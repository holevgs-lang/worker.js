const BASE_URL = "https://eea.okx.com";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const SYMBOLS = [
  "BTC-USDT-SWAP",
  "ETH-USDT-SWAP",
  "SOL-USDT-SWAP",
  "LINK-USDT-SWAP",
  "GRASS-USDT-SWAP",
  "STRK-USDT-SWAP"
];

const PAPER_CONFIG = {
  initialCapital: 500,
  leverage: 2,
  maxOpenPositions: 12,
  maxPositionsPerSymbol: 2,
  riskPerTrade: 5,
  maxRiskPerSymbol: 10,
  maxTotalRisk: 60,
  maxCorrelatedRisk: 15,
  correlationThreshold: 0.75,
  feeRate: 0.0005,
  slippageRate: 0.0002
};

const CORRELATION_WINDOW = 50;
const CORRELATION_MIN_SAMPLES = 20;
const CORRELATION_MAX_AGE_MS = 10 * 60 * 1000;
const PAPER_LOCK_TTL_MS = 5 * 60 * 1000;
const PAPER_LOCK_RENEW_INTERVAL_MS = 60 * 1000;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function controlAuthError(request, env, requiredMethod) {
  if (request.method !== requiredMethod) {
    return json({
      ok: false,
      error: `Разрешён только ${requiredMethod}`
    }, 405);
  }

  if (!env.BOT_CONTROL_TOKEN) {
    return json({
      ok: false,
      error: "BOT_CONTROL_TOKEN не настроен"
    }, 500);
  }

  if (
    request.headers.get("Authorization") !==
    `Bearer ${env.BOT_CONTROL_TOKEN}`
  ) {
    return json({
      ok: false,
      error: "Доступ запрещён"
    }, 401);
  }

  return null;
}

// Получение 100 завершённых свечей OKX
async function getCandles(symbol) {
  const endpoint = new URL(
    "/api/v5/market/candles",
    BASE_URL
  );

  endpoint.searchParams.set("instId", symbol);
  endpoint.searchParams.set("bar", "5m");
  endpoint.searchParams.set("limit", "100");

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(endpoint.toString(), {
        headers: {
          "Accept": "application/json"
        }
      });

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          "Некорректный ответ OKX: " + raw.slice(0, 200)
        );
      }

      if (!response.ok || data.code !== "0") {
        
const error = new Error(
  "OKX HTTP " + response.status +
  "; code " + data.code +
  "; " + (data.msg || "")
);

const requestError = /** @type {any} */ (error);

requestError.rateLimited =
  response.status === 429 ||
  data.code === "50011";

const retryAfter = Number(
  response.headers.get("Retry-After")
);

requestError.retryDelay =
  Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 30000)
    : 5000;

throw requestError;

      }

      const candles = (data.data || [])
        .filter(c => c[8] === "1")
        .slice(0, 100)
        .reverse()
        .map(c => ({
          time: new Date(Number(c[0])).toISOString(),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5])
        }))
        .filter(candle =>
          Number.isFinite(Date.parse(candle.time)) &&
          [candle.open, candle.high, candle.low, candle.close, candle.volume]
            .every(Number.isFinite) &&
          candle.open > 0 &&
          candle.high > 0 &&
          candle.low > 0 &&
          candle.close > 0 &&
          candle.volume >= 0 &&
          candle.high >= Math.max(candle.open, candle.close, candle.low) &&
          candle.low <= Math.min(candle.open, candle.close, candle.high)
        );

      if (candles.length < 35) {
        throw new Error(
          "Недостаточно завершённых свечей"
        );
      }

      return {
        symbol,
        ok: true,
        candlesCount: candles.length,
        latest: candles[candles.length - 1],
        candles
      };

    
} catch (error) {
  const requestError = /** @type {Error & { rateLimited?: boolean, retryDelay?: number }} */ (error);

  lastError = String(error);

  if (attempt === 0 && requestError.rateLimited) {
    await sleep(requestError.retryDelay || 5000);
    continue;
  }

  break;
}

  }

  return {
    symbol,
    ok: false,
    error: lastError
  };
}

// Экспоненциальная скользящая средняя
function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      values[i] * multiplier +
      result * (1 - multiplier);
  }

  return result;
}

// Полный ряд EMA для MACD
function emaSeries(values, period) {
  const result = [];

  if (values.length < period) return result;

  const multiplier = 2 / (period + 1);

  let current = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  result.push(current);

  for (let i = period; i < values.length; i++) {
    current =
      values[i] * multiplier +
      current * (1 - multiplier);

    result.push(current);
  }

  return result;
}

// Расчёт индикаторов
function calculateIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 35) {
    throw new Error("Недостаточно свечей");
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);

  // RSI 14 по методу Wilder
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= 14; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain = gains / 14;
  let avgLoss = losses / 14;

  for (let i = 15; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    avgGain =
      (avgGain * 13 + Math.max(change, 0)) / 14;

    avgLoss =
      (avgLoss * 13 + Math.max(-change, 0)) / 14;
  }

  let rsi;

  if (avgGain === 0 && avgLoss === 0) {
    rsi = 50;
  } else if (avgLoss === 0) {
    rsi = 100;
  } else {
    rsi = 100 - 100 / (1 + avgGain / avgLoss);
  }

  // MACD 12 / 26 / 9
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);

  const macdValues = [];

  // EMA12 и EMA26 начинаются с разных индексов.
  // Сопоставляем значения по исходным индексам.
  for (let i = 25; i < closes.length; i++) {
    const shortValue = ema12[i - 11];
    const longValue = ema26[i - 25];

    macdValues.push(shortValue - longValue);
  }

  const macd = macdValues[macdValues.length - 1];
  const signal = ema(macdValues, 9);
  const histogram = macd - signal;

  // ATR 14 по методу Wilder
  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    trueRanges.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  let atr = trueRanges
    .slice(0, 14)
    .reduce((a, b) => a + b, 0) / 14;

  for (let i = 14; i < trueRanges.length; i++) {
    atr = (atr * 13 + trueRanges[i]) / 14;
  }

  // Средний объём предыдущих 20 свечей
  const previousVolumes = volumes.slice(-21, -1);

  const averageVolume = previousVolumes.length
    ? previousVolumes.reduce((a, b) => a + b, 0) /
      previousVolumes.length
    : 0;

  const currentVolume = volumes[volumes.length - 1];

  const result = {
    price: closes[closes.length - 1],
    ema9,
    ema21,
    rsi,
    macd,
    macdSignal: signal,
    macdHistogram: histogram,
    atr,
    volume: currentVolume,
    averageVolume,
    volumeRatio: averageVolume > 0
      ? currentVolume / averageVolume
      : null
  };

  for (const value of Object.values(result)) {
    if (value !== null && !Number.isFinite(value)) {
      throw new Error("Некорректное значение индикатора");
    }
  }

  return result;
}

// Получение данных всех рынков

async function collectMarketData() {  
/** @type {any[]} */
const marketData = [];


  for (const symbol of SYMBOLS) {
    const market = await getCandles(symbol);

    if (!market.ok) {
      marketData.push({
        symbol,
        error: market.error
      });

      await sleep(10000);
      continue;
    }

    const indicators = calculateIndicators(market.candles);

    const lastCandle = market.latest;

    marketData.push({
      symbol,

      // Время открытия последней закрытой свечи
      lastCandleTime: lastCandle.time,

      // OHLC последней закрытой свечи
      lastCandleOpen: lastCandle.open,
      lastCandleHigh: lastCandle.high,
      lastCandleLow: lastCandle.low,
      lastCandleClose: lastCandle.close,
      lastCandleVolume: lastCandle.volume,

      // Индикаторы
      ...indicators,
      // Синхронизированный ряд закрытий для расчёта корреляции доходностей.
      closeSeries: market.candles.slice(-CORRELATION_WINDOW - 1).map(candle => ({
        time: candle.time,
        close: candle.close
      }))
    });

    await sleep(5000);
  }

  return marketData;
}


// Извлечение JSON из ответа Gemma
function extractAIJson(response) {
  let content = response;

  // Если пришла строка с JSON-оболочкой,
  // сначала пробуем разобрать её.
  if (typeof content === "string") {
    try {
      content = JSON.parse(content);
    } catch (error) {
      // Возможно, это уже текст самого ответа модели.
    }
  }

  // Извлекаем текст ответа из формата Chat Completions.
  if (
    content &&
    typeof content === "object" &&
    Array.isArray(content.choices)
  ) {
    content = content.choices[0]?.message?.content;
  }

  // Если модель уже вернула готовый объект.
  if (
    content &&
    typeof content === "object" &&
    Array.isArray(content.decisions)
  ) {
    return content;
  }

  if (typeof content !== "string") {
    throw new Error("Не найден текст JSON-ответа Gemma");
  }

  let text = content.trim();

  // Убираем Markdown-обрамление, если оно есть.
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Извлекаем JSON-объект.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("В ответе Gemma не найден JSON-объект");
  }

  return JSON.parse(text.slice(start, end + 1));
}

