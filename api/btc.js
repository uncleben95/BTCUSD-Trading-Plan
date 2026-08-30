// =====================================================
// BTCUSD API
// Multi-source candle fallback
// Binance -> Bybit -> Coinbase
// =====================================================

const SOURCES = [

  {
    name: "Binance Futures",
    url:
      "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=250"
  },

  {
    name: "Binance Spot",
    url:
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=250"
  },

  {
    name: "Bybit",
    url:
      "https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=250"
  },

  {
    name: "Coinbase",
    url:
      "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900"
  }

];


// =====================================================
// FETCH
// =====================================================

async function fetchJSON(url) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      7000
    );

  try {

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "BTCUSD-Monitor"
          },

          cache:
            "no-store"
        }
      );

    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );

    }

    return await response.json();

  } finally {

    clearTimeout(timer);

  }

}


// =====================================================
// NORMALIZE BINANCE
// =====================================================

function normalizeBinance(data) {

  if (
    !Array.isArray(data) ||
    data.length < 60
  )
    return null;

  return data.map(
    c => [

      Number(c[0]),
      Number(c[1]),
      Number(c[2]),
      Number(c[3]),
      Number(c[4]),
      Number(c[5])

    ]
  );

}


// =====================================================
// NORMALIZE BYBIT
// =====================================================

function normalizeBybit(data) {

  const list =
    data?.result?.list;

  if (
    !Array.isArray(list) ||
    list.length < 60
  )
    return null;

  return list
    .reverse()
    .map(
      c => [

        Number(c[0]),
        Number(c[1]),
        Number(c[2]),
        Number(c[3]),
        Number(c[4]),
        Number(c[5])

      ]
    );

}


// =====================================================
// NORMALIZE COINBASE
// =====================================================

function normalizeCoinbase(data) {

  if (
    !Array.isArray(data) ||
    data.length < 60
  )
    return null;

  return data
    .sort(
      (a, b) =>
        Number(a[0]) -
        Number(b[0])
    )
    .map(
      c => [

        Number(c[0]) * 1000,
        Number(c[3]),
        Number(c[2]),
        Number(c[1]),
        Number(c[4]),
        Number(c[5])

      ]
    );

}


// =====================================================
// GET CANDLES
// =====================================================

async function getCandles() {

  const errors = [];

  for (
    const source of SOURCES
  ) {

    try {

      console.log(
        "Trying:",
        source.name
      );

      const raw =
        await fetchJSON(
          source.url
        );

      let candles = null;

      if (
        source.name
          .startsWith("Binance")
      ) {

        candles =
          normalizeBinance(
            raw
          );

      }

      else if (
        source.name === "Bybit"
      ) {

        candles =
          normalizeBybit(
            raw
          );

      }

      else if (
        source.name === "Coinbase"
      ) {

        candles =
          normalizeCoinbase(
            raw
          );

      }

      if (
        candles &&
        candles.length >= 60
      ) {

        console.log(
          "SUCCESS:",
          source.name,
          candles.length
        );

        return {

          candles,

          source:
            source.name

        };

      }

    } catch (error) {

      console.warn(
        source.name,
        "FAILED:",
        error.message
      );

      errors.push(
        `${source.name}: ${error.message}`
      );

    }

  }

  throw new Error(
    "All BTC candle sources failed | " +
    errors.join(" | ")
  );

}


// =====================================================
// EMA
// =====================================================

function EMA(values, period) {

  if (
    values.length < period
  )
    return null;

  const k =
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
      ) * k +
      ema;

  }

  return ema;

}


// =====================================================
// SMA
// =====================================================

function SMA(values, period) {

  if (
    values.length < period
  )
    return null;

  const slice =
    values.slice(
      -period
    );

  return (
    slice.reduce(
      (a, b) => a + b,
      0
    ) / period
  );

}


// =====================================================
// RSI
// =====================================================

function RSI(
  values,
  period = 14
) {

  if (
    values.length <= period
  )
    return null;

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const diff =
      values[i] -
      values[i - 1];

    if (diff > 0)
      gain += diff;
    else
      loss -= diff;

  }

  let avgGain =
    gain / period;

  let avgLoss =
    loss / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const diff =
      values[i] -
      values[i - 1];

    const g =
      Math.max(
        diff,
        0
      );

    const l =
      Math.max(
        -diff,
        0
      );

    avgGain =
      (
        avgGain *
        (period - 1) +
        g
      ) / period;

    avgLoss =
      (
        avgLoss *
        (period - 1) +
        l
      ) / period;

  }

  if (
    avgLoss === 0
  )
    return 100;

  const rs =
    avgGain /
    avgLoss;

  return (
    100 -
    100 / (1 + rs)
  );

}


// =====================================================
// ATR
// =====================================================

function ATR(
  candles,
  period = 14
) {

  if (
    candles.length <= period
  )
    return null;

  const tr = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const high =
      candles[i][2];

    const low =
      candles[i][3];

    const previous =
      candles[i - 1][4];

    tr.push(
      Math.max(

        high - low,

        Math.abs(
          high - previous
        ),

        Math.abs(
          low - previous
        )

      )
    );

  }

  return SMA(
    tr,
    period
  );

}


