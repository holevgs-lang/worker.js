const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const file = path.resolve("worker.js");
const backup = path.resolve("worker.js.backup-20261115-220217");
const temp = file + ".patch-tmp";
const originalTemp = file + ".prepatch";

const expectedHash =
  "570D63675233D843E84F3034856E3F0DB70831C7513A7A627DF0D977C3761FB5";

function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
}

function replaceExactly(source, oldText, newText, description) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(
      description + ": expected exactly one match, found " + count
    );
  }
  return source.replace(oldText, newText);
}

function restore() {
  if (fs.existsSync(originalTemp)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(originalTemp, file);
  }
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}

try {
  if (!fs.existsSync(file)) throw new Error("worker.js not found.");
  if (!fs.existsSync(backup)) throw new Error("Expected backup not found.");

  const original = fs.readFileSync(file);
  const backupData = fs.readFileSync(backup);

  if (hash(original) !== expectedHash) {
    throw new Error("worker.js hash differs from the verified source. No changes made.");
  }

  if (hash(backupData) !== expectedHash) {
    throw new Error("Backup hash mismatch. No changes made.");
  }

  let source = original.toString("utf8");

  source = replaceExactly(
    source,
    "const instruments = JSON.parse(rawInstruments);",
    "const instruments = JSON.parse(rawInstruments);\n    const now = Date.now();",
    "processPendingSignals: instruments anchor"
  );

  source = replaceExactly(
    source,
    "evaluatePendingSignalExpiry(signal, Date.now())",
    "evaluatePendingSignalExpiry(signal, now)",
    "pending signal expiry clock"
  );

  source = replaceExactly(
    source,
    "const pendingResult = await processPendingSignals(env, lock);\n      const positionResult = await processOpenPositions(env, lock);",
    "const positionResult = await processOpenPositions(env, lock);\n      const pendingResult = await processPendingSignals(env, lock);",
    "paper-process-test processing order"
  );

  fs.writeFileSync(temp, Buffer.from(source, "utf8"));

  if (fs.existsSync(originalTemp)) {
    throw new Error("A previous .prepatch file exists. Resolve it before proceeding.");
  }

  fs.renameSync(file, originalTemp);

  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.renameSync(originalTemp, file);
    throw error;
  }

  const check = spawnSync("node", ["--check", file], {
    encoding: "utf8",
    windowsHide: true
  });

  if (check.status !== 0) {
    restore();
    console.error("Syntax check failed. Original worker.js restored.");
    if (check.stdout) console.error(check.stdout);
    if (check.stderr) console.error(check.stderr);
    process.exitCode = 1;
  } else {
    fs.unlinkSync(originalTemp);
    console.log("PATCH APPLIED.");
    console.log("node --check: OK");
    console.log("No application code or network requests were executed.");
    console.log("Original backup was not modified.");
  }
} catch (error) {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
  console.error("PATCH NOT APPLIED:", error.message);
  console.error("worker.js was not intentionally modified.");
  process.exitCode = 1;
}
