'use strict';

// Локальный установщик исправлений OKX Smart Trader.
// Выполняет только чтение/запись worker.js и node --check worker.js.
// Не импортирует и не запускает код Worker, не вызывает fetch/API/KV/Cloudflare.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const file = path.resolve(process.cwd(), 'worker.js');
const expectedSha256 = '59F8F0601464D2C98DC5F5C0C89B639F3608E3029D0EE4B2189CBD08EE172E04';

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}
function fail(message) {
  console.error('\nОТМЕНА: ' + message);
  process.exitCode = 1;
}
function replaceFunction(source, name, replacement) {
  const marker = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const match = marker.exec(source);
  if (!match) throw new Error('Не найдена функция ' + name);
  const start = match.index;
  const next = /^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|^export\s+default\s*\{/gm;
  next.lastIndex = start + match[0].length;
  const following = next.exec(source);
  if (!following) throw new Error('Не найден конец функции ' + name);
  const end = following.index;
  const oldBlock = source.slice(start, end);
  if (!oldBlock.includes('{') || !oldBlock.includes('}')) {
    throw new Error('Структура функции ' + name + ' выглядит неожиданно');
  }
  return { source: source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end), oldBlock };
}

const replacements = {};

replacements.getCorrelationRisk = String.raw`function getCorrelationRisk(symbol, activePositions, correlationSnapshot, threshold) {
  const now = Date.now();
  const calculatedAt = Date.parse(correlationSnapshot?.calculatedAt);
  if (
    typeof symbol !== "string" || !symbol ||
    !Array.isArray(activePositions) ||
    !Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
    !correlationSnapshot || !correlationSnapshot.matrix ||
    !Number.isFinite(calculatedAt) || calculatedAt > now ||
    now - calculatedAt > CORRELATION_MAX_AGE_MS
  ) {
    return { ok: false, error: "Нет корректного свежего снимка корреляции; новые позиции временно запрещены" };
  }

  let correlatedRisk = 0;
  const correlatedSymbols = [];

  for (const position of activePositions) {
    if (!position || typeof position.symbol !== "string" || !position.symbol) {
      return { ok: false, error: "Обнаружена некорректная открытая позиция при проверке корреляционного риска" };
    }
    if (position.symbol === symbol) continue;

    const correlation = correlationSnapshot.matrix?.[symbol]?.[position.symbol];
    if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1) {
      return {
        ok: false,
        error: "Недостаточно корректных данных корреляции для " + symbol + " и " + position.symbol
      };
    }
    if (Math.abs(correlation) >= threshold) {
      const rawRisk = position.actualRisk ?? position.plannedStopRisk;
      const positionRisk = Number(rawRisk);
      if (!Number.isFinite(positionRisk) || positionRisk <= 0) {
        return {
          ok: false,
          error: "Невозможно подтвердить риск коррелирующей позиции " + position.symbol + "; новые входы запрещены"
        };
      }
      correlatedRisk += positionRisk;
      if (!Number.isFinite(correlatedRisk)) {
        return { ok: false, error: "Переполнение суммы корреляционного риска" };
      }
      correlatedSymbols.push({ symbol: position.symbol, correlation });
    }
  }

  return { ok: true, correlatedRisk, correlatedSymbols };
}`;

