import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

// Hardened Fallback Pool containing 4 optimal OCR and structured-schema models
const FREE_MODEL_POOL = [
  "gemini-2.5-flash-lite", // 1. Primary Low-Latency Target
  "gemini-2.5-flash", // 2. High Reasoning Vision Backup
  "gemini-2.0-flash", // 3. Ultra-Stable Generation Backup
  "gemini-2.5-pro", // 4. Elite-Tier Parsing Heavyweight
];

export async function extractReceiptData(fileBuffer, mimeType, retries = 3) {
  const base64Data = fileBuffer.toString("base64");

  const prompt = `
    You are a senior security auditing accountant for Airborne Gymnastics Center.
    Analyze this uploaded document carefully and extract structural values.
    
    CRITICAL FILTER RULES:
    1. CLASSIFICATION & EXCLUSIONS: 
       - Set isGymnasticsFee to true ONLY if this document is a payment confirmation for regular gymnastics ACADEMY/TUITION TRAINING FEES (e.g., monthly fees, term fees, class packages).
       - ABSOLUTELY REJECT and set isGymnasticsFee to false if the receipt or reference notes payments for merchandise, clothing, equipment, or non-tuition transactions (e.g., "buying leotard", "uniform", "grip bag", "chalk", "t-shirt", "coffee").
    
    2. DATE EXTRACTION: Find the transaction date and time on the document. Format it EXACTLY as "DD/MM/YYYY HH:mm:ss". If missing, return "".
    
    3. RECIPIENT REFERENCE EXTRACTION: Look closely for fields named 'Recipient reference', 'Payment details', 'Remarks', or 'Description'. You MUST extract the FULL literal text match without truncating or changing it. (e.g., "Ng Wing Hin May-Jul" must be returned exactly as "Ng Wing Hin May-Jul").
    
    4. PAYMENT METHOD STANDARDIZATION: Normalize strictly into the format: "Bank/eWallet Name - Payment Channel".
       Examples:
       - Maybank DuitNow Transfer -> "Maybank - DuitNow Transfer"
       - Touch 'n Go eWallet -> "Touch 'n Go - eWallet"
       - Public Bank Online Transfer -> "Public Bank - Internet Banking"
       
    5. MONTH/TERM COVERED STANDARDIZATION: Parse references to targeted payment months/terms. Standardize output to match: "ShortMonth Year - ShortMonth Year" or "ShortMonth Year".
       - If it says "May-Jul" and the transaction date is in 2026, infer the year and output: "May 2026 - Jul 2026".
       - If it says "May 2026", output: "May 2026".
       - If missing, return "".

    6. FORGERY ANALYSIS: Evaluate layout integrity. Assign a score from 0-100.
  `;

  let modelPoolIndex = 0;

  for (let i = 0; i < retries; i++) {
    const targetModel = FREE_MODEL_POOL[modelPoolIndex];

    try {
      console.log(
        `🧠 [GEMINI API] Invoking generation request. Model target: [${targetModel}] (Attempt ${i + 1}/${retries})`,
      );

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: prompt },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isGymnasticsFee: { type: Type.BOOLEAN },
              forgery_verification_confidence: { type: Type.INTEGER },
              transaction_date: { type: Type.STRING },
              gymnast_name: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              reference: {
                type: Type.STRING,
                description:
                  "Full literal text from the reference/remarks field.",
              },
              payment_method: {
                type: Type.STRING,
                description:
                  "Standardized format: 'Bank/eWallet name - bank method'",
              },
              month_term_covered: {
                type: Type.STRING,
                description:
                  "Standardized format: 'Mmm YYYY - Mmm YYYY' or 'Mmm YYYY'",
              },
              transaction_id: { type: Type.STRING },
            },
            required: [
              "isGymnasticsFee",
              "forgery_verification_confidence",
              "transaction_date",
              "reference",
              "payment_method",
              "month_term_covered",
            ],
          },
        },
      });

      // Verification check: make sure text returned is non-empty
      if (!response.text) {
        throw new Error("Empty text returned from Gemini channel endpoint.");
      }

      return JSON.parse(response.text);
    } catch (error) {
      const errorMessage = error.message || String(error);

      // Strict Check: Did Google explicitly return a 429 Quota Exhaustion?
      const isQuotaError =
        error.status === 429 ||
        error.statusCode === 429 ||
        errorMessage.includes("429") ||
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.includes("RESOURCE_EXHAUSTED");

      if (isQuotaError) {
        if (modelPoolIndex < FREE_MODEL_POOL.length - 1) {
          modelPoolIndex++;
          console.warn(
            `🔄 [QUOTA FALLBACK] Genuine 429 detected. Swapping to backup model: [${FREE_MODEL_POOL[modelPoolIndex]}]...`,
          );
          // Cool-down sleep increased to 3 seconds to let parallel webhook traffic clear out cleanly
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        } else {
          console.warn(
            `⏳ [RATE LIMIT] All pool models saturated. Cooling down for 15 seconds...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 15000));
          continue;
        }
      }

      // If it's a standard operational error (e.g., download mismatch or network timeout),
      // retry on the SAME model first instead of immediately burning fallbacks!
      console.error(
        `⚠️ [API TRY ${i + 1}/${retries} FAILED on ${targetModel}]:`,
        errorMessage,
      );

      if (i === retries - 1) {
        throw new Error(
          `Gemini API exhausted all fallback pool models and retry attempts. Last Error: ${errorMessage}`,
        );
      }

      // Standard incremental backoff delay (1.5s, 3s)
      await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
    }
  }
}
