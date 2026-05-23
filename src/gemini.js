import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

// Ordered fallback models pool list. Each model represents a fresh, separate RPD free quota tier bucket!
const FREE_MODEL_POOL = [
  "gemini-2.5-flash-lite", // Default Target
  "gemini-2.5-flash", // Fallback Target 1
  "gemini-1.5-flash", // Fallback Target 2
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

  // Use a pool index cursor that tracks across loop execution iterations
  let modelPoolIndex = 0;

  for (let i = 0; i < retries; i++) {
    // Dynamically pick the model from the remaining pool
    const targetModel = FREE_MODEL_POOL[modelPoolIndex];

    try {
      console.log(
        `🧠 [GEMINI API] Invoking generation request. Model target: [${targetModel}] (Attempt ${i + 1}/${retries})`,
      );

      const response = await ai.models.generateContent({
        model: targetModel, // Dynamic structural target placement
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

      return JSON.parse(response.text);
    } catch (error) {
      const errorMessage = error.message || String(error);
      const isQuotaError =
        error.status === 429 ||
        error.statusCode === 429 ||
        errorMessage.includes("429") ||
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.includes("RESOURCE_EXHAUSTED");

      if (isQuotaError) {
        // If we have models left in the free rotation pool, pivot right away!
        if (modelPoolIndex < FREE_MODEL_POOL.length - 1) {
          modelPoolIndex++;
          console.warn(
            `🔄 [QUOTA FALLBACK] Model [${targetModel}] exhausted. Swapping to backup model: [${FREE_MODEL_POOL[modelPoolIndex]}] immediately...`,
          );

          // Small 1.5-second buffer sleep to ensure sockets drop cleanly before hitting the alternative pool model
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        } else if (i < retries - 1) {
          // If all models in our rotation are completely exhausted, fallback to standard per-minute time backoffs
          console.warn(
            `⏳ [RATE LIMIT] All pool models exhausted. Sleeping for 16 seconds on standard loop constraint context...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 16000));
          continue;
        }
      }

      // Log ordinary system network drop exceptions (e.g., 500, 503, timeouts)
      console.error(`⚠️ [API TRY ${i + 1}/${retries} FAILED]:`, errorMessage);

      if (i === retries - 1) {
        throw new Error(
          `Gemini API exhausted all fallback pool models and retry attempts. Last Error: ${errorMessage}`,
        );
      }

      // Linear backoff logic for standard non-quota errors (e.g., 1.5s, 3s)
      await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
    }
  }
}
