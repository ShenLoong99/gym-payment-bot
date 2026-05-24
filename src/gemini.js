import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

const FREE_MODEL_POOL = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

const MAX_RETRIES = FREE_MODEL_POOL.length;

// ── Helper: safely extract text from response regardless of SDK version ───────
function extractResponseText(response) {
  // New SDK: response.text is a function
  if (typeof response.text === "function") {
    return response.text();
  }
  // Old SDK: response.text is a string property
  if (typeof response.text === "string") {
    return response.text;
  }
  // Fallback: dig into candidates manually
  const candidate = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (candidate) return candidate;

  throw new Error(
    `Cannot extract text from response. Keys: ${Object.keys(response).join(", ")}`,
  );
}

// ── Helper: strict 429 detection — do NOT trigger on empty/undefined response ─
function isGenuine429(error) {
  // Must have explicit HTTP 429 or quota keywords — undefined text is NOT a quota error
  return (
    error.status === 429 ||
    error.statusCode === 429 ||
    (error.message?.includes("429") && !error.message?.includes("undefined")) ||
    error.message?.toLowerCase().includes("resource_exhausted") ||
    error.message?.toLowerCase().includes("quota exceeded")
  );
}

export async function extractReceiptData(
  fileBuffer,
  mimeType,
  retries = MAX_RETRIES,
) {
  const base64Data = fileBuffer.toString("base64");

  const prompt = `
    You are a senior security auditing accountant for Airborne Gymnastics Center.
    Analyze this uploaded document carefully and extract structural values.
    
    CRITICAL FILTER RULES:
    1. CLASSIFICATION & EXCLUSIONS: 
       - Set isGymnasticsFee to true ONLY if this document is a payment confirmation for regular gymnastics ACADEMY/TUITION TRAINING FEES (e.g., monthly fees, term fees, class packages).
       - ABSOLUTELY REJECT and set isGymnasticsFee to false if the receipt or reference notes payments for merchandise, clothing, equipment, or non-tuition transactions.
    
    2. DATE EXTRACTION: Format EXACTLY as "DD/MM/YYYY HH:mm:ss". If missing, return "".
    
    3. RECIPIENT REFERENCE EXTRACTION: Extract the FULL literal text from 'Recipient reference', 'Payment details', 'Remarks', or 'Description' fields without truncating.
    
    4. PAYMENT METHOD STANDARDIZATION: Normalize to "Bank/eWallet Name - Payment Channel".
       Examples:
       - Maybank DuitNow Transfer -> "Maybank - DuitNow Transfer"
       - Touch 'n Go eWallet -> "Touch 'n Go - eWallet"
       - Public Bank Online Transfer -> "Public Bank - Internet Banking"
       
    5. MONTH/TERM COVERED: Standardize to "ShortMonth Year - ShortMonth Year" or "ShortMonth Year".
       - "May-Jul" with 2026 transaction date -> "May 2026 - Jul 2026"
       - If missing, return "".

    6. FORGERY ANALYSIS: Evaluate layout integrity. Assign a score 0-100.
  `;

  let modelPoolIndex = 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    const targetModel = FREE_MODEL_POOL[modelPoolIndex];

    try {
      console.log(
        `🧠 [GEMINI API] Model: [${targetModel}] | Attempt ${attempt + 1}/${retries}`,
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
              reference: { type: Type.STRING },
              payment_method: { type: Type.STRING },
              month_term_covered: { type: Type.STRING },
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

      // ✅ FIX #2: Use version-safe text extractor instead of response.text directly
      const rawText = extractResponseText(response);

      console.log(`🧠 [GEMINI RAW RESPONSE]: ${rawText}`);

      if (!rawText || rawText.trim() === "") {
        throw new Error("Empty text returned from Gemini endpoint.");
      }

      // Strip potential markdown fences before parsing
      const clean = rawText.replace(/```json|```/g, "").trim();
      return JSON.parse(clean);
    } catch (error) {
      const errorMessage = error.message || String(error);
      console.error(
        `⚠️ [ATTEMPT ${attempt + 1}/${retries} FAILED on ${targetModel}]: ${errorMessage}`,
      );

      // ✅ FIX #3: Only burn a fallback model on a confirmed real 429
      if (isGenuine429(error)) {
        if (modelPoolIndex < FREE_MODEL_POOL.length - 1) {
          modelPoolIndex++;
          console.warn(
            `🔄 [QUOTA FALLBACK] Confirmed 429. Switching to: [${FREE_MODEL_POOL[modelPoolIndex]}]`,
          );
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        } else {
          console.warn(`⏳ [RATE LIMIT] All models saturated. Cooling 15s...`);
          await new Promise((resolve) => setTimeout(resolve, 15000));
          continue;
        }
      }

      // Non-quota error: retry on SAME model with backoff
      if (attempt < retries - 1) {
        const delay = 1500 * (attempt + 1);
        console.log(`🔁 Retrying same model in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(
        `Gemini API failed after all retries. Last error: ${errorMessage}`,
      );
    }
  }
}
