import { google } from "googleapis";
import dotenv from "dotenv";
import crypto from "crypto";
import { getColumnLetter, formatSheetDate } from "./helper.js";

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile:
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "./google-credentials.json",
  scopes: [["https://www.googleapis.com/auth/spreadsheets"]],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

function generateRecordId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Helper to dynamically fetch the header row from any given tab and return it as a clean array of header names for flexible column index resolution in other operations
 */
async function getTabHeaders(tabName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:Z1`, // Targets the first row dynamically
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error(
        `No headers found or tab is empty in sheet: "${tabName}"`,
      );
    }

    // Return headers cleaned of leading/trailing whitespaces
    return rows[0].map((header) => (header || "").trim());
  } catch (error) {
    console.error(
      `❌ Failed to retrieve headers for tab "${tabName}":`,
      error.message,
    );
    throw error;
  }
}

/**
 * Fetches the administrative cut-off day config number dynamically from the Config sheet
 */
async function getCutOffDay() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2",
    });
    const rows = response.data.values;
    if (rows && rows[0] && rows[0][0]) {
      const cutOff = parseInt(rows[0][0].trim(), 10);
      if (!isNaN(cutOff)) return cutOff;
    }
  } catch (err) {
    console.error(
      "⚠️ Config retrieval failed. Defaulting cut-off to day 1:",
      err.message,
    );
  }
  return 1;
}

/**
 * Core Business Logic Rule Matrix Engine
 */
function calculateNextDueDate(startDateStr, paymentCovered, cutOffDay) {
  if (!startDateStr || startDateStr.toLowerCase() === "n/a") return null;

  const parts = startDateStr.split("/");
  if (parts.length !== 3) return null;

  let day = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);

  let targetDate = new Date(year, month, day);
  let incrementMonths = 1;

  const normalizedCovered = (paymentCovered || "").toLowerCase();
  if (
    normalizedCovered.includes("term") ||
    normalizedCovered.includes("3 month")
  ) {
    incrementMonths = 3;
  }

  targetDate.setMonth(targetDate.getMonth() + incrementMonths);

  if (targetDate.getDate() > cutOffDay) {
    targetDate.setDate(cutOffDay);
  }

  return formatSheetDate(targetDate);
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

    // 1. Fetch headers dynamically from Payment History using your global helper
    const headers = await getTabHeaders("Payment History");
    const receiptIdColIdx = headers.indexOf("Receipt ID");

    // Fallback if the column header name gets renamed or deleted
    if (receiptIdColIdx === -1) {
      throw new Error(
        "'Receipt ID' column header name not found in Payment History tab.",
      );
    }

    // 2. Resolve index dynamically to its spreadsheet column A1 letter notation
    const colLetter = getColumnLetter(receiptIdColIdx);

    // 3. Update the range string dynamically using the resolved column letter letter
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Payment History'!${colLetter}2:${colLetter}5000`, // Dynamically targets the correct column range
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

export async function isDuplicateTransaction(transactionId) {
  if (!transactionId || transactionId === "N/A") return false;

  try {
    // 1. Fetch headers dynamically from Payment History
    const headers = await getTabHeaders("Payment History");
    const txnIdColIdx = headers.indexOf("Transaction ID");

    // Fallback: If column name is modified or missing, alert early safely
    if (txnIdColIdx === -1) {
      console.warn(
        "⚠️ [DUPLICATE CHECK SKIPPED] 'Transaction ID' column not found in headers.",
      );
      return false;
    }

    // 2. Resolve index to its actual sheet A1 column letter notation dynamically
    const colLetter = getColumnLetter(txnIdColIdx);

    // 3. Request data rows using the dynamic column range letter
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Payment History!${colLetter}:${colLetter}`,
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
 * Primary Exporter Module called directly by core Baileys network ingestion layer loops
 */
export async function appendPaymentRow(analysis, whatsappMeta) {
  try {
    const hasDuplicate = await isDuplicateTransaction(analysis.transaction_id);
    if (hasDuplicate) {
      console.log(
        `🛑 [DUPLICATE BLOCKED] Transaction ID ${analysis.transaction_id} already logged.`,
      );
      return { success: false, isDuplicate: true };
    }

    const recordId = generateRecordId();
    const now = new Date();

    // Format timestamp exactly like GitHub template: YYYY-MM-DD HH:MM:SS
    const formattedLogDate =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ` +
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const receiptString = await generateNextReceiptId(
      analysis.transaction_date,
    );

    const gymnastName = analysis.gymnast_name || "Unknown Gymnast";

    // 1. Fetch Master List data to resolve gymnast rows and track headers dynamically
    const masterListRef = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Master List!A1:Z",
    });

    const masterRows = masterListRef.data.values;
    let resolvedGymnast = null;
    let matchedGymnastId = "N/A";

    if (masterRows && masterRows.length > 0) {
      const headers = await getTabHeaders("Master List");

      const gymnastIdColIdx = headers.indexOf("ID");
      const gymnastNameColIdx = headers.indexOf("Gymnast Name");
      const nextDueDateColIdx = headers.indexOf("Next Due Date");
      const paymentStatusColIdx = headers.indexOf("Payment Status");

      if (gymnastNameColIdx !== -1) {
        for (let i = 1; i < masterRows.length; i++) {
          const row = masterRows[i];
          if (
            row[gymnastNameColIdx] &&
            row[gymnastNameColIdx].trim().toLowerCase() ===
              gymnastName.trim().toLowerCase()
          ) {
            if (gymnastIdColIdx !== -1 && row[gymnastIdColIdx]) {
              matchedGymnastId = row[gymnastIdColIdx].trim();
            }

            resolvedGymnast = {
              rowIndex: i + 1,
              nextDueDateColIdx: nextDueDateColIdx,
              paymentStatusColIdx: paymentStatusColIdx,
            };
            break;
          }
        }
      }
    }

    // 2. Fetch Payment History structural headers to populate values dynamically by name
    const historyHeaderRef = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Payment History!A1:Z1",
    });

    const historyHeaders =
      historyHeaderRef.data.values?.[0]?.map((h) => (h || "").trim()) || [];
    if (historyHeaders.length === 0) {
      throw new Error(
        "Critical: Payment History headers are completely missing or unreachable.",
      );
    }

    // Map content using the exact structure criteria from the original GitHub logs
    const historyDataMap = {
      "Record ID": recordId,
      "Transact Date": analysis.transaction_date || "N/A",
      "Row Created": formattedLogDate,
      "Saved Contact": whatsappMeta.pushName || "Unknown Profile",
      "Phone Number": `'${whatsappMeta.phoneNumber}`,
      "ID Ref": matchedGymnastId,
      "Gymnast Name": gymnastName,
      "Amount": analysis.amount,
      "Reference": analysis.recipient_reference || "N/A",
      "Transaction ID": `'${analysis.transaction_id || "N/A"}`,
      "Payment Method": analysis.payment_method || "Instant Transfer",
      "Payment Covered": analysis.payment_covered || "N/A",
      "Revenue Start": analysis.revenue_start_date || "N/A",
      "Receipt ID": receiptString,
    };

    // Construct the row array dynamically based on the header text sequence found
    const paymentHistoryFields = historyHeaders.map((headerName) => {
      return historyDataMap[headerName] !== undefined
        ? historyDataMap[headerName]
        : "";
    });

    // Write row back into tracking history tab
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Payment History!A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [paymentHistoryFields] },
    });
    console.log(
      `📝 [SHEETS SUCCESS] Row logged with Record ID: ${recordId} | Created at: ${formattedLogDate}`,
    );

    // 3. Conditionally update fields safely if targeted accurately by real-time text tags
    if (resolvedGymnast && resolvedGymnast.rowIndex) {
      const cutOffDay = await getCutOffDay();
      const computedDueDate = calculateNextDueDate(
        analysis.revenue_start_date,
        analysis.payment_covered,
        cutOffDay,
      );

      if (resolvedGymnast.paymentStatusColIdx !== -1) {
        const statusLetter = getColumnLetter(
          resolvedGymnast.paymentStatusColIdx,
        );
        const statusRange = `Master List!${statusLetter}${resolvedGymnast.rowIndex}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: statusRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["On Time"]] },
        });
        console.log(
          `🎯 [MASTER LIST UPDATED] Set Payment Status to [On Time] in cell [${statusRange}]`,
        );
      }

      if (computedDueDate && resolvedGymnast.nextDueDateColIdx !== -1) {
        const dueDateLetter = getColumnLetter(
          resolvedGymnast.nextDueDateColIdx,
        );
        const dueDateRange = `Master List!${dueDateLetter}${resolvedGymnast.rowIndex}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: dueDateRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[computedDueDate]] },
        });
        console.log(
          `🎯 [MASTER LIST UPDATED] Set Next Due Date to [${computedDueDate}] in cell [${dueDateRange}] for gymnast: ${gymnastName}`,
        );
      }
    } else {
      console.warn(
        "⚠️ [SKIPPED MASTER UPDATE] Could not resolve matching gymnast profile in Master List safely.",
      );
    }

    return {
      success: true,
      receiptNumber: receiptString,
      gymnastName: gymnastName,
      amount: analysis.amount || 0,
    };
  } catch (error) {
    console.error(
      "❌ Google Sheets Core Engine Processing Error:",
      error.message,
    );
    throw error;
  }
}
