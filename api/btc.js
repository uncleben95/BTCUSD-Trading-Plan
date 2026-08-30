// =====================================================
// BTCUSD API
// Primary: Binance Futures
// Fallback: Binance Spot
// =====================================================

const BINANCE_FUTURES =
  "https://fapi.binance.com";

const BINANCE_SPOT =
  "https://api.binance.com";

async function getJSON(url) {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8000
    );

  try {

    const res =
      await fetch(
        url,
        {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "BTCUSD-Technical-Monitor/1.0"
          },
          cache: "no-store"
        }
      );

    if (!res.ok) {

      throw new Error(
        `HTTP ${res.status}`
      );

    }

    return await res.json();

  } finally {

    clearTimeout(timeout);

  }

}


// -----------------------------------------------------
// GET KLINES
// -----------------------------------------------------

async function getKlines() {

  const endpoints = [

    `${BINANCE_FUTURES}/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=250`,

    `${BINANCE_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=250`

  ];

  for (const url of endpoints) {

    try {

      const data =
        await getJSON(url);

      if (
        Array.isArray(data) &&
        data.length >= 60
      ) {

        return data;

      }

    } catch (err) {

      console.warn(
        "Kline source failed:",
        err.message
      );

    }

  }

  throw new Error(
    "BTC candle data unavailable"
  );

}


// -----------------------------------------------------
// INDICATORS
// -----------------------------------------------------

function closes(candles) {

  return candles.map(
    c => Number(c[4])
  );

}

function highs(candles) {

  return candles.map(
    c => Number(c[2])
  );

}

function lows(candles) {

  return candles.map(
    c => Number(c[3])
  );

}

function volumes(candles) {

  return candles.map(
    c => Number(c[5])
  );

}


// EMA

function EMA(values, period) {

  if (
    !values ||
    values.length < period
  ) return null;

  const multiplier =
    2 / (period + 1);

  let ema =
    values
      .slice(0, period)
      .reduce(
        (a, b) => a + b,
        0
      ) / period;

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    ema =
      (
        values[i] - ema
      ) * multiplier + ema;

  }

  return ema;

}


// SMA

function SMA(values, period) {

  if (
    values.length < period
  ) return null;

  const arr =
    values.slice(
      values.length - period
    );

  return (
    arr.reduce(
      (a, b) => a + b,
      0
    ) / period
  );

}


// RSI

function RSI(values, period = 14) {

  if (
    values.length <= period
  ) return null;

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const diff =
      values[i] -
      values[i - 1];

    if (diff >= 0)
      gains += diff;
    else
      losses -= diff;

  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const diff =
      values[i] -
      values[i - 1];

    const gain =
      Math.max(diff, 0);

    const loss =
      Math.max(-diff, 0);

    avgGain =
      (
        avgGain * (period - 1) +
        gain
      ) / period;

    avgLoss =
      (
        avgLoss * (period - 1) +
        loss
      ) / period;

  }

  if (avgLoss === 0)
    return 100;

  const rs =
    avgGain / avgLoss;

  return 100 - (
    100 / (1 + rs)
  );

}


// ATR

function ATR(candles, period = 14) {

  if (
    candles.length <= period
  ) return null;

  const tr = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const high =
      Number(candles[i][2]);

    const low =
      Number(candles[i][3]);

    const prevClose =
      Number(candles[i - 1][4]);

    tr.push(
      Math.max(
        high - low,
        Math.abs(
          high - prevClose
        ),
        Math.abs(
          low - prevClose
        )
      )
    );

  }

  return SMA(
    tr,
    period
  );

}


// Bollinger Bands

function bollinger(
  values,
  period = 20,
  multiplier = 2
) {

  if (
    values.length < period
  ) return null;

  const arr =
    values.slice(
      values.length - period
    );

  const middle =
    arr.reduce(
      (a, b) => a + b,
      0
    ) / period;

  const variance =
    arr.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - middle,
          2
        ),
      0
    ) / period;

  const sd =
    Math.sqrt(
      variance
    );

  return {

    upper:
      middle +
      multiplier * sd,

    middle,

    lower:
      middle -
      multiplier * sd

  };

}


// -----------------------------------------------------
// VOLUME
// -----------------------------------------------------

function volumeInfo(candles) {

  const vols =
    volumes(candles);

  const current =
    vols[vols.length - 1];

  const previous =
    vols.slice(
      Math.max(
        0,
        vols.length - 21
      ),
      vols.length - 1
    );

  const average =
    previous.length
      ? previous.reduce(
          (a, b) => a + b,
          0
        ) / previous.length
      : current;

  const ratio =
    average > 0
      ? current / average
      : 1;

  let state =
    "NORMAL";

  if (ratio >= 2)
    state = "VERY HIGH";

  else if (ratio >= 1.3)
    state = "HIGH";

  else if (ratio <= 0.7)
    state = "LOW";

  return {

    current,

    average,

    ratio,

    state

  };

}


