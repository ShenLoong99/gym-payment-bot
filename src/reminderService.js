import cron from "node-cron";
import { google } from "googleapis";
import dotenv from "dotenv";
import {
  isBotProcessingAllowed,
  isReplyAndReceiptAllowed,
  isReminderActive,
} from "./telegramAdmin.js";
import { sendUniversalTelegramError } from "./logger.js";

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile:
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "./google-credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

/**
 * Helper to parse DD/MM/YYYY date strings cleanly into a JS Date object
 */
function parseSheetDate(dateStr) {
  if (!dateStr || dateStr.trim() === "" || dateStr === "N/A") return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  return new Date(
    parseInt(parts[2], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[0], 10),
  );
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
      "⚠️ [REMINDER CONFIG FETCH FAILED] Defaulting cut-off to day 1:",
      err.message,
    );
  }
  return 1;
}

/**
 * Core Reminder Execution Engine
 */
export async function runReminderEngine(whatsappSocket, contextTriggerSource) {
  // If the toggle is off, exit immediately before doing any work.
  const activeStatus = await isReminderActive();

  // 2. Check the resolved boolean value
  if (activeStatus === false) {
    console.log(
      `ℹ️ [REMINDER ENGINE] Skipped scan: Reminder toggle is currently OFF in settings.`,
    );
    return { success: false, reason: "Reminder toggle is disabled" };
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const formattedTodayStr = today.toLocaleDateString("en-GB");

    console.log(
      `📡 [REMINDER ENGINE] Initializing scan loop via: [${contextTriggerSource}]...`,
    );

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Master List!A1:Z",
    });

    const rows = response.data.values; // ✅ Declared only once
    if (!rows || rows.length <= 1) {
      console.log(
        "ℹ️ [REMINDER] Master List sheet contains no actionable roster rows.",
      );
      return { success: true, count: 0, roster: [] };
    }

    // ✅ Header indices mapped dynamically from the top row
    const headers = rows[0].map((h) => (h || "").trim());
    const gymnastNameColIdx = headers.indexOf("Gymnast Name");
    const phoneNumberColIdx = headers.indexOf("Parents Contact");
    const nextDueDateColIdx = headers.indexOf("Next Due Date");
    const paymentStatusColIdx = headers.indexOf("Payment Status");
    const reminderDateColIdx = headers.indexOf("Reminder Date");

    // Guard check to ensure columns exist before parsing rows
    if (
      gymnastNameColIdx === -1 ||
      phoneNumberColIdx === -1 ||
      nextDueDateColIdx === -1 ||
      paymentStatusColIdx === -1
    ) {
      console.error(
        "❌ [REMINDER ERROR] Critical tracking columns are missing from Master List row headers.",
      );
      return { success: false, count: 0, roster: [] };
    }

    let remindersDispatchedCount = 0;
    const targetsNotifiedRosterList = [];
    const remindersSent = [];

    // Iterate from row 2 onwards (index 1 is the first data row)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1;

      const gymnastName = row[gymnastNameColIdx]
        ? row[gymnastNameColIdx].trim()
        : "Unknown";
      const rawPhone = row[phoneNumberColIdx]
        ? String(row[phoneNumberColIdx]).trim()
        : "";
      const rawDueDate = row[nextDueDateColIdx]
        ? row[nextDueDateColIdx].trim()
        : "";
      const paymentStatus = row[paymentStatusColIdx]
        ? row[paymentStatusColIdx].trim().toLowerCase()
        : "";
      const lastReminderDate = row[reminderDateColIdx]
        ? row[reminderDateColIdx].trim()
        : "";

      if (lastReminderDate === formattedTodayStr) {
        continue;
      }

      // Skip row if there is no valid phone number to send to
      if (!rawPhone) continue;

      // Condition 1: Payment Status must be blank or explicitly "unpaid" or "overdue"
      if (paymentStatus !== "" && paymentStatus !== "overdue") {
        console.log(
          `ℹ️ [REMINDER] Skipped ${gymnastName} - Already marked as [${row[paymentStatusColIdx]}].`,
        );
        continue;
      }

      let shouldRemind = false;

      // Condition 2: If Next Due Date is completely blank or N/A, it's a first-time user -> Remind them!
      if (!rawDueDate || rawDueDate === "N/A") {
        shouldRemind = true;
        console.log(
          `ℹ️ [REMINDER] Triggered ${gymnastName} - First time user (Blank Due Date).`,
        );
      } else {
        // Otherwise, evaluate if the existing due date has arrived or passed
        const dueDate = parseSheetDate(rawDueDate);
        if (dueDate && dueDate <= today) {
          shouldRemind = true;
          console.log(
            `ℹ️ [REMINDER] Triggered ${gymnastName} - Account is due/overdue ([${rawDueDate}]).`,
          );
        }
      }

      if (shouldRemind) {
        // Clean phone number structure for WhatsApp API execution
        let cleanPhone = rawPhone.replace(/[^0-9]/g, "");
        if (!cleanPhone.startsWith("60") && cleanPhone.startsWith("1")) {
          cleanPhone = "60" + cleanPhone;
        }
        const recipientJid = `${cleanPhone}@s.whatsapp.net`;

        // 4. FIX: Use dynamic cut-off day inside the message string template
        const reminderMessage = `*Airborne Gymnastics Center* 🧾\n\nFriendly Reminder: Training fees for *${gymnastName}* are now due. Kindly make payment via TNG eWallet or Online Bank Transfer.\n\nPlease use the following details in your bank transfer reference/note:\n• 📌 Required Reference Format: [Gymnast Name] - [Month/Term]\n(Example: John - July 2026)\n\n_After payment is processed, please send a copy of the bank confirmation slip directly to this WhatsApp number for processing._\n\nThank you! 🙏`;

        if (whatsappSocket) {
          await whatsappSocket.sendMessage(recipientJid, {
            text: reminderMessage,
          });
          console.log(
            `✉️ [WHATSAPP SENT] Dispatched bill warning to ${gymnastName} (${cleanPhone})`,
          );
        } else {
          console.warn(
            `⚠️ [WHATSAPP SKIPPED] Socket instance undefined during runtime execution processing.`,
          );
        }

        const colLetter = String.fromCharCode(65 + reminderDateColIdx);

        // 5. Instantly mark Reminder Date cell in Column C to avoid duplication loops
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Master List!${colLetter}${rowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[formattedTodayStr]] },
        });

        remindersSent.push(`${gymnastName} (+${cleanPhone})`);

        // ✅ BETTER THROTTLING: 30s to 90s range
        const minDelay = 30000;
        const maxDelay = 90000;
        const randomDelay = Math.floor(
          Math.random() * (maxDelay - minDelay) + minDelay,
        );

        console.log(
          `⏳ Waiting ${Math.round(randomDelay / 1000)}s before next contact...`,
        );
        await sleep(randomDelay);

        // ✅ ADD BATCHING: After every 50 people, take a 30-minute break
        if (remindersSent.length % 30 === 0) {
          console.log(
            "☕ Batch complete. Taking a 30-minute rest to mimic human behavior...",
          );
          await sleep(30 * 60 * 1000);
        }
      }
    }

    return {
      success: true,
      count: remindersSent.length,
      roster: remindersSent,
    };
  } catch (error) {
    // FIX: Using uniform sendUniversalTelegramError channel logic for unified process error mapping
    await sendUniversalTelegramError("ReminderService Engine Core", error);
    throw error;
  }
}

