import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const SWITCHES_PATH = path.join(process.cwd(), "switches.json");

function getSwitches() {
  try {
    const data = fs.readFileSync(SWITCHES_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { bot_active: true, reply_receipt_active: true };
  }
}

function saveSwitches(config) {
  fs.writeFileSync(SWITCHES_PATH, JSON.stringify(config, null, 2), "utf8");
}

function getTimestamp() {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" });
}

const adminKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📊 Check Status" }],
      [
        { text: "🚨 Toggle Master Bot" },
        { text: "🔄 Toggle Replies/Receipts" },
      ],
      [{ text: "❓ Help Guide" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

console.log(
  "🚀 [TELEGRAM ADMIN] Kill Switch Controller Module Active with Button Layout.",
);

bot.on("message", (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (text === "/start" || text === "❓ Help Guide" || text === "/help") {
    const helpText = `🛠️ **Airborne Bot Admin Kill Switches**\n\nUse the menu buttons below to toggle state or monitor uptime instantly.`;
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

    // ─── ADDED TERMINAL LOGS ───
    console.log(
      `\n🚀 [TELEGRAM ADMIN] Processing Status Request from Admin Chat ID: ${chatId}`,
    );
    console.log(
      `📊 [STATUS EVENT] Current configuration resolved from file:`,
      JSON.stringify(config),
    );
    console.log(
      `⏱️ [STATUS EVENT] Uptime calculated: ${hours}h ${minutes}m ${seconds}s`,
    );

    const statusText = `📊 **System Status Report**\n⏱️ **Uptime:** ${hours}h ${minutes}m ${seconds}s\n\n🚨 **Master Switch (Bot Active):** ${config.bot_active ? "🟢 ON" : "🔴 OFF"}\n📝 **Reply & Receipt Pipeline:** ${config.reply_receipt_active ? "🟢 ON" : "🔴 OFF"}\n🕒 **Checked At:** ${getTimestamp()}`;
    bot.sendMessage(chatId, statusText, {
      parse_mode: "Markdown",
      ...adminKeyboard,
    });
  } else if (text === "🚨 Toggle Master Bot" || text === "/toggle_bot") {
    const config = getSwitches();
    config.bot_active = !config.bot_active;
    saveSwitches(config);

    // ─── ADDED TERMINAL LOGS ───
    console.log(
      `\n🚨 [MASTER SWITCH MUTATED] Admin updated configuration matrix state.`,
    );
    console.log(
      `📝 [FILE WRITE] Updating switches.json -> Setting bot_active to: ${config.bot_active}`,
    );
    if (!config.bot_active) {
      console.warn(
        `⚠️ [STATUS WARNING] Main message processing engine has been offline paused.`,
      );
    }

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

    // ─── ADDED TERMINAL LOGS ───
    console.log(
      `\n🔄 [REPLY SWITCH MUTATED] Admin updated configuration matrix state.`,
    );
    console.log(
      `📝 [FILE WRITE] Updating switches.json -> Setting reply_receipt_active to: ${config.reply_receipt_active}`,
    );
    if (!config.reply_receipt_active) {
      console.warn(
        `🤫 [STATUS WARNING] Secondary pipeline muted: Records will sync to Sheets silently. No PDFs will generate.`,
      );
    }

    bot.sendMessage(
      chatId,
      `🔄 **[TOGGLE SUCCESS]**\nReplies & PDF receipts toggled to: **${config.reply_receipt_active ? "🟢 ON" : "🔴 OFF"}**\n🕒 _${getTimestamp()}_`,
      { parse_mode: "Markdown", ...adminKeyboard },
    );
  }
});

export function isBotProcessingAllowed() {
  return getSwitches().bot_active;
}
export function isReplyAndReceiptAllowed() {
  return getSwitches().reply_receipt_active;
}