// -----------------------------------------------------
// SUPPORT / RESISTANCE
// -----------------------------------------------------

function structureInfo(candles) {

  const recent =
    candles.slice(-40);

  const hi =
    highs(recent);

  const lo =
    lows(recent);

  const resistance =
    Math.max(...hi);

  const support =
    Math.min(...lo);

  const lastHigh =
    Math.max(
      ...hi.slice(-10)
    );

  const lastLow =
    Math.min(
      ...lo.slice(-10)
    );

  const price =
    Number(
      candles[candles.length - 1][4]
    );

  let structure =
    "RANGE";

  if (
    price > lastHigh
  )
    structure = "BULLISH";

  else if (
    price < lastLow
  )
    structure = "BEARISH";

  return {

    resistance,

    support,

    lastHigh,

    lastLow,

    structure

  };

}


// -----------------------------------------------------
// M15 ENGINE
// -----------------------------------------------------

function calculateM15(candles) {

  const price =
    Number(
      candles[candles.length - 1][4]
    );

  const close =
    closes(candles);

  const ema20 =
    EMA(close, 20);

  const ema50 =
    EMA(close, 50);

  const rsi =
    RSI(close, 14);

  const atr =
    ATR(candles, 14);

  const bb =
    bollinger(
      close,
      20,
      2
    );

  const volume =
    volumeInfo(candles);

  const structure =
    structureInfo(candles);

  let score = 50;

  if (
    price > ema20
  )
    score += 10;
  else
    score -= 10;

  if (
    price > ema50
  )
    score += 10;
  else
    score -= 10;

  if (
    ema20 > ema50
  )
    score += 10;
  else
    score -= 10;

  if (
    rsi > 50 &&
    rsi < 70
  )
    score += 8;

  if (
    rsi < 50 &&
    rsi > 30
  )
    score -= 8;

  if (
    volume.ratio >= 1.3
  ) {

    if (
      price > ema20
    )
      score += 7;
    else
      score -= 7;

  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
    );

  let signal =
    "WAIT";

  if (
    score >= 70
  )
    signal = "BUY";

  else if (
    score <= 30
  )
    signal = "SELL";

  let phase =
    "RANGE";

  if (
    price > ema20 &&
    ema20 > ema50
  )
    phase = "BULLISH TREND";

  else if (
    price < ema20 &&
    ema20 < ema50
  )
    phase = "BEARISH TREND";

  let bbPosition =
    "MIDDLE";

  if (bb) {

    if (
      price >= bb.upper
    )
      bbPosition = "UPPER";

    else if (
      price <= bb.lower
    )
      bbPosition = "LOWER";

  }

  return {

    price,

    ema20,

    ema50,

    rsi,

    atr,

    volume,

    bb: {

      ...bb,

      position:
        bbPosition

    },

    resistance:
      structure.resistance,

    support:
      structure.support,

    lastHigh:
      structure.lastHigh,

    lastLow:
      structure.lastLow,

    structure:
      structure.structure,

    bos:
      "MONITORING",

    choch:
      "MONITORING",

    signal,

    score,

    phase

  };

}


// -----------------------------------------------------
// TRADE PLAN
// -----------------------------------------------------

function tradePlan(
  price,
  atr,
  signal
) {

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(atr) ||
    signal === "WAIT"
  ) {

    return {

      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      rr: null

    };

  }

  const risk =
    atr * 1.2;

  if (
    signal === "BUY"
  ) {

    const sl =
      price - risk;

    const tp1 =
      price + risk * 1.5;

    const tp2 =
      price + risk * 2.5;

    return {

      entry: price,

      sl,

      tp1,

      tp2,

      rr: "1:1.5 / 1:2.5"

    };

  }

  const sl =
    price + risk;

  const tp1 =
    price - risk * 1.5;

  const tp2 =
    price - risk * 2.5;

  return {

    entry: price,

    sl,

    tp1,

    tp2,

    rr: "1:1.5 / 1:2.5"

  };

}


// -----------------------------------------------------
// MAIN
// -----------------------------------------------------

export default async function handler(
  req,
  res
) {

  try {

    const candles =
      await getKlines();

    const m15 =
      calculateM15(
        candles
      );

    const signal =
      m15.signal;

    const trade =
      tradePlan(
        m15.price,
        m15.atr,
        signal
      );

    const timeframes = {

      M15: {

        ...m15,

        condition:
          signal === "BUY"
            ? "BULLISH"
            : signal === "SELL"
              ? "BEARISH"
              : "NEUTRAL"

      }

    };

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );

    return res.status(200).json({

      ok: true,

      source:
        "Binance Futures / Spot",

      price:
        m15.price,

      signal,

      score:
        m15.score,

      phase:
        m15.phase,

      trade,

      timeframes,

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(
      "BTC API ERROR:",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        error.message ||
        "BTC data unavailable"

    });

  }

}
