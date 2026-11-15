const fs = require("fs");
const s = fs.readFileSync("worker.js", "utf8");

for (const marker of [
  'url.pathname === "/paper-process-test"',
  "function calculatePaperCloseAccounting",
  "function evaluatePositionExit",
  "function getUnprocessedPositionCandles"
]) {
  const i = s.indexOf(marker);
  console.log("\n===== " + marker + " =====");
  if (i < 0) {
    console.log("NOT FOUND");
  } else {
    console.log(s.slice(Math.max(0, i - 500), Math.min(s.length, i + 5000)));
  }
}
