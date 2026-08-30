export default async function handler(req, res) {

  const KEY = process.env.COINGECKO_API_KEY;

  if (!KEY) {
    return res.status(500).json({
      ok: false,
      error: "COINGECKO_API_KEY missing"
    });
  }

  try {

    const url =
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart" +
      "?vs_currency=usd" +
      "&days=1" +
      "&interval=5m" +
      "&precision=full";

    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "x-cg-demo-api-key": KEY
      }
    });

    if (!response.ok) {

      const text = await response.text();

      return res.status(response.status).json({
        ok: false,
        error: `CoinGecko HTTP ${response.status}`,
        detail: text
      });

    }

    const raw = await response.json();

    if (!raw.prices || raw.prices.length < 30) {

      return res.status(503).json({
        ok: false,
        error: "Insufficient BTC historical data"
      });

    }

    const candles = buildCandles(
      raw.prices,
      raw.total_volumes || []
    );

    const m15 = candles.M15;
    const m30 = candles.M30;
    const h1  = candles.H1;
    const h4  = candles.H4;
    const d1  = candles.D1;

    const price =
      Number(raw.prices.at(-1)?.[1]);

    const result = {

      ok: true,

      source: "CoinGecko",

      price,

      signal: "WAIT",

      score: 0,

      phase: "ANALYSING",

      trade: {
        entry: null,
        sl: null,
        tp1: null,
        tp2: null,
        rr: null
      },

      timeframes: {

        D1: analyse(d1),
        H4: analyse(h4),
        H1: analyse(h1),
        M30: analyse(m30),
        M15: analyse(m15),

        M5: {
          condition: "DATA SOURCE",
          score: "--"
        }

      },

      updated:
        new Date().toISOString()

    };

    const analysis =
      analyse(m15);

    result.timeframes.M15 =
      analysis;

    result.signal =
      generateSignal(
        analysis,
        price
      );

    result.score =
      analysis.score;

    result.phase =
      analysis.phase;

    result.trade =
      buildTradePlan(
        price,
        analysis
      );

    return res.status(200).json(result);

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "BTC API failed",
      detail: error.message
    });

  }

}


/* =====================================================
   BUILD TIMEFRAME CANDLES
===================================================== */

function buildCandles(
  prices,
  volumes
) {

  const result = {

    M15: [],
    M30: [],
    H1: [],
    H4: [],
    D1: []

  };

  const volumeMap =
    new Map(
      volumes.map(v => [
        v[0],
        Number(v[1])
      ])
    );

  for (
    const p of prices
  ) {

    const ts =
      Number(p[0]);

    const close =
      Number(p[1]);

    const volume =
      findVolume(
        ts,
        volumeMap
      );

    addCandle(
      result.M15,
      ts,
      close,
      volume,
      15
    );

    addCandle(
      result.M30,
      ts,
      close,
      volume,
      30
    );

    addCandle(
      result.H1,
      ts,
      close,
      volume,
      60
    );

    addCandle(
      result.H4,
      ts,
      close,
      volume,
      240
    );

    addCandle(
      result.D1,
      ts,
      close,
      volume,
      1440
    );

  }

  return result;

}


/* =====================================================
   AGGREGATE
===================================================== */

function addCandle(
  array,
  timestamp,
  price,
  volume,
  minutes
) {

  const bucket =
    Math.floor(
      timestamp /
      (minutes * 60000)
    ) *
    (minutes * 60000);

  let candle =
    array.at(-1);

  if (
    !candle ||
    candle.time !== bucket
  ) {

    candle = {

      time: bucket,

      open: price,
      high: price,
      low: price,
      close: price,

      volume: volume || 0

    };

    array.push(candle);

  } else {

    candle.high =
      Math.max(
        candle.high,
        price
      );

    candle.low =
      Math.min(
        candle.low,
        price
      );

    candle.close =
      price;

    candle.volume +=
      volume || 0;

  }

}


/* =====================================================
   VOLUME LOOKUP
===================================================== */

function findVolume(
  timestamp,
  map
) {

  if (map.has(timestamp))
    return map.get(timestamp);

  let closest = null;

  for (
    const [ts, value]
    of map
  ) {

    if (
      Math.abs(
        ts - timestamp
      ) < 180000
    ) {

      closest = value;
      break;

    }

  }

  return closest || 0;

}


/* =====================================================
   TECHNICAL ANALYSIS
===================================================== */