// =====================================================
// BOLLINGER
// =====================================================

function Bollinger(
  values,
  period = 20
) {

  if (
    values.length < period
  )
    return null;

  const data =
    values.slice(
      -period
    );

  const middle =
    data.reduce(
      (a, b) => a + b,
      0
    ) / period;

  const variance =
    data.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - middle,
          2
        ),
      0
    ) / period;

  const deviation =
    Math.sqrt(
      variance
    );

  return {

    upper:
      middle +
      deviation * 2,

    middle,

    lower:
      middle -
      deviation * 2

  };

}


// =====================================================
// VOLUME
// =====================================================

function VolumeInfo(
  candles
) {

  const values =
    candles.map(
      c => c[5]
    );

  const current =
    values[
      values.length - 1
    ];

  const previous =
    values.slice(
      -21,
      -1
    );

  const average =
    previous.reduce(
      (a, b) => a + b,
      0
    ) /
    previous.length;

  const ratio =
    average > 0
      ? current / average
      : 1;

  let state =
    "NORMAL";

  if (
    ratio >= 2
  )
    state =
      "VERY HIGH";

  else if (
    ratio >= 1.3
  )
    state =
      "HIGH";

  else if (
    ratio <= 0.7
  )
    state =
      "LOW";

  return {

    current,

    average,

    ratio,

    state

  };

}


// =====================================================
// SUPPORT / RESISTANCE
// =====================================================

function Structure(
  candles
) {

  const recent =
    candles.slice(
      -40
    );

  const resistance =
    Math.max(
      ...recent.map(
        c => c[2]
      )
    );

  const support =
    Math.min(
      ...recent.map(
        c => c[3]
      )
    );

  const lastHigh =
    Math.max(
      ...recent
        .slice(-10)
        .map(
          c => c[2]
        )
    );

  const lastLow =
    Math.min(
      ...recent
        .slice(-10)
        .map(
          c => c[3]
        )
    );

  const price =
    candles[
      candles.length - 1
    ][4];

  let trend =
    "RANGE";

  if (
    price > lastHigh
  )
    trend =
      "BULLISH";

  else if (
    price < lastLow
  )
    trend =
      "BEARISH";

  return {

    resistance,

    support,

    lastHigh,

    lastLow,

    trend

  };

}


// =====================================================
// M15
// =====================================================

function calculate(
  candles
) {

  const closes =
    candles.map(
      c => c[4]
    );

  const price =
    closes[
      closes.length - 1
    ];

  const ema20 =
    EMA(
      closes,
      20
    );

  const ema50 =
    EMA(
      closes,
      50
    );

  const rsi =
    RSI(
      closes,
      14
    );

  const atr =
    ATR(
      candles,
      14
    );

  const bb =
    Bollinger(
      closes,
      20
    );

  const volume =
    VolumeInfo(
      candles
    );

  const structure =
    Structure(
      candles
    );

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
    volume.ratio > 1.3
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
    signal =
      "BUY";

  else if (
    score <= 30
  )
    signal =
      "SELL";

  let phase =
    "RANGE";

  if (
    price > ema20 &&
    ema20 > ema50
  )
    phase =
      "BULLISH TREND";

  else if (
    price < ema20 &&
    ema20 < ema50
  )
    phase =
      "BEARISH TREND";

  let bbPosition =
    "MIDDLE";

  if (bb) {

    if (
      price >= bb.upper
    )
      bbPosition =
        "UPPER";

    else if (
      price <= bb.lower
    )
      bbPosition =
        "LOWER";

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
      structure.trend,

    bos:
      "MONITORING",

    choch:
      "MONITORING",

    signal,

    score,

    phase

  };

}


// =====================================================
// TRADE PLAN
// =====================================================

function TradePlan(
  price,
  atr,
  signal
) {

  if (
    signal === "WAIT" ||
    !atr
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

    return {

      entry:
        price,

      sl:
        price - risk,

      tp1:
        price + risk * 1.5,

      tp2:
        price + risk * 2.5,

      rr:
        "1:1.5 / 1:2.5"

    };

  }

  return {

    entry:
      price,

    sl:
      price + risk,

    tp1:
      price - risk * 1.5,

    tp2:
      price - risk * 2.5,

    rr:
      "1:1.5 / 1:2.5"

  };

}


// =====================================================
// HANDLER
// =====================================================

export default async function handler(
  req,
  res
) {

  try {

    const result =
      await getCandles();

    const candles =
      result.candles;

    const source =
      result.source;

    const m15 =
      calculate(
        candles
      );

    const trade =
      TradePlan(
        m15.price,
        m15.atr,
        m15.signal
      );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({

      ok: true,

      source,

      price:
        m15.price,

      signal:
        m15.signal,

      score:
        m15.score,

      phase:
        m15.phase,

      trade,

      timeframes: {

        M15: {

          ...m15,

          condition:
            m15.signal === "BUY"
              ? "BULLISH"
              : m15.signal === "SELL"
                ? "BEARISH"
                : "NEUTRAL"

        }

      },

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        error.message

    });

  }

}