/**
 * Helper to pause execution for a set time (in milliseconds)
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Initializes scheduling configurations on engine system startup
 */
export function initializeReminderScheduler(sock) {
  // Job 1: Monthly automation pipeline -> Runs every 10am on the day according to the cut-off day specified in the Config sheet (default to 1st of every month if config fetch fails)
  // cron.schedule("*/1 * * * *", async () => {
  cron.schedule("0 10 5 * *", async () => {
    console.log("⏰ [CRON] Automated Monthly billing event triggered.");

    // Fetch the dynamic cut-off day from Config sheet
    const cutOffDay = await getCutOffDay();
    const today = new Date().getDate();

    // Only proceed if today matches the cut-off day
    if (today !== cutOffDay) {
      console.log(
        `ℹ️ [CRON] Today is day ${today}, waiting for cut-off day ${cutOffDay}.`,
      );
      return;
    }

    try {
      const summary = await runReminderEngine(sock, "Monthly Scheduled Job");

      // ✅ FIX: Only alert if there is a real system error.
      // If successful, log to console or send a standard info message, NOT an error alert.
      if (summary.success && summary.count > 0) {
        const report = `ℹ️ *Monthly Automated Reminders Sent*: ${summary.count}\n\n*Roster*:\n${summary.roster.join("\n")}`;
        console.log(`✅ [CRON SUCCESS] ${report}`);
      }
    } catch (err) {
      // Only log here if the engine itself throws an exception
      console.error("❌ Monthly Cron Job Loop crashed:", err.message);
      await sendUniversalTelegramError(
        "Monthly Reminder Cron Summary Report",
        err,
      );
    }
  });

  console.log(
    "✅ [SCHEDULER ENGINE] Cron layouts locked and tracking smoothly.",
  );
}
