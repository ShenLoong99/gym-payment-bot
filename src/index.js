import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import dotenv from "dotenv";
import path from "path";
import qrcode from "qrcode-terminal";
import fs from "fs";

import { extractReceiptData } from "./gemini.js";
import { appendPaymentRow } from "./sheets.js";
import { logEvent } from "./logger.js";
import { generateReceiptPdfBuffer } from "./receiptGenerator.js";

// Import crash handling alongside the new standardized Telegram downtime alert function
import {
  handleProcessCrash,
  resetCrashCounter,
  sendTelegramDowntimeAlert,
} from "./crashTracker.js";

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
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    receivedPendingNotifications: false, // Prevent processing backlog missed during downtime
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("\n--- SCAN THIS QR CODE WITH WHATSAPP ---");
      qrcode.generate(qr, { small: true });
      console.log("---------------------------------------\n");
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => startBot(), 5000);
      }
    } else if (connection === "open") {
      console.log(
        "\n✅ [ONLINE] Airborne Bot connected to WhatsApp successfully.",
      );
      resetCrashCounter();
      updateLastOnlineTimestamp();
    }
  });

  sock.ev.on("creds.update", saveCreds);

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

            // Call updated sheet pipeline wrapper to get access to computed incremental index parameters
            const result = await appendPaymentRow(analysis, whatsappMeta);

            if (result.success) {
              // Isolate current runtime time signatures
              const now = new Date();
              const currentTimeStr = now.toLocaleTimeString("en-GB", {
                timeZone: process.env.TZ || "Asia/Kuala_Lumpur",
                hour12: false,
              });

              // Construct the structured parameter mapping blueprint object requested in Step 2
              const paymentPayload = {
                student_name: result.gymnastName,
                payer_name: analysis.payer_name || whatsappMeta.pushName,
                amount: result.amount,
                currency: "RM",
                date:
                  analysis.transaction_date.split(" ")[0] ||
                  now.toLocaleDateString("en-GB"),
                time: currentTimeStr,
                reference_number: analysis.transaction_id || "N/A",
                bank_or_platform: analysis.bank_name || "Instant Transfer",
                receipt_number: result.receiptNumber,
              };

              try {
                console.log(
                  "🎨 [PDF ENGINE] Constructing graphic transaction receipt canvas vector layouts...",
                );
                // Step 5: Render layout structure canvas vector parameters to memory buffer allocation arrays
                const pdfBuffer =
                  await generateReceiptPdfBuffer(paymentPayload);

                let matchedReply = `Thank you! Your official electronic statement receipt has been compiled and is attached below. 🙏`;

                // Send the text validation update statement message baseline context anchor node
                await sock.sendMessage(
                  remoteJid,
                  { text: matchedReply },
                  { quoted: msg },
                );

                // Step 6: Dispatch the raw buffer stream across WhatsApp as an official Document attachment asset node
                await sock.sendMessage(
                  remoteJid,
                  {
                    document: pdfBuffer,
                    mimetype: "application/pdf",
                    fileName: `Receipt_${paymentPayload.receipt_number}.pdf`,
                  },
                  { quoted: msg },
                );

                console.log(
                  `📦 [SUCCESS] PDF Invoice [Receipt_${paymentPayload.receipt_number}.pdf] dispatched across Baileys gateway network.`,
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