replacements.getFundingPayments = String.raw`async function getFundingPayments(symbol, openedAt, closedAt, contracts, contractValue, direction) {
  const from = Date.parse(openedAt);
  const to = Date.parse(closedAt);
  if (
    typeof symbol !== "string" || !SYMBOLS.includes(symbol) ||
    !Number.isFinite(from) || !Number.isFinite(to) ||
    !Number.isFinite(contracts) || contracts <= 0 ||
    !Number.isFinite(contractValue) || contractValue <= 0 ||
    ![-1, 1].includes(direction)
  ) {
    throw new Error("Некорректные параметры для расчёта Funding по " + symbol);
  }
  if (to <= from) {
    return { fundingPnl: 0, events: [] };
  }

  const endpoint = new URL("/api/v5/public/funding-rate-history", BASE_URL);
  endpoint.searchParams.set("instId", symbol);
  endpoint.searchParams.set("limit", "400");

  const response = await fetch(endpoint.toString(), { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok || data.code !== "0" || !Array.isArray(data.data)) {
    throw new Error("Не удалось получить историю Funding для " + symbol + ": " + (data.msg || data.code || response.status));
  }

  const allFundingTimes = data.data.map(row => Number(row?.fundingTime));
  if (!allFundingTimes.length || allFundingTimes.some(timestamp => !Number.isFinite(timestamp))) {
    throw new Error("История Funding для " + symbol + " неполная или содержит некорректные временные метки; закрытие отложено");
  }
  const oldestReturned = Math.min(...allFundingTimes);
  if (from < oldestReturned) {
    throw new Error("История Funding для " + symbol + " не покрывает весь срок позиции (получено не более 400 записей); сделка оставлена открытой до получения полного расчёта");
  }

  const fundingRows = data.data
    .map(row => ({ ...row, fundingTimestamp: Number(row.fundingTime) }))
    .filter(row => row.fundingTimestamp > from && row.fundingTimestamp <= to)
    .sort((a, b) => a.fundingTimestamp - b.fundingTimestamp);

  const events = [];
  let fundingPnl = 0;

  for (const row of fundingRows) {
    const realizedRate = Number(row.realizedRate);
    if (!Number.isFinite(realizedRate)) {
      throw new Error("OKX не вернул фактический realizedRate для " + symbol + " на " + row.fundingTime);
    }

    // Соблюдаем лимит публичного OKX API при пакетном закрытии нескольких позиций.
    await sleep(120);
    const markEndpoint = new URL("/api/v5/market/history-mark-price-candles", BASE_URL);
    markEndpoint.searchParams.set("instId", symbol);
    markEndpoint.searchParams.set("bar", "1m");
    markEndpoint.searchParams.set("after", String(row.fundingTimestamp - 120000));
    markEndpoint.searchParams.set("before", String(row.fundingTimestamp + 60000));
    markEndpoint.searchParams.set("limit", "10");

    const markResponse = await fetch(markEndpoint.toString(), { headers: { Accept: "application/json" } });
    const markData = await markResponse.json();
    if (!markResponse.ok || markData.code !== "0" || !Array.isArray(markData.data)) {
      throw new Error("Не удалось получить историческую mark price для Funding " + symbol + ": " + (markData.msg || markData.code || markResponse.status));
    }

    const markRows = markData.data
      .map(candle => ({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        close: Number(candle[4])
      }))
      .filter(candle => Number.isFinite(candle.timestamp) && Number.isFinite(candle.open) && Number.isFinite(candle.close) && candle.open > 0 && candle.close > 0);

    // Допускается только точная свеча события или непосредственно предыдущая минутная свеча.
    const exactCandle = markRows.find(candle => candle.timestamp === row.fundingTimestamp);
    const previousCandle = markRows.find(candle => candle.timestamp + 60000 === row.fundingTimestamp);
    const markCandle = exactCandle || previousCandle;
    if (!markCandle) {
      throw new Error("Не найдена точная или непосредственно предшествующая mark-свеча для Funding " + symbol + " " + row.fundingTime);
    }

    const settlementMarkPrice = exactCandle ? exactCandle.open : previousCandle.close;
    const eventPnl = -direction * contracts * contractValue * settlementMarkPrice * realizedRate;
    if (!Number.isFinite(eventPnl)) throw new Error("Некорректный расчёт Funding");
    fundingPnl += eventPnl;
    if (!Number.isFinite(fundingPnl)) throw new Error("Переполнение итогового расчёта Funding");
    events.push({
      fundingTime: new Date(row.fundingTimestamp).toISOString(),
      realizedRate,
      markPrice: settlementMarkPrice,
      fundingPnl: eventPnl
    });
  }

  return { fundingPnl, events };
}`;

