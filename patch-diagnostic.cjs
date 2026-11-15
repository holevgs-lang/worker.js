const fs = require("fs");
const s = fs.readFileSync("worker.js", "utf8");

const names = [
  "getCorrelationRisk",
  "getFundingPayments",
  "calculateExistingPositionRisk",
  "evaluatePaperRiskAdmission",
  "processPendingSignals",
  "processOpenPositions"
];

for (const name of names) {
  console.log(name + ": " + (s.split("function " + name + "(").length - 1));
}

console.log("paper-process-test: " + (s.split("paper-process-test").length - 1));
console.log("REJECTED assignments: " + (s.split('signal.status = "REJECTED"').length - 1));
