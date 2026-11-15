'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const file = path.resolve(process.cwd(), 'worker.js');
const expectedSha256 = '7EE4FC8AA6076FEA61738B9EF1EFC34BE05B3A2AA393DCA9965AB2C0CA2E5F6B';
const required = {
  initialCapital: 500,
  leverage: 2,
  maxOpenPositions: 12,
  maxPositionsPerSymbol: 2,
  riskPerTrade: 5,
  maxRiskPerSymbol: 10,
  maxTotalRisk: 60,
  maxCorrelatedRisk: 15,
  correlationThreshold: 0.75
};

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}
function fail(message) {
  console.error('PATCH NOT APPLIED: ' + message);
  process.exitCode = 1;
}
function replaceExactly(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error('Не найден точный якорь: ' + label);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error('Якорь встречается более одного раза: ' + label);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

if (!fs.existsSync(file)) {
  fail('В текущей папке не найден worker.js. Откройте PowerShell в папке проекта.');
  return;
}

const original = fs.readFileSync(file, 'utf8');
const beforeHash = sha256(original);
if (beforeHash !== expectedSha256) {
  fail('SHA256 не совпадает. Ожидался ' + expectedSha256 + ', получен ' + beforeHash + '. Файл не изменён.');
  return;
}

let patched = original;
try {
  const oldConfigRead = `  const maxOpenPositions = Number(state.maxOpenPositions);\n  const maxPositionsPerSymbol = Number(state.maxPositionsPerSymbol);\n  const riskPerTrade = Number(state.riskPerTrade);\n  const maxRiskPerSymbol = Number(state.maxRiskPerSymbol);\n  const maxTotalRisk = Number(state.maxTotalRisk);\n  const maxCorrelatedRisk = Number(state.maxCorrelatedRisk ?? PAPER_CONFIG.maxCorrelatedRisk);\n  const correlationThreshold = Number(state.correlationThreshold ?? PAPER_CONFIG.correlationThreshold);\n  const feeRate = Number(state.feeRate ?? PAPER_CONFIG.feeRate);\n  const slippageRate = Number(state.slippageRate ?? PAPER_CONFIG.slippageRate);\n  const leverage = Number(state.leverage);\n\n  if (\n    !Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 ||\n    !Number.isInteger(maxPositionsPerSymbol) || maxPositionsPerSymbol < 1 ||\n    !Number.isFinite(riskPerTrade) || riskPerTrade <= 0 ||\n    !Number.isFinite(maxRiskPerSymbol) || maxRiskPerSymbol <= 0 ||\n    !Number.isFinite(maxTotalRisk) || maxTotalRisk <= 0 ||\n    !Number.isFinite(maxCorrelatedRisk) || maxCorrelatedRisk <= 0 ||\n    !Number.isFinite(correlationThreshold) || correlationThreshold < 0 || correlationThreshold > 1 ||\n    !Number.isFinite(feeRate) || feeRate < 0 ||\n    !Number.isFinite(slippageRate) || slippageRate < 0 ||\n    !Number.isFinite(leverage) || leverage <= 0\n  ) {\n    throw new Error("Конфигурация риска виртуального счёта некорректна");\n  }`;

  const newConfigRead = `  // Жёсткие лимиты берутся только из PAPER_CONFIG, а не из изменяемого KV-состояния.\n  // Несовпадение состояния блокирует новые входы; значения и баланс автоматически не переписываются.\n  const fixedLimitKeys = [\n    "initialCapital", "leverage", "maxOpenPositions", "maxPositionsPerSymbol",\n    "riskPerTrade", "maxRiskPerSymbol", "maxTotalRisk", "maxCorrelatedRisk",\n    "correlationThreshold"\n  ];\n  for (const key of fixedLimitKeys) {\n    if (Number(state[key]) !== PAPER_CONFIG[key]) {\n      throw new Error("Настройка " + key + " в KV не совпадает с жёстким лимитом кода; новые входы заблокированы");\n    }\n  }\n  const maxOpenPositions = PAPER_CONFIG.maxOpenPositions;\n  const maxPositionsPerSymbol = PAPER_CONFIG.maxPositionsPerSymbol;\n  const riskPerTrade = PAPER_CONFIG.riskPerTrade;\n  const maxRiskPerSymbol = PAPER_CONFIG.maxRiskPerSymbol;\n  const maxTotalRisk = PAPER_CONFIG.maxTotalRisk;\n  const maxCorrelatedRisk = PAPER_CONFIG.maxCorrelatedRisk;\n  const correlationThreshold = PAPER_CONFIG.correlationThreshold;\n  const feeRate = PAPER_CONFIG.feeRate;\n  const slippageRate = PAPER_CONFIG.slippageRate;\n  const leverage = PAPER_CONFIG.leverage;`;

  patched = replaceExactly(patched, oldConfigRead, newConfigRead, 'processPendingSignals: чтение лимитов из KV');

  const oldValidation = `    !Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 ||\n    !Number.isInteger(config.maxPositionsPerSymbol) || config.maxPositionsPerSymbol < 1 ||\n    ![config.riskPerTrade, config.maxRiskPerSymbol, config.maxTotalRisk, config.maxCorrelatedRisk, config.leverage]\n      .every(value => Number.isFinite(value) && value > 0) ||\n    !Number.isFinite(config.correlationThreshold) || config.correlationThreshold < 0 || config.correlationThreshold > 1 ||`;
  const newValidation = `    !Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions !== PAPER_CONFIG.maxOpenPositions ||\n    !Number.isInteger(config.maxPositionsPerSymbol) || config.maxPositionsPerSymbol !== PAPER_CONFIG.maxPositionsPerSymbol ||\n    config.riskPerTrade !== PAPER_CONFIG.riskPerTrade ||\n    config.maxRiskPerSymbol !== PAPER_CONFIG.maxRiskPerSymbol ||\n    config.maxTotalRisk !== PAPER_CONFIG.maxTotalRisk ||\n    config.maxCorrelatedRisk !== PAPER_CONFIG.maxCorrelatedRisk ||\n    config.leverage !== PAPER_CONFIG.leverage ||\n    config.correlationThreshold !== PAPER_CONFIG.correlationThreshold ||`;
  patched = replaceExactly(patched, oldValidation, newValidation, 'evaluatePaperRiskAdmission: проверка фиксированных лимитов');

  const oldConfigDeclaration = 'const PAPER_CONFIG = {';
  const newConfigDeclaration = 'const PAPER_CONFIG = Object.freeze({';
  patched = replaceExactly(patched, oldConfigDeclaration, newConfigDeclaration, 'PAPER_CONFIG declaration');
  const configEnd = `  slippageRate: 0.0002\n};`;
  const frozenConfigEnd = `  slippageRate: 0.0002\n});`;
  patched = replaceExactly(patched, configEnd, frozenConfigEnd, 'PAPER_CONFIG closing');

  // Проверка точных констант и сохранения безопасного режима до записи.
  for (const [key, value] of Object.entries(required)) {
    const re = new RegExp('\\b' + key + ':\\s*' + String(value).replace('.', '\\.') + '\\b');
    if (!re.test(patched)) throw new Error('После патча не подтверждён лимит ' + key + '=' + value);
  }
  if (!/mode:\s*"DEMO ONLY"/.test(patched) || !/executionEnabled:\s*false/.test(patched)) {
    throw new Error('Не подтверждены ограничения DEMO ONLY / executionEnabled=false');
  }
  if (!patched.includes('if (Number(state[key]) !== PAPER_CONFIG[key])')) {
    throw new Error('Не найдена блокирующая проверка расхождения KV и лимитов кода');
  }

  const backup = file + '.backup-before-hard-limits-' + new Date().toISOString().replace(/[-:.]/g, '');
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  const temp = file + '.hard-limits-tmp';
  fs.writeFileSync(temp, patched, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }

  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  } catch (error) {
    fs.copyFileSync(backup, file);
    console.error('СИНТАКСИЧЕСКАЯ ПРОВЕРКА НЕ ПРОЙДЕНА. Исходный worker.js восстановлен из резервной копии.');
    console.error('Backup: ' + backup);
    process.exitCode = 1;
    return;
  }

  const after = fs.readFileSync(file, 'utf8');
  console.log('PATCH APPLIED.');
  console.log('node --check: OK');
  console.log('Изменения:');
  console.log('- PAPER_CONFIG защищён через Object.freeze.');
  console.log('- processPendingSignals использует лимиты только из PAPER_CONFIG.');
  console.log('- При несовпадении лимитов в KV новые входы блокируются.');
  console.log('- evaluatePaperRiskAdmission отклоняет конфигурацию, отличную от жёстких лимитов.');
  console.log('Backup: ' + backup);
  console.log('SHA256 before: ' + beforeHash);
  console.log('SHA256 after:  ' + sha256(after));
  console.log('Баланс и записи KV не изменялись.');
  console.log('No application code, self-test route, network request, OKX API, KV, Cloudflare or deployment was executed.');
} catch (error) {
  fail(String(error && error.message ? error.message : error));
}
