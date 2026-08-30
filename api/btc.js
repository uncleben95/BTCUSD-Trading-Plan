// ============================================================
// BTCUSD API
// Binance public market data
// Backend calculates technical data
// ============================================================

const BASE = "https://api.binance.com/api/v3";

const TIMEFRAMES = [
  { label: "D1", interval: "1d", limit: 100 },
  { label: "H4", interval: "4h", limit: 100 },
  { label: "H1", interval: "1h", limit: 150 },
  { label: "M30", interval: "30m", limit: 150 },
  { label: "M15", interval: "15m", limit: 150 },
  { label: "M5", interval: "5m", limit: 150 }
];

async function getJSON(url) {

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function ema(values, period) {

  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result = 0;

  for (let i = 0; i < period; i++) {
    result += values[i];
  }

  result /= period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier + result;
  }

  return result;
}

function sma(values, period) {

  if (values.length < period) return null;

  const slice = values.slice(-period);

  return slice.reduce((a, b) => a + b, 0) / period;
}

function std(values, period) {

  if (values.length < period) return null;

  const slice = values.slice(-period);

  const mean =
    slice.reduce((a, b) => a + b, 0) / period;

  const variance =
    slice.reduce(
      (sum, value) =>
        sum + Math.pow(value - mean, 2),
      0
    ) / period;

  return Math.sqrt(variance);
}