function analyse(candles) {

  if (!candles ||
      candles.length < 20) {

    return {

      condition: "WAIT",
      score: 0,
      phase: "INSUFFICIENT DATA"

    };

  }

  const closes =
    candles.map(
      x => x.close
    );

  const volumes =
    candles.map(
      x => x.volume
    );

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
    Bollinger(
      closes,
      20,
      2
    );

  const currentVolume =
    volumes.at(-1);

  const avgVolume =
    average(
      volumes.slice(-20)
    );

  const volumeRatio =
    avgVolume > 0
      ? currentVolume / avgVolume
      : 0;

  let score = 50;

  if (price > ema20)
    score += 10;
  else
    score -= 10;

  if (ema20 > ema50)
    score += 15;
  else
    score -= 15;

  if (rsi > 55)
    score += 10;

  if (rsi < 45)
    score -= 10;

  if (volumeRatio > 1.2) {

    if (price > ema20)
      score += 10;
    else
      score -= 10;

  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
    );

  let condition =
    "NEUTRAL";

  if (score >= 65)
    condition =
      "BULLISH";

  else if (score <= 35)
    condition =
      "BEARISH";

  let phase =
    "RANGING";

  if (
    price > ema20 &&
    ema20 > ema50
  )
    phase =
      "UPTREND";

  else if (
    price < ema20 &&
    ema20 < ema50
  )
    phase =
      "DOWNTREND";

  return {

    price,

    ema20,
    ema50,

    rsi,

    atr,

    volume: {

      current:
        currentVolume,

      average:
        avgVolume,

      ratio:
        volumeRatio,

      state:
        volumeRatio >= 1.5
          ? "HIGH"
          : volumeRatio >= 1
          ? "NORMAL"
          : "LOW"

    },

    bb,

    resistance:
      Math.max(
        ...candles
          .slice(-20)
          .map(x => x.high)
      ),

    support:
      Math.min(
        ...candles
          .slice(-20)
          .map(x => x.low)
      ),

    structure:
      condition,

    bos:
      "MONITOR",

    choch:
      "MONITOR",

    condition,

    score,

    phase

  };

}


/* =====================================================
   EMA
===================================================== */

function EMA(
  values,
  period
) {

  if (
    values.length <
    period
  )
    return values.at(-1);

  const multiplier =
    2 /
    (period + 1);

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
      (
        values[i] -
        ema
      ) *
      multiplier +
      ema;

  }

  return ema;

}


/* =====================================================
   RSI
===================================================== */

function RSI(
  values,
  period
) {

  if (
    values.length <= period
  )
    return 50;

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

    if (diff >= 0)
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

  if (avgLoss === 0)
    return 100;

  const rs =
    avgGain /
    avgLoss;

  return 100 -
    (100 / (1 + rs));

}


/* =====================================================
   ATR
===================================================== */

function ATR(
  candles,
  period
) {

  if (
    candles.length <
    period + 1
  )
    return 0;

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

    trs.push(
      Math.max(

        c.high -
        c.low,

        Math.abs(
          c.high -
          p.close
        ),

        Math.abs(
          c.low -
          p.close
        )

      )
    );

  }

  return average(
    trs.slice(-period)
  );

}


/* =====================================================
   BOLLINGER
===================================================== */

function Bollinger(
  values,
  period,
  multiplier
) {

  const slice =
    values.slice(
      -period
    );

  const middle =
    average(slice);

  const variance =
    average(
      slice.map(
        x =>
          Math.pow(
            x - middle,
            2
          )
      )
    );

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


/* =====================================================
   SIGNAL
===================================================== */

function generateSignal(
  analysis,
  price
) {

  if (
    analysis.score >= 75 &&
    price > analysis.ema20
  )
    return "BUY";

  if (
    analysis.score <= 25 &&
    price < analysis.ema20
  )
    return "SELL";

  return "WAIT";

}


/* =====================================================
   TRADE PLAN
===================================================== */

function buildTradePlan(
  price,
  analysis
) {

  if (
    analysis.score < 65 &&
    analysis.score > 35
  ) {

    return {

      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      rr: null

    };

  }

  const atr =
    analysis.atr;

  if (
    !Number.isFinite(atr) ||
    atr <= 0
  )
    return {};

  if (
    analysis.score >= 65
  ) {

    const sl =
      price -
      atr * 1.5;

    const tp1 =
      price +
      atr * 1.5;

    const tp2 =
      price +
      atr * 3;

    return {

      entry: price,
      sl,
      tp1,
      tp2,
      rr: "1:1 → 1:2"

    };

  }

  if (
    analysis.score <= 35
  ) {

    const sl =
      price +
      atr * 1.5;

    const tp1 =
      price -
      atr * 1.5;

    const tp2 =
      price -
      atr * 3;

    return {

      entry: price,
      sl,
      tp1,
      tp2,
      rr: "1:1 → 1:2"

    };

  }

}


/* =====================================================
   HELPERS
===================================================== */

function average(
  arr
) {

  if (!arr.length)
    return 0;

  return arr.reduce(
    (a,b) => a + b,
    0
  ) / arr.length;

}
