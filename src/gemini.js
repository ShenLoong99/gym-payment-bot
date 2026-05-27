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
  if (typeof response.text === "function") {
    return response.text();
  }
  if (typeof response.text === "string") {
    return response.text;
  }
  const candidate = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (candidate) return candidate;

  throw new Error(
    `Cannot extract text from response. Keys: ${Object.keys(response).join(", ")}`,
  );
}

// ── Helper: strict 429 detection ─────────────────────────────────────────────
function isGenuine429(error) {
  return (
    error.status === 429 ||
    error.statusCode === 429 ||
    String(error).includes("429") ||
    String(error).toLowerCase().includes("quota")
  );
}

/**
 * Enhanced Gemini extraction schema split to support explicit reference lookups
 */
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    isGymnasticsFee: {
      type: Type.BOOLEAN,
      description:
        "True if the document is a bank receipt/payment statement representing tuition/fees paid to Airborne Gymnastics Center.",
    },
    forgery_verification_confidence: {
      type: Type.INTEGER,
      description:
        "Confidence rating (1-100) that this document is unaltered and authentic.",
    },
    transaction_date: {
      type: Type.STRING,
      description:
        "Date and time of transaction in exact format 'DD/MM/YYYY HH:MM:SS'. For example: '20/05/2026 12:14:00'.",
    },
    recipient_reference: {
      type: Type.STRING,
      description:
        "The complete, raw text extracted verbatim from the 'Recipient reference' field (e.g., 'Ng Wing Hin May-Jul'). Essential for student matching.",
    },
    transaction_id: {
      type: Type.STRING,
      description:
        "The unique Reference ID tracking number of the transaction (e.g., '018997386M').",
    },
    payment_method: {
      type: Type.STRING,
      description:
        "Bank origin name coupled with the transaction framework (e.g., 'Maybank - DuitNow Transfer').",
    },
    payment_covered: {
      type: Type.STRING,
      enum: ["Monthly", "Termly", "Per Session"],
      description:
        "Classify the structure of the payment. Choose 'Monthly' if paying for a single month, 'Termly' if paying for a block/term of multiple months, or 'Per Session' if paying a single walk-in/one-time session fee.",
    },
    revenue_start_date: {
      type: Type.STRING,
      description:
        "The exact calendar start date of the period being paid for. For 'June 2026' return '2026-06-01'. For 'May 2026 - Aug 2026' return '2026-05-01'. For a specific session '1 May 2026' return '2026-05-01'.",
    },
    amount: {
      type: Type.NUMBER,
      description:
        "The numeric dollar/RM quantity processed on the transaction document ledger.",
    },
    gymnast_name: {
      type: Type.STRING,
      description:
        "The explicit student/gymnast name if written anywhere on the invoice note, reference, or description fields.",
    },
  },
  required: [
    "isGymnasticsFee",
    "forgery_verification_confidence",
    "transaction_date",
    "recipient_reference",
    "transaction_id",
    "payment_method",
    "payment_covered",
    "revenue_start_date",
    "amount",
    "gymnast_name",
  ],
};

/**
 * Core LLM parsing execution pipeline using structural JSON formatting constraints
 */
export async function extractReceiptData(
  pdfBuffer,
  mimeType = "application/pdf",
  retries = MAX_RETRIES,
) {
  let modelPoolIndex = 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    const targetModel = FREE_MODEL_POOL[modelPoolIndex];
    try {
      console.log(
        `🧠 [GEMINI API] Attempt ${attempt + 1}/${retries} using model: [${targetModel}]`,
      );

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: pdfBuffer.toString("base64"),
                  mimeType: mimeType,
                },
              },
              {
                text: "Analyze this transaction slip document. Map out all extraction parameters exactly matching the structured JSON format guidelines provided.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.1, // Set lower temperature for higher factual accuracy
        },
      });

      const rawText = extractResponseText(response);
      if (!rawText || rawText.trim() === "") {
        throw new Error("Empty text returned from Gemini endpoint.");
      }

      const clean = rawText.replace(/```json|```/g, "").trim();
      return JSON.parse(clean);
    } catch (error) {
      const errorMessage = error.message || String(error);
      console.error(
        `⚠️ [ATTEMPT ${attempt + 1}/${retries} FAILED on ${targetModel}]: ${errorMessage}`,
      );

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

      if (attempt < retries - 1) {
        const delay = 1500 * (attempt + 1);
        console.log(`🔁 Retrying same model in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(
          `❌ Gemini extraction execution completely exhausted: ${errorMessage}`,
        );
      }
    }
  }
}
