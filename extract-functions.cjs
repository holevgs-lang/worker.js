const fs = require("fs");

const file = "C:\\Users\\Домашний\\YandexDisk\\ОРБИТА\\Крипта\\worker.js";
const source = fs.readFileSync(file, "utf8");

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

let output = "";

for (const name of names) {
  const marker = "function " + name + "(";
  const start = source.indexOf(marker);

  if (start < 0) {
    output += "\n\n// NOT FOUND: " + name + "\n";
    continue;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let started = false;

  for (let i = start; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (c === "*" && n === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }

    if (c === "/" && n === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (c === "/" && n === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }

    if (c === "{") {
      depth++;
      started = true;
    } else if (c === "}") {
      depth--;
      if (started && depth === 0) {
        output += "\n\n// ===== " + name + " =====\n";
        output += source.slice(start, i + 1);
        break;
      }
    }
  }
}

fs.writeFileSync("functions-review.txt", output, "utf8");
console.log("Extracted functions to functions-review.txt");
