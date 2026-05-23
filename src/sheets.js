import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile:
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "./google-credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

/**
 * Traverses the master directory list to cross-reference and isolate gymnast profiles
 */
async function findGymnastFromMasterList(savedContact, referenceText) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Master List!A:C",
    });
    const rows = response.data.values;
    if (!rows || rows.length <= 1) return "";

    const lookupString = `${savedContact} ${referenceText}`.toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const gymnastName = rows[i][0] ? rows[i][0].trim() : "";
      const parentName = rows[i][1] ? rows[i][1].trim() : "";
      if (gymnastName.length <= 1) continue;

      if (
        (parentName && lookupString.includes(parentName.toLowerCase())) ||
        (gymnastName && lookupString.includes(gymnastName.toLowerCase()))
      ) {
        return gymnastName;
      }
    }
  } catch (err) {
    console.error("❌ Master List Cross-Ref Error:", err.message);
  }
  return "";
}

/**
 * Checks past logging transactions to prevent processing duplicate submissions
 */
async function isDuplicateTransaction(transactionId) {
  if (!transactionId || transactionId.trim() === "" || transactionId === "null")
    return false;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Payment History!G:G",
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

/**
 * Dynamically constructs a sequential receipt key matching the AGYYYYMMDD000001 pattern.
 * @param {string} dateStr - Input date string (expected format "DD/MM/YYYY HH:mm:ss")
 */
async function generateNextReceiptId(dateStr) {
  try {
    // 1. Fallback to today if string is corrupt or missing
    let targetDate = new Date();
    if (dateStr && dateStr.includes("/")) {
      const parts = dateStr.split(" ")[0].split("/");
      targetDate = new Date(parts[2], parts[1] - 1, parts[0]);
    }

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const day = String(targetDate.getDate()).padStart(2, "0");
    const datePrefix = `AG${year}${month}${day}`; // e.g., AG20260523

    // 2. Fetch past receipt records from Column J
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Payment History'!J2:J5000",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return `${datePrefix}000001`;
    }

    // 3. Filter IDs issued on this exact calendar day
    const todaysReceipts = rows
      .map((row) => (row[0] ? String(row[0]).trim() : ""))
      .filter((id) => id.startsWith(datePrefix));

    if (todaysReceipts.length === 0) {
      return `${datePrefix}000001`; // First transaction of the day
    }

    // 4. Extract numerical counters, find max, and increment by 1
    const counters = todaysReceipts
      .map((id) => {
        const numericPart = id.replace(datePrefix, "");
        return parseInt(numericPart, 10);
      })
      .filter((num) => !isNaN(num));

    const highestCounter = counters.length > 0 ? Math.max(...counters) : 0;
    const nextCounterStr = String(highestCounter + 1).padStart(6, "0");

    return `${datePrefix}${nextCounterStr}`;
  } catch (err) {
    console.error(
      "⚠️ Error generating serial receipt number, fallback applied:",
      err.message,
    );
    const randomPadding = String(Math.floor(100000 + Math.random() * 900000));
    return `AGERROR${randomPadding}`;
  }
}

/**
 * Merged functional pipeline logging payment rows to Google Sheets
 */
export async function appendPaymentRow(analysis, whatsappMeta) {
  try {
    // 1. Guard against duplicate entries
    const hasDuplicate = await isDuplicateTransaction(analysis.transaction_id);
    if (hasDuplicate) {
      console.log(
        `🛑 [DUPLICATE BLOCKED] Transaction ID ${analysis.transaction_id} already logged.`,
      );
      return { success: false, isDuplicate: true };
    }

    // 2. Dynamic profile lookups
    const savedContact = whatsappMeta.pushName || whatsappMeta.phoneNumber;
    let gymnastName =
      analysis.gymnast_name && analysis.gymnast_name !== "null"
        ? analysis.gymnast_name
        : "";

    if (!gymnastName || gymnastName.trim() === "") {
      gymnastName = await findGymnastFromMasterList(
        savedContact,
        analysis.reference || "",
      );
    }

    // 3. Generate receipt ID matching the new AGYYYYMMDD000001 template pattern
    const receiptString = await generateNextReceiptId(
      analysis.transaction_date,
    );

    // 4. Clean parameters
    const cleanReference =
      analysis.reference && analysis.reference !== "null"
        ? analysis.reference
        : "";
    const cleanTxnId =
      analysis.transaction_id && analysis.transaction_id !== "null"
        ? analysis.transaction_id
        : "";
    const cleanMethod = analysis.payment_method || "Instant Transfer";
    const cleanTerm =
      analysis.month_term_covered && analysis.month_term_covered !== "null"
        ? analysis.month_term_covered
        : "";

    // 5. Build explicit 10-column layout row matching your visual headers
    const rowValues = [
      analysis.transaction_date, // Column A: Date
      savedContact, // Column B: Saved Contact
      `'${whatsappMeta.phoneNumber}`, // Column C: Phone Number
      gymnastName || "Manual Review Required", // Column D: Gymnast Name
      analysis.amount || 0, // Column E: Amount
      cleanReference, // Column F: Reference
      `'${cleanTxnId}`, // Column G: Transaction ID
      cleanMethod, // Column H: Payment Method
      cleanTerm, // Column I: Month/Term Covered
      receiptString, // Column J: Receipt ID
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Payment History!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowValues] },
    });

    console.log(
      `📝 [SHEETS SUCCESS] Row logged with Serial ID: ${receiptString}`,
    );

    return {
      success: true,
      receiptNumber: receiptString,
      gymnastName: gymnastName || "Unresolved Profile (Pending Admin)",
      amount: analysis.amount || 0,
    };
  } catch (error) {
    console.error(
      "❌ Google Sheets sync pipeline execution runtime failure:",
      error.message,
    );
    return { success: false, error: error.message };
  }
}
