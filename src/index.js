import {
  useMultiFileAuthState,
  downloadMediaMessage,
  makeWASocket,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import dotenv from "dotenv";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import { extractReceiptData } from "./gemini.js";
import { appendPaymentRow } from "./sheets.js";
import { logEvent } from "./logger.js";
import { generateReceiptPdfBuffer } from "./receiptGenerator.js";
import {
  isBotProcessingAllowed,
  isReplyAndReceiptAllowed,
} from "./telegramAdmin.js";

// Import crash handling alongside the new standardized Telegram downtime alert function
import {
  handleProcessCrash,
  resetCrashCounter,
  sendTelegramDowntimeAlert,
} from "./crashTracker.js";
import { initializeReminderScheduler } from "./reminderService.js";
import { sendTelegramQrCode } from "./logger.js";

dotenv.config();

const ADMIN_JID = process.env.ADMIN_JID;
const LAST_ONLINE_FILE = path.resolve("./last_online.json");
const DOWNTIME_LOG_FILE = path.resolve("./downtime.log");

// Helper to format consistent UTC+8 dates for logs and alerts
function getFormattedLocalTime(dateObj = new Date()) {
  return dateObj
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
}

function saveFile(buffer, dirPath, fileName, extension) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `${fileName}.${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function formatWhatsAppDate(timestampInSeconds) {
  const date = new Date(timestampInSeconds * 1000);
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getCrashState() {
  const STATE_FILE = path.resolve("./crash-state.json");
  try {
    if (!fs.existsSync(STATE_FILE)) return { consecutive_crashes: 0 };
    return JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8") || '{"consecutive_crashes":0}',
    );
  } catch (err) {
    return { consecutive_crashes: 0 };
  }
}

function updateLastOnlineTimestamp() {
  try {
    const data = { last_seen_raw: new Date().toISOString() };
    fs.writeFileSync(LAST_ONLINE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(
      "❌ Failed writing last online timestamp state:",
      err.message,
    );
  }
}

async function startBot() {
  const currentCrashes = getCrashState().consecutive_crashes;
  const CRASH_LIMIT = 10;

  if (currentCrashes >= CRASH_LIMIT) {
    console.error(
      `🚨 [HALT] Bot is marked as unstable (${currentCrashes}/${CRASH_LIMIT}). Suppressing startup.`,
    );
    return;
  }

  console.log("🚀 [INIT] Starting Airborne Security Automated Bot Engine...");

  // =========================================================
  // DOWNTIME ANALYSIS ENGINE (Standardized to Telegram)
  // =========================================================
  if (fs.existsSync(LAST_ONLINE_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(LAST_ONLINE_FILE, "utf8"));
      if (fileData.last_seen_raw) {
        const lastOnlineTime = new Date(fileData.last_seen_raw);
        const currentTime = new Date();

        const diffMs = currentTime - lastOnlineTime;
        const diffMinutes = Math.floor(diffMs / 1000 / 60);

        if (diffMinutes > 0) {
          const logLine = `[${getFormattedLocalTime(currentTime)}] ⏳ System Recovery: Discovered offline duration of ${diffMinutes} minutes. (Offline since: ${getFormattedLocalTime(lastOnlineTime)})\n`;
          fs.appendFileSync(DOWNTIME_LOG_FILE, logLine, "utf8");
          console.log(
            `⏳ [DOWNTIME TRACKER] Bot was offline for ${diffMinutes} minutes.`,
          );

          // Guard threshold constraint: > 5 minutes
          if (diffMinutes > 5) {
            console.log(
              "📢 Downtime boundary breached. Dispatching telemetry report over Telegram gateway...",
            );
            // Run asynchronously without blocking Baileys initial handshakes
            sendTelegramDowntimeAlert(
              getFormattedLocalTime(lastOnlineTime),
              diffMinutes,
            ).catch((err) => {
              console.error(
                "❌ Failed transmitting downtime summary across Telegram:",
                err.message,
              );
            });
          }
        }
      }
    } catch (err) {
      console.error(
        "❌ Error running structural downtime engine parsing:",
        err.message,
      );
    }
  }

  const authFolder = path.resolve(
    process.env.SESSION_DATA_PATH || "./auth_info_baileys",
  );

  console.log("DEBUG: Preparing Auth State...");
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  console.log("DEBUG: Initializing Socket...");
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    // receivedPendingNotifications: false,
  });

  console.log("DEBUG: Socket Created. Registering listeners...");
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    console.log("DEBUG: Connection Update Received:", update);
    const { connection, qr, lastDisconnect } = update;

    // QR Generation Logic
    if (qr) {
      const qrPath = "./temp_qr.png";
      try {
        await qrcode.toFile(qrPath, qr);
        // Send the file to the owner via Telegram
        await sendTelegramQrCode(qrPath); // Use a telegram photo helper
        console.log("📡 [AUTH] QR code generated and sent to Telegram.");
      } catch (err) {
        console.error("❌ Failed to generate/send QR:", err.message);
      }
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) {
        startBot(); // Reconnect if not explicitly logged out
      }
    } else if (connection === "open") {
      console.log("✅ [ONLINE] WhatsApp Airborne Bot connected successfully.");
      resetCrashCounter(); // This resets the crash-state.json file
      updateLastOnlineTimestamp();
      global.sock = sock;
      initializeReminderScheduler(sock);
    }
  });

  // Periodic heartbeat monitor script to update timestamp every 60 seconds
  const heartbeatInterval = setInterval(() => {
    if (sock.user) {
      updateLastOnlineTimestamp();
    }
  }, 60000);

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      if (!msg.message) continue;

      // MASTER SWITCH CHECK
      if (!isBotProcessingAllowed()) {
        console.warn(
          "🛑 [PIPELINE BLOCKED] Incoming message dropped. Master Switch (/toggle_bot) is OFF.",
        );
        continue;
      }

      updateLastOnlineTimestamp();

      const messageType = Object.keys(msg.message || {})[0];
      const remoteJid = msg.key.remoteJid;
      const senderJid = remoteJid.endsWith("@g.us")
        ? msg.key.participant || ""
        : msg.key.fromMe
          ? sock.user?.id || remoteJid
          : remoteJid;
      const senderPhone = senderJid.split("@")[0].split(":")[0];

      let targetMimeType = null;
      let shouldProcess = false;

      if (messageType === "imageMessage") {
        targetMimeType = msg.message.imageMessage?.mimetype || "image/jpeg";
        shouldProcess = true;
      } else if (messageType === "documentMessage") {
        const docMime = msg.message.documentMessage?.mimetype || "";
        const docName =
          msg.message.documentMessage?.fileName?.toLowerCase() || "";
        if (docMime === "application/pdf" || docName.endsWith(".pdf")) {
          targetMimeType = "application/pdf";
          shouldProcess = true;
        }
      }

      if (shouldProcess && senderPhone) {
        console.log(
          `\n📥 [NEW MEDIA] Intercepted [${messageType}] from actual phone: +${senderPhone}`,
        );
        try {
          console.log("⏳ [DOWNLOADING] Fetching media stream buffer...");
          const buffer = await downloadMediaMessage(
            msg,
            "buffer",
            {},
            { logger: pino({ level: "silent" }), reconnectMode: "always" },
          );
          const analysis = await extractReceiptData(buffer, targetMimeType);
          console.log(
            `🧠 [GEMINI RAW RESPONSE]:`,
            JSON.stringify(analysis, null, 2),
          );

          if (!analysis || !analysis.isGymnasticsFee) {
            console.log(
              "🤫 [IGNORE] Document filtered (Not an academy fee receipt). Dropping workflow.",
            );
            continue;
          }

          if (
            !analysis.transaction_date ||
            analysis.transaction_date.trim() === ""
          ) {
            analysis.transaction_date = formatWhatsAppDate(
              msg.messageTimestamp,
            );
          }

          const confidence = analysis.forgery_verification_confidence;
          const whatsappMeta = {
            phoneNumber: senderPhone,
            pushName: msg.pushName || "Contact Profile Unknown",
          };

          if (confidence >= 90) {
            console.log(
              "📝 [DATABASE] High confidence threshold met. Syncing row with Google Sheets...",
            );

            // Always write records to sheets regardless of the secondary reply switch
            const result = await appendPaymentRow(analysis, whatsappMeta);

            if (result.success) {
              // GENERATE THE UNIQUE FOLDER PATH ONCE
              const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .slice(0, 19);
              const targetDir = path.join(
                "./Payment",
                `${timestamp}_${senderPhone}`,
              );

              // Get original filename (handle image vs pdf)
              const originalFileName =
                msg.message.documentMessage?.fileName?.replace(
                  /\.[^/.]+$/,
                  "",
                ) || `payment_slip_${new Date().getTime()}`;
              const extension =
                targetMimeType === "application/pdf" ? "pdf" : "jpg";

              // SAVE PAYMENT SLIP
              saveFile(buffer, targetDir, originalFileName, extension);

              // REPLY & RECEIPT PIECE CHECK
              if (!isReplyAndReceiptAllowed()) {
                console.warn(
                  "🤫 [REPLY LOCKED] Row logged to Sheets silently. Customer auto-reply & PDF generation are disabled (/toggle_reply_receipt).",
                );
                continue; // Terminate execution early before generating PDF or sending messages
              }

              // Generate Standardized Receipt Name: AG + YYYYMMDD + RunningNumber
              const datePart = new Date()
                .toISOString()
                .slice(0, 10)
                .replace(/-/g, "");
              const receiptFileName = `AG${datePart}${result.receiptNumber}`;

              const now = new Date();
              const currentTimeStr = now.toLocaleTimeString("en-GB", {
                timeZone: process.env.TZ || "Asia/Kuala_Lumpur",
                hour12: false,
              });

              const paymentPayload = {
                student_name: result.gymnastName,
                amount: result.amount,
                currency: "RM",
                date:
                  analysis.transaction_date.split(" ")[0] ||
                  now.toLocaleDateString("en-GB"),
                time: currentTimeStr,
                reference_number: analysis.transaction_id || "N/A",
                bank_or_platform: analysis.payment_method || "Instant Transfer",
                receipt_number: result.receiptNumber,
                payment_covered: analysis.payment_covered || "N/A",
                revenue_start_date: analysis.revenue_start_date || "N/A",
              };

              try {
                console.log(
                  "🎨 [PDF ENGINE] Constructing graphic transaction receipt canvas vector layouts...",
                );

                const pdfBuffer =
                  await generateReceiptPdfBuffer(paymentPayload);

                saveFile(pdfBuffer, targetDir, receiptFileName, "pdf");

                let matchedReply = `Thank you! Your official electronic statement receipt has been compiled and is attached below. 🙏`;

                await sock.sendMessage(
                  remoteJid,
                  { text: matchedReply },
                  { quoted: msg },
                );

                await sock.sendMessage(
                  remoteJid,
                  {
                    document: pdfBuffer,
                    mimetype: "application/pdf",
                    fileName: `${receiptFileName}.pdf`,
                  },
                  { quoted: msg },
                );

                console.log(
                  `📦 [SUCCESS] PDF Invoice [${receiptFileName}.pdf] dispatched across Baileys gateway network.`,
                );
              } catch (pdfError) {
                console.error(
                  "❌ Failed building or delivering PDF metadata invoice asset attachment node stream:",
                  pdfError.message,
                );
              }
            }
          } else {
            console.log(
              `🚨 [ESCALATION] Low confidence index (${confidence}%). Notifying admin channel...`,
            );
            if (ADMIN_JID) {
              let adminAlert = `🚨 *AIRBORNE AUTOMATION MANUAL VERIFICATION REQUEST*\n\n`;
              adminAlert += `A transaction record sent by *${whatsappMeta.pushName}* (+${senderPhone}) returned an uncertainty score of *${confidence}%*.\n\n*Extracted Details Snapshot*:\n• Date Assigned: ${analysis.transaction_date}\n• Amount: RM ${analysis.amount || "0"}\n• Bank ID Ref: ${analysis.transaction_id || "N/A"}\n\n👉 Please manually verify this entry in your sheet ledger logs.`;
              await sock.sendMessage(ADMIN_JID, { text: adminAlert });
            }
            let holdingMessage = `*Airborne Gymnastics Center*\n\n⏳ *Payment Document Received*\n\nYour confirmation slip has been sent to our billing ledger. Because some details are slightly unclear, our admin office is running a manual review. Your status will reflect shortly. Thank you for your patience!`;
            await sock.sendMessage(
              remoteJid,
              { text: holdingMessage },
              { quoted: msg },
            );
          }
        } catch (error) {
          console.error("💥 [CRASH Catch Block]:", error.message);
          clearInterval(heartbeatInterval);
          await handleProcessCrash(error);
          process.exit(1);
        }
      }
    }
  });
}

process.on("unhandledRejection", async (reason) => {
  console.error("💥 [CRASH DETECTED VIA UNHANDLED REJECTION]:", reason);
  try {
    await handleProcessCrash(reason);
  } catch (err) {}
  process.exit(1);
});

process.on("uncaughtException", async (error) => {
  console.error("💥 [CRASH DETECTED VIA UNCAUGHT EXCEPTION]:", error.message);
  try {
    await handleProcessCrash(error);
  } catch (err) {}
  process.exit(1);
});

startBot();
