const fs = require("fs");
const s = fs.readFileSync("worker.js", "utf8");

const names = [
  "getCorrelationRisk",
  "getFundingPayments",
  "calculateExistingPositionRisk",
  "evaluatePaperRiskAdmission",
  "processPendingSignals",
  "processOpenPositions",
  "closePaperPosition",
  "applyPaperCloseAccounting"
];

const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const all = [...s.matchAll(re)];
let out = "";

for (const name of names) {
  const current = all.find(m => m[1] === name);
  if (!current) throw new Error("Function not found: " + name);
  const next = all.find(m => m.index > current.index);
  const end = next ? next.index : s.length;
  out += "\n\n/* ===== " + name + " ===== */\n";
  out += s.slice(current.index, end);
}

const route = s.indexOf("paper-process-test");
if (route < 0) throw new Error("paper-process-test not found");
const lines = s.slice(0, route).split(/\r?\n/);
const line = lines.length - 1;
out += "\n\n/* ===== paper-process-test route ===== */\n";
out += lines.slice(Math.max(0, line - 35), line + 45).join("\n");

fs.writeFileSync("patch-source-review.txt", out, "utf8");
console.log("Created patch-source-review.txt");
console.log("Bytes: " + Buffer.byteLength(out, "utf8"));
