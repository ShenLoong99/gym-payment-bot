import fs from "fs";
import path from "path";

const logFilePath = path.resolve("./automation-events.log");

export function logEvent(level, phone, message, meta = null) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] [Phone: ${phone}] ${message}`;
  if (meta) logLine += ` | Meta: ${JSON.stringify(meta)}`;
  logLine += "\n";

  fs.appendFile(logFilePath, logLine, "utf8", (err) => {
    if (err) console.error("Logging Error:", err.message);
  });
}