replacements.calculateExistingPositionRisk = String.raw`function calculateExistingPositionRisk(position, instrument, feeRate, slippageRate) {
  if (
    !position || typeof position !== "object" ||
    !Number.isFinite(feeRate) || feeRate < 0 ||
    !Number.isFinite(slippageRate) || slippageRate < 0 ||
    !["OPEN_LONG", "OPEN_SHORT"].includes(position.action)
  ) {
    return { ok: false, error: "Некорректные параметры пересчёта риска существующей позиции" };
  }

  const contracts = Number(position.contracts);
  const contractValue = Number(instrument?.contractValue ?? position.contractValue);
  const referenceEntryPrice = Number(position.referenceEntryPrice ?? position.entryPrice);
  const entryExecutionPrice = Number(position.entryPrice);
  const stopLoss = Number(position.stopLoss);
  const action = position.action;
  if (
    ![contracts, contractValue, referenceEntryPrice, entryExecutionPrice, stopLoss].every(Number.isFinite) ||
    contracts <= 0 || contractValue <= 0 || referenceEntryPrice <= 0 || entryExecutionPrice <= 0 || stopLoss <= 0
  ) {
    return { ok: false, error: "Нельзя безопасно пересчитать риск существующей позиции" };
  }

  const stopExecutionPrice = getExecutionPrices(stopLoss, action, false, slippageRate);
  if (!Number.isFinite(stopExecutionPrice) || stopExecutionPrice <= 0) {
    return { ok: false, error: "Некорректная цена исполнения Stop Loss при пересчёте риска" };
  }
  const riskPerContract =
    Math.abs(referenceEntryPrice - stopLoss) * contractValue +
    Math.abs(entryExecutionPrice - referenceEntryPrice) * contractValue +
    Math.abs(stopExecutionPrice - stopLoss) * contractValue +
    (entryExecutionPrice + stopExecutionPrice) * contractValue * feeRate;
  const actualRisk = contracts * riskPerContract;
  if (!Number.isFinite(riskPerContract) || riskPerContract <= 0 || !Number.isFinite(actualRisk) || actualRisk <= 0) {
    return { ok: false, error: "Некорректный пересчитанный риск существующей позиции" };
  }
  return { ok: true, actualRisk };
}`;

replacements.evaluatePaperRiskAdmission = String.raw`function evaluatePaperRiskAdmission({
  symbol, action, activePositions, correlationSnapshot, config,
  instrument, entry, stopLoss, balance
}) {
  if (
    typeof symbol !== "string" || !SYMBOLS.includes(symbol) ||
    !["OPEN_LONG", "OPEN_SHORT"].includes(action) ||
    !Array.isArray(activePositions) || !config ||
    !Number.isFinite(balance) || balance < 0 ||
    !Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 ||
    !Number.isInteger(config.maxPositionsPerSymbol) || config.maxPositionsPerSymbol < 1 ||
    ![config.riskPerTrade, config.maxRiskPerSymbol, config.maxTotalRisk, config.maxCorrelatedRisk, config.leverage]
      .every(value => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(config.correlationThreshold) || config.correlationThreshold < 0 || config.correlationThreshold > 1 ||
    !Number.isFinite(config.feeRate) || config.feeRate < 0 ||
    !Number.isFinite(config.slippageRate) || config.slippageRate < 0
  ) {
    return { ok: false, error: "Некорректные входные данные или конфигурация риск-менеджера" };
  }

  let currentRisk = 0;
  let usedMargin = 0;
  for (const position of activePositions) {
    if (
      !position || typeof position.symbol !== "string" || !SYMBOLS.includes(position.symbol) ||
      !["OPEN_LONG", "OPEN_SHORT"].includes(position.action)
    ) {
      return { ok: false, error: "Обнаружена некорректная открытая позиция; новый вход запрещён" };
    }
    const positionRisk = Number(position.actualRisk);
    const positionMargin = Number(position.requiredMargin);
    if (!Number.isFinite(positionRisk) || positionRisk <= 0 || !Number.isFinite(positionMargin) || positionMargin <= 0) {
      return { ok: false, error: "Не подтверждены риск или маржа открытой позиции " + position.symbol + "; новый вход запрещён" };
    }
    currentRisk += positionRisk;
    usedMargin += positionMargin;
    if (!Number.isFinite(currentRisk) || !Number.isFinite(usedMargin)) {
      return { ok: false, error: "Переполнение совокупного риска или использованной маржи" };
    }
  }

  const symbolPositions = activePositions.filter(position => position.symbol === symbol);
  if (activePositions.length >= config.maxOpenPositions) {
    return { ok: false, error: "Достигнут общий лимит открытых позиций" };
  }
  if (symbolPositions.length >= config.maxPositionsPerSymbol) {
    return { ok: false, error: "Достигнут лимит двух позиций по инструменту" };
  }
  if (symbolPositions.some(position => position.action !== action)) {
    return { ok: false, error: "Запрещено открывать встречную позицию по уже занятому инструменту" };
  }

  const symbolRisk = symbolPositions.reduce((sum, position) => sum + Number(position.actualRisk), 0);
  const correlationRisk = getCorrelationRisk(
    symbol, activePositions, correlationSnapshot, config.correlationThreshold
  );
  if (!correlationRisk.ok) return { ok: false, error: correlationRisk.error };

  const riskBudget = Math.min(
    config.riskPerTrade,
    config.maxTotalRisk - currentRisk,
    config.maxRiskPerSymbol - symbolRisk,
    config.maxCorrelatedRisk - correlationRisk.correlatedRisk
  );
  if (!Number.isFinite(riskBudget) || riskBudget <= 0) {
    return { ok: false, error: "Исчерпан общий, инструментальный или корреляционный лимит риска" };
  }

  const size = calculatePaperPositionSize(
    entry, stopLoss, instrument, riskBudget, config.leverage, action,
    config.feeRate, config.slippageRate
  );
  if (!size.ok) return { ok: false, error: size.error };
  if (
    !Number.isFinite(size.actualRisk) || size.actualRisk <= 0 ||
    !Number.isFinite(size.requiredMargin) || size.requiredMargin <= 0 ||
    !Number.isFinite(size.contracts) || size.contracts <= 0
  ) {
    return { ok: false, error: "Расчёт размера позиции вернул некорректный риск, маржу или количество контрактов" };
  }

  if (correlationRisk.correlatedRisk + size.actualRisk > config.maxCorrelatedRisk + 1e-8) {
    return {
      ok: false,
      error: "Превышен лимит коррелирующего риска " + config.maxCorrelatedRisk + " USDT; связанные позиции: " + correlationRisk.correlatedSymbols.map(item => item.symbol).join(", ")
    };
  }
  if (
    symbolRisk + size.actualRisk > config.maxRiskPerSymbol + 1e-8 ||
    currentRisk + size.actualRisk > config.maxTotalRisk + 1e-8
  ) {
    return { ok: false, error: "Расчётный риск превышает установленный лимит" };
  }

  if (usedMargin + size.requiredMargin > balance) {
    return { ok: false, error: "Недостаточно виртуальной маржи" };
  }

  return {
    ok: true, size, riskBudget, currentRisk, symbolRisk,
    correlatedRisk: correlationRisk.correlatedRisk,
    requiredMarginAfterEntry: usedMargin + size.requiredMargin
  };
}`;