function rsi(values, period = 14) {

  if (values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;

  const start = values.length - period;

  for (let i = start; i < values.length; i++) {

    const diff =
      values[i] - values[i - 1];

    if (diff > 0) {
      gain += diff;
    } else {
      loss += Math.abs(diff);
    }
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {

  if (candles.length < period + 1) return null;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {

    const c = candles[i];
    const p = candles[i - 1];

    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  const slice = trs.slice(-period);

  return (
    slice.reduce((a, b) => a + b, 0) /
    slice.length
  );
}

function structure(candles) {

  const recent = candles.slice(-50);

  if (recent.length < 10) {
    return {
      high: null,
      low: null,
      structure: "NONE",
      bos: "NONE",
      choch: "NONE"
    };
  }

  const highs = [];
  const lows = [];

  for (let i = 2; i < recent.length - 2; i++) {

    const c = recent[i];

    if (
      c.high > recent[i - 1].high &&
      c.high > recent[i - 2].high &&
      c.high >= recent[i + 1].high &&
      c.high >= recent[i + 2].high
    ) {
      highs.push(c.high);
    }

    if (
      c.low < recent[i - 1].low &&
      c.low < recent[i - 2].low &&
      c.low <= recent[i + 1].low &&
      c.low <= recent[i + 2].low
    ) {
      lows.push(c.low);
    }
  }

  const lastHigh =
    highs.length
      ? highs[highs.length - 1]
      : Math.max(...recent.map(x => x.high));

  const previousHigh =
    highs.length > 1
      ? highs[highs.length - 2]
      : lastHigh;

  const lastLow =
    lows.length
      ? lows[lows.length - 1]
      : Math.min(...recent.map(x => x.low));

  const previousLow =
    lows.length > 1
      ? lows[lows.length - 2]
      : lastLow;

  const price =
    recent[recent.length - 1].close;

  let type = "NEUTRAL";

  if (
    lastHigh > previousHigh &&
    lastLow > previousLow
  ) {
    type = "HH / HL";
  }

  if (
    lastHigh < previousHigh &&
    lastLow < previousLow
  ) {
    type = "LH / LL";
  }

  let bos = "NONE";
  let choch = "NONE";

  if (price > lastHigh) {
    bos = "BULLISH";
  }

  if (price < lastLow) {
    bos = "BEARISH";
  }

  return {
    high: lastHigh,
    low: lastLow,
    structure: type,
    bos,
    choch
  };
}

function analyse(candles) {

  const closes =
    candles.map(x => x.close);

  const current =
    closes[closes.length - 1];

  const ema20 =
    ema(closes, 20);

  const ema50 =
    ema(closes, 50);

  const RSI =
    rsi(closes);

  const ATR =
    atr(candles);

  const middle =
    sma(closes, 20);

  const deviation =
    std(closes, 20);

  const upper =
    middle + deviation * 2;

  const lower =
    middle - deviation * 2;

  const volumes =
    candles.map(x => x.volume);

  const currentVolume =
    volumes[volumes.length - 1];

  const averageVolume =
    sma(volumes, 20);

  const volumeRatio =
    averageVolume
      ? currentVolume / averageVolume
      : 1;

  let condition = "NEUTRAL";

  let score = 50;

  if (current > ema20) score += 10;
  else score -= 10;

  if (ema20 > ema50) score += 15;
  else score -= 15;

  if (RSI > 50 && RSI < 70) {
    score += 10;
  }

  if (RSI < 50 && RSI > 30) {
    score -= 5;
  }

  if (RSI >= 70) {
    score -= 5;
  }

  if (current > middle) {
    score += 5;
  } else {
    score -= 5;
  }

  score =
    Math.max(0, Math.min(100, score));

  if (score >= 65) {
    condition = "BULLISH";
  } else if (score <= 35) {
    condition = "BEARISH";
  }

  let bbPosition = "BELOW MID";

  if (current >= upper) {
    bbPosition = "UPPER BAND";
  } else if (current <= lower) {
    bbPosition = "LOWER BAND";
  } else if (current > middle) {
    bbPosition = "ABOVE MID";
  }

  const sr = structure(candles);

  return {
    price: current,
    ema20,
    ema50,
    rsi: RSI,
    atr: ATR,

    bb: {
      upper,
      middle,
      lower,
      position: bbPosition
    },

    volume: {
      current: currentVolume,
      average: averageVolume,
      ratio: volumeRatio,
      state:
        volumeRatio >= 1.5
          ? "SPIKE"
          : volumeRatio >= 1.1
          ? "HIGH"
          : "NORMAL"
    },

    score,
    condition,

    resistance: sr.high,
    support: sr.low,

    structure: sr.structure,
    bos: sr.bos,
    choch: sr.choch,

    updated:
      new Date().toISOString()
  };
}

async function getCandles(interval, limit) {

  const url =
    `${BASE}/klines` +
    `?symbol=BTCUSDT` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const raw =
    await getJSON(url);

  return raw.map(x => ({
    time: Number(x[0]),
    open: Number(x[1]),
    high: Number(x[2]),
    low: Number(x[3]),
    close: Number(x[4]),
    volume: Number(x[5])
  }));
}

export default async function handler(req, res) {

  try {

    const result = {};

    for (const tf of TIMEFRAMES) {

      try {

        const candles =
          await getCandles(
            tf.interval,
            tf.limit
          );

        result[tf.label] =
          analyse(candles);

      } catch (error) {

        console.error(
          tf.label,
          error
        );
      }
    }

    if (!Object.keys(result).length) {

      return res.status(502).json({
        ok: false,
        error: "BTC candle data unavailable"
      });
    }

    const price =
      result.M15?.price ||
      result.M5?.price;

    const m15 =
      result.M15;

    let bullish = 0;
    let bearish = 0;

    for (const key of [
      "D1",
      "H4",
      "H1",
      "M30",
      "M15",
      "M5"
    ]) {

      const d = result[key];

      if (!d) continue;

      if (d.condition === "BULLISH") {
        bullish++;
      }

      if (d.condition === "BEARISH") {
        bearish++;
      }
    }

    let signal = "WAIT";

    let signalScore =
      Math.max(
        50,
        Math.max(bullish, bearish) * 12
      );

    if (
      result.D1?.condition === "BULLISH" &&
      result.H4?.condition === "BULLISH" &&
      result.H1?.condition === "BULLISH" &&
      result.M30?.condition === "BULLISH" &&
      result.M15?.condition === "BULLISH" &&
      result.M5?.condition === "BULLISH" &&
      m15.rsi < 72 &&
      m15.bos === "BULLISH"
    ) {

      signal = "BUY";
      signalScore = 85;
    }

    if (
      result.D1?.condition === "BEARISH" &&
      result.H4?.condition === "BEARISH" &&
      result.H1?.condition === "BEARISH" &&
      result.M30?.condition === "BEARISH" &&
      result.M15?.condition === "BEARISH" &&
      result.M5?.condition === "BEARISH" &&
      m15.rsi > 28 &&
      m15.bos === "BEARISH"
    ) {

      signal = "SELL";
      signalScore = 85;
    }

    let entry = null;
    let sl = null;
    let tp1 = null;
    let tp2 = null;

    if (signal === "BUY") {

      entry = price;

      sl = Math.min(
        m15.support,
        price - m15.atr * 1.2
      );

      const risk =
        entry - sl;

      tp1 =
        entry + risk * 1.5;

      tp2 =
        entry + risk * 2.5;
    }

    if (signal === "SELL") {

      entry = price;

      sl = Math.max(
        m15.resistance,
        price + m15.atr * 1.2
      );

      const risk =
        sl - entry;

      tp1 =
        entry - risk * 1.5;

      tp2 =
        entry - risk * 2.5;
    }

    let phase =
      "WAIT — MARKET NOT ALIGNED";

    if (
      result.D1?.condition === "BULLISH" &&
      result.M30?.condition === "BULLISH" &&
      result.M15?.condition === "BULLISH"
    ) {

      phase =
        "WAIT — BULLISH SETUP / TRIGGER NOT READY";
    }

    if (
      result.D1?.condition === "BEARISH" &&
      result.M30?.condition === "BEARISH" &&
      result.M15?.condition === "BEARISH"
    ) {

      phase =
        "WAIT — BEARISH SETUP / TRIGGER NOT READY";
    }

    if (m15.rsi >= 72) {
      phase = "WAIT — OVERBOUGHT";
    }

    if (m15.rsi <= 28) {
      phase = "WAIT — OVERSOLD";
    }

    if (signal === "BUY") {
      phase = "BUY — FULL CONFIRMATION";
    }

    if (signal === "SELL") {
      phase = "SELL — FULL CONFIRMATION";
    }

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({

      ok: true,

      symbol: "BTCUSD",

      source: "Binance",

      updated:
        new Date().toISOString(),

      price,

      signal,

      score:
        Math.min(100, signalScore),

      phase,

      trade: {
        entry,
        sl,
        tp1,
        tp2,
        rr:
          signal === "BUY" ||
          signal === "SELL"
            ? "1 : 2.5"
            : null
      },

      timeframes: result

    });

  } catch (error) {

    console.error(
      "BTC API ERROR",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        error?.message ||
        "Server error"

    });
  }
}
