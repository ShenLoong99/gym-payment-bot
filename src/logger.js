import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";

dotenv.config();

const logFilePath = path.resolve("./automation-events.log");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Standard event logging to local text files
 */
export function logEvent(level, phone, message, meta = null) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] [Phone: ${phone}] ${message}`;
  if (meta) logLine += ` | Meta: ${JSON.stringify(meta)}`;
  logLine += "\n";

  fs.appendFile(logFilePath, logLine, "utf8", (err) => {
    if (err) console.error("❌ Local Logging Error:", err.message);
  });
}

/**
 * Universally flashes runtime exceptions straight to your Telegram channel.
 * Synchronized with the global core error strategy.
 */
export async function sendUniversalTelegramError(contextName, error) {
  const errorMessage = error?.message || String(error);

  console.error(`💥 [CRITICAL EXCEPTION - ${contextName}]:`, errorMessage);

  // FIX: Explicitly check against the correct environment variable name declared at the top
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn(
      "⚠️ Telegram configuration vectors are missing (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID). Alert bypassed.",
    );
    return;
  }

  // Escape special characters for Markdown formatting fallback safety
  const cleanMessage =
    `🚨 *Core Process Error Detected* 🚨\n\n` +
    `*Context:* ${contextName}\n` +
    `*Error Message:* \`${errorMessage}\`\n` +
    `*Timestamp:* ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })} \n\n` +
    `_Please check the server console terminal logs immediately._`;

  try {
    // FIX: Using the uniform TELEGRAM_CHAT_ID identifier mapping
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: cleanMessage,
        parse_mode: "Markdown",
      },
    );
    console.log(
      `📡 [TELEGRAM ALERT SENT] Successfully reported error from context: [${contextName}]`,
    );
  } catch (err) {
    console.error(
      "❌ Failed to push alert to Telegram API gateway:",
      err.response?.data || err.message,
    );
  }
}

export async function sendTelegramQrCode(filePath) {
  try {
    await bot.telegram.sendPhoto(process.env.TELEGRAM_CHAT_ID, {
      source: filePath,
    });
    console.log("✅ [TELEGRAM] QR code sent to admin.");
  } catch (err) {
    console.error("❌ [TELEGRAM] Failed to send QR code:", err.message);
  }
}