replacements.processPendingSignals = String.raw`async function processPendingSignals(env, lock) {
  if (!env.TRADER_KV) {
    throw new Error("TRADER_KV не подключён");
  }

  const rawState = await env.TRADER_KV.get("paper:state");
  const rawInstruments = await env.TRADER_KV.get("paper:instruments");
  if (!rawState || !rawInstruments) {
    throw new Error("Не найдены данные виртуального счёта");
  }

  const state = JSON.parse(rawState);
  const instruments = JSON.parse(rawInstruments);
  const now = Date.now();

  if (state.mode !== "DEMO ONLY" || state.executionEnabled !== false) {
    throw new Error("Обработка разрешена только в DEMO ONLY");
  }
  if (!Array.isArray(instruments)) {
    throw new Error("Спецификации контрактов имеют некорректный формат");
  }
  if (!Number.isFinite(Number(state.balance)) || Number(state.balance) < 0) {
    throw new Error("Баланс виртуального счёта некорректен; очередь сигналов не обработана");
  }
  state.balance = Number(state.balance);

  const maxOpenPositions = Number(state.maxOpenPositions);
  const maxPositionsPerSymbol = Number(state.maxPositionsPerSymbol);
  const riskPerTrade = Number(state.riskPerTrade);
  const maxRiskPerSymbol = Number(state.maxRiskPerSymbol);
  const maxTotalRisk = Number(state.maxTotalRisk);
  const maxCorrelatedRisk = Number(state.maxCorrelatedRisk ?? PAPER_CONFIG.maxCorrelatedRisk);
  const correlationThreshold = Number(state.correlationThreshold ?? PAPER_CONFIG.correlationThreshold);
  const feeRate = Number(state.feeRate ?? PAPER_CONFIG.feeRate);
  const slippageRate = Number(state.slippageRate ?? PAPER_CONFIG.slippageRate);
  const leverage = Number(state.leverage);

  if (
    !Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 ||
    !Number.isInteger(maxPositionsPerSymbol) || maxPositionsPerSymbol < 1 ||
    !Number.isFinite(riskPerTrade) || riskPerTrade <= 0 ||
    !Number.isFinite(maxRiskPerSymbol) || maxRiskPerSymbol <= 0 ||
    !Number.isFinite(maxTotalRisk) || maxTotalRisk <= 0 ||
    !Number.isFinite(maxCorrelatedRisk) || maxCorrelatedRisk <= 0 ||
    !Number.isFinite(correlationThreshold) || correlationThreshold < 0 || correlationThreshold > 1 ||
    !Number.isFinite(feeRate) || feeRate < 0 ||
    !Number.isFinite(slippageRate) || slippageRate < 0 ||
    !Number.isFinite(leverage) || leverage <= 0
  ) {
    throw new Error("Конфигурация риска виртуального счёта некорректна");
  }

  if (
    !Array.isArray(state.pendingSignals) ||
    !Array.isArray(state.openPositions) ||
    !Array.isArray(state.closedPositions)
  ) {
    throw new Error("Структура виртуального счёта повреждена; обработка остановлена без изменения истории");
  }

  const pending = state.pendingSignals.filter(signal => signal.status === "PENDING");
  const symbols = [...new Set(pending.map(signal => signal.symbol))];
  const results = [];

  for (const symbol of symbols) {
    if (!SYMBOLS.includes(symbol)) {
      results.push({ symbol, ok: false, error: "Инструмент отсутствует в разрешённом списке" });
      continue;
    }

    const market = await getCandles(symbol);
    if (!market.ok) {
      results.push({ symbol, ok: false, error: market.error });
      continue;
    }

    const instrument = instruments.find(item => item.symbol === symbol);
    if (!instrument) {
      results.push({ symbol, ok: false, error: "Спецификация контракта не найдена" });
      continue;
    }

    const signals = pending.filter(signal => signal.symbol === symbol);
    for (const signal of signals) {
      const expiryCheck = evaluatePendingSignalExpiry(signal, now);
      const lastProcessed = signal.lastProcessedCandleTime
        ? Date.parse(signal.lastProcessedCandleTime)
        : 0;

      if (!expiryCheck.ok || !Number.isFinite(lastProcessed)) {
        signal.status = "REJECTED";
        signal.rejectReason = !expiryCheck.ok ? expiryCheck.error : "Некорректное время последней обработанной свечи";
        results.push({ symbol, signalId: signal.id, status: "REJECTED", reason: signal.rejectReason });
        continue;
      }

      const eligibleTime = expiryCheck.eligibleTime;
      if (expiryCheck.expired) {
        signal.status = "EXPIRED";
        signal.expiredAt = expiryCheck.expiredAt;
        signal.rejectReason = "Окно входа пропущено: сигнал не был обработан вовремя";
        results.push({ symbol, signalId: signal.id, status: "EXPIRED", reason: signal.rejectReason });
        continue;
      }

      const candles = market.candles.filter(candle => {
        const candleTime = Date.parse(candle.time);
        const candleCloseTime = candleTime + 300000;
        return candleTime >= eligibleTime && candleTime > lastProcessed && candleCloseTime <= now;
      });

      let opened = false;
      for (const candle of candles) {
        signal.eligibleCandlesProcessed = (signal.eligibleCandlesProcessed || 0) + 1;
        signal.lastProcessedCandleTime = candle.time;

        const entryTouched = candle.low <= signal.entry && candle.high >= signal.entry;
        if (entryTouched) {
          const activePositions = state.openPositions.filter(position => position.status === "OPEN");
          const admission = evaluatePaperRiskAdmission({
            symbol,
            action: signal.action,
            activePositions,
            correlationSnapshot: state.latestCorrelation,
            config: {
              maxOpenPositions, maxPositionsPerSymbol, riskPerTrade, maxRiskPerSymbol,
              maxTotalRisk, maxCorrelatedRisk, correlationThreshold, leverage, feeRate, slippageRate
            },
            instrument,
            entry: signal.entry,
            stopLoss: signal.stopLoss,
            balance: Number(state.balance)
          });

          if (!admission.ok) {
            signal.status = "REJECTED";
            signal.rejectReason = admission.error;
            break;
          }

          const size = admission.size;
          const position = {
            id: crypto.randomUUID(),
            signalId: signal.id,
            analysisId: signal.analysisId,
            symbol: signal.symbol,
            action: signal.action,
            status: "OPEN",
            entryPrice: size.entryExecutionPrice,
            referenceEntryPrice: signal.entry,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            contracts: size.contracts,
            contractValue: Number(instrument.contractValue),
            actualRisk: size.actualRisk,
            plannedStopRisk: size.actualRisk,
            grossStopRisk: size.grossStopRisk,
            entryFee: size.entryFee,
            entrySlippageCost: size.entrySlippageCost,
            estimatedExitFeeAtStop: size.estimatedExitFeeAtStop,
            estimatedExitSlippageAtStop: size.estimatedExitSlippageAtStop,
            estimatedTradingCostsAtStop: size.estimatedTradingCostsAtStop,
            feeRate,
            slippageRate,
            notional: size.notional,
            requiredMargin: size.requiredMargin,
            leverage,
            entryCandleTime: candle.time,
            openedAt: new Date(Date.parse(candle.time) + 300000).toISOString(),
            lastProcessedCandleTime: candle.time,
            pnlAccounting: "NET_AFTER_FEES_SLIPPAGE_FUNDING",
            costsIncluded: false,
            riskExcludesFutureFunding: true,
            fundingPnl: 0,
            fundingEvents: []
          };

          const stopTouched = signal.action === "OPEN_SHORT"
            ? candle.high >= signal.stopLoss
            : candle.low <= signal.stopLoss;
          const targetTouched = signal.action === "OPEN_SHORT"
            ? candle.low <= signal.takeProfit
            : candle.high >= signal.takeProfit;

          if (stopTouched || targetTouched) {
            // Если одна свеча задела SL и TP, выбираем консервативный SL.
            const exitReferencePrice = stopTouched ? signal.stopLoss : signal.takeProfit;
            const exitReason = stopTouched ? "STOP_LOSS" : "TAKE_PROFIT";
            try {
              const closeResult = await closePaperPosition(position, exitReferencePrice, exitReason, candle.time, instrument);
              state.balance += closeResult.netPnl;
              if (!state.closedPositions.some(item => item.id === position.id)) {
                state.closedPositions.push(position);
              }
              signal.status = "CLOSED";
            } catch (error) {
              // Не теряем позицию: фиксируем намерение закрыть её и повторяем позже.
              position.pendingExit = { exitReferencePrice, exitReason, candleTime: candle.time };
              position.lastExitError = String(error);
              state.openPositions.push(position);
              signal.status = "OPEN";
              signal.rejectReason = "Закрытие отложено до подтверждения всех расходов: " + String(error);
            }
          } else {
            state.openPositions.push(position);
            signal.status = "OPEN";
          }

          signal.positionId = position.id;
          signal.openedAt = position.openedAt;
          opened = true;
          results.push({ symbol, signalId: signal.id, status: signal.status, position });
          break;
        }

        if (signal.eligibleCandlesProcessed >= getSignalExpiryConfig(signal).value) {
          signal.status = "EXPIRED";
          signal.expiredAt = new Date(Date.parse(candle.time) + 300000).toISOString();
          break;
        }
      }

      if (!opened && signal.status === "PENDING") {
        results.push({
          symbol,
          signalId: signal.id,
          status: signal.status,
          eligibleCandlesProcessed: signal.eligibleCandlesProcessed
        });
      }
    }
  }

  state.lastUpdatedAt = new Date().toISOString();
  await lock.put("paper:state", JSON.stringify(state));
  return { ok: true, mode: "DEMO ONLY", executionEnabled: false, processed: results };
}`;

