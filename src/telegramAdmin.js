import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { runReminderEngine } from "./reminderService.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const SWITCHES_PATH = path.join(process.cwd(), "switches.json");

let lastControlPanelMessageId = null;

/**
 * Safely parse execution configuration matrix metrics from state tracking file
 */
function getSwitches() {
  try {
    if (fs.existsSync(SWITCHES_PATH)) {
      const data = fs.readFileSync(SWITCHES_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("❌ Error reading switches.json:", error.message);
  }
  return {
    bot_active: true,
    reply_receipt_active: true,
    reminder_active: true,
  };
}

/**
 * Persists updated layout attributes back into structural tracking storage file safely
 */
function saveSwitches(config) {
  try {
    fs.writeFileSync(SWITCHES_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Error writing to switches.json:", error.message);
  }
}

function getTimestamp() {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" });
}

// Fixed-layout administrative menu interface buttons matrix (Optimized for 4 rows)
const adminKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📊 Check Status" }, { text: "❓ Help Guide" }],
      [
        { text: "🚨 Toggle Master Bot" },
        { text: "🔄 Toggle Replies/Receipts" },
      ],
      [{ text: "🕒 Toggle Reminders" }, { text: "📩 Send Reminders" }],
      [{ text: "🔄 Refresh Chat" }, { text: "💀 Hard Kill Bot Process" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

console.log(
  "🚀 [TELEGRAM ADMIN] Kill Switch Controller Module Active with Button Layout.",
);

bot.on("message", async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (!text) return;

  // ADDED: Real-time terminal tracking log for incoming admin actions
  console.log(
    `💬 [TELEGRAM ADMIN MESSAGE] From Chat ID: ${chatId} | Command: "${text}"`,
  );

  if (text === "/start" || text === "🔄 Refresh Chat") {
    console.log("📊 [TELEGRAM ADMIN] Chat refreshed by user.");

    // 2. Send new panel and store its ID
    const sentMessage = await bot.sendMessage(
      chatId,
      `🎯 **[REFRESH SUCCESS]**\nChanges updated in chat successfully.\n🕒 _${getTimestamp()}_`,
      { parse_mode: "Markdown", ...adminKeyboard },
    );

    lastControlPanelMessageId = sentMessage.message_id;
    return;
  } else if (text === "❓ Help Guide" || text === "/help") {
    const helpText =
      `🛠️ **Airborne Bot Admin Control Panel**\n\n` +
      `• **📊 Check Status**: Displays live server up-time and functional toggle state matrix.\n` +
      `• **🚨 Toggle Master Bot**: *[SOFT SWITCH]* Suspends payment verification and parsing pipelines without dropping connection. Use for basic maintenance.\n` +
      `• **🔄 Toggle Replies/Receipts**: Turns off automatic confirmation replies and PDF dispatching back to parents.\n` +
      `• **🕒 Toggle Reminders**: Turns on/off scheduled automated payment reminder crons.\n` +
      `• **📩 Send Reminders**: Runs on-demand scans to instantly prompt outstanding parent listings.\n\n` +
      `🚨 **EMERGENCY SYSTEM BREAK** 🚨\n` +
      `• **💀 Hard Kill Bot Process**: *[HARD SWITCH]* Shuts down the entire OS process via PM2 immediately. Use this if the bot enters an error spam loop that can't be stopped quickly via database flags. Requires manual terminal access to bring back online.`;

    bot.sendMessage(chatId, helpText, {
      parse_mode: "Markdown",
      ...adminKeyboard,
    });
  } else if (text === "📊 Check Status" || text === "/status") {
    const config = getSwitches();
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    const statusText =
      `📊 **System Status Report**\n⏱️ **Uptime:** ${hours}h ${minutes}m ${seconds}s\n\n` +
      `🚨 **Master Switch (Bot Active):** ${config.bot_active ? "🟢 ON" : "🔴 OFF"}\n` +
      `📝 **Reply & Receipt Pipeline:** ${config.reply_receipt_active ? "🟢 ON" : "🔴 OFF"}\n` +
      `🕒 **Smart Automated Reminders:** ${config.reminder_active !== false ? "🟢 ON" : "🔴 OFF"}\n\n` +
      `🕒 **Checked At:** ${getTimestamp()}`;

    bot.sendMessage(chatId, statusText, {
      parse_mode: "Markdown",
      ...adminKeyboard,
    });
  } else if (text === "🚨 Toggle Master Bot" || text === "/toggle_bot") {
    const config = getSwitches();
    config.bot_active = !config.bot_active;
    saveSwitches(config);

    console.log(
      `📊 [MASTER SWITCH MUTATED] Main message engine toggled to ${config.bot_active ? "🟢 RUNNING" : "🔴 STOPPED"}`,
    );

    bot.sendMessage(
      chatId,
      `🚨 **[MASTER SWITCH MUTATED]**\nMain message engine toggled to: **${config.bot_active ? "🟢 RUNNING" : "🔴 STOPPED"}**\n🕒 _${getTimestamp()}_`,
      { parse_mode: "Markdown", ...adminKeyboard },
    );
  } else if (
    text === "🔄 Toggle Replies/Receipts" ||
    text === "/toggle_reply_receipt"
  ) {
    const config = getSwitches();
    config.reply_receipt_active = !config.reply_receipt_active;
    saveSwitches(config);

    console.log(
      `🔄 [TOGGLE SUCCESS] Replies & PDF receipts toggled to ${config.reply_receipt_active ? "🟢 ON" : "🔴 OFF"}`,
    );

    bot.sendMessage(
      chatId,
      `🔄 **[TOGGLE SUCCESS]**\nReplies & PDF receipts toggled to: **${config.reply_receipt_active ? "🟢 ON" : "🔴 OFF"}**\n🕒 _${getTimestamp()}_`,
      { parse_mode: "Markdown", ...adminKeyboard },
    );
  } else if (text === "🕒 Toggle Reminders" || text === "/toggle_reminder") {
    const config = getSwitches();
    config.reminder_active =
      config.reminder_active === undefined ? false : !config.reminder_active;
    saveSwitches(config);

    console.log(
      `🕒 [TOGGLE SUCCESS] Smart Automated Reminders toggled to ${config.reminder_active ? "🟢 ON" : "🔴 OFF"}`,
    );

    bot.sendMessage(
      chatId,
      `🕒 **[TOGGLE SUCCESS]**\nSmart Automated Reminders toggled to: **${config.reminder_active ? "🟢 ON" : "🔴 OFF"}**\n🕒 _${getTimestamp()}_`,
      { parse_mode: "Markdown", ...adminKeyboard },
    );
  } else if (text === "📩 Send Reminders" || text === "/send_reminders") {
    if (!(await isReminderActive())) {
      return await bot.sendMessage(
        chatId,
        "⚠️ *Action Blocked:* The reminder service is currently turned OFF.\n\nClick the `🕒 Toggle Reminders` button below to enable it before manual triggering.",
        { parse_mode: "Markdown", ...adminKeyboard },
      );
    }

    await bot.sendMessage(
      chatId,
      "⏳ *Scanning Master List for eligible or missed parent profiles...*",
    );

    try {
      const summary = await runReminderEngine(
        global.sock,
        "Manual Telegram Admin Request",
      );

      if (summary.success) {
        const responseText = `🏁 *On-Demand Reminder Check Finished!*\n\n• *Messages Dispatched:* ${summary.count}\n\n${
          summary.count > 0
            ? `*Target Roster*:\n${summary.roster.join("\n")}`
            : "_No messages sent. All active profiles have already been reminded or are fully up to date for this cycle._"
        }`;
        await bot.sendMessage(chatId, responseText, {
          parse_mode: "Markdown",
          ...adminKeyboard,
        });
      } else {
        await bot.sendMessage(
          chatId,
          `⚠️ *Execution Bypassed:* ${summary.reason}`,
          adminKeyboard,
        );
      }
    } catch (err) {
      console.error(
        "❌ On-demand reminder execution error caught:",
        err.message,
      );
      await bot.sendMessage(
        chatId,
        `❌ *Manual Run Failed:* ${err.message}`,
        adminKeyboard,
      );
    }
  } else if (text === "💀 Hard Kill Bot Process") {
    console.warn(
      "💀 [CRITICAL] Hard Kill command received via Telegram. Shutting down process immediately...",
    );

    await bot.sendMessage(
      chatId,
      "🛑 *Executing Emergency System Brake...*\nStopping PM2 process container instance now to prevent further error spam. Terminal intervention required to restart.",
      { parse_mode: "Markdown" },
    );

    setTimeout(() => {
      exec("pm2 stop gym-payment-bot", (error) => {
        if (error) {
          console.error(
            "⚠️ Local PM2 command failed, issuing direct process execution termination:",
            error.message,
          );
          process.exit(0);
        }
      });
    }, 1500);
  }
});

export function isBotProcessingAllowed() {
  return getSwitches().bot_active !== false;
}

export function isReplyAndReceiptAllowed() {
  return getSwitches().reply_receipt_active !== false;
}

export async function isReminderActive() {
  return getSwitches().reminder_active !== false;
}