// Проверка торговых решений
// Проверка торговых решений
function validateDecisions(parsed, marketData) {
  const errors = [];
  const warnings = [];

  if (!parsed || !Array.isArray(parsed.decisions)) {
    return {
      valid: false,
      errors: ["Нет массива decisions"],
      warnings
    };
  }

  if (parsed.decisions.length !== SYMBOLS.length) {
    errors.push("Количество решений не равно шести");
  }

  for (const symbol of SYMBOLS) {
    const matches = parsed.decisions.filter(
      d => d && d.symbol === symbol
    );

    if (matches.length !== 1) {
      errors.push(
        symbol + ": отсутствует решение или есть дубликаты"
      );
      continue;
    }

    const d = matches[0];

    const market = marketData.find(
      item => item.symbol === symbol
    );

    if (
      !market ||
      ![
        market.price,
        market.ema9,
        market.ema21,
        market.rsi,
        market.macd,
        market.macdSignal,
        market.macdHistogram,
        market.atr,
        market.volumeRatio
      ].every(Number.isFinite)
    ) {
      errors.push(
        symbol + ": отсутствуют корректные рыночные данные"
      );
      continue;
    }

    if (!["OPEN_LONG", "OPEN_SHORT", "HOLD"].includes(d.action)) {
      errors.push(symbol + ": недопустимое действие");
      continue;
    }

    if (
      !Number.isInteger(d.confidence) ||
      d.confidence < 0 ||
      d.confidence > 100
    ) {
      errors.push(
        symbol + ": confidence должен быть целым числом от 0 до 100"
      );
      continue;
    }

    if (typeof d.reason !== "string" || !d.reason.trim()) {
      errors.push(symbol + ": отсутствует объяснение решения");
      continue;
    }

    const reason = d.reason.toLowerCase();
    const factualProblems = [];

    // Нормализация распространённой опечатки
    const normalizedReason = reason.replace(
      /ни\s+же/g,
      "ниже"
    );

    // Проверка положения цены относительно EMA
    const relationChecks = [
      {
        pattern: /(?:цена\s+)?(?:находится\s+)?ниже\s+ema\s*9/i,
        correct: market.price < market.ema9,
        label: "Цена ошибочно указана ниже EMA9"
      },
      {
        pattern: /(?:цена\s+)?(?:находится\s+)?выше\s+ema\s*9/i,
        correct: market.price > market.ema9,
        label: "Цена ошибочно указана выше EMA9"
      },
      {
        pattern: /(?:цена\s+)?(?:находится\s+)?ниже\s+ema\s*21/i,
        correct: market.price < market.ema21,
        label: "Цена ошибочно указана ниже EMA21"
      },
      {
        pattern: /(?:цена\s+)?(?:находится\s+)?выше\s+ema\s*21/i,
        correct: market.price > market.ema21,
        label: "Цена ошибочно указана выше EMA21"
      }
    ];

    for (const check of relationChecks) {
      if (
        check.pattern.test(normalizedReason) &&
        !check.correct
      ) {
        factualProblems.push(check.label);
      }
    }

    // Проверка MACD относительно сигнальной линии
    if (
      /macd\s+(?:выше|над)\s+(?:сигнальной\s+лини[ия])/i.test(normalizedReason) &&
      !(market.macd > market.macdSignal)
    ) {
      factualProblems.push(
        "MACD ошибочно указан выше сигнальной линии"
      );
    }

    if (
      /macd\s+(?:ниже|под)\s+(?:сигнальной\s+лини[ия])/i.test(normalizedReason) &&
      !(market.macd < market.macdSignal)
    ) {
      factualProblems.push(
        "MACD ошибочно указан ниже сигнальной линии"
      );
    }

    // Проверка положительного и отрицательного MACD
    if (
      /macd\s+(?:положительный|положителен)/i.test(normalizedReason) &&
      !(market.macd > 0)
    ) {
      factualProblems.push("MACD ошибочно назван положительным");
    }

    if (
      /macd\s+(?:отрицательный|отрицателен)/i.test(normalizedReason) &&
      !(market.macd < 0)
    ) {
      factualProblems.push("MACD ошибочно назван отрицательным");
    }

    // Проверка числового RSI
    const rsiMatches = [
      ...normalizedReason.matchAll(
        /rsi\s*(?:\(|:|=)?\s*(\d+(?:[.,]\d+)?)/gi
      )
    ];

    for (const match of rsiMatches) {
      const statedRSI = Number(match[1].replace(",", "."));

      if (
        !Number.isFinite(statedRSI) ||
        Math.abs(statedRSI - market.rsi) > 0.2
      ) {
        factualProblems.push(
          "Указанное значение RSI не совпадает с рыночными данными"
        );
        break;
      }
    }

    // Проверка объёма относительно среднего
    if (
      /объем\s+(?:выше|превышает)\s+среднего/i.test(normalizedReason) &&
      !(market.volumeRatio > 1)
    ) {
      factualProblems.push(
        "Объём ошибочно указан выше среднего"
      );
    }

    if (
      /объем\s+(?:ниже|меньше)\s+среднего/i.test(normalizedReason) &&
      !(market.volumeRatio < 1)
    ) {
      factualProblems.push(
        "Объём ошибочно указан ниже среднего"
      );
    }

    // Проверка HOLD
    if (d.action === "HOLD") {
      if (
        d.entry !== null ||
        d.stopLoss !== null ||
        d.takeProfit !== null
      ) {
        errors.push(
          symbol + ": HOLD должен иметь null в ценах"
        );
      }

      if (factualProblems.length > 0) {
        warnings.push(
          symbol + ": ошибка в объяснении HOLD. " +
          factualProblems.join("; ")
        );
      }

      continue;
    }

    // Проверка цен сделки
    const prices = [
      d.entry,
      d.stopLoss,
      d.takeProfit
    ];

    if (!prices.every(Number.isFinite)) {
      errors.push(symbol + ": некорректные цены");
      continue;
    }

    if (
      d.entry <= 0 ||
      d.stopLoss <= 0 ||
      d.takeProfit <= 0
    ) {
      errors.push(symbol + ": недопустимые цены");
      continue;
    }

    const maxEntryDistance = Math.max(
      market.atr * 2.5,
      market.price * 0.01
    );

    if (
      Math.abs(d.entry - market.price) > maxEntryDistance
    ) {
      errors.push(
        symbol + ": цена входа слишком далеко от рынка"
      );
      continue;
    }

    let tradeProblems = factualProblems.slice();

    // Проверка LONG
    if (d.action === "OPEN_LONG") {
      if (
        d.stopLoss >= d.entry ||
        d.takeProfit <= d.entry
      ) {
        tradeProblems.push(
          "Неверное расположение SL или TP для LONG"
        );
      }

      const risk = d.entry - d.stopLoss;
      const reward = d.takeProfit - d.entry;

      if (risk > 0 && reward / risk < 1.5) {
        tradeProblems.push(
          "Соотношение прибыли к риску меньше 1.5"
        );
      }

      if (
        !(market.price > market.ema9 &&
          market.ema9 > market.ema21)
      ) {
        tradeProblems.push(
          "Нет подтверждения восходящего расположения EMA"
        );
      }

      if (market.rsi < 50 || market.rsi > 70) {
        tradeProblems.push(
          "RSI не соответствует фильтру LONG"
        );
      }

      if (
        !(market.macd > market.macdSignal &&
          market.macdHistogram > 0)
      ) {
        tradeProblems.push("MACD не подтверждает LONG");
      }

      if (market.volumeRatio < 1) {
        tradeProblems.push("Объём ниже среднего");
      }
    }

    // Проверка SHORT
    if (d.action === "OPEN_SHORT") {
      if (
        d.stopLoss <= d.entry ||
        d.takeProfit >= d.entry
      ) {
        tradeProblems.push(
          "Неверное расположение SL или TP для SHORT"
        );
      }

      const risk = d.stopLoss - d.entry;
      const reward = d.entry - d.takeProfit;

      if (risk > 0 && reward / risk < 1.5) {
        tradeProblems.push(
          "Соотношение прибыли к риску меньше 1.5"
        );
      }

      if (
        !(market.price < market.ema9 &&
          market.ema9 < market.ema21)
      ) {
        tradeProblems.push(
          "Нет подтверждения нисходящего расположения EMA"
        );
      }

      if (market.rsi < 30 || market.rsi > 50) {
        tradeProblems.push(
          "RSI не соответствует фильтру SHORT"
        );
      }

      if (
        !(market.macd < market.macdSignal &&
          market.macdHistogram < 0)
      ) {
        tradeProblems.push("MACD не подтверждает SHORT");
      }

      if (market.volumeRatio < 1) {
        tradeProblems.push("Объём ниже среднего");
      }
    }

    // Блокировка сделки при обнаружении проблем
    if (tradeProblems.length > 0) {
      warnings.push(
        symbol + ": сделка заменена на HOLD. " +
        tradeProblems.join("; ")
      );

      d.action = "HOLD";
      d.entry = null;
      d.stopLoss = null;
      d.takeProfit = null;
      d.confidence = 0;
      d.reason =
        "Автоматический HOLD: торговые условия не прошли защитную проверку.";
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
async function withPaperLock(env, task) {
  if (!env.PAPER_LOCK) {
    throw new Error("Durable Object PAPER_LOCK не подключён");
  }

  const id = env.PAPER_LOCK.idFromName("okx-smart-trader-paper-account");
  const stub = env.PAPER_LOCK.get(id);

  // Каждый запрос к Durable Object имеет ограниченное время ожидания.
  async function requestPaperLock(path, token, body, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const headers = {
        "Accept": "application/json"
      };

      if (token) {
        headers["X-Paper-Lock-Token"] = token;
      }

      const options = {
        method: "POST",
        headers,
        signal: controller.signal
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }

      const response = await stub.fetch(
        `https://paper-lock${path}`,
        options
      );

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("Durable Object вернул некорректный JSON");
      }

      if (!response.ok || data?.ok !== true) {
        throw new Error(
          data?.error || `HTTP ${response.status}`
        );
      }

      return data;

    } catch (error) {
      if (timedOut) {
        throw new Error(
          `PaperLock ${path}: превышено время ожидания ${timeoutMs} мс`
        );
      }

      throw new Error(
        `PaperLock ${path}: ${String(error)}`
      );

    } finally {
      clearTimeout(timeout);
    }
  }

  // Получаем блокировку.
  const acquireData = await requestPaperLock(
    "/acquire",
    null,
    undefined,
    15000
  );

  const token = acquireData.token;

  if (typeof token !== "string" || !token) {
    throw new Error("PaperLock: не получен токен блокировки");
  }

  let heartbeatError = null;
  let heartbeatStopped = false;
  let stopHeartbeatResolve;

  const stopHeartbeatSignal = new Promise(resolve => {
    stopHeartbeatResolve = resolve;
  });

  // Продлеваем блокировку до завершения основной операции.
  const heartbeat = (async () => {
    while (!heartbeatStopped) {
      const action = await Promise.race([
        sleep(PAPER_LOCK_RENEW_INTERVAL_MS).then(() => "renew"),
        stopHeartbeatSignal.then(() => "stop")
      ]);

      if (action === "stop" || heartbeatStopped) {
        return;
      }

      try {
        await requestPaperLock(
          "/renew",
          token,
          undefined,
          20000
        );
      } catch (error) {
        heartbeatError = error;
        return;
      }
    }
  })();

  // Все записи состояния проходят через Durable Object.
  const lock = {
    put: async (key, value) => {
      if (heartbeatError) {
        throw new Error(
          "Запись запрещена: heartbeat блокировки завершился ошибкой: " +
          String(heartbeatError)
        );
      }

      const result = await requestPaperLock(
        "/put",
        token,
        { key, value },
        30000
      );

      if (heartbeatError) {
        throw new Error(
          "Запись завершена с неопределённым состоянием heartbeat: " +
          String(heartbeatError)
        );
      }

      return result;
    }
  };

  let taskError = null;

  try {
    const result = await task(lock);

    if (heartbeatError) {
      throw new Error(
        "PaperLock потерял подтверждение продления блокировки: " +
        String(heartbeatError)
      );
    }

    return result;

  } catch (error) {
    taskError = error;
    throw error;

  } finally {
    // Останавливаем heartbeat и дожидаемся завершения текущего запроса.
    heartbeatStopped = true;
    stopHeartbeatResolve();

    await heartbeat;

    let cleanupError = null;

    if (heartbeatError && !taskError) {
      cleanupError = new Error(
        "Ошибка heartbeat PaperLock: " + String(heartbeatError)
      );
    }

    // Освобождение блокировки также ограничено по времени.
    try {
      await requestPaperLock(
        "/release",
        token,
        undefined,
        10000
      );
    } catch (releaseError) {
      if (!taskError && !cleanupError) {
        cleanupError = releaseError;
      } else {
        console.error(
          "PaperLock release failed",
          String(releaseError)
        );
      }
    }

    if (cleanupError) {
      throw cleanupError;
    }
  }
}
function pearsonCorrelation(valuesA, valuesB) {
  if (valuesA.length !== valuesB.length || valuesA.length < CORRELATION_MIN_SAMPLES) {
    return null;
  }

  const meanA = valuesA.reduce((sum, value) => sum + value, 0) / valuesA.length;
  const meanB = valuesB.reduce((sum, value) => sum + value, 0) / valuesB.length;
  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;

  for (let i = 0; i < valuesA.length; i++) {
    const da = valuesA[i] - meanA;
    const db = valuesB[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }

  const denominator = Math.sqrt(sumSqA * sumSqB);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

function calculateCorrelationMatrix(marketData) {
  const returnMaps = new Map();

  for (const item of marketData) {
    if (!item || !SYMBOLS.includes(item.symbol) || !Array.isArray(item.closeSeries)) continue;
    const closes = item.closeSeries
      .filter(point => point && Number.isFinite(Date.parse(point.time)) && Number.isFinite(point.close) && point.close > 0)
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const returns = new Map();

    for (let i = 1; i < closes.length; i++) {
      const previous = closes[i - 1];
      const current = closes[i];
      const previousTime = Date.parse(previous.time);
      const currentTime = Date.parse(current.time);
      if (currentTime - previousTime !== 300000) continue;
      returns.set(current.time, Math.log(current.close / previous.close));
    }

    returnMaps.set(item.symbol, returns);
  }

  const matrix = {};
  for (const symbolA of SYMBOLS) {
    matrix[symbolA] = {};
    for (const symbolB of SYMBOLS) {
      if (symbolA === symbolB) {
        matrix[symbolA][symbolB] = 1;
        continue;
      }
      const mapA = returnMaps.get(symbolA);
      const mapB = returnMaps.get(symbolB);
      if (!mapA || !mapB) {
        matrix[symbolA][symbolB] = null;
        continue;
      }
      const commonTimes = [...mapA.keys()].filter(time => mapB.has(time)).sort();
      const valuesA = commonTimes.map(time => mapA.get(time));
      const valuesB = commonTimes.map(time => mapB.get(time));
      matrix[symbolA][symbolB] = pearsonCorrelation(valuesA, valuesB);
    }
  }

  return {
    matrix,
    window: CORRELATION_WINDOW,
    minSamples: CORRELATION_MIN_SAMPLES,
    threshold: PAPER_CONFIG.correlationThreshold,
    calculatedAt: new Date().toISOString()
  };
}

function getCorrelationRisk(symbol, activePositions, correlationSnapshot, threshold) {
  if (!correlationSnapshot || !correlationSnapshot.matrix ||
      !Number.isFinite(Date.parse(correlationSnapshot.calculatedAt)) ||
      Date.now() - Date.parse(correlationSnapshot.calculatedAt) > CORRELATION_MAX_AGE_MS) {
    return { ok: false, error: "Нет свежего снимка корреляции; новые позиции временно запрещены" };
  }

  let correlatedRisk = 0;
  const correlatedSymbols = [];

  for (const position of activePositions) {
    if (position.symbol === symbol) continue;
    const correlation = correlationSnapshot.matrix?.[symbol]?.[position.symbol];
    if (!Number.isFinite(correlation)) {
      return {
        ok: false,
        error: `Недостаточно данных корреляции для ${symbol} и ${position.symbol}`
      };
    }
    if (Math.abs(correlation) >= threshold) {
      correlatedRisk += Number(position.actualRisk || position.plannedStopRisk || 0);
      correlatedSymbols.push({ symbol: position.symbol, correlation });
    }
  }

  return { ok: true, correlatedRisk, correlatedSymbols };
}

function getExecutionPrices(referencePrice, action, isEntry, slippageRate) {
  const direction = action === "OPEN_LONG" ? 1 : -1;
  const adverseDirection = isEntry ? direction : -direction;
  return referencePrice * (1 + adverseDirection * slippageRate);
}

async function getFundingPayments(symbol, openedAt, closedAt, contracts, contractValue, direction) {
  const from = Date.parse(openedAt);
  const to = Date.parse(closedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`Некорректные даты для расчёта Funding по ${symbol}`);
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
    throw new Error(`Не удалось получить историю Funding для ${symbol}: ${data.msg || data.code || response.status}`);
  }

  const fundingRows = data.data
    .map(row => ({ ...row, fundingTimestamp: Number(row.fundingTime) }))
    .filter(row => Number.isFinite(row.fundingTimestamp) && row.fundingTimestamp > from && row.fundingTimestamp <= to)
    .sort((a, b) => a.fundingTimestamp - b.fundingTimestamp);

  const allFundingTimes = data.data.map(row => Number(row.fundingTime)).filter(Number.isFinite);
  const oldestReturned = allFundingTimes.length ? Math.min(...allFundingTimes) : null;
  if (Number.isFinite(oldestReturned) && from < oldestReturned) {
    throw new Error(`История Funding для ${symbol} не покрывает весь срок позиции; сделка оставлена открытой до получения полного расчёта`);
  }
  if (!allFundingTimes.length) {
    throw new Error(`OKX не вернул историю Funding для ${symbol}; сделка оставлена открытой до получения подтверждённых данных`);
  }

  const events = [];
  let fundingPnl = 0;

  for (const row of fundingRows) {
    const realizedRate = Number(row.realizedRate);
    if (!Number.isFinite(realizedRate)) {
      throw new Error(`OKX не вернул фактический realizedRate для ${symbol} на ${row.fundingTime}`);
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
      throw new Error(`Не удалось получить историческую mark price для Funding ${symbol}: ${markData.msg || markData.code || markResponse.status}`);
    }

    const markRows = markData.data
      .map(candle => ({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        close: Number(candle[4])
      }))
      .filter(candle => Number.isFinite(candle.timestamp) && Number.isFinite(candle.open) && Number.isFinite(candle.close) && candle.open > 0 && candle.close > 0);
    const markCandle = markRows.find(candle => candle.timestamp === row.fundingTimestamp) ||
      markRows.find(candle => candle.timestamp + 60000 === row.fundingTimestamp) ||
      markRows.sort((a, b) => Math.abs(a.timestamp - row.fundingTimestamp) - Math.abs(b.timestamp - row.fundingTimestamp))[0];

    if (!markCandle || Math.abs(markCandle.timestamp - row.fundingTimestamp) > 60000) {
      throw new Error(`Не найдена mark price в момент Funding ${symbol} ${row.fundingTime}`);
    }
    const settlementMarkPrice = markCandle.timestamp === row.fundingTimestamp
      ? markCandle.open
      : markCandle.close;

    // Положительная ставка: LONG платит, SHORT получает; отрицательная — наоборот.
    const eventPnl = -direction * contracts * contractValue * settlementMarkPrice * realizedRate;
    if (!Number.isFinite(eventPnl)) throw new Error("Некорректный расчёт Funding");
    fundingPnl += eventPnl;
    events.push({
      fundingTime: new Date(row.fundingTimestamp).toISOString(),
      realizedRate,
      markPrice: settlementMarkPrice,
      fundingPnl: eventPnl
    });
  }

  return { fundingPnl, events };
}

function evaluatePositionExit(position, candle) {
  if (!position || !candle || !["OPEN_LONG", "OPEN_SHORT"].includes(position.action)) {
    return { ok: false, error: "Некорректная позиция или направление" };
  }

  const stopLoss = Number(position.stopLoss);
  const takeProfit = Number(position.takeProfit);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const candleTimestamp = Date.parse(candle.time);

  if (
    ![stopLoss, takeProfit, high, low].every(Number.isFinite) ||
    stopLoss <= 0 || takeProfit <= 0 || low <= 0 || high < low ||
    !Number.isFinite(candleTimestamp)
  ) {
    return { ok: false, error: "Некорректные цены или время свечи для проверки выхода" };
  }

  const isLong = position.action === "OPEN_LONG";
  const stopTouched = isLong ? low <= stopLoss : high >= stopLoss;
  const targetTouched = isLong ? high >= takeProfit : low <= takeProfit;

  if (stopTouched) {
    return { ok: true, shouldClose: true, exitReason: "STOP_LOSS", exitReferencePrice: stopLoss, stopTouched, targetTouched };
  }
  if (targetTouched) {
    return { ok: true, shouldClose: true, exitReason: "TAKE_PROFIT", exitReferencePrice: takeProfit, stopTouched, targetTouched };
  }
  return { ok: true, shouldClose: false, exitReason: null, exitReferencePrice: null, stopTouched, targetTouched };
}

function getUnprocessedPositionCandles(candles, lastProcessedCandleTime) {
  const lastProcessed = Date.parse(lastProcessedCandleTime);
  if (!Number.isFinite(lastProcessed)) {
    return { ok: false, error: "Некорректное время последней обработанной свечи" };
  }
  if (!Array.isArray(candles)) {
    return { ok: false, error: "Некорректный список свечей" };
  }
  return {
    ok: true,
    candles: candles.filter(candle => {
      const candleTime = Date.parse(candle?.time);
      return Number.isFinite(candleTime) && candleTime > lastProcessed;
    })
  };
}

function calculatePaperCloseAccounting({ position, exitReferencePrice, fundingPnl = 0 }) {
  if (!position || !["OPEN_LONG", "OPEN_SHORT"].includes(position.action)) {
    throw new Error("Некорректное направление виртуальной позиции");
  }

  const direction = position.action === "OPEN_LONG" ? 1 : -1;
  const contracts = Number(position.contracts);
  const contractValue = Number(position.contractValue);
  const feeRate = Number(position.feeRate ?? PAPER_CONFIG.feeRate);
  const slippageRate = Number(position.slippageRate ?? PAPER_CONFIG.slippageRate);
  const referenceEntryPrice = Number(position.referenceEntryPrice ?? position.entryPrice);
  const entryExecutionPrice = Number(position.entryPrice);
  const exitReference = Number(exitReferencePrice);
  const funding = Number(fundingPnl);
  const exitExecutionPrice = getExecutionPrices(exitReference, position.action, false, slippageRate);

  if (
    ![contracts, contractValue, feeRate, slippageRate, referenceEntryPrice, entryExecutionPrice, exitReference, funding, exitExecutionPrice].every(Number.isFinite) ||
    contracts <= 0 || contractValue <= 0 || feeRate < 0 || slippageRate < 0 ||
    referenceEntryPrice <= 0 || entryExecutionPrice <= 0 || exitReference <= 0 || exitExecutionPrice <= 0
  ) {
    throw new Error("Некорректные параметры расчёта результата виртуальной позиции");
  }

  const grossPnl = (exitReference - referenceEntryPrice) * contracts * contractValue * direction;
  const entrySlippageCost = Number(position.entrySlippageCost ?? Math.abs(entryExecutionPrice - referenceEntryPrice) * contracts * contractValue);
  const exitSlippageCost = Math.abs(exitExecutionPrice - exitReference) * contracts * contractValue;
  const entryFee = Number(position.entryFee ?? entryExecutionPrice * contracts * contractValue * feeRate);
  const exitFee = exitExecutionPrice * contracts * contractValue * feeRate;

  if (![entrySlippageCost, exitSlippageCost, entryFee, exitFee].every(Number.isFinite) ||
      entrySlippageCost < 0 || exitSlippageCost < 0 || entryFee < 0 || exitFee < 0) {
    throw new Error("Некорректные комиссии или расходы на проскальзывание");
  }

  const totalFees = entryFee + exitFee;
  const totalSlippage = entrySlippageCost + exitSlippageCost;
  const totalCosts = totalFees + totalSlippage - funding;
  const netPnl = grossPnl - totalFees - totalSlippage + funding;

  if (![grossPnl, totalFees, totalSlippage, totalCosts, netPnl].every(Number.isFinite)) {
    throw new Error("Не удалось рассчитать чистый результат позиции");
  }

  return {
    grossPnl, netPnl, totalFees, totalSlippage, fundingPnl: funding,
    totalCosts, exitExecutionPrice, entryFee, exitFee,
    entrySlippageCost, exitSlippageCost
  };
}

function applyPaperCloseAccounting(position, exitReferencePrice, exitReason, candleTime, accounting, fundingEvents = []) {
  if (!position || !accounting || !["STOP_LOSS", "TAKE_PROFIT"].includes(exitReason)) {
    throw new Error("Некорректные данные для фиксации закрытия виртуальной позиции");
  }
  const closedAtMs = Date.parse(candleTime) + 300000;
  if (!Number.isFinite(closedAtMs) || !Number.isFinite(accounting.netPnl)) {
    throw new Error("Некорректное время закрытия или финансовый результат");
  }

  position.status = "CLOSED";
  position.referenceExitPrice = exitReferencePrice;
  position.exitPrice = accounting.exitExecutionPrice;
  position.grossPnl = accounting.grossPnl;
  position.entryFee = accounting.entryFee;
  position.exitFee = accounting.exitFee;
  position.totalFees = accounting.totalFees;
  position.entrySlippageCost = accounting.entrySlippageCost;
  position.exitSlippageCost = accounting.exitSlippageCost;
  position.totalSlippageCost = accounting.totalSlippage;
  position.fundingPnl = accounting.fundingPnl;
  position.fundingEvents = fundingEvents;
  position.totalCosts = accounting.totalCosts;
  position.netPnl = accounting.netPnl;
  position.pnlAccounting = "NET_AFTER_FEES_SLIPPAGE_FUNDING";
  position.costsIncluded = true;
  position.exitReason = exitReason;
  position.exitCandleTime = candleTime;
  position.closedAt = new Date(closedAtMs).toISOString();
  return accounting;
}

async function closePaperPosition(position, exitReferencePrice, exitReason, candleTime, instrument) {
  const direction = position.action === "OPEN_LONG" ? 1 : -1;
  const contracts = Number(position.contracts);
  const contractValue = Number(position.contractValue || instrument.contractValue);
  const openedAt = position.openedAt;
  const closedAt = new Date(Date.parse(candleTime) + 300000).toISOString();

  const funding = await getFundingPayments(
    position.symbol,
    openedAt,
    closedAt,
    contracts,
    contractValue,
    direction
  );
  const accounting = calculatePaperCloseAccounting({
    position: { ...position, contractValue },
    exitReferencePrice,
    fundingPnl: funding.fundingPnl
  });

  return applyPaperCloseAccounting(
    position, exitReferencePrice, exitReason, candleTime, accounting, funding.events
  );
}

function alignPriceToTick(price, tickSize, mode = "nearest") {
  const tick = Number(tickSize);

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(tick) ||
    tick <= 0
  ) {
    throw new Error("Некорректная цена или шаг цены инструмента");
  }

  const units = price / tick;
  let alignedUnits;

  if (mode === "floor") {
    alignedUnits = Math.floor(units + 1e-10);
  } else if (mode === "ceil") {
    alignedUnits = Math.ceil(units - 1e-10);
  } else {
    alignedUnits = Math.round(units);
  }

  const decimals = Math.min(
    12,
    (String(tick).split(".")[1] || "").length
  );

  return Number((alignedUnits * tick).toFixed(decimals));
}

function calculateExistingPositionRisk(position, instrument, feeRate, slippageRate) {
  const contracts = Number(position.contracts);
  const contractValue = Number(instrument?.contractValue ?? position.contractValue);
  const referenceEntryPrice = Number(position.referenceEntryPrice ?? position.entryPrice);
  const entryExecutionPrice = Number(position.entryPrice);
  const stopLoss = Number(position.stopLoss);
  const action = position.action;
  const stopExecutionPrice = getExecutionPrices(stopLoss, action, false, slippageRate);
  if (![contracts, contractValue, referenceEntryPrice, entryExecutionPrice, stopLoss, stopExecutionPrice].every(Number.isFinite) ||
      contracts <= 0 || contractValue <= 0 || referenceEntryPrice <= 0 || entryExecutionPrice <= 0 || stopLoss <= 0 ||
      !["OPEN_LONG", "OPEN_SHORT"].includes(action)) {
    return { ok: false, error: "Нельзя безопасно пересчитать риск существующей позиции" };
  }
  const riskPerContract =
    Math.abs(referenceEntryPrice - stopLoss) * contractValue +
    Math.abs(entryExecutionPrice - referenceEntryPrice) * contractValue +
    Math.abs(stopExecutionPrice - stopLoss) * contractValue +
    (entryExecutionPrice + stopExecutionPrice) * contractValue * feeRate;
  const actualRisk = contracts * riskPerContract;
  if (!Number.isFinite(actualRisk) || actualRisk <= 0) {
    return { ok: false, error: "Некорректный пересчитанный риск существующей позиции" };
  }
  return { ok: true, actualRisk };
}

function calculatePaperPositionSize(
  entry,
  stopLoss,
  instrument,
  riskBudget,
  leverage,
  action,
  feeRate = PAPER_CONFIG.feeRate,
  slippageRate = PAPER_CONFIG.slippageRate
) {
  const contractValue = Number(instrument.contractValue);
  const lotSize = Number(instrument.lotSize);
  const minSize = Number(instrument.minSize);
  const priceRisk = Math.abs(entry - stopLoss);
  const direction = action === "OPEN_LONG" ? 1 : action === "OPEN_SHORT" ? -1 : 0;
  const entryExecutionPrice = getExecutionPrices(entry, action, true, slippageRate);
  const stopExecutionPrice = getExecutionPrices(stopLoss, action, false, slippageRate);
  const grossStopRiskPerContract = priceRisk * contractValue;
  const entrySlippagePerContract = Math.abs(entryExecutionPrice - entry) * contractValue;
  const stopSlippagePerContract = Math.abs(stopExecutionPrice - stopLoss) * contractValue;
  const entryFeePerContract = entryExecutionPrice * contractValue * feeRate;
  const stopFeePerContract = stopExecutionPrice * contractValue * feeRate;
  const riskPerContract = grossStopRiskPerContract + entrySlippagePerContract + stopSlippagePerContract + entryFeePerContract + stopFeePerContract;

  if (
    !Number.isFinite(entry) || !Number.isFinite(stopLoss) || entry <= 0 || stopLoss <= 0 || priceRisk <= 0 ||
    !Number.isFinite(contractValue) || contractValue <= 0 ||
    !Number.isFinite(lotSize) || lotSize <= 0 || !Number.isFinite(minSize) || minSize <= 0 ||
    !Number.isFinite(riskBudget) || riskBudget <= 0 || !Number.isFinite(leverage) || leverage <= 0 ||
    !Number.isFinite(feeRate) || feeRate < 0 || !Number.isFinite(slippageRate) || slippageRate < 0 ||
    direction === 0 || instrument.state !== "live" || instrument.contractType !== "linear" ||
    !Number.isFinite(riskPerContract) || riskPerContract <= 0
  ) {
    return { ok: false, error: "Некорректные параметры расчёта позиции" };
  }

  const rawContracts = riskBudget / riskPerContract;
  const contracts = Math.floor((rawContracts + 1e-10) / lotSize) * lotSize;
  if (contracts < minSize) {
    return { ok: false, error: "Минимальный размер контракта превышает допустимый риск с учётом расходов" };
  }

  const actualRisk = contracts * riskPerContract;
  const notional = contracts * contractValue * entryExecutionPrice;
  const requiredMargin = notional / leverage;

  return {
    ok: true,
    contracts,
    riskPerContract,
    grossStopRisk: contracts * grossStopRiskPerContract,
    entryExecutionPrice,
    entryFee: contracts * entryFeePerContract,
    entrySlippageCost: contracts * entrySlippagePerContract,
    estimatedExitFeeAtStop: contracts * stopFeePerContract,
    estimatedExitSlippageAtStop: contracts * stopSlippagePerContract,
    estimatedTradingCostsAtStop: contracts * (entrySlippagePerContract + stopSlippagePerContract + entryFeePerContract + stopFeePerContract),
    actualRisk,
    notional,
    requiredMargin,
    riskBudget
  };
}

// Чистая проверка допуска к виртуальному входу: не читает/пишет KV,
// не обращается к рынку и не создаёт позиции.
function evaluatePaperRiskAdmission({
  symbol, action, activePositions, correlationSnapshot, config,
  instrument, entry, stopLoss, balance
}) {
  if (!Array.isArray(activePositions) || !config || !Number.isFinite(balance) || balance < 0) {
    return { ok: false, error: "Некорректные входные данные риск-менеджера" };
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

  const currentRisk = activePositions.reduce((sum, position) => sum + Number(position.actualRisk || 0), 0);
  const symbolRisk = symbolPositions.reduce((sum, position) => sum + Number(position.actualRisk || 0), 0);
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

  if (correlationRisk.correlatedRisk + size.actualRisk > config.maxCorrelatedRisk + 1e-8) {
    return {
      ok: false,
      error: `Превышен лимит коррелирующего риска ${config.maxCorrelatedRisk} USDT; связанные позиции: ${correlationRisk.correlatedSymbols.map(item => item.symbol).join(", ")}`
    };
  }
  if (
    symbolRisk + size.actualRisk > config.maxRiskPerSymbol + 1e-8 ||
    currentRisk + size.actualRisk > config.maxTotalRisk + 1e-8
  ) {
    return { ok: false, error: "Расчётный риск превышает установленный лимит" };
  }

  const usedMargin = activePositions.reduce(
    (sum, position) => sum + Number(position.requiredMargin || 0), 0
  );
  if (usedMargin + size.requiredMargin > balance) {
    return { ok: false, error: "Недостаточно виртуальной маржи" };
  }

  return {
    ok: true, size, riskBudget, currentRisk, symbolRisk,
    correlatedRisk: correlationRisk.correlatedRisk,
    requiredMarginAfterEntry: usedMargin + size.requiredMargin
  };
}

function getSignalExpiryConfig(signal) {
  const raw = signal?.expiresAfterCandles;
  const value = raw === undefined || raw === null ? 3 : Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > 12) {
    return {
      ok: false,
      error: "expiresAfterCandles должен быть целым числом от 1 до 12"
    };
  }

  return { ok: true, value };
}

function evaluatePendingSignalExpiry(signal, now = Date.now()) {
  const eligibleTime = Date.parse(getEligibleAfterCandleTime(signal));
  const expiry = getSignalExpiryConfig(signal);

  if (!Number.isFinite(eligibleTime)) {
    return { ok: false, expired: false, error: "Некорректное время начала окна сигнала" };
  }

  if (!expiry.ok) {
    return { ok: false, expired: false, error: expiry.error };
  }

  if (!Number.isFinite(now)) {
    return { ok: false, expired: false, error: "Некорректное текущее время" };
  }

  const windowEndsAt = eligibleTime + expiry.value * 300000;

  return {
    ok: true,
    expired: now > windowEndsAt,
    eligibleTime,
    expiresAfterCandles: expiry.value,
    windowEndsAt,
    expiredAt: new Date(windowEndsAt).toISOString()
  };
}

function getPendingSignalStatusCounts(signals) {
  const counts = {
    total: 0,
    pending: 0,
    open: 0,
    closed: 0,
    expired: 0,
    rejected: 0,
    other: 0
  };

  for (const signal of Array.isArray(signals) ? signals : []) {
    counts.total += 1;
    const status = String(signal?.status || "").toUpperCase();

    if (status === "PENDING") counts.pending += 1;
    else if (status === "OPEN") counts.open += 1;
    else if (status === "CLOSED") counts.closed += 1;
    else if (status === "EXPIRED") counts.expired += 1;
    else if (status === "REJECTED") counts.rejected += 1;
    else counts.other += 1;
  }

  return counts;
}

async function processPendingSignals(env, lock) {
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

  if (
    state.mode !== "DEMO ONLY" ||
    state.executionEnabled !== false
  ) {
    throw new Error("Обработка разрешена только в DEMO ONLY");
  }

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

  const pending = state.pendingSignals.filter(
    signal => signal.status === "PENDING"
  );

  const symbols = [...new Set(pending.map(signal => signal.symbol))];
  const results = [];

  for (const symbol of symbols) {
    if (!SYMBOLS.includes(symbol)) {
      results.push({
        symbol,
        ok: false,
        error: "Инструмент отсутствует в разрешённом списке"
      });
      continue;
    }

    const market = await getCandles(symbol);

    if (!market.ok) {
      results.push({
        symbol,
        ok: false,
        error: market.error
      });
      continue;
    }

    const instrument = instruments.find(item => item.symbol === symbol);

    if (!instrument) {
      results.push({
        symbol,
        ok: false,
        error: "Спецификация контракта не найдена"
      });
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
        signal.rejectReason = !expiryCheck.ok
          ? expiryCheck.error
          : "Некорректное время последней обработанной свечи";
        results.push({
          symbol,
          signalId: signal.id,
          status: "REJECTED",
          reason: signal.rejectReason
        });
        continue;
      }

      const eligibleTime = expiryCheck.eligibleTime;

      // Fail closed: не открываем сделку задним числом после окончания окна.
      if (expiryCheck.expired) {
        signal.status = "EXPIRED";
        signal.expiredAt = expiryCheck.expiredAt;
        signal.rejectReason =
          "Окно входа пропущено: сигнал не был обработан вовремя";
        results.push({
          symbol,
          signalId: signal.id,
          status: "EXPIRED",
          reason: signal.rejectReason
        });
        continue;
      }

      const candles = market.candles.filter(candle => {
        const candleTime = Date.parse(candle.time);
        const candleCloseTime = candleTime + 300000;

        return (
          candleTime >= eligibleTime &&
          candleTime > lastProcessed &&
          candleCloseTime <= now
        );
      });

      let opened = false;

      for (const candle of candles) {
        signal.eligibleCandlesProcessed =
          (signal.eligibleCandlesProcessed || 0) + 1;

        signal.lastProcessedCandleTime = candle.time;

        const entryTouched =
          candle.low <= signal.entry &&
          candle.high >= signal.entry;

        if (entryTouched) {
          const activePositions = state.openPositions.filter(
            position => position.status === "OPEN"
          );
          const admission = evaluatePaperRiskAdmission({
            symbol,
            action: signal.action,
            activePositions,
            correlationSnapshot: state.latestCorrelation,
            config: {
              maxOpenPositions,
              maxPositionsPerSymbol,
              riskPerTrade,
              maxRiskPerSymbol,
              maxTotalRisk,
              maxCorrelatedRisk,
              correlationThreshold,
              leverage,
              feeRate,
              slippageRate
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
            openedAt: new Date(
              Date.parse(candle.time) + 300000
            ).toISOString(),
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
            const exitPrice = stopTouched
              ? signal.stopLoss
              : signal.takeProfit;

            try {
              const closeResult = await closePaperPosition(
                position,
                exitPrice,
                stopTouched ? "STOP_LOSS" : "TAKE_PROFIT",
                candle.time,
                instrument
              );
              state.balance += closeResult.netPnl;
              state.closedPositions.push(position);
              signal.status = "CLOSED";
            } catch (error) {
              signal.status = "REJECTED";
              signal.rejectReason = "Не удалось безопасно учесть расходы при немедленном закрытии: " + String(error);
              break;
            }
          } else {
            state.openPositions.push(position);
            signal.status = "OPEN";
          }

          signal.positionId = position.id;
          signal.openedAt = position.openedAt;
          opened = true;

          results.push({
            symbol,
            signalId: signal.id,
            status: signal.status,
            position
          });

          break;
        }

        if (
          signal.eligibleCandlesProcessed >=
          getSignalExpiryConfig(signal).value
        ) {
          signal.status = "EXPIRED";
          signal.expiredAt = new Date(
            Date.parse(candle.time) + 300000
          ).toISOString();
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

  return {
    ok: true,
    mode: "DEMO ONLY",
    executionEnabled: false,
    processed: results
  };
}

async function processOpenPositions(env, lock) {
  if (!env.TRADER_KV) {
    throw new Error("TRADER_KV не подключён");
  }

  const rawState = await env.TRADER_KV.get("paper:state");

  if (!rawState) {
    throw new Error("Не найдено состояние виртуального счёта");
  }

  const state = JSON.parse(rawState);

  if (
    state.mode !== "DEMO ONLY" ||
    state.executionEnabled !== false
  ) {
    throw new Error("Мониторинг разрешён только в DEMO ONLY");
  }

  if (
    !Array.isArray(state.openPositions) ||
    !Array.isArray(state.closedPositions)
  ) {
    throw new Error("Структура позиций повреждена; обработка остановлена без изменения истории");
  }

  const activePositions = state.openPositions.filter(
    position => position.status === "OPEN"
  );

  const symbols = [
    ...new Set(activePositions.map(position => position.symbol))
  ];

  const results = [];

  for (const symbol of symbols) {
    const market = await getCandles(symbol);

    if (!market.ok) {
      results.push({
        symbol,
        ok: false,
        error: market.error
      });
      continue;
    }

    const positions = activePositions.filter(
      position => position.symbol === symbol
    );

    for (const position of positions) {
      const candleWindow = getUnprocessedPositionCandles(
        market.candles,
        position.lastProcessedCandleTime || position.entryCandleTime
      );

      if (!candleWindow.ok) {
        results.push({
          symbol,
          positionId: position.id,
          ok: false,
          error: candleWindow.error
        });
        continue;
      }

      const candles = candleWindow.candles;

      let closed = false;

      for (const candle of candles) {
        const exitDecision = evaluatePositionExit(position, candle);

        if (!exitDecision.ok) {
          results.push({
            symbol,
            positionId: position.id,
            ok: false,
            error: exitDecision.error
          });
          break;
        }

        if (exitDecision.shouldClose) {
          const exitPrice = exitDecision.exitReferencePrice;

          try {
            const closeResult = await closePaperPosition(
              position,
              exitPrice,
              exitDecision.exitReason,
              candle.time,
              { contractValue: position.contractValue }
            );

            state.balance += closeResult.netPnl;
            if (!state.closedPositions.some(item => item.id === position.id)) {
              state.closedPositions.push(position);
            }
            state.openPositions = state.openPositions.filter(item => item.id !== position.id);
            closed = true;

            results.push({
              symbol,
              positionId: position.id,
              status: "CLOSED",
              exitReason: position.exitReason,
              exitPrice: position.exitPrice,
              grossPnl: closeResult.grossPnl,
              netPnl: closeResult.netPnl,
              totalFees: closeResult.totalFees,
              totalSlippage: closeResult.totalSlippage,
              fundingPnl: closeResult.fundingPnl,
              totalCosts: closeResult.totalCosts,
              balance: state.balance
            });
          } catch (error) {
            results.push({
              symbol,
              positionId: position.id,
              status: "OPEN",
              ok: false,
              error: "Закрытие отложено: не удалось подтвердить все расходы: " + String(error)
            });
            break;
          }

          break;
        } else {
          position.lastProcessedCandleTime = candle.time;
        }
      }

      if (!closed && position.status === "OPEN") {
        results.push({
          symbol,
          positionId: position.id,
          status: "OPEN",
          lastProcessedCandleTime:
            position.lastProcessedCandleTime
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
}
function getEligibleAfterCandleTime(signal) {
  if (signal.eligibleAfterCandleTime) {
    return signal.eligibleAfterCandleTime;
  }

  const signalTime = Date.parse(signal.signalTime);

  if (!Number.isFinite(signalTime)) {
    throw new Error("Некорректное время сигнала");
  }

  return new Date(
  Math.floor(signalTime / 300000) * 300000 + 300000
).toISOString();
}

async function createPendingSignals(env, analysisRecord, lock) {
  if (!env.TRADER_KV) {
    throw new Error("Не найдено KV-хранилище TRADER_KV");
  }

  if (!analysisRecord || !analysisRecord.id) {
    throw new Error("Нет данных анализа или analysisId");
  }

  if (analysisRecord.validation !== true) {
    return {
      ok: false,
      created: 0,
      reason: "Анализ не прошёл проверку"
    };
  }

  const signalTime = analysisRecord.timestamp;
  const signalTimestamp = Date.parse(signalTime);

  if (!Number.isFinite(signalTimestamp)) {
    throw new Error("В анализе отсутствует корректное время");
  }

  const [stateRaw, instrumentsRaw] = await Promise.all([
    env.TRADER_KV.get("paper:state"),
    env.TRADER_KV.get("paper:instruments")
  ]);

  if (!stateRaw || !instrumentsRaw) {
    throw new Error("Не найдены состояние счёта или спецификации контрактов");
  }

  const state = JSON.parse(stateRaw);
  const instruments = JSON.parse(instrumentsRaw);

  if (
    state.mode !== "DEMO ONLY" ||
    state.executionEnabled !== false
  ) {
    throw new Error("Добавление сигналов разрешено только в DEMO ONLY");
  }

  if (
    !Array.isArray(state.pendingSignals) ||
    !Array.isArray(state.openPositions) ||
    !Array.isArray(state.closedPositions)
  ) {
    throw new Error("Структура виртуального счёта повреждена; новые сигналы не добавлены");
  }

  const decisions = analysisRecord.decisions;
  const marketData = analysisRecord.marketData;

  if (!Array.isArray(decisions) || !Array.isArray(marketData)) {
    throw new Error("Отсутствуют decisions или marketData");
  }

  const correlationSnapshot = calculateCorrelationMatrix(marketData);
  correlationSnapshot.calculatedAt = analysisRecord.timestamp;
  state.latestCorrelation = correlationSnapshot;

  const createdSignals = [];
  const skipped = [];

  for (const decision of decisions) {
    if (
      decision.action !== "OPEN_LONG" &&
      decision.action !== "OPEN_SHORT"
    ) {
      continue;
    }

    const symbol = decision.symbol;

    if (!SYMBOLS.includes(symbol)) {
      continue;
    }

    const instrument = instruments.find(item => item.symbol === symbol);
    const market = marketData.find(item => item.symbol === symbol);

    if (
      !instrument ||
      instrument.state !== "live" ||
      instrument.contractType !== "linear" ||
      !market ||
      !market.lastCandleTime ||
      !Number.isFinite(Date.parse(market.lastCandleTime))
    ) {
      skipped.push({
        symbol,
        reason: "Нет корректных рыночных данных или спецификации контракта"
      });
      continue;
    }

    const activePositions = state.openPositions.filter(
      position => position.status === "OPEN" && position.symbol === symbol
    );

    if (activePositions.length >= Number(state.maxPositionsPerSymbol || 2)) {
      skipped.push({
        symbol,
        reason: "Уже достигнут лимит открытых позиций по инструменту"
      });
      continue;
    }

    if (activePositions.some(position => position.action !== decision.action)) {
      skipped.push({
        symbol,
        reason: "Противоположная позиция по инструменту уже открыта"
      });
      continue;
    }

    const pendingForSymbol = state.pendingSignals.some(
      signal => signal.status === "PENDING" && signal.symbol === symbol
    );

    if (pendingForSymbol) {
      skipped.push({
        symbol,
        reason: "По инструменту уже ожидает подтверждения другой сигнал"
      });
      continue;
    }

    const entryRaw = Number(decision.entry);
    const stopLossRaw = Number(decision.stopLoss);
    const takeProfitRaw = Number(decision.takeProfit);

    if (
      !Number.isFinite(entryRaw) ||
      !Number.isFinite(stopLossRaw) ||
      !Number.isFinite(takeProfitRaw) ||
      entryRaw <= 0 ||
      stopLossRaw <= 0 ||
      takeProfitRaw <= 0
    ) {
      skipped.push({
        symbol,
        reason: "Некорректные цены сигнала"
      });
      continue;
    }

    const isLong = decision.action === "OPEN_LONG";
    const entry = alignPriceToTick(
      entryRaw,
      instrument.tickSize,
      "nearest"
    );
    const stopLoss = alignPriceToTick(
      stopLossRaw,
      instrument.tickSize,
      isLong ? "floor" : "ceil"
    );
    const takeProfit = alignPriceToTick(
      takeProfitRaw,
      instrument.tickSize,
      isLong ? "ceil" : "floor"
    );

    if (
      (isLong && !(stopLoss < entry && takeProfit > entry)) ||
      (!isLong && !(stopLoss > entry && takeProfit < entry))
    ) {
      skipped.push({
        symbol,
        reason: "После приведения к шагу цены нарушилось расположение Entry/SL/TP"
      });
      continue;
    }

    const signalId = analysisRecord.id + ":" + symbol;

    const alreadyExists =
      state.pendingSignals.some(signal => signal.id === signalId) ||
      state.openPositions.some(position => position.signalId === signalId) ||
      state.closedPositions.some(position => position.signalId === signalId);

    if (alreadyExists) {
      skipped.push({
        symbol,
        reason: "Этот анализ уже создавал сигнал по инструменту"
      });
      continue;
    }

    const eligibleAfterCandleTime = new Date(
      Math.floor(signalTimestamp / 300000) * 300000 + 300000
    ).toISOString();

    const signal = {
      id: signalId,
      analysisId: analysisRecord.id,
      symbol,
      action: decision.action,
      entry,
      stopLoss,
      takeProfit,
      confidence: decision.confidence,
      reason: decision.reason,
      status: "PENDING",
      signalTime,
      signalCandleTime: market.lastCandleTime,
      eligibleAfterCandleTime,
      eligibleCandlesProcessed: 0,
      expiresAfterCandles: 3,
      lastProcessedCandleTime: null,
      createdAt: new Date().toISOString()
    };

    state.pendingSignals.push(signal);
    createdSignals.push(signal);
  }

  state.lastUpdatedAt = new Date().toISOString();

  await lock.put("paper:state", JSON.stringify(state));

  const pendingSignalCounts = getPendingSignalStatusCounts(state.pendingSignals);

  return {
    ok: true,
    created: createdSignals.length,
    pendingTotal: pendingSignalCounts.pending,
    pendingHistoryTotal: pendingSignalCounts.total,
    pendingSignalCounts,
    signals: createdSignals,
    skipped
  };
}


async function runAutonomousCycle(env, scheduledTime) {
  if (!env.TRADER_KV || !env.AI || !env.PAPER_LOCK) {
    throw new Error("Для автономного цикла обязательны TRADER_KV, AI и PAPER_LOCK");
  }

  return withPaperLock(env, async (lock) => {
    const initialRaw = await env.TRADER_KV.get("paper:state");
    if (!initialRaw) throw new Error("Виртуальный счёт не инициализирован; сначала выполните /paper-init");
    const initialState = JSON.parse(initialRaw);
    if (
      initialState.mode !== "DEMO ONLY" ||
      initialState.executionEnabled !== false ||
      initialState.configVersion !== 3 ||
      initialState.accountingMode !== "NET_PNL_FEES_SLIPPAGE_AND_REALIZED_FUNDING"
    ) {
      throw new Error("Автономный цикл разрешён только для мигрированного DEMO ONLY счёта; реальные сделки заблокированы");
    }

    // Сначала сопровождаем уже открытые виртуальные позиции.
    const positionResult = await processOpenPositions(env, lock);

    // Новые входы разрешаются только при свежих данных всех шести рынков.
    const marketData = await collectMarketData();
    const failedMarkets = marketData.filter(item => item.error);
    if (failedMarkets.length) {
      throw new Error("Автономный цикл остановлен: нет полных рыночных данных по всем инструментам: " +
        failedMarkets.map(item => item.symbol).join(", "));
    }

    const correlationSnapshot = calculateCorrelationMatrix(marketData);
    correlationSnapshot.calculatedAt = new Date().toISOString();
    const stateAfterMarket = JSON.parse(await env.TRADER_KV.get("paper:state"));
    stateAfterMarket.latestCorrelation = correlationSnapshot;
    await lock.put("paper:state", JSON.stringify(stateAfterMarket));

    // Сначала обрабатываем ранее подтверждённые сигналы с актуальной корреляцией.
    const pendingProcessResult = await processPendingSignals(env, lock);

    const promptMarketData = marketData.map(({ closeSeries, ...item }) => item);
    const prompt = `
Ты — автономный аналитический модуль торгового бота OKX.
Режим DEMO ONLY. Анализируй ровно шесть USDT perpetual SWAP на таймфрейме 5m.
Самостоятельно выбирай OPEN_LONG, OPEN_SHORT или HOLD. Допустимо 0–6 сделок.
Используй только фактические значения ниже. Не придумывай цены или индикаторы.
Учитывай тренд, импульс, объём, RSI, EMA, MACD и ATR совместно.
При противоречивых или недостаточных данных выбирай HOLD.
LONG: SL ниже Entry, TP выше Entry. SHORT: SL выше Entry, TP ниже Entry.
Entry должен быть близок к текущей цене. Reward/Risk не меньше 1.5.
Для HOLD все цены должны быть null.
Верни ровно по одному решению для каждого символа, confidence integer 0..100,
reason краткий и подтверждённый данными. Верни только JSON без Markdown.
Формат: {"decisions":[{"symbol":"BTC-USDT-SWAP","action":"HOLD","entry":null,"stopLoss":null,"takeProfit":null,"confidence":0,"reason":"Недостаточно подтверждений"}]}

РЫНОЧНЫЕ ДАННЫЕ:
${JSON.stringify(promptMarketData, null, 2)}
`;

    const aiResult = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: "Ты автономный аналитический модуль. Возвращай только корректный JSON. Не исполняй реальные сделки." },
        { role: "user", content: prompt }
      ],
      chat_template_kwargs: { enable_thinking: false }
    });

    let aiText = typeof aiResult?.response === "string"
      ? aiResult.response
      : typeof aiResult?.output === "string"
        ? aiResult.output
        : JSON.stringify(aiResult);

    let parsed = null;
    let validation = { valid: false, errors: [], warnings: [] };
    try {
      parsed = extractAIJson(aiText);
      validation = validateDecisions(parsed, marketData);
    } catch (error) {
      validation = { valid: false, errors: [String(error)], warnings: [] };
    }

    const analysisId = crypto.randomUUID();
    const analysisRecord = {
      id: analysisId,
      timestamp: new Date().toISOString(),
      scheduledTime: new Date(scheduledTime).toISOString(),
      mode: "DEMO ONLY",
      executionEnabled: false,
      model: MODEL,
      validation: validation.valid,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings || [],
      marketData,
      decisions: parsed?.decisions || [],
      rawAIResponse: validation.valid ? undefined : aiText
    };

    await env.TRADER_KV.put("paper:analysis:" + analysisId, JSON.stringify(analysisRecord));

    let pendingResult = { ok: false, created: 0, reason: "Анализ не прошёл проверку" };
    if (validation.valid) {
      pendingResult = await createPendingSignals(env, analysisRecord, lock);
    }

    const finalRaw = await env.TRADER_KV.get("paper:state");
    const finalState = JSON.parse(finalRaw);
    finalState.lastAutonomousCycle = {
      scheduledAt: new Date(scheduledTime).toISOString(),
      completedAt: new Date().toISOString(),
      analysisId,
      validation: validation.valid,
      pendingCreated: pendingResult.created || 0,
      mode: "DEMO ONLY",
      executionEnabled: false
    };
    await lock.put("paper:state", JSON.stringify(finalState));

    return {
      ok: true,
      mode: "DEMO ONLY",
      executionEnabled: false,
      analysisId,
      validation,
      pendingSignalsCreated: pendingResult.created || 0,
      pendingProcessResult,
      positionResult
    };
  });
}

export default {
  async scheduled(controller, env) {
    // Cron may exist in wrangler config, but it must remain inert until the
    // operator explicitly enables this environment variable in Cloudflare.
    if (env.PAPER_AUTONOMOUS_ENABLED !== "true") {
      console.log("OKX Smart Trader scheduled cycle disabled by PAPER_AUTONOMOUS_ENABLED");
      return;
    }
    try {
      if (!env.TRADER_KV) throw new Error("TRADER_KV не подключён");
      const stateRaw = await env.TRADER_KV.get("paper:state");
      if (!stateRaw) throw new Error("Виртуальный счёт не инициализирован");
      const state = JSON.parse(stateRaw);
      if (
        state.mode !== "DEMO ONLY" ||
        state.executionEnabled !== false ||
        state.configVersion !== 3 ||
        state.accountingMode !== "NET_PNL_FEES_SLIPPAGE_AND_REALIZED_FUNDING"
      ) {
        throw new Error("Автономный цикл заблокирован: DEMO-счёт не прошёл миграцию configVersion 3");
      }
      const result = await runAutonomousCycle(env, controller.scheduledTime);
      console.log("OKX Smart Trader autonomous cycle", JSON.stringify(result));
    } catch (error) {
      const message = String(error);
      if (message.includes("уже обрабатывается другим запросом")) {
        console.warn("OKX Smart Trader cycle skipped: another cycle holds the lock");
        return;
      }
      console.error("OKX Smart Trader autonomous cycle failed", message);
      throw error;
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);


    if (url.pathname === "/paper-config-update") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Разрешён только POST" }, 405);
      }

      if (!env.BOT_CONTROL_TOKEN) {
        return json({ ok: false, error: "BOT_CONTROL_TOKEN не настроен" }, 500);
      }

      if (
        request.headers.get("Authorization") !==
        `Bearer ${env.BOT_CONTROL_TOKEN}`
      ) {
        return json({ ok: false, error: "Доступ запрещён" }, 401);
      }

      try {
        const result = await withPaperLock(env, async (lock) => {
          const rawState = await env.TRADER_KV.get("paper:state");

          if (!rawState) {
            throw new Error("Сначала необходимо выполнить /paper-init");
          }

          const state = JSON.parse(rawState);

          if (
            state.mode !== "DEMO ONLY" ||
            state.executionEnabled !== false
          ) {
            throw new Error("Миграция разрешена только в DEMO ONLY");
          }

          // До любых изменений проверяем структуру и фиксируем контрольные значения.
          if (
            !Array.isArray(state.pendingSignals) ||
            !Array.isArray(state.openPositions) ||
            !Array.isArray(state.closedPositions)
          ) {
            throw new Error("Структура истории счёта повреждена. Миграция отменена без записи в KV.");
          }

          const originalBalance = Number(state.balance);
          const originalInitialCapital = Number(state.initialCapital);
          if (!Number.isFinite(originalBalance) || originalBalance < 0) {
            throw new Error("Текущий баланс виртуального счёта некорректен");
          }
          if (!Number.isFinite(originalInitialCapital) || originalInitialCapital <= 0) {
            throw new Error("Исходный капитал виртуального счёта некорректен");
          }

          const originalPendingJson = JSON.stringify(state.pendingSignals);
          const originalClosedJson = JSON.stringify(state.closedPositions);
          const originalPendingCount = state.pendingSignals.length;
          const originalOpenCount = state.openPositions.length;
          const originalClosedCount = state.closedPositions.length;
          const originalOpenIds = state.openPositions.map(position => position?.id ?? null);

          const openPositions = state.openPositions.filter(
            position => position && position.status === "OPEN"
          );
          const openPositionIds = openPositions.map(position => position.id);
          if (
            openPositions.some(position => !SYMBOLS.includes(position.symbol)) ||
            openPositionIds.some(id => typeof id !== "string" || !id) ||
            new Set(openPositionIds).size !== openPositionIds.length
          ) {
            throw new Error("В открытых позициях обнаружены неизвестные инструменты или повторяющиеся ID. Миграция отменена.");
          }
          const instrumentsRaw = await env.TRADER_KV.get("paper:instruments");
          if (!instrumentsRaw) throw new Error("Не найдены спецификации контрактов для миграции риска");
          const migrationInstruments = JSON.parse(instrumentsRaw);
          if (!Array.isArray(migrationInstruments)) {
            throw new Error("Некорректный список спецификаций контрактов");
          }

          for (const position of openPositions) {
            const instrument = migrationInstruments.find(item => item.symbol === position.symbol);
            if (!instrument || instrument.state !== "live" || instrument.contractType !== "linear") {
              throw new Error(`Не найдена действующая линейная спецификация ${position.symbol} для пересчёта риска`);
            }
            const recalculated = calculateExistingPositionRisk(
              position,
              instrument,
              PAPER_CONFIG.feeRate,
              PAPER_CONFIG.slippageRate
            );
            if (!recalculated.ok) throw new Error(recalculated.error);
            position.actualRisk = recalculated.actualRisk;
            position.plannedStopRisk = recalculated.actualRisk;
            position.feeRate = PAPER_CONFIG.feeRate;
            position.slippageRate = PAPER_CONFIG.slippageRate;
          }

          const currentRisk = openPositions.reduce(
            (sum, position) => sum + Number(position.actualRisk),
            0
          );
          if (!Number.isFinite(currentRisk)) {
            throw new Error("Не удалось подтвердить совокупный риск открытых позиций");
          }

          const riskBySymbol = Object.fromEntries(
            SYMBOLS.map(symbol => [
              symbol,
              openPositions
                .filter(position => position.symbol === symbol)
                .reduce((sum, position) => sum + Number(position.actualRisk), 0)
            ])
          );

          if (
            openPositions.length > PAPER_CONFIG.maxOpenPositions ||
            currentRisk > PAPER_CONFIG.maxTotalRisk + 1e-8 ||
            Object.values(riskBySymbol).some(risk => !Number.isFinite(risk) || risk > PAPER_CONFIG.maxRiskPerSymbol + 1e-8) ||
            SYMBOLS.some(symbol =>
              openPositions.filter(position => position.symbol === symbol).length >
              PAPER_CONFIG.maxPositionsPerSymbol
            )
          ) {
            throw new Error("Текущие позиции не соответствуют новым лимитам. Конфигурация не изменена.");
          }

          // Если есть открытые позиции, корреляционный риск тоже должен быть проверяемым.
          if (openPositions.length > 1) {
            const snapshot = state.latestCorrelation;
            for (const position of openPositions) {
              const correlationRisk = getCorrelationRisk(
                position.symbol,
                openPositions.filter(other => other.id !== position.id),
                snapshot,
                PAPER_CONFIG.correlationThreshold
              );
              if (!correlationRisk.ok) throw new Error(correlationRisk.error);
              if (correlationRisk.correlatedRisk + Number(position.actualRisk) > PAPER_CONFIG.maxCorrelatedRisk + 1e-8) {
                throw new Error("Открытые позиции превышают лимит коррелирующего риска. Миграция отменена.");
              }
            }
          }

          // Object.assign не должен сбросить ни баланс, ни исходный капитал.
          Object.assign(state, PAPER_CONFIG);
          state.initialCapital = originalInitialCapital;
          state.balance = originalBalance;

          if (
            state.balance !== originalBalance ||
            state.initialCapital !== originalInitialCapital ||
            state.pendingSignals.length !== originalPendingCount ||
            state.openPositions.length !== originalOpenCount ||
            state.closedPositions.length !== originalClosedCount ||
            JSON.stringify(state.pendingSignals) !== originalPendingJson ||
            JSON.stringify(state.closedPositions) !== originalClosedJson ||
            JSON.stringify(state.openPositions.map(position => position?.id ?? null)) !== JSON.stringify(originalOpenIds)
          ) {
            throw new Error("Контроль целостности баланса или истории не пройден. Миграция отменена.");
          }

          state.configVersion = 3;
          state.configUpdatedAt = new Date().toISOString();
          state.accountingMode = "NET_PNL_FEES_SLIPPAGE_AND_REALIZED_FUNDING";
          state.migrationIntegrity = {
            balancePreserved: true,
            initialCapitalPreserved: true,
            pendingSignalsPreserved: true,
            openPositionsPreserved: true,
            closedPositionsPreserved: true,
            pendingSignalsCount: originalPendingCount,
            openPositionsCount: originalOpenCount,
            closedPositionsCount: originalClosedCount,
            verifiedAt: new Date().toISOString()
          };

          await lock.put("paper:state", JSON.stringify(state));

          return {
            ok: true,
            mode: "DEMO ONLY",
            executionEnabled: false,
            configUpdated: true,
            balancePreserved: true,
            historyPreserved: true,
            migrationIntegrity: state.migrationIntegrity,
            state
          };
        });

        return json(result);
      } catch (error) {
        return json({
          ok: false,
          mode: "DEMO ONLY",
          executionEnabled: false,
          error: String(error)
        }, 409);
      }
    }

if (url.pathname === "/paper-process-test") {
  if (request.method !== "POST") {
    return json({
      ok: false,
      error: "Разрешён только POST"
    }, 405);
  }

  if (!env.BOT_CONTROL_TOKEN) {
    return json({
      ok: false,
      error: "BOT_CONTROL_TOKEN не настроен"
    }, 500);
  }

  const authorization = request.headers.get("Authorization");

  if (authorization !== `Bearer ${env.BOT_CONTROL_TOKEN}`) {
    return json({
      ok: false,
      error: "Доступ запрещён"
    }, 401);
  }

  if (!env.TRADER_KV) {
    return json({
      ok: false,
      error: "TRADER_KV не подключён"
    }, 500);
  }

  try {
    const result = await withPaperLock(env, async (lock) => {
      const rawState = await env.TRADER_KV.get("paper:state");

      if (!rawState) {
        throw new Error("Виртуальный счёт не инициализирован");
      }

      const state = JSON.parse(rawState);

      if (
        state.mode !== "DEMO ONLY" ||
        state.executionEnabled !== false
      ) {
        throw new Error("Разрешён только режим DEMO ONLY");
      }

      const positionResult = await processOpenPositions(env, lock);
      const pendingResult = await processPendingSignals(env, lock);

      return {
        ok: true,
        mode: "DEMO ONLY",
        executionEnabled: false,
        pendingSignals: pendingResult,
        openPositions: positionResult
      };
    });

    return json(result);
  } catch (error) {
    return json({
      ok: false,
      mode: "DEMO ONLY",
      executionEnabled: false,
      error: String(error)
    }, 503);
  }
}


if (url.pathname === "/paper-expiry-self-test") {
  const authError = controlAuthError(request, env, "POST");
  if (authError) return authError;

  // This endpoint uses synthetic in-memory fixtures only:
  // no KV reads/writes, no market data, no positions and no queue processing.
  const eligibleAfterCandleTime = "2026-01-01T10:00:00.000Z";
  const validSignal = {
    id: "SELF-TEST-EXPIRED",
    signalTime: "2026-01-01T09:59:00.000Z",
    eligibleAfterCandleTime,
    expiresAfterCandles: 3
  };

  const expired = evaluatePendingSignalExpiry(
    validSignal,
    Date.parse("2026-01-01T10:15:01.000Z")
  );
  const stillValidAtBoundary = evaluatePendingSignalExpiry(
    validSignal,
    Date.parse("2026-01-01T10:15:00.000Z")
  );
  const invalidValues = [0, -1, 1.5, "abc", 13].map(value => ({
    value,
    result: getSignalExpiryConfig({
      ...validSignal,
      expiresAfterCandles: value
    })
  }));
  const counts = getPendingSignalStatusCounts([
    { status: "PENDING" },
    { status: "EXPIRED" },
    { status: "REJECTED" },
    { status: "OPEN" },
    { status: "CLOSED" },
    { status: "CANCELLED" }
  ]);

  const checks = {
    expiresAfterThreeCandles: expired.ok && expired.expired,
    exactBoundaryStillEligible: stillValidAtBoundary.ok && !stillValidAtBoundary.expired,
    invalidExpiryValuesRejected: invalidValues.every(item => !item.result.ok),
    statusCountsSeparated:
      counts.total === 6 &&
      counts.pending === 1 &&
      counts.expired === 1 &&
      counts.rejected === 1 &&
      counts.open === 1 &&
      counts.closed === 1 &&
      counts.other === 1
  };

  return json({
    ok: Object.values(checks).every(Boolean),
    mode: "DEMO ONLY",
    executionEnabled: false,
    testType: "PURE_IN_MEMORY_NO_SIDE_EFFECTS",
    checks,
    expiryExample: {
      eligibleAfterCandleTime,
      expiresAfterCandles: 3,
      windowEndsAt: expired.windowEndsAt
        ? new Date(expired.windowEndsAt).toISOString()
        : null,
      expiredAt: expired.expiredAt,
      expiredStatusExpected: expired.expired ? "EXPIRED" : "PENDING"
    },
    invalidExpiryValues: invalidValues,
    sampleStatusCounts: counts,
    sideEffects: {
      kvRead: false,
      kvWrite: false,
      marketDataRequests: false,
      queueProcessed: false,
      positionsOpened: false
    }
  });
}


if (url.pathname === "/paper-risk-self-test") {
  const authError = controlAuthError(request, env, "POST");
  if (authError) return authError;

  // Только синтетические объекты в памяти. Никаких KV, fetch, очереди или позиций.
  const now = Date.now();
  const matrix = {};
  for (const a of SYMBOLS) {
    matrix[a] = {};
    for (const b of SYMBOLS) matrix[a][b] = a === b ? 1 : 0.2;
  }
  matrix["BTC-USDT-SWAP"]["ETH-USDT-SWAP"] = 0.82;
  matrix["ETH-USDT-SWAP"]["BTC-USDT-SWAP"] = 0.82;
  const freshCorrelation = { matrix, calculatedAt: new Date(now).toISOString() };
  const config = {
    maxOpenPositions: 12, maxPositionsPerSymbol: 2,
    riskPerTrade: 5, maxRiskPerSymbol: 10, maxTotalRisk: 60,
    maxCorrelatedRisk: 15, correlationThreshold: 0.75,
    leverage: 2, feeRate: 0.0005, slippageRate: 0.0002
  };
  const instrument = {
    state: "live", contractType: "linear", contractValue: 0.01,
    lotSize: 1, minSize: 1
  };
  const base = {
    symbol: "BTC-USDT-SWAP", action: "OPEN_LONG", activePositions: [],
    correlationSnapshot: freshCorrelation, config, instrument,
    entry: 100, stopLoss: 99, balance: 500
  };
  const run = overrides => evaluatePaperRiskAdmission({ ...base, ...overrides });
  const openPosition = (symbol, action = "OPEN_LONG", actualRisk = 1, requiredMargin = 10) => ({
    symbol, action, status: "OPEN", actualRisk, requiredMargin
  });

  const allowed = run({});
  const totalLimit = run({ activePositions: Array.from({ length: 12 }, () => openPosition("SOL-USDT-SWAP")) });
  const symbolLimit = run({ activePositions: [openPosition(base.symbol), openPosition(base.symbol)] });
  const oppositeDirection = run({ activePositions: [openPosition(base.symbol, "OPEN_SHORT")] });
  const correlatedLimit = run({ activePositions: [openPosition("ETH-USDT-SWAP", "OPEN_LONG", 15)] });
  const insufficientMargin = run({ balance: 1 });
  const staleCorrelation = run({
    activePositions: [openPosition("ETH-USDT-SWAP")],
    correlationSnapshot: { matrix, calculatedAt: new Date(now - CORRELATION_MAX_AGE_MS - 1).toISOString() }
  });
  const perSymbolRiskLimit = run({ activePositions: [openPosition(base.symbol, "OPEN_LONG", 10)] });

  const checks = {
    validEntryAllowedWithinRisk: allowed.ok && allowed.size.actualRisk <= config.riskPerTrade + 1e-8,
    totalPositionLimitEnforced: !totalLimit.ok && totalLimit.error.includes("общий лимит"),
    perSymbolPositionLimitEnforced: !symbolLimit.ok && symbolLimit.error.includes("лимит двух позиций"),
    oppositeDirectionBlocked: !oppositeDirection.ok && oppositeDirection.error.includes("встречную позицию"),
    correlatedRiskLimitEnforced: !correlatedLimit.ok,
    insufficientMarginBlocked: !insufficientMargin.ok && insufficientMargin.error.includes("маржи"),
    staleCorrelationFailsClosed: !staleCorrelation.ok && staleCorrelation.error.includes("корреляции"),
    perSymbolRiskLimitEnforced: !perSymbolRiskLimit.ok
  };

  return json({
    ok: Object.values(checks).every(Boolean),
    mode: "DEMO ONLY",
    executionEnabled: false,
    testType: "PURE_SYNTHETIC_IN_MEMORY_NO_SIDE_EFFECTS",
    checks,
    scenarios: {
      allowed: allowed.ok ? { riskBudget: allowed.riskBudget, actualRisk: allowed.size.actualRisk, requiredMargin: allowed.size.requiredMargin } : allowed,
      totalLimit: totalLimit.error,
      symbolLimit: symbolLimit.error,
      oppositeDirection: oppositeDirection.error,
      correlatedLimit: correlatedLimit.error,
      insufficientMargin: insufficientMargin.error,
      staleCorrelation: staleCorrelation.error,
      perSymbolRiskLimit: perSymbolRiskLimit.error
    },
    sideEffects: {
      kvRead: false, kvWrite: false, marketDataRequests: false,
      queueProcessed: false, positionsOpened: false
    }
  });
}

if (url.pathname === "/paper-position-self-test") {
  const authError = controlAuthError(request, env, "POST");
  if (authError) return authError;

  // Только синтетические данные и чистые функции: без KV, fetch, очереди и изменения позиций.
  const position = (action, stopLoss, takeProfit) => ({
    action, stopLoss, takeProfit
  });
  const candle = (high, low, time = "2026-01-01T10:05:00.000Z") => ({
    time, open: (high + low) / 2, high, low, close: (high + low) / 2, volume: 1
  });

  const longStop = evaluatePositionExit(position("OPEN_LONG", 95, 110), candle(103, 94));
  const longTarget = evaluatePositionExit(position("OPEN_LONG", 95, 110), candle(111, 97));
  const shortStop = evaluatePositionExit(position("OPEN_SHORT", 105, 90), candle(106, 97));
  const shortTarget = evaluatePositionExit(position("OPEN_SHORT", 105, 90), candle(103, 89));
  const bothTouched = evaluatePositionExit(position("OPEN_LONG", 95, 110), candle(111, 94));
  const neitherTouched = evaluatePositionExit(position("OPEN_LONG", 95, 110), candle(109, 96));
  const invalidCandle = evaluatePositionExit(position("OPEN_LONG", 95, 110), candle(90, 100));

  const candleWindow = getUnprocessedPositionCandles([
    candle(104, 99, "2026-01-01T10:00:00.000Z"),
    candle(105, 98, "2026-01-01T10:05:00.000Z"),
    candle(106, 97, "2026-01-01T10:10:00.000Z"),
    { time: "invalid-time", high: 100, low: 99 }
  ], "2026-01-01T10:05:00.000Z");

  const accountingPosition = {
    action: "OPEN_LONG", contracts: 2, contractValue: 0.01,
    referenceEntryPrice: 100, entryPrice: 100.02,
    feeRate: 0.0005, slippageRate: 0.0002
  };
  const noFunding = calculatePaperCloseAccounting({
    position: accountingPosition, exitReferencePrice: 110, fundingPnl: 0
  });
  const fundingDebit = calculatePaperCloseAccounting({
    position: accountingPosition, exitReferencePrice: 110, fundingPnl: -0.01
  });
  const fundingCredit = calculatePaperCloseAccounting({
    position: accountingPosition, exitReferencePrice: 110, fundingPnl: 0.01
  });
  const shortAccounting = calculatePaperCloseAccounting({
    position: {
      ...accountingPosition,
      action: "OPEN_SHORT",
      entryPrice: 99.98
    },
    exitReferencePrice: 90,
    fundingPnl: 0
  });
  let invalidAccountingRejected = false;
  try {
    calculatePaperCloseAccounting({
      position: { ...accountingPosition, feeRate: -0.1 },
      exitReferencePrice: 110,
      fundingPnl: 0
    });
  } catch {
    invalidAccountingRejected = true;
  }

  const checks = {
    longStopLossDetected: longStop.ok && longStop.shouldClose && longStop.exitReason === "STOP_LOSS" && longStop.exitReferencePrice === 95,
    longTakeProfitDetected: longTarget.ok && longTarget.shouldClose && longTarget.exitReason === "TAKE_PROFIT" && longTarget.exitReferencePrice === 110,
    shortStopLossDetected: shortStop.ok && shortStop.shouldClose && shortStop.exitReason === "STOP_LOSS" && shortStop.exitReferencePrice === 105,
    shortTakeProfitDetected: shortTarget.ok && shortTarget.shouldClose && shortTarget.exitReason === "TAKE_PROFIT" && shortTarget.exitReferencePrice === 90,
    stopLossWinsWhenBothTouched: bothTouched.ok && bothTouched.stopTouched && bothTouched.targetTouched && bothTouched.exitReason === "STOP_LOSS",
    positionStaysOpenWhenNoLevelTouched: neitherTouched.ok && !neitherTouched.shouldClose,
    malformedCandleRejected: !invalidCandle.ok,
    alreadyProcessedCandlesIgnored: candleWindow.ok && candleWindow.candles.length === 1 && candleWindow.candles[0].time === "2026-01-01T10:10:00.000Z",
    feesAndSlippageIncluded: noFunding.totalFees > 0 && noFunding.totalSlippage > 0 && Math.abs(noFunding.netPnl - (noFunding.grossPnl - noFunding.totalFees - noFunding.totalSlippage)) < 1e-10,
    fundingDebitReducesNetPnl: Math.abs((noFunding.netPnl - fundingDebit.netPnl) - 0.01) < 1e-10,
    fundingCreditIncreasesNetPnl: Math.abs((fundingCredit.netPnl - noFunding.netPnl) - 0.01) < 1e-10,
    shortGrossPnlUsesCorrectDirection: Math.abs(shortAccounting.grossPnl - 0.2) < 1e-10 && shortAccounting.exitExecutionPrice > 90,
    invalidAccountingInputsRejected: invalidAccountingRejected
  };

  return json({
    ok: Object.values(checks).every(Boolean),
    mode: "DEMO ONLY",
    executionEnabled: false,
    testType: "PURE_SYNTHETIC_IN_MEMORY_NO_SIDE_EFFECTS",
    checks,
    scenarios: {
      longStopLoss: longStop,
      longTakeProfit: longTarget,
      shortStopLoss: shortStop,
      shortTakeProfit: shortTarget,
      bothLevelsTouched: bothTouched,
      neitherLevelTouched: neitherTouched,
      processedCandleWindow: candleWindow,
      accounting: {
        grossPnl: noFunding.grossPnl,
        totalFees: noFunding.totalFees,
        totalSlippage: noFunding.totalSlippage,
        netPnlWithoutFunding: noFunding.netPnl,
        netPnlWithFundingDebit: fundingDebit.netPnl,
        netPnlWithFundingCredit: fundingCredit.netPnl,
        shortGrossPnl: shortAccounting.grossPnl,
        shortExitExecutionPrice: shortAccounting.exitExecutionPrice
      }
    },
    sideEffects: {
      kvRead: false,
      kvWrite: false,
      marketDataRequests: false,
      queueProcessed: false,
      positionsOpened: false,
      positionsClosed: false,
      accountBalanceChanged: false
    }
  });
}

if (url.pathname === "/paper-lifecycle-self-test") {
  const authError = controlAuthError(request, env, "POST");
  if (authError) return authError;

  // Полный синтетический цикл на локальной копии состояния. Не вызывает KV, fetch,
  // getFundingPayments, processPendingSignals или processOpenPositions.
  const config = {
    ...PAPER_CONFIG,
    maxOpenPositions: 12,
    maxPositionsPerSymbol: 2,
    riskPerTrade: 5,
    maxRiskPerSymbol: 10,
    maxTotalRisk: 60,
    maxCorrelatedRisk: 15,
    correlationThreshold: 0.75,
    leverage: 2
  };
  const now = Date.now();
  const matrix = {};
  for (const a of SYMBOLS) {
    matrix[a] = {};
    for (const b of SYMBOLS) matrix[a][b] = a === b ? 1 : 0.2;
  }
  const correlationSnapshot = { matrix, calculatedAt: new Date(now).toISOString() };
  const instrument = {
    symbol: "BTC-USDT-SWAP", state: "live", contractType: "linear",
    contractValue: 0.01, lotSize: 1, minSize: 1
  };
  const initialBalance = 500;
  const testState = {
    mode: "DEMO ONLY", executionEnabled: false, balance: initialBalance,
    openPositions: [], closedPositions: []
  };
  const candleTime = "2026-01-01T10:00:00.000Z";
  const entry = 100;
  const stopLoss = 99;
  const takeProfit = 110;
  const admission = evaluatePaperRiskAdmission({
    symbol: instrument.symbol, action: "OPEN_LONG",
    activePositions: testState.openPositions,
    correlationSnapshot, config, instrument,
    entry, stopLoss, balance: testState.balance
  });

  if (!admission.ok) {
    return json({
      ok: false, mode: "DEMO ONLY", executionEnabled: false,
      testType: "PURE_SYNTHETIC_IN_MEMORY_LIFECYCLE",
      error: "Синтетический вход не прошёл риск-проверку: " + admission.error,
      sideEffects: { kvRead: false, kvWrite: false, marketDataRequests: false, queueProcessed: false, realOrders: false }
    }, 200);
  }

  const size = admission.size;
  const position = {
    id: "synthetic-lifecycle-position", symbol: instrument.symbol,
    action: "OPEN_LONG", status: "OPEN",
    entryPrice: size.entryExecutionPrice, referenceEntryPrice: entry,
    stopLoss, takeProfit, contracts: size.contracts,
    contractValue: instrument.contractValue,
    actualRisk: size.actualRisk, plannedStopRisk: size.actualRisk,
    grossStopRisk: size.grossStopRisk,
    entryFee: size.entryFee, entrySlippageCost: size.entrySlippageCost,
    feeRate: config.feeRate, slippageRate: config.slippageRate,
    notional: size.notional, requiredMargin: size.requiredMargin,
    leverage: config.leverage, entryCandleTime: candleTime,
    openedAt: new Date(Date.parse(candleTime) + 300000).toISOString(),
    lastProcessedCandleTime: candleTime,
    pnlAccounting: "NET_AFTER_FEES_SLIPPAGE_FUNDING",
    costsIncluded: false, fundingPnl: 0, fundingEvents: []
  };
  testState.openPositions.push(position);
  const positionAddedToOpenList = testState.openPositions.some(item => item.id === position.id);

  const exitCandle = {
    time: "2026-01-01T10:05:00.000Z",
    open: 105, high: 111, low: 101, close: 110, volume: 1
  };
  const exitDecision = evaluatePositionExit(position, exitCandle);
  let accounting = null;
  if (exitDecision.ok && exitDecision.shouldClose) {
    accounting = calculatePaperCloseAccounting({
      position, exitReferencePrice: exitDecision.exitReferencePrice, fundingPnl: 0
    });
    applyPaperCloseAccounting(
      position, exitDecision.exitReferencePrice, exitDecision.exitReason,
      exitCandle.time, accounting, []
    );
    testState.balance += accounting.netPnl;
    testState.closedPositions.push(position);
    testState.openPositions = testState.openPositions.filter(item => item.id !== position.id);
  }

  const checks = {
    syntheticEntryPassedRiskAdmission: admission.ok && size.actualRisk <= config.riskPerTrade + 1e-8,
    positionCreatedInTestState: position.status === "CLOSED" && testState.closedPositions.length === 1,
    positionWasAddedBeforeExit: positionAddedToOpenList,
    takeProfitDetected: exitDecision.ok && exitDecision.shouldClose && exitDecision.exitReason === "TAKE_PROFIT",
    closeAccountingApplied: !!accounting && position.costsIncluded && position.exitReason === "TAKE_PROFIT",
    feesAndSlippageDeducted: !!accounting && accounting.totalFees > 0 && accounting.totalSlippage > 0 && accounting.netPnl < accounting.grossPnl,
    balanceUpdatedByNetPnl: !!accounting && Math.abs(testState.balance - (initialBalance + accounting.netPnl)) < 1e-8,
    positionRemovedFromOpenList: testState.openPositions.length === 0,
    positionRecordedInClosedList: testState.closedPositions.length === 1 && testState.closedPositions[0].status === "CLOSED",
    testStateIsDemoOnly: testState.mode === "DEMO ONLY" && testState.executionEnabled === false
  };

  return json({
    ok: Object.values(checks).every(Boolean),
    mode: "DEMO ONLY", executionEnabled: false,
    testType: "PURE_SYNTHETIC_IN_MEMORY_LIFECYCLE_NO_EXTERNAL_SIDE_EFFECTS",
    checks,
    scenario: {
      symbol: instrument.symbol, action: position.action,
      riskBudget: admission.riskBudget, actualRisk: size.actualRisk,
      contracts: size.contracts, entryReferencePrice: entry,
      exitReferencePrice: exitDecision.exitReferencePrice,
      exitReason: exitDecision.exitReason,
      grossPnl: accounting?.grossPnl ?? null,
      totalFees: accounting?.totalFees ?? null,
      totalSlippage: accounting?.totalSlippage ?? null,
      fundingPnl: 0,
      netPnl: accounting?.netPnl ?? null,
      initialBalance, finalBalance: testState.balance,
      openPositionsAfter: testState.openPositions.length,
      closedPositionsAfter: testState.closedPositions.length
    },
    sideEffects: {
      kvRead: false, kvWrite: false, marketDataRequests: false,
      fundingRequests: false, queueProcessed: false,
      positionsOpenedInAccount: false, positionsClosedInAccount: false,
      accountBalanceChanged: false, realOrders: false
    }
  });
}

if (url.pathname === "/paper-state-test") {
  const authError = controlAuthError(request, env, "GET");
  if (authError) return authError;
  const rawState = await env.TRADER_KV.get("paper:state");

  if (!rawState) {
    return json({
      ok: false,
      error: "Состояние виртуального счёта не найдено"
    });
  }

 

const state = JSON.parse(rawState);

const openPositions = (state.openPositions || []).filter(
  position => position.status === "OPEN"
);

const closedPositions = state.closedPositions || [];

const totalOpenRisk = openPositions.reduce(
  (sum, position) => sum + Number(position.actualRisk || 0),
  0
);

const usedMargin = openPositions.reduce(
  (sum, position) => sum + Number(position.requiredMargin || 0),
  0
);

return json({
  ok: true,
  mode: state.mode,
  executionEnabled: state.executionEnabled,
  configVersion: state.configVersion ?? null,
  migrationIntegrity: state.migrationIntegrity || null,
  balance: state.balance,

  initialCapital: state.initialCapital,
  leverage: state.leverage,
  maxOpenPositions: state.maxOpenPositions,
  maxPositionsPerSymbol: state.maxPositionsPerSymbol,
  riskPerTrade: state.riskPerTrade,
  maxRiskPerSymbol: state.maxRiskPerSymbol,
  maxTotalRisk: state.maxTotalRisk,
  maxCorrelatedRisk: state.maxCorrelatedRisk ?? PAPER_CONFIG.maxCorrelatedRisk,
  correlationThreshold: state.correlationThreshold ?? PAPER_CONFIG.correlationThreshold,
  feeRate: state.feeRate ?? PAPER_CONFIG.feeRate,
  slippageRate: state.slippageRate ?? PAPER_CONFIG.slippageRate,
  latestCorrelation: state.latestCorrelation || null,
  lastAutonomousCycle: state.lastAutonomousCycle || null,
  totalOpenRisk,
  usedMargin,
  accountingMode: state.accountingMode || "LEGACY_GROSS_PNL",
  newTradesUseNetAccounting: true,
  legacyClosedPositionsMayBeGross: true,
  riskBySymbol: Object.fromEntries(
    SYMBOLS.map(symbol => [
      symbol,
      openPositions
        .filter(position => position.symbol === symbol)
        .reduce((sum, position) => sum + Number(position.actualRisk || 0), 0)
    ])
  ),

  pendingSignalCounts: getPendingSignalStatusCounts(state.pendingSignals),
  pendingSignals: (state.pendingSignals || []).map(signal => ({
    id: signal.id,
    symbol: signal.symbol,
    action: signal.action,
    status: signal.status,
    signalTime: signal.signalTime,
    signalCandleTime: signal.signalCandleTime,
    eligibleAfterCandleTime: getEligibleAfterCandleTime(signal),
    eligibleCandlesProcessed: signal.eligibleCandlesProcessed,
    expiresAfterCandles: signal.expiresAfterCandles
  })),

  openPositionsCount: openPositions.length,

  openPositions: openPositions.map(position => ({
    id: position.id,
    symbol: position.symbol,
    action: position.action,
    entryPrice: position.entryPrice,
    referenceEntryPrice: position.referenceEntryPrice ?? position.entryPrice,
    estimatedTradingCostsAtStop: position.estimatedTradingCostsAtStop ?? null,
    riskExcludesFutureFunding: position.riskExcludesFutureFunding ?? true,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    contracts: position.contracts,
    actualRisk: position.actualRisk,
    requiredMargin: position.requiredMargin,
    openedAt: position.openedAt,
    lastProcessedCandleTime: position.lastProcessedCandleTime
  })),

  closedPositionsCount: closedPositions.length,

  closedPositions: closedPositions.map(position => ({
    id: position.id,
    symbol: position.symbol,
    action: position.action,
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice,
    grossPnl: position.grossPnl,
    netPnl: position.netPnl,
    totalFees: position.totalFees,
    totalSlippageCost: position.totalSlippageCost,
    fundingPnl: position.fundingPnl,
    totalCosts: position.totalCosts,
    exitReason: position.exitReason,
    openedAt: position.openedAt,
    closedAt: position.closedAt
  }))
});
}

    if (url.pathname === "/paper-journal-test") {
      const authError = controlAuthError(request, env, "GET");
      if (authError) return authError;
      try {
        const id = url.searchParams.get("id");

        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
          return json({
            ok: false,
            error: "Не указан корректный analysisId"
          }, 400);
        }

        const key = "paper:analysis:" + id;
        const saved = await env.TRADER_KV.get(key);

        if (!saved) {
          return json({
            ok: false,
            found: false,
            error: "Запись не найдена в KV"
          }, 404);
        }

        const record = JSON.parse(saved);

        return json({
          ok: true,
          found: true,
          mode: "DEMO ONLY",
          executionEnabled: false,
          analysisId: record.id,
          timestamp: record.timestamp,
          validation: record.validation,
          decisionsCount: record.decisions.length,
          symbols: record.decisions.map(item => item.symbol)
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error)
        }, 500);
      }
    }
    if (url.pathname === "/paper-init") {
      const authError = controlAuthError(request, env, "POST");
      if (authError) return authError;
      try {
        const result = await withPaperLock(env, async (lock) => {
        const endpoint = new URL(
          "/api/v5/public/instruments",
          "https://eea.okx.com"
        );

        endpoint.searchParams.set("instType", "SWAP");

        const response = await fetch(endpoint.toString(), {
          headers: {
            "Accept": "application/json"
          }
        });

        const data = await response.json();

        if (!response.ok || data.code !== "0") {
          throw new Error(
            "Ошибка получения параметров OKX: " + (data.msg || data.code)
          );
        }

        const instruments = (data.data || [])
          .filter(item => SYMBOLS.includes(item.instId))
          .map(item => ({
            symbol: item.instId,
            state: item.state,
            contractValue: item.ctVal,
            contractValueCurrency: item.ctValCcy,
            lotSize: item.lotSz,
            minSize: item.minSz,
            tickSize: item.tickSz,
            settlementCurrency: item.settleCcy,
            contractType: item.ctType
          }));

        if (instruments.length !== SYMBOLS.length) {
          throw new Error("Получены не все параметры контрактов");
        }

        if (instruments.some(item =>
          item.state !== "live" || item.contractType !== "linear"
        )) {
          throw new Error("Обнаружен недоступный или неподходящий контракт");
        }

        const existingState = await env.TRADER_KV.get(
          "paper:state"
        );

        await lock.put("paper:instruments", JSON.stringify(instruments));

        let stateCreated = false;

        if (existingState === null) {
          const initialState = {
            ...PAPER_CONFIG,
            balance: PAPER_CONFIG.initialCapital,
            mode: "DEMO ONLY",
            executionEnabled: false,
            pendingSignals: [],
            openPositions: [],
            closedPositions: [],
            latestCorrelation: null,
            lastAutonomousCycle: null,
            configVersion: 3,
            accountingMode: "NET_PNL_FEES_SLIPPAGE_AND_REALIZED_FUNDING",
            createdAt: new Date().toISOString()
          };

          await lock.put("paper:state", JSON.stringify(initialState));

          stateCreated = true;
        }

        const savedState = JSON.parse(
          await env.TRADER_KV.get("paper:state")
        );

        return {
          ok: true,
          mode: "DEMO ONLY",
          executionEnabled: false,
          storage: "TRADER_KV",
          instrumentsSaved: instruments.length,
          stateCreated,
          state: savedState,
          checkedAt: new Date().toISOString()
        };
        });
        return json(result);

      } catch (error) {
        return json({
          ok: false,
          mode: "DEMO ONLY",
          executionEnabled: false,
          error: String(error)
        }, 500);
      }
    }
    if (url.pathname === "/instruments-test") {
      try {
        const endpoint = new URL(
          "/api/v5/public/instruments",
          "https://eea.okx.com"
        );

        endpoint.searchParams.set("instType", "SWAP");

        const response = await fetch(endpoint.toString(), {
          headers: {
            "Accept": "application/json"
          }
        });

        const data = await response.json();

        if (!response.ok || data.code !== "0") {
          return json({
            ok: false,
            httpStatus: response.status,
            okxCode: data.code,
            okxMessage: data.msg || "",
            mode: "DEMO ONLY"
          }, 502);
        }

        const instruments = (data.data || [])
          .filter(item => SYMBOLS.includes(item.instId))
          .map(item => ({
            symbol: item.instId,
            state: item.state,
            contractValue: item.ctVal,
            contractValueCurrency: item.ctValCcy,
            lotSize: item.lotSz,
            minSize: item.minSz,
            tickSize: item.tickSz,
            settlementCurrency: item.settleCcy,
            contractType: item.ctType
          }));

        return json({
          ok: instruments.length === SYMBOLS.length,
          mode: "DEMO ONLY",
          checkedAt: new Date().toISOString(),
          expected: SYMBOLS.length,
          received: instruments.length,
          missing: SYMBOLS.filter(
            symbol => !instruments.some(item => item.symbol === symbol)
          ),
          instruments
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error),
          mode: "DEMO ONLY"
        }, 500);
      }
    }
    if (url.pathname === "/eea-rate-test") {
      try {
        const endpoint = new URL(
          "/api/v5/market/candles",
          "https://eea.okx.com"
        );

        endpoint.searchParams.set("instId", "BTC-USDT-SWAP");
        endpoint.searchParams.set("bar", "5m");
        endpoint.searchParams.set("limit", "1");

        const response = await fetch(endpoint.toString(), {
          headers: {
            "Accept": "application/json"
          }
        });

        const raw = await response.text();
        const data = JSON.parse(raw);

        return json({
          ok: response.ok && data.code === "0",
          httpStatus: response.status,
          okxCode: data.code,
          okxMessage: data.msg || "",
          candlesReceived: Array.isArray(data.data)
            ? data.data.length
            : 0,
          checkedAt: new Date().toISOString(),
          apiDomain: "eea.okx.com",
          mode: "DEMO ONLY"
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error),
          apiDomain: "eea.okx.com",
          mode: "DEMO ONLY"
        }, 500);
      }
    }
    if (url.pathname === "/okx-rate-test") {
      try {
        const endpoint = new URL(
          "/api/v5/market/candles",
          BASE_URL
        );

        endpoint.searchParams.set("instId", "BTC-USDT-SWAP");
        endpoint.searchParams.set("bar", "5m");
        endpoint.searchParams.set("limit", "1");

        const response = await fetch(endpoint.toString(), {
          headers: {
            "Accept": "application/json"
          }
        });

        const raw = await response.text();
        const data = JSON.parse(raw);

        return json({
          ok: response.ok && data.code === "0",
          httpStatus: response.status,
          okxCode: data.code,
          okxMessage: data.msg || "",
          candlesReceived: Array.isArray(data.data)
            ? data.data.length
            : 0,
          checkedAt: new Date().toISOString(),
          mode: "DEMO ONLY"
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error),
          mode: "DEMO ONLY"
        }, 500);
      }
    }

    // Главная страница
    if (url.pathname === "/") {
      return json({
        ok: true,
        worker: "OKX Smart Trader",
        ai: "Gemma 4",
        mode: "DEMO ONLY",
        executionEnabled: false
      });
    }

    // Проверка Gemma
    if (url.pathname === "/ai-test") {
      const authError = controlAuthError(request, env, "POST");
      if (authError) return authError;
      try {
        const result = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: "Ты аналитический модуль торгового бота. Отвечай кратко на русском языке."
            },
            {
              role: "user",
              content: "Подтверди: Gemma 4 работает. Демо-режим активен."
            }
          ],
          chat_template_kwargs: {
            enable_thinking: false
          }
        });

        return json({
          ok: true,
          model: MODEL,
          mode: "DEMO ONLY",
          result
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error)
        }, 500);
      }
    }

    // Проверка получения свечей
    if (url.pathname === "/market-test") {
      const results = [];

      for (const symbol of SYMBOLS) {
        results.push(await getCandles(symbol));
        await sleep(800);
      }

      return json({
        ok: results.every(r => r.ok),
        mode: "DEMO ONLY",
        timeframe: "5m",
        checkedAt: new Date().toISOString(),
        successfulPairs: results.filter(r => r.ok).length,
        failedPairs: results.filter(r => !r.ok).length,
        results
      });
    }


