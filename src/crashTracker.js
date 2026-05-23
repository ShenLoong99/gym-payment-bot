import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { exec } from "child_process";

dotenv.config();

const STATE_FILE = path.resolve("./crash-state.json");
const CRASH_LIMIT = 10;

function getInternalCrashState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { consecutive_crashes: 0 };
    return JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8") || '{"consecutive_crashes":0}',
    );
  } catch (err) {
    return { consecutive_crashes: 0 };
  }
}

function saveCrashState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Failed writing crash counter disk state:", err.message);
  }
}

/**
 * Standardized execution function to send Telegram payloads
 */
async function postToTelegramGateway(textPayload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error(
      "❌ Telegram configuration tokens missing inside environment parameters.",
    );
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: textPayload,
        parse_mode: "Markdown",
      },
      { timeout: 5000 },
    );
    return true;
  } catch (err) {
    console.error(
      "❌ Telegram gateway communication failure:",
      err.response?.data || err.message,
    );
    return false;
  }
}

/**
 * NEW: Dispatches a downtime restoration summary to Telegram
 */
export async function sendTelegramDowntimeAlert(
  offlineSinceStr,
  durationMinutes,
) {
  const tzLabel =
    process.env.TZ === "Asia/Kuala_Lumpur" ? "GMT+8" : "Local Time";

  let alertMsg =
    `⚠️ *AIRBORNE BOT SYSTEM RESTORATION ALERT* ⚠️\n\n` +
    `The automated engine has recovered from an unmonitored infrastructure downtime event.\n\n` +
    `• *Offline Since:* ${offlineSinceStr} (${tzLabel})\n` +
    `• *Downtime Duration:* ${durationMinutes} minutes\n\n` +
    `👉 *Instruction:* Please manually check your WhatsApp chats for any incoming payment slips or transaction receipts missed during this window.`;

  return await postToTelegramGateway(alertMsg);
}

/**
 * Increments crash tracking metric and triggers hard system freeze if limit reached
 */
export async function handleProcessCrash(error) {
  const state = getInternalCrashState();

  if (state.consecutive_crashes >= CRASH_LIMIT) {
    return;
  }

  state.consecutive_crashes += 1;
  console.error(
    `⚠️ Persistent crash tracker incremented: ${state.consecutive_crashes}/${CRASH_LIMIT}`,
  );
  saveCrashState(state);

  if (state.consecutive_crashes >= CRASH_LIMIT) {
    const errorDetails = error?.stack || error?.message || String(error);
    console.log(
      "⏳ Threshold breached. Sending alert and executing hard infrastructure freeze...",
    );

    const localDate = new Date();
    const timestamp = localDate
      .toLocaleString("en-GB", {
        timeZone: process.env.TZ || "Asia/Kuala_Lumpur",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      .replace(/,/g, "");

    const tzLabel =
      process.env.TZ === "Asia/Kuala_Lumpur" ? "GMT+8" : "Local Time";

    const crashPayload =
      `🚨 *AIRBORNE PAYMENT BOT CRASH ALERT* 🚨\n\n` +
      `*Timestamp:* ${timestamp} (${tzLabel})\n` +
      `*Status:* Hard-stop limit reached (${state.consecutive_crashes}/${CRASH_LIMIT}).\n\n` +
      `*Last Trace Exception Error:* \n\`\`\`\n${errorDetails}\n\`\`\``;

    await postToTelegramGateway(crashPayload);

    exec("pm2 stop gym-payment-bot", (err) => {
      if (err) {
        process.exit(1);
      }
    });
  }
}

export function resetCrashCounter() {
  const state = getInternalCrashState();
  if (state.consecutive_crashes > 0) {
    console.log(
      `🧹 Bot stabilized. Resetting consecutive crash counters back to zero.`,
    );
    state.consecutive_crashes = 0;
    saveCrashState(state);
  }
}
