// Suppress noisy internal PDF.js font parsing warnings from third-party libraries (pdf-parse)
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const isFontWarning = (msg) =>
  typeof msg === "string" &&
  (msg.includes("Ran out of space in font private use area") ||
    msg.includes("TT: undefined function:") ||
    msg.includes("Unknown/unsupported coordinate math opcode") ||
    msg.includes("Unknown/unsupported post table version") ||
    msg.includes("post table version"));

console.warn = function (...args) {
  if (args.length > 0 && isFontWarning(args[0])) return;
  originalConsoleWarn.apply(console, args);
};

console.log = function (...args) {
  if (args.length > 0 && isFontWarning(args[0])) return;
  originalConsoleLog.apply(console, args);
};

process.on("uncaughtException", (err) => {
  console.error("[CRITICAL ERROR] Uncaught Exception in worker/server:", err?.stack || err?.message || err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL ERROR] Unhandled Rejection in async pipeline:", reason?.stack || reason?.message || reason);
});

const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/server");
const aiAgent = require("./src/services/aiService");
const { processQueue, pollDriveSourceFolder } = require("./src/services/jobQueueService");

const port = process.env.PORT || 3000;
let debug = false;
let testrun = false;

const args = process.argv.slice(2);
if (args.includes("--debug")) debug = true;
if (args.includes("--test")) testrun = true;

aiAgent.init(debug);

app.listen(port, "0.0.0.0", () => {
  console.log(`Web UI läuft auf http://0.0.0.0:${port}`);
  processQueue();
  setInterval(pollDriveSourceFolder, 15 * 1000);
  setTimeout(pollDriveSourceFolder, 5000);

  if (testrun) {
    console.log("[SYSTEM] Testmodus aktiv.");
  }
});