if (url.pathname === "/market-data-test") {
  const results = await collectMarketData();

  return json({
    ok:
      results.length === SYMBOLS.length &&
      results.every(r =>
        !r.error &&
        typeof r.lastCandleTime === "string" &&
        Number.isFinite(r.lastCandleOpen) &&
        Number.isFinite(r.lastCandleHigh) &&
        Number.isFinite(r.lastCandleLow) &&
        Number.isFinite(r.lastCandleClose) &&
        Number.isFinite(r.price) &&
        Number.isFinite(r.ema9) &&
        Number.isFinite(r.ema21) &&
        Number.isFinite(r.rsi) &&
        Number.isFinite(r.atr)
      ),
    mode: "DEMO ONLY",
    timeframe: "5m",
    checkedAt: new Date().toISOString(),
    successfulPairs: results.filter(r => !r.error).length,
    failedPairs: results.filter(r => r.error).length,
    results
  });
}






    // Проверка индикаторов
    if (url.pathname === "/indicator-test") {
      const results = [];

      try {
        const marketData = await collectMarketData();

        for (const item of marketData) {
          results.push({
            symbol: item.symbol,
            ok: !item.error,
            ...item
          });
        }

        return json({
          ok: marketData.every(item => !item.error),
          mode: "DEMO ONLY",
          timeframe: "5m",
          checkedAt: new Date().toISOString(),
          successfulPairs: marketData.filter(item => !item.error).length,
          failedPairs: marketData.filter(item => item.error).length,
          results
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error)
        }, 500);
      }
    }

