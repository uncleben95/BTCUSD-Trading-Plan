export default async function handler(req, res) {

  try {

    const TF = {
      D1: "1d",
      H4: "4h",
      H1: "1h",
      M30: "30m",
      M15: "15m",
      M5: "5m"
    };

    const results = {};

    for (const [name, interval] of Object.entries(TF)) {

      const url =
        `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`;

      const response = await fetch(url);

      if (!response.ok)
        throw new Error(`Binance ${name} HTTP ${response.status}`);

      const raw = await response.json();

      const candles = raw.map(x => ({
        time: Number(x[0]),
        open: Number(x[1]),
        high: Number(x[2]),
        low: Number(x[3]),
        close: Number(x[4]),
        volume: Number(x[5])
      }));

      results[name] = analyze(candles);

    }

    const price =
      results.M15?.price ||
      results.M5?.price;

    const signal =
      calculateSignal(results);

    const trade =
      makeTradePlan(
        results.M15,
        signal
      );

    res.setHeader(
      "Cache-Control",
      "s-maxage=5, stale-while-revalidate=15"
    );

    return res.status(200).json({

      price,

      signal: signal.signal,

      score: signal.score,

      phase: signal.phase,

      trade,

      timeframes: results,

      updated: new Date().toISOString()

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: true,
      message: error.message
    });

  }

}


/* =====================================================
   ANALYSIS
===================================================== */

function analyze(candles) {

  const closes =
    candles.map(c => c.close);

  const price =
    closes[closes.length - 1];

  const ema20 =
    ema(closes, 20);

  const ema50 =
    ema(closes, 50);

  const rsi =
    RSI(closes, 14);

  const atr =
    ATR(candles, 14);

  const middle =
    sma(closes, 20);

  const std =
    STD(closes, 20);

  const upper =
    middle + std * 2;

  const lower =
    middle - std * 2;

  const volumes =
    candles.map(c => c.volume);

  const currentVolume =
    volumes[volumes.length - 1];

  const averageVolume =
    sma(volumes, 20);

  const volumeRatio =
    averageVolume
      ? currentVolume / averageVolume
      : 1;

  let volumeState =
    "NORMAL";

  if (volumeRatio >= 1.5)
    volumeState = "HIGH";

  else if (volumeRatio >= 1)
    volumeState = "ABOVE AVG";

  let score = 50;

  if (price > ema20)
    score += 10;
  else
    score -= 10;

  if (ema20 > ema50)
    score += 15;
  else
    score -= 15;

  if (rsi > 50 && rsi < 70)
    score += 10;

  else if (rsi < 50 && rsi > 30)
    score -= 5;

  if (rsi >= 70)
    score -= 5;

  if (price > middle)
    score += 5;
  else
    score -= 5;

  score =
    Math.max(
      0,
      Math.min(100, score)
    );

  let condition =
    "NEUTRAL";

  if (score >= 65)
    condition = "BULLISH";

  else if (score <= 35)
    condition = "BEARISH";


  let bbPosition =
    "BELOW MID";

  if (price >= upper)
    bbPosition = "UPPER BAND";

  else if (price <= lower)
    bbPosition = "LOWER BAND";

  else if (price > middle)
    bbPosition = "ABOVE MID";


  const recent =
    candles.slice(-40);

  const resistance =
    Math.max(
      ...recent.map(c => c.high)
    );

  const support =
    Math.min(
      ...recent.map(c => c.low)
    );


  const structure =
    detectStructure(candles);

  return {

    price,

    ema20,

    ema50,

    rsi,

    atr,

    condition,

    score,

    bb: {

      upper,

      middle,

      lower,

      position:
        bbPosition

    },

    volume: {

      current:
        currentVolume,

      average:
        averageVolume,

      ratio:
        volumeRatio,

      state:
        volumeState

    },

    resistance,

    support,

    structure:
      structure.structure,

    bos:
      structure.bos,

    choch:
      structure.choch

  };

}


/* =====================================================
   EMA
===================================================== */

function ema(values, period) {

  if (values.length < period)
    return null;

  let result = 0;

  for (let i = 0; i < period; i++)
    result += values[i];

  result /= period;

  const multiplier =
    2 / (period + 1);

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    result =
      (values[i] - result) *
      multiplier +
      result;

  }

  return result;

}


/* =====================================================
   SMA
===================================================== */

function sma(values, period) {

  if (values.length < period)
    return null;

  const slice =
    values.slice(-period);

  return (
    slice.reduce(
      (a, b) => a + b,
      0
    ) / period
  );

}


/* =====================================================
   STD
===================================================== */

function STD(values, period) {

  if (values.length < period)
    return null;

  const slice =
    values.slice(-period);

  const mean =
    sma(slice, period);

  const variance =
    slice.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / period;

  return Math.sqrt(variance);

}


/* =====================================================
   RSI
===================================================== */

function RSI(values, period) {

  if (values.length < period + 1)
    return null;

  let gain = 0;
  let loss = 0;

  const start =
    values.length - period;

  for (
    let i = start;
    i < values.length;
    i++
  ) {

    const difference =
      values[i] -
      values[i - 1];

    if (difference > 0)
      gain += difference;

    else
      loss += Math.abs(
        difference
      );

  }

  const avgGain =
    gain / period;

  const avgLoss =
    loss / period;

  if (avgLoss === 0)
    return 100;

  const rs =
    avgGain / avgLoss;

  return (
    100 -
    100 / (1 + rs)
  );

}


