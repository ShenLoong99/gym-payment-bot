import { google } from "googleapis";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile:
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "./google-credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

function generateRecordId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function findGymnastFromMasterList(recipientReference) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Master List!A:B",
    });
    const rows = response.data.values;
    if (!rows || rows.length <= 1) return null;

    const lookupString = String(recipientReference).toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const gymnastId = rows[i][0] ? rows[i][0].trim() : "";
      const gymnastName = rows[i][1] ? rows[i][1].trim() : "";

      if (gymnastName.length <= 1) continue;

      if (lookupString.includes(gymnastName.toLowerCase())) {
        console.log(
          `🎯 [MATCH FOUND] Linked name "${gymnastName}" to Gymnast ID: ${gymnastId}`,
        );
        return { id: gymnastId, name: gymnastName };
      }
    }
    console.log(
      `⚠️ [NO MATCH] Could not automatically resolve a Gymnast ID for: "${lookupString}"`,
    );
  } catch (err) {
    console.error("❌ Master List Cross-Ref Error:", err.message);
  }
  return null;
}

async function isDuplicateTransaction(transactionId) {
  if (!transactionId || transactionId.trim() === "" || transactionId === "null")
    return false;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Payment History!J:J", // Points directly to Transaction ID column
    });
    const rows = response.data.values;
    if (!rows) return false;

    const cleanSearchId = transactionId.trim().toLowerCase();
    return rows.some(
      (row) =>
        row[0] && row[0].replace(/['\s]/g, "").toLowerCase() === cleanSearchId,
    );
  } catch (err) {
    console.error("❌ Duplicate detection error:", err.message);
    return false;
  }
}

async function generateNextReceiptId(dateStr) {
  try {
    let targetDate = new Date();
    if (dateStr && dateStr.includes("/")) {
      const parts = dateStr.split(" ")[0].split("/");
      targetDate = new Date(parts[2], parts[1] - 1, parts[0]);
    }

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const day = String(targetDate.getDate()).padStart(2, "0");
    const datePrefix = `AG${year}${month}${day}`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Payment History'!N2:N5000", // Evaluates column N for receipt IDs
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return `${datePrefix}000001`;

    const todaysReceipts = rows
      .map((row) => (row[0] ? String(row[0]).trim() : ""))
      .filter((id) => id.startsWith(datePrefix));

    if (todaysReceipts.length === 0) return `${datePrefix}000001`;

    const counters = todaysReceipts
      .map((id) => parseInt(id.replace(datePrefix, ""), 10))
      .filter((num) => !isNaN(num));

    const highestCounter = counters.length > 0 ? Math.max(...counters) : 0;
    return `${datePrefix}${String(highestCounter + 1).padStart(6, "0")}`;
  } catch (err) {
    console.error("⚠️ Error generating serial receipt number:", err.message);
    return `AGERROR${String(Math.floor(100000 + Math.random() * 900000))}`;
  }
}

export async function appendPaymentRow(analysis, whatsappMeta) {
  try {
    const hasDuplicate = await isDuplicateTransaction(analysis.transaction_id);
    if (hasDuplicate) {
      console.log(
        `🛑 [DUPLICATE BLOCKED] Transaction ID ${analysis.transaction_id} already logged.`,
      );
      return { success: false, isDuplicate: true };
    }

    const savedContact = whatsappMeta.pushName || whatsappMeta.phoneNumber;
    const lookupText = analysis.recipient_reference || "";

    const resolvedGymnast = await findGymnastFromMasterList(lookupText);
    const gymnastIdRef = resolvedGymnast ? resolvedGymnast.id : "";
    const gymnastName = resolvedGymnast
      ? resolvedGymnast.name
      : analysis.gymnast_name || "Manual Review Required";

    const receiptString = await generateNextReceiptId(
      analysis.transaction_date,
    );

    const cleanTxnId =
      analysis.transaction_id && analysis.transaction_id !== "null"
        ? analysis.transaction_id
        : "";
    const cleanMethod = analysis.payment_method || "Instant Transfer";

    const recordId = generateRecordId();

    const now = new Date();
    const formattedLogDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    // Cleaned 14-Column Values Array
    const rowValues = [
      recordId, // Column A: Record ID
      analysis.transaction_date, // Column B: Date
      formattedLogDate, // Column C: Date Row Created
      savedContact, // Column D: Saved Contact
      `'${whatsappMeta.phoneNumber}`, // Column E: Phone Number
      gymnastIdRef, // Column F: Gymnast ID Ref
      gymnastName, // Column G: Gymnast Name
      analysis.amount || 0, // Column H: Amount
      lookupText, // Column I: Recipient Reference
      `'${cleanTxnId}`, // Column J: Transaction ID
      cleanMethod, // Column K: Payment Method
      analysis.payment_covered, // Column L: Payment Covered (Enum dropdown)
      analysis.revenue_start_date, // Column M: Revenue Start Date (YYYY-MM-DD)
      receiptString, // Column N: Receipt ID
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Payment History!A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowValues] },
    });

    console.log(
      `📝 [SHEETS SUCCESS] Row logged with Record ID: ${recordId} | Created at: ${formattedLogDate}`,
    );

    return {
      success: true,
      receiptNumber: receiptString,
      gymnastName: gymnastName,
      amount: analysis.amount || 0,
    };
  } catch (error) {
    console.error("❌ Google Sheets sync runtime failure:", error.message);
    return { success: false, error: error.message };
  }
}