// Анализ Gemma без исполнения сделок
    if (url.pathname === "/ai-analysis-test") {
      const authError = controlAuthError(request, env, "POST");
      if (authError) return authError;
      try {
        const marketData = await collectMarketData();

        if (marketData.some(item => item.error)) {
          return json({
            ok: false,
            mode: "DEMO ONLY",
            error: "Не удалось получить данные всех рынков",
            marketData
          }, 502);
        }

        const prompt = `
Ты — автономный аналитический модуль торгового бота OKX.

Режим работы: DEMO ONLY.
Проанализируй все шесть бессрочных фьючерсов USDT.
Таймфрейм: 5 минут.
Плечо будущей симуляции: x2.

Самостоятельно принимай решения:
OPEN_LONG, OPEN_SHORT или HOLD.

ИСПОЛЬЗОВАНИЕ ДАННЫХ:
ИСХОДНЫЕ ДАННЫЕ РЫНКА:

Ниже переданы реальные данные, полученные от OKX.
Обязательно проанализируй их. Не проси пользователя
предоставить дополнительные данные.

${JSON.stringify(marketData, null, 2)}

1. Используй только фактические значения из переданных данных.
2. Не придумывай значения RSI, EMA, MACD, ATR, цены и объёма.
3. В reason указывай только подтверждённые фактами наблюдения.
4. Не утверждай, что произошло пересечение EMA или MACD, если нет предыдущих значений.
5. Положительный MACD histogram сам по себе не доказывает пересечение MACD.
6. Не делай вывод о развороте только по RSI.
7. Учитывай тренд, импульс и объём совместно.
8. При противоречивых или недостаточных сигналах выбирай HOLD.

ПРАВИЛА РЕШЕНИЙ:

OPEN_LONG — только при достаточно сильном подтверждении роста.

OPEN_SHORT — только при достаточно сильном подтверждении снижения.

HOLD — если сигнал слабый, противоречивый или риск неоправдан.

Не пытайся обязательно открыть сделку.
Допустимо от нуля до шести сделок.

ПРАВИЛА ЦЕН:

Для OPEN_LONG:
stopLoss ниже entry;
takeProfit выше entry.

Для OPEN_SHORT:
stopLoss выше entry;
takeProfit ниже entry.

Entry должен быть близок к текущей цене.
Не выдумывай цены.
Соотношение потенциальной прибыли к риску не меньше 1.5.

Для HOLD:
entry, stopLoss и takeProfit должны быть null.

ФОРМАТ ОТВЕТА:

Верни ровно шесть решений, по одному на каждую пару.
Каждая пара должна присутствовать ровно один раз.

confidence — целое число от 0 до 100.
reason — краткое объяснение на основании данных.

Верни только корректный JSON без Markdown:

{
  "decisions": [
    {
      "symbol": "BTC-USDT-SWAP",
      "action": "HOLD",
      "entry": null,
      "stopLoss": null,
      "takeProfit": null,
      "confidence": 0,
      "reason": "Недостаточно подтверждений для входа"
    }
  ]
}
`;

        const aiResult = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: "Ты автономный аналитический модуль. Возвращай только корректный JSON. Не исполняй сделки."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          chat_template_kwargs: {
            enable_thinking: false
          }
        });

        let aiText = "";

        if (
          aiResult &&
          typeof aiResult.response === "string"
        ) {
          aiText = aiResult.response;
        } else if (
          aiResult &&
          typeof aiResult.output === "string"
        ) {
          aiText = aiResult.output;
        } else {
          aiText = JSON.stringify(aiResult);
        }

        let parsed = null;
        let validation = {
          valid: false,
          errors: []
        };

        try {
          parsed = extractAIJson(aiText);
          validation = validateDecisions(parsed, marketData);
        } catch (error) {
          validation = {
            valid: false,
            errors: [String(error)]
          };
        }
