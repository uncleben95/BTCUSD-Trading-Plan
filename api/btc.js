// =====================================================
// BTCUSD - TECHNICAL ENGINE
// Public Coinbase Market Data
// M15 / M30 / H1 / H4 / D1
// =====================================================

export default async function handler(req, res) {

  try {

    const timeframes = {
      M15: 900,
      M30: 1800,
      H1: 3600,
      H4: 14400,
      D1: 86400
    };

    const results = {};

    for (const [tf, granularity] of Object.entries(timeframes)) {

      const url =
        `https://api.exchange.coinbase.com/products/BTC-USD/candles` +
        `?granularity=${granularity}`;

      const response = await fetch(url, {
        headers: {
          "Accept": "application/json"
        },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Coinbase ${tf} HTTP ${response.status}`);
      }

      const raw = await response.json();

      if (!Array.isArray(raw) || raw.length < 60) {
        throw new Error(`Not enough ${tf} candles`);
      }

      // Coinbase:
      // [time, low, high, open, close, volume]

      const candles = raw
        .map(c => ({
          time: Number(c[0]),
          low: Number(c[1]),
          high: Number(c[2]),
          open: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5])
        }))
        .filter(c =>
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close) &&
          Number.isFinite(c.volume)
        )
        .sort((a, b) => a.time - b.time);

      results[tf] = calculate(candles);

    }

    const price =
      results.M15.price;

    const signal =
      buildSignal(results);

    const score =
      signal.score;

    const atr =
      results.M15.atr;

    let trade = null;

    if (
      signal.signal !== "WAIT" &&
      Number.isFinite(price) &&
      Number.isFinite(atr)
    ) {

      const risk =
        atr * 1.25;

      const reward1 =
        risk * 1.5;

      const reward2 =
        risk * 2.5;

      if (signal.signal === "BUY") {

        trade = {
          entry: price,
          sl: price - risk,
          tp1: price + reward1,
          tp2: price + reward2,
          rr: "1:1.5 / 1:2.5"
        };

      } else {

        trade = {
          entry: price,
          sl: price + risk,
          tp1: price - reward1,
          tp2: price - reward2,
          rr: "1:1.5 / 1:2.5"
        };

      }

    }

    res.status(200).json({

      ok: true,

      source: "Coinbase Public Market Data",

      price,

      signal: signal.signal,

      score,

      phase:
        results.M15.phase,

      trade,

      timeframes: {

        D1: results.D1,

        H4: results.H4,

        H1: results.H1,

        M30: results.M30,

        M15: results.M15,

        M5: results.M15

      },

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({

      ok: false,

      error:
        error.message ||
        "BTC technical data unavailable"

    });

  }

}


// =====================================================
// CALCULATIONS
// =====================================================

function calculate(candles) {

  const closes =
    candles.map(c => c.close);

  const highs =
    candles.map(c => c.high);

  const lows =
    candles.map(c => c.low);

  const volumes =
    candles.map(c => c.volume);

  const price =
    closes[closes.length - 1];

  const ema20 =
    EMA(closes, 20);

  const ema50 =
    EMA(closes, 50);

  const rsi =
    RSI(closes, 14);

  const atr =
    ATR(candles, 14);

  const bb =
    Bollinger(closes, 20, 2);

  const currentVolume =
    volumes[volumes.length - 1];

  const avgVolume =
    average(
      volumes.slice(-21, -1)
    );

  const volumeRatio =
    avgVolume > 0
      ? currentVolume / avgVolume
      : 1;

  const resistance =
    Math.max(
      ...highs.slice(-20)
    );

  const support =
    Math.min(
      ...lows.slice(-20)
    );

  const structure =
    price > ema20 && ema20 > ema50
      ? "BULLISH"
      : price < ema20 && ema20 < ema50
      ? "BEARISH"
      : "RANGE";

  const bos =
    price > resistance
      ? "BULLISH BOS"
      : price < support
      ? "BEARISH BOS"
      : "--";

  const previousPrice =
    closes[closes.length - 2];

  const choch =
    structure === "BULLISH" &&
    previousPrice < ema20 &&
    price > ema20
      ? "BULLISH CHOCH"
      : structure === "BEARISH" &&
        previousPrice > ema20 &&
        price < ema20
      ? "BEARISH CHOCH"
      : "--";

  const volatility =
    atr / price * 100;

  let phase = "RANGE";

  if (
    structure === "BULLISH" &&
    volumeRatio >= 1.2
  ) {
    phase = "BULLISH EXPANSION";
  }

  else if (
    structure === "BEARISH" &&
    volumeRatio >= 1.2
  ) {
    phase = "BEARISH EXPANSION";
  }

  else if (
    volumeRatio < 0.8
  ) {
    phase = "LOW VOLUME";
  }

  else if (
    structure === "BULLISH"
  ) {
    phase = "BULLISH TREND";
  }

  else if (
    structure === "BEARISH"
  ) {
    phase = "BEARISH TREND";
  }

  return {

    price,

    ema20,

    ema50,

    rsi,

    atr,

    volume: {
      current: currentVolume,
      average: avgVolume,
      ratio: volumeRatio,
      state:
        volumeRatio >= 1.5
          ? "HIGH"
          : volumeRatio <= 0.7
          ? "LOW"
          : "NORMAL"
    },

    bb,

    resistance,

    support,

    structure,

    bos,

    choch,

    volatility,

    phase,

    condition:
      structure,

    score:
      localScore(
        price,
        ema20,
        ema50,
        rsi,
        volumeRatio
      )

  };

}


// =====================================================
// SIGNAL ENGINE
// =====================================================

function buildSignal(tf) {

  const m15 =
    tf.M15;

  const h1 =
    tf.H1;

  const h4 =
    tf.H4;

  let score = 50;

  if (
    m15.price >
    m15.ema20
  ) score += 8;
  else score -= 8;

  if (
    m15.ema20 >
    m15.ema50
  ) score += 8;
  else score -= 8;

  if (
    h1.price >
    h1.ema20
  ) score += 8;
  else score -= 8;

  if (
    h4.price >
    h4.ema20
  ) score += 6;
  else score -= 6;

  if (
    m15.rsi >= 50 &&
    m15.rsi < 70
  ) score += 7;

  if (
    m15.rsi <= 50 &&
    m15.rsi > 30
  ) score -= 7;

  if (
    m15.volume.ratio >= 1.2
  ) {

    if (
      m15.price >
      m15.ema20
    ) score += 6;
    else score -= 6;

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
    score >= 70 &&
    m15.price > m15.ema20 &&
    m15.ema20 > m15.ema50
  ) {

    signal = "BUY";

  }

  else if (
    score <= 30 &&
    m15.price < m15.ema20 &&
    m15.ema20 < m15.ema50
  ) {

    signal = "SELL";

  }

  return {
    signal,
    score
  };

}


// =====================================================
// INDICATORS
// =====================================================

function EMA(values, period) {

  if (values.length < period)
    return NaN;

  const k =
    2 / (period + 1);

  let ema =
    average(
      values.slice(
        0,
        period
      )
    );

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    ema =
      values[i] * k +
      ema * (1 - k);

  }

  return ema;

}


function RSI(values, period) {

  if (
    values.length <
    period + 1
  )
    return NaN;

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
      Math.max(
        diff,
        0
      );

    const loss =
      Math.max(
        -diff,
        0
      );

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

  return 100 -
    100 / (1 + rs);

}


function ATR(candles, period) {

  if (
    candles.length <
    period + 1
  )
    return NaN;

  const trs = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];

    const tr =
      Math.max(
        c.high - c.low,
        Math.abs(
          c.high - p.close
        ),
        Math.abs(
          c.low - p.close
        )
      );

    trs.push(tr);

  }

  return average(
    trs.slice(-period)
  );

}


function Bollinger(
  values,
  period,
  multiplier
) {

  const slice =
    values.slice(-period);

  const middle =
    average(slice);

  const variance =
    average(
      slice.map(
        v =>
          Math.pow(
            v - middle,
            2
          )
      )
    );

  const sd =
    Math.sqrt(variance);

  const upper =
    middle +
    multiplier * sd;

  const lower =
    middle -
    multiplier * sd;

  const price =
    values[values.length - 1];

  let position =
    "MIDDLE";

  if (
    price >= upper
  )
    position = "UPPER";

  else if (
    price <= lower
  )
    position = "LOWER";

  return {
    upper,
    middle,
    lower,
    position
  };

}


function average(values) {

  if (!values.length)
    return 0;

  return values.reduce(
    (a, b) => a + b,
    0
  ) / values.length;

}


function localScore(
  price,
  ema20,
  ema50,
  rsi,
  volumeRatio
) {

  let score = 50;

  if (price > ema20)
    score += 10;
  else
    score -= 10;

  if (ema20 > ema50)
    score += 10;
  else
    score -= 10;

  if (rsi > 50)
    score += 10;
  else
    score -= 10;

  if (volumeRatio > 1.2)
    score += 10;

  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}