replacements.processOpenPositions = String.raw`async function processOpenPositions(env, lock) {
  if (!env.TRADER_KV) throw new Error("TRADER_KV не подключён");
  const rawState = await env.TRADER_KV.get("paper:state");
  if (!rawState) throw new Error("Не найдено состояние виртуального счёта");

  const state = JSON.parse(rawState);
  if (state.mode !== "DEMO ONLY" || state.executionEnabled !== false) {
    throw new Error("Мониторинг разрешён только в DEMO ONLY");
  }
  if (!Array.isArray(state.openPositions) || !Array.isArray(state.closedPositions)) {
    throw new Error("Структура позиций повреждена; обработка остановлена без изменения истории");
  }
  if (!Number.isFinite(Number(state.balance)) || Number(state.balance) < 0) {
    throw new Error("Баланс виртуального счёта некорректен; закрытие позиций остановлено");
  }
  state.balance = Number(state.balance);
  if (!Array.isArray(state.pendingSignals)) state.pendingSignals = [];

  const activePositions = state.openPositions.filter(position => position.status === "OPEN");
  const symbols = [...new Set(activePositions.map(position => position.symbol))];
  const results = [];

  for (const symbol of symbols) {
    const positions = activePositions.filter(position => position.symbol === symbol && position.status === "OPEN");
    const positionsNeedingCandles = [];

    // Сначала повторяем ранее отложенные закрытия. Новые свечи для такой позиции
    // не обрабатываются, пока финансовый расчёт старого выхода не завершён.
    for (const position of positions) {
      if (!position.pendingExit) {
        positionsNeedingCandles.push(position);
        continue;
      }

      const pendingExit = position.pendingExit;
      if (
        !Number.isFinite(Number(pendingExit.exitReferencePrice)) || Number(pendingExit.exitReferencePrice) <= 0 ||
        !["STOP_LOSS", "TAKE_PROFIT"].includes(pendingExit.exitReason) ||
        !Number.isFinite(Date.parse(pendingExit.candleTime))
      ) {
        results.push({ symbol, positionId: position.id, status: "OPEN", ok: false, error: "Повреждены параметры отложенного закрытия; позиция оставлена открытой" });
        continue;
      }

      try {
        const closeResult = await closePaperPosition(
          position,
          Number(pendingExit.exitReferencePrice),
          pendingExit.exitReason,
          pendingExit.candleTime,
          { contractValue: position.contractValue }
        );
        state.balance += closeResult.netPnl;
        delete position.pendingExit;
        delete position.lastExitError;
        if (!state.closedPositions.some(item => item.id === position.id)) {
          state.closedPositions.push(position);
        }
        state.openPositions = state.openPositions.filter(item => item.id !== position.id);
        const linkedSignal = state.pendingSignals.find(signal => signal.id === position.signalId);
        if (linkedSignal) {
          linkedSignal.status = "CLOSED";
          linkedSignal.closedAt = position.closedAt;
        }
        results.push({
          symbol, positionId: position.id, status: "CLOSED",
          exitReason: position.exitReason, exitPrice: position.exitPrice,
          grossPnl: closeResult.grossPnl, netPnl: closeResult.netPnl,
          totalFees: closeResult.totalFees, totalSlippage: closeResult.totalSlippage,
          fundingPnl: closeResult.fundingPnl, totalCosts: closeResult.totalCosts,
          balance: state.balance, retriedPendingExit: true
        });
      } catch (error) {
        position.lastExitError = String(error);
        results.push({
          symbol, positionId: position.id, status: "OPEN", ok: false,
          error: "Повторное закрытие отложено: не удалось подтвердить все расходы: " + String(error),
          pendingExit: true
        });
      }
    }

    if (!positionsNeedingCandles.length) continue;

    const market = await getCandles(symbol);
    if (!market.ok) {
      results.push({ symbol, ok: false, error: market.error });
      continue;
    }

    for (const position of positionsNeedingCandles) {
      if (position.status !== "OPEN") continue;
      const candleWindow = getUnprocessedPositionCandles(
        market.candles,
        position.lastProcessedCandleTime || position.entryCandleTime
      );
      if (!candleWindow.ok) {
        results.push({ symbol, positionId: position.id, ok: false, error: candleWindow.error });
        continue;
      }

      let closed = false;
      for (const candle of candleWindow.candles) {
        const exitDecision = evaluatePositionExit(position, candle);
        if (!exitDecision.ok) {
          results.push({ symbol, positionId: position.id, ok: false, error: exitDecision.error });
          break;
        }

        if (exitDecision.shouldClose) {
          const pendingExit = {
            exitReferencePrice: exitDecision.exitReferencePrice,
            exitReason: exitDecision.exitReason,
            candleTime: candle.time
          };
          // Сохраняем параметры до попытки финансового закрытия.
          position.pendingExit = pendingExit;
          try {
            const closeResult = await closePaperPosition(
              position,
              pendingExit.exitReferencePrice,
              pendingExit.exitReason,
              pendingExit.candleTime,
              { contractValue: position.contractValue }
            );
            state.balance += closeResult.netPnl;
            delete position.pendingExit;
            delete position.lastExitError;
            if (!state.closedPositions.some(item => item.id === position.id)) {
              state.closedPositions.push(position);
            }
            state.openPositions = state.openPositions.filter(item => item.id !== position.id);
            const linkedSignal = state.pendingSignals.find(signal => signal.id === position.signalId);
            if (linkedSignal) {
              linkedSignal.status = "CLOSED";
              linkedSignal.closedAt = position.closedAt;
            }
            closed = true;
            results.push({
              symbol, positionId: position.id, status: "CLOSED",
              exitReason: position.exitReason, exitPrice: position.exitPrice,
              grossPnl: closeResult.grossPnl, netPnl: closeResult.netPnl,
              totalFees: closeResult.totalFees, totalSlippage: closeResult.totalSlippage,
              fundingPnl: closeResult.fundingPnl, totalCosts: closeResult.totalCosts,
              balance: state.balance
            });
          } catch (error) {
            position.lastExitError = String(error);
            results.push({
              symbol, positionId: position.id, status: "OPEN", ok: false,
              error: "Закрытие отложено: не удалось подтвердить все расходы: " + String(error),
              pendingExit: true
            });
          }
          break;
        }

        position.lastProcessedCandleTime = candle.time;
      }

      if (!closed && position.status === "OPEN" && !position.pendingExit) {
        results.push({
          symbol, positionId: position.id, status: "OPEN",
          lastProcessedCandleTime: position.lastProcessedCandleTime
        });
      }
    }
  }

  state.lastUpdatedAt = new Date().toISOString();
  await lock.put("paper:state", JSON.stringify(state));
  return {
    ok: true,
    mode: "DEMO ONLY",
    executionEnabled: false,
    checkedPositions: activePositions.length,
    results
  };
}`;