const analysisId = crypto.randomUUID();
        const analysisTime = new Date().toISOString();

        const analysisRecord = {
          id: analysisId,
          timestamp: analysisTime,
          mode: "DEMO ONLY",
          executionEnabled: false,
          model: MODEL,
          validation: validation.valid,
          validationErrors: validation.errors,
          validationWarnings: validation.warnings || [],
          marketData,
          decisions: parsed?.decisions || [],
          rawAIResponse: validation.valid ? undefined : aiText
        };

        
await env.TRADER_KV.put(
  "paper:analysis:" + analysisId,
  JSON.stringify(analysisRecord)
);

// Добавляем проверенные сигналы в виртуальную очередь
/** @type {any} */
let pendingResult = {
  ok: false,
  created: 0,
  reason: "Анализ не прошёл проверку"
};

if (validation.valid) {
  try {
    pendingResult = await withPaperLock(env, async (lock) =>
      createPendingSignals(env, analysisRecord, lock)
    );
  } catch (error) {
    pendingResult = {
      ok: false,
      created: 0,
      reason: String(error)
    };
  }
}

return json({
  ok: true,
  mode: "DEMO ONLY",
  executionEnabled: false,
  model: MODEL,
  checkedAt: new Date().toISOString(),

  analysisId: analysisId,
  journalSaved: true,

  validation: validation.valid,
  validationErrors: validation.errors,
  validationWarnings: validation.warnings || [],

  pendingSignals: pendingResult,

  marketData: marketData,
  decisions: parsed,

  rawAIResponse: validation.valid ? undefined : aiText
});

      } catch (error) {
        return json({
          ok: false,
          mode: "DEMO ONLY",
          executionEnabled: false,
          error: String(error)
        }, 500);
      }
    }
    // Проверка KV
    if (url.pathname === "/kv-test") {
      const authError = controlAuthError(request, env, "POST");
      if (authError) return authError;
      try {
        await env.TRADER_KV.put("connection_test", "OK");

        const result = await env.TRADER_KV.get("connection_test");

        return json({
          ok: result === "OK",
          storage: "TRADER_KV",
          test: result
        });

      } catch (error) {
        return json({
          ok: false,
          error: String(error)
        }, 500);
      }
    }

    return json({
      ok: false,
      error: "Not found"
    }, 404);
  }
};