/* =====================================================
   ATR
===================================================== */

function ATR(candles, period) {

  if (candles.length < period + 1)
    return null;

  const trs = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      candles[i - 1];

    const tr =
      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )

      );

    trs.push(tr);

  }

  return sma(
    trs,
    period
  );

}


/* =====================================================
   STRUCTURE
===================================================== */

function detectStructure(candles) {

  const recent =
    candles.slice(-30);

  const highs =
    recent.map(
      c => c.high
    );

  const lows =
    recent.map(
      c => c.low
    );

  const current =
    candles[candles.length - 1]
      .close;

  const previousHigh =
    Math.max(
      ...highs.slice(0, -5)
    );

  const previousLow =
    Math.min(
      ...lows.slice(0, -5)
    );

  const latestHigh =
    Math.max(
      ...highs.slice(-5)
    );

  const latestLow =
    Math.min(
      ...lows.slice(-5)
    );

  let bos = "NONE";
  let choch = "NONE";
  let structure = "RANGE";

  if (
    latestHigh >
    previousHigh &&
    latestLow >
    previousLow
  ) {

    structure = "HH / HL";

  }

  else if (
    latestHigh <
    previousHigh &&
    latestLow <
    previousLow
  ) {

    structure = "LH / LL";

  }

  else if (
    current > latestHigh
  ) {

    bos = "BULLISH";

  }

  else if (
    current < latestLow
  ) {

    bos = "BEARISH";

  }

  return {
    structure,
    bos,
    choch
  };

}


/* =====================================================
   FINAL SIGNAL
===================================================== */

function calculateSignal(data) {

  const d1 = data.D1;
  const h4 = data.H4;
  const h1 = data.H1;
  const m30 = data.M30;
  const m15 = data.M15;
  const m5 = data.M5;

  let bull = 0;
  let bear = 0;

  const list = [
    [d1, 25],
    [h4, 15],
    [h1, 15],
    [m30, 20],
    [m15, 15],
    [m5, 10]
  ];

  for (
    const [d, weight]
    of list
  ) {

    if (!d)
      continue;

    if (
      d.condition ===
      "BULLISH"
    )
      bull += weight;

    if (
      d.condition ===
      "BEARISH"
    )
      bear += weight;

  }

  let signal =
    "WAIT";

  let score =
    Math.max(
      50,
      Math.min(
        79,
        Math.max(
          bull,
          bear
        )
      )
    );

  const bullish =
    bull > bear &&
    d1?.condition === "BULLISH" &&
    h4?.condition === "BULLISH" &&
    h1?.condition === "BULLISH" &&
    m30?.condition === "BULLISH" &&
    m15?.condition === "BULLISH" &&
    m5?.condition === "BULLISH";

  const bearish =
    bear > bull &&
    d1?.condition === "BEARISH" &&
    h4?.condition === "BEARISH" &&
    h1?.condition === "BEARISH" &&
    m30?.condition === "BEARISH" &&
    m15?.condition === "BEARISH" &&
    m5?.condition === "BEARISH";


  if (bullish) {

    signal = "BUY";
    score = Math.max(
      80,
      bull
    );

  }

  else if (bearish) {

    signal = "SELL";
    score = Math.max(
      80,
      bear
    );

  }


  let phase =
    "WAIT — MARKET NOT ALIGNED";

  if (
    m15?.rsi >= 70 &&
    signal === "WAIT"
  ) {

    phase =
      "WAIT — OVERBOUGHT";

  }

  else if (
    m15?.rsi <= 30 &&
    signal === "WAIT"
  ) {

    phase =
      "WAIT — OVERSOLD";

  }

  else if (
    d1?.condition === "BULLISH" &&
    m30?.condition === "BULLISH" &&
    m15?.condition === "BULLISH"
  ) {

    phase =
      "WAIT — BULLISH SETUP / TRIGGER NOT READY";

  }

  else if (
    d1?.condition === "BEARISH" &&
    m30?.condition === "BEARISH" &&
    m15?.condition === "BEARISH"
  ) {

    phase =
      "WAIT — BEARISH SETUP / TRIGGER NOT READY";

  }

  return {
    signal,
    score,
    phase
  };

}


/* =====================================================
   TRADE PLAN
===================================================== */

function makeTradePlan(
  m15,
  signal
) {

  if (
    !m15 ||
    signal.signal === "WAIT"
  ) {

    return {
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      rr: null
    };

  }

  const entry =
    m15.price;

  const atr =
    m15.atr;

  if (!atr)
    return {};

  if (
    signal.signal === "BUY"
  ) {

    const sl =
      Math.min(
        m15.support,
        entry - atr * 1.2
      );

    const risk =
      entry - sl;

    return {

      entry,

      sl,

      tp1:
        entry + risk * 1.5,

      tp2:
        entry + risk * 2.5,

      rr:
        "1 : 2.5"

    };

  }

  if (
    signal.signal === "SELL"
  ) {

    const sl =
      Math.max(
        m15.resistance,
        entry + atr * 1.2
      );

    const risk =
      sl - entry;

    return {

      entry,

      sl,

      tp1:
        entry - risk * 1.5,

      tp2:
        entry - risk * 2.5,

      rr:
        "1 : 2.5"

    };

  }

}
