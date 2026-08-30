const BASE = "https://data-api.binance.vision";
const SYMBOL = "BTCUSDT";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const t = {
      D1: "1d",
      H4: "4h",
      H1: "1h",
      M30: "30m",
      M15: "15m",
      M5: "5m"
    };

    const timeframes = {};

    await Promise.all(
      Object.entries(t).map(async ([name, interval]) => {
        timeframes[name] = calc(
          await candles(interval, 200)
        );
      })
    );

    const m = timeframes.M15;
    const s = signal(timeframes);

    const price = m.price;
    const atr = m.atr;

    let trade = null;

    if (
      s.signal !== "WAIT" &&
      Number.isFinite(price) &&
      Number.isFinite(atr)
    ) {
      const risk = atr * 1.25;
      const r1 = risk * 1.5;
      const r2 = risk * 2.5;

      if (s.signal === "BUY") {
        trade = {
          entry: price,
          sl: price - risk,
          tp1: price + r1,
          tp2: price + r2,
          rr: "1:1.5 / 1:2.5"
        };
      } else {
        trade = {
          entry: price,
          sl: price + risk,
          tp1: price - r1,
          tp2: price - r2,
          rr: "1:1.5 / 1:2.5"
        };
      }
    }

    return res.status(200).json({
      ok: true,
      source: "Binance Public Market Data",
      symbol: SYMBOL,
      price,
      signal: s.signal,
      score: s.score,
      phase: m.phase,
      trade,
      timeframes,
      updated: new Date().toISOString()
    });

  } catch (e) {

    console.error(e);

    return res.status(500).json({
      ok: false,
      error: e.message || "BTC candle data unavailable"
    });
  }
}


async function candles(interval, limit) {

  const url =
    `${BASE}/api/v3/klines` +
    `?symbol=${SYMBOL}` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const response =
    await fetch(url, {
      cache: "no-store"
    });

  if (!response.ok) {
    throw new Error(
      `Binance ${interval} HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    !Array.isArray(data) ||
    data.length < 60
  ) {
    throw new Error(
      `Not enough ${interval} candles`
    );
  }

  return data.map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  }));
}


function calc(candles) {

  const closes =
    candles.map(x => x.close);

  const highs =
    candles.map(x => x.high);

  const lows =
    candles.map(x => x.low);

  const volumes =
    candles.map(x => x.volume);

  const price =
    closes.at(-1);

  const ema20 =
    EMA(closes, 20);

  const ema50 =
    EMA(closes, 50);

  const rsi =
    RSI(closes, 14);

  const atr =
    ATR(candles, 14);

  const bb =
    BB(closes, 20, 2);

  const currentVolume =
    volumes.at(-1);

  const averageVolume =
    mean(
      volumes.slice(-21, -1)
    );

  const volumeRatio =
    averageVolume > 0
      ? currentVolume / averageVolume
      : 1;

  const resistance =
    Math.max(
      ...highs.slice(-21, -1)
    );

  const support =
    Math.min(
      ...lows.slice(-21, -1)
    );

  const structure =
    price > ema20 &&
    ema20 > ema50
      ? "BULLISH"
      : price < ema20 &&
        ema20 < ema50
      ? "BEARISH"
      : "RANGE";

  const previous =
    closes.at(-2);

  const bos =
    price > resistance
      ? "BULLISH BOS"
      : price < support
      ? "BEARISH BOS"
      : "--";

  const choch =
    structure === "BULLISH" &&
    previous < ema20 &&
    price > ema20
      ? "BULLISH CHOCH"
      : structure === "BEARISH" &&
        previous > ema20 &&
        price < ema20
      ? "BEARISH CHOCH"
      : "--";

  let phase = "RANGE";

  if (
    volumeRatio >= 1.2 &&
    structure === "BULLISH"
  ) {
    phase = "BULLISH EXPANSION";
  }

  else if (
    volumeRatio >= 1.2 &&
    structure === "BEARISH"
  ) {
    phase = "BEARISH EXPANSION";
  }

  else if (
    volumeRatio < 0.8
  ) {
    phase = "LOW VOLUME";
  }

  else if (
    structure !== "RANGE"
  ) {
    phase =
      structure + " TREND";
  }

  return {

    price,

    ema20,

    ema50,

    rsi,

    atr,

    volume: {
      current: currentVolume,
      average: averageVolume,
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

    volatility:
      price > 0
        ? atr / price * 100
        : NaN,

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


function signal(tf) {

  const m =
    tf.M15;

  const h =
    tf.H1;

  const q =
    tf.H4;

  let score = 50;

  score +=
    m.price > m.ema20
      ? 8
      : -8;

  score +=
    m.ema20 > m.ema50
      ? 8
      : -8;

  score +=
    h.price > h.ema20
      ? 8
      : -8;

  score +=
    q.price > q.ema20
      ? 6
      : -6;

  if (
    m.rsi >= 50 &&
    m.rsi < 70
  ) {
    score += 7;
  }

  else if (
    m.rsi <= 50 &&
    m.rsi > 30
  ) {
    score -= 7;
  }

  if (
    m.volume.ratio >= 1.2
  ) {
    score +=
      m.price > m.ema20
        ? 6
        : -6;
  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
    );

  let result = "WAIT";

  if (
    score >= 70 &&
    m.price > m.ema20 &&
    m.ema20 > m.ema50
  ) {
    result = "BUY";
  }

  else if (
    score <= 30 &&
    m.price < m.ema20 &&
    m.ema20 < m.ema50
  ) {
    result = "SELL";
  }

  return {
    score,
    signal: result
  };
}


function EMA(values, period) {

  if (
    values.length < period
  ) {
    return NaN;
  }

  const k =
    2 / (period + 1);

  let ema =
    mean(
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
  ) {
    return NaN;
  }

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

    avgGain =
      (
        avgGain * (period - 1) +
        Math.max(diff, 0)
      ) / period;

    avgLoss =
      (
        avgLoss * (period - 1) +
        Math.max(-diff, 0)
      ) / period;
  }

  if (
    avgLoss === 0
  ) {
    return 100;
  }

  return (
    100 -
    100 /
    (
      1 +
      avgGain / avgLoss
    )
  );
}


function ATR(candles, period) {

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

    trs.push(
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
      )
    );
  }

  return mean(
    trs.slice(-period)
  );
}


function BB(
  values,
  period,
  multiplier
) {

  const slice =
    values.slice(-period);

  const middle =
    mean(slice);

  const variance =
    mean(
      slice.map(
        value =>
          Math.pow(
            value - middle,
            2
          )
      )
    );

  const sd =
    Math.sqrt(
      variance
    );

  const upper =
    middle +
    multiplier * sd;

  const lower =
    middle -
    multiplier * sd;

  const price =
    values.at(-1);

  return {

    upper,

    middle,

    lower,

    position:
      price >= upper
        ? "UPPER"
        : price <= lower
        ? "LOWER"
        : "MIDDLE"
  };
}


function mean(values) {

  if (
    !values.length
  ) {
    return 0;
  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );
}


function localScore(
  price,
  ema20,
  ema50,
  rsi,
  volumeRatio
) {

  let score = 50;

  score +=
    price > ema20
      ? 10
      : -10;

  score +=
    ema20 > ema50
      ? 10
      : -10;

  score +=
    rsi > 50
      ? 10
      : -10;

  if (
    volumeRatio > 1.2
  ) {
    score += 10;
  }

  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );
}