if (!fs.existsSync(file)) {
  fail('В текущей папке не найден worker.js. Открой PowerShell в папке проекта и повтори запуск.');
} else {
  const original = fs.readFileSync(file, 'utf8');
  const originalHash = sha256(original);
  if (originalHash !== expectedSha256) {
    fail('SHA256 worker.js не совпадает с ожидаемой версией. Изменений не сделано.\nОжидался: ' + expectedSha256 + '\nПолучен:  ' + originalHash + '\nСначала пришли фактический SHA256 — адаптирую установщик к твоей версии.');
  } else {
    let patched = original;
    const counts = {};
    try {
      for (const name of Object.keys(replacements)) {
        const result = replaceFunction(patched, name, replacements[name]);
        patched = result.source;
        counts[name] = 1;
      }

      // Защита от случайного изменения важных режимов и параметров проекта.
      const requiredInvariants = [
        'mode: "DEMO ONLY"',
        'executionEnabled: false',
        'maxOpenPositions: 12',
        'maxPositionsPerSymbol: 2',
        'riskPerTrade: 5',
        'maxRiskPerSymbol: 10',
        'maxTotalRisk: 60',
        'maxCorrelatedRisk: 15',
        'leverage: 2'
      ];
      for (const invariant of requiredInvariants) {
        if (!patched.includes(invariant)) throw new Error('Не найден обязательный контрольный параметр: ' + invariant);
      }
      if (!patched.includes('const now = Date.now();') || !patched.includes('evaluatePendingSignalExpiry(signal, now)')) {
        throw new Error('Проверка единого времени обработки сигналов не пройдена');
      }

      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const backup = path.join(path.dirname(file), 'worker.js.backup-before-risk-fixes-' + stamp);
      const temp = file + '.patch-tmp';
      if (fs.existsSync(backup) || fs.existsSync(temp)) throw new Error('Файл резервной копии или временный файл уже существует: ' + backup);

      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(temp, patched, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, file);

      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (check.status !== 0) {
        fs.copyFileSync(backup, file);
        throw new Error('node --check завершился ошибкой. Исходный worker.js автоматически восстановлен из резервной копии.\n' + (check.stderr || check.stdout || '')); 
      }

      const finalText = fs.readFileSync(file, 'utf8');
      console.log('PATCH APPLIED.');
      console.log('node --check: OK');
      console.log('Изменены функции: ' + Object.keys(counts).join(', '));
      console.log('Backup: ' + backup);
      console.log('SHA256 before: ' + originalHash);
      console.log('SHA256 after:  ' + sha256(finalText));
      console.log('No application code, self-test route, network request, OKX API, KV, Cloudflare or deployment was executed.');
    } catch (error) {
      try {
        const temp = file + '.patch-tmp';
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {}
      fail(String(error && error.message || error));
    }
  }
}