// Durable Object: сериализует изменения виртуального счёта.
// Обязателен binding PAPER_LOCK в настройках Worker.
export class PaperLock {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.lockRecord = null;
    this.queue = Promise.resolve();

    this.ready = this.state.blockConcurrencyWhile(async () => {
      this.lockRecord = await this.state.storage.get("paper-lock") || null;
    });
  }

  runExclusive(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return json({ ok: false, error: "Разрешён только POST" }, 405);
    }

    await this.ready;

    if (url.pathname === "/acquire") {
      return this.runExclusive(async () => {
        if (
          this.lockRecord &&
          this.lockRecord.expiresAt > Date.now()
        ) {
          return json({
            ok: false,
            error: "Виртуальный счёт уже обрабатывается другим запросом"
          }, 409);
        }

        const token = crypto.randomUUID();
        const nextLock = {
          token,
          expiresAt: Date.now() + PAPER_LOCK_TTL_MS
        };

        await this.state.storage.put("paper-lock", nextLock);
        this.lockRecord = nextLock;

        return json({ ok: true, token });
      });
    }

    if (url.pathname === "/renew") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");
        if (!token || !this.lockRecord || this.lockRecord.token !== token || this.lockRecord.expiresAt <= Date.now()) {
          return json({ ok: false, error: "Блокировка истекла или токен недействителен" }, 409);
        }
        const nextLock = {
          ...this.lockRecord,
          expiresAt: Date.now() + PAPER_LOCK_TTL_MS
        };

        await this.state.storage.put("paper-lock", nextLock);
        this.lockRecord = nextLock;

        return json({ ok: true, expiresAt: nextLock.expiresAt });
      });
    }

    if (url.pathname === "/put") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");

        if (
          !token ||
          !this.lockRecord ||
          this.lockRecord.token !== token ||
          this.lockRecord.expiresAt <= Date.now()
        ) {
          return json({
            ok: false,
            error: "Запись отклонена: блокировка истекла или токен недействителен"
          }, 409);
        }

        if (!this.env.TRADER_KV) {
          return json({
            ok: false,
            error: "TRADER_KV не подключён"
          }, 500);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "Некорректное тело запроса"
          }, 400);
        }

        const allowedKeys = new Set([
          "paper:state",
          "paper:instruments"
        ]);

        if (
          !body ||
          !allowedKeys.has(body.key) ||
          typeof body.value !== "string"
        ) {
          return json({
            ok: false,
            error: "Недопустимый ключ или значение KV"
          }, 400);
        }

        await this.env.TRADER_KV.put(body.key, body.value);

        return json({
          ok: true,
          key: body.key
        });
      });
    }
    if (url.pathname === "/release") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");

        if (!token) {
          return json({
            ok: false,
            error: "Не передан токен блокировки"
          }, 400);
        }

        if (!this.lockRecord || this.lockRecord.token !== token) {
          return json({ ok: false }, 409);
        }

        await this.state.storage.delete("paper-lock");
        this.lockRecord = null;

        return json({ ok: true });
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
}
