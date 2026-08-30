const BASE = "https://api.gemini.com";
const SYMBOL = "BTCUSD";

const TIMEFRAMES = {
  D1: "1d",
  H4: "6h",
  H1: "1h",
  M30: "30m",
  M15: "15m",
  M5: "5m"
};

export default async function handler(req, res) {

  res.setHeader("Cache-Control", "no-store");

  try {

    const [
      ticker,
      orderbook,
      ...candleResults
    ] = await Promise.all([

      getTicker(),

      getOrderBook(),

      ...Object.values(TIMEFRAMES).map(
        tf => getCandles(tf)
      )

    ]);

    const names =
      Object.keys(TIMEFRAMES);

    const timeframes = {};

    names.forEach((name, i) => {

      timeframes[name] =
        calculate(
          candleResults[i]
        );

    });

    /*
      Use Gemini ticker as the
      freshest current BTC price.
    */

    const livePrice =
      Number(ticker.close);

    /*
      Make M15 use live ticker price
      instead of waiting for candle close.
    */

    if (
      timeframes.M15 &&
      Number.isFinite(livePrice)
    ) {

      timeframes.M15.price =
        livePrice;

    }

    const m15 =
      timeframes.M15;

    const signalResult =
      calculateSignal(
        timeframes
      );

    const trade =
      makeTradePlan(
        signalResult.signal,
        m15.price,
        m15.atr
      );

    const orderFlow =
      calculateOrderFlow(
        orderbook
      );

    return res.status(200).json({

      ok: true,

      source:
        "Gemini Public Market Data",

      symbol:
        SYMBOL,

      price:
        livePrice,

      signal:
        signalResult.signal,

      score:
        signalResult.score,

      phase:
        m15.phase,

      trade,

      timeframes,

      market: {

        high:
          Number(ticker.high),

        low:
          Number(ticker.low),

        open:
          Number(ticker.open),

        change:
          calculateChange(
            ticker
          ),

        bid:
          Number(ticker.bid),

        ask:
          Number(ticker.ask),

        volume:
          Number(
            ticker.volume?.BTC || 0
          )

      },

      orderBook:
        orderFlow,

      updated:
        new Date().toISOString()

    });

  }

  catch (error) {

    console.error(
      "BTC API ERROR:",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        error.message ||
        "BTC candle data unavailable"

    });

  }

}


/* =========================================================
   GEMINI TICKER
========================================================= */

async function getTicker() {

  const response =
    await fetch(
      `${BASE}/v2/ticker/${SYMBOL}`,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {

    throw new Error(
      `Gemini ticker HTTP ${response.status}`
    );

  }

  const data =
    await response.json();

  if (
    !data ||
    !data.close
  ) {

    throw new Error(
      "Gemini ticker unavailable"
    );

  }

  return data;

}


/* =========================================================
   GEMINI ORDER BOOK
========================================================= */

async function getOrderBook() {

  const response =
    await fetch(
      `${BASE}/v1/book/${SYMBOL}?limit_bids=50&limit_asks=50`,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {

    throw new Error(
      `Gemini order book HTTP ${response.status}`
    );

  }

  return response.json();

}


/* =========================================================
   GEMINI CANDLES
========================================================= */

async function getCandles(
  timeframe
) {

  const url =
    `${BASE}/v2/candles/${SYMBOL}/${timeframe}`;

  const response =
    await fetch(
      url,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {

    throw new Error(
      `Gemini ${timeframe} HTTP ${response.status}`
    );

  }

  const data =
    await response.json();

  if (
    !Array.isArray(data) ||
    data.length < 60
  ) {

    throw new Error(
      `Not enough Gemini ${timeframe} candles`
    );

  }

  /*
    Gemini returns:

    [
      timestamp,
      open,
      high,
      low,
      close,
      volume
    ]

    Newest candles are normally first,
    so sort oldest -> newest.
  */

  return data

    .map(c => ({

      time:
        Number(c[0]),

      open:
        Number(c[1]),

      high:
        Number(c[2]),

      low:
        Number(c[3]),

      close:
        Number(c[4]),

      volume:
        Number(c[5])

    }))

    .sort(
      (a, b) =>
        a.time - b.time
    );

}


/* =========================================================
   TECHNICAL CALCULATION
========================================================= */

function calculate(
  candles
) {

  const closes =
    candles.map(
      c => c.close
    );

  const highs =
    candles.map(
      c => c.high
    );

  const lows =
    candles.map(
      c => c.low
    );

  const volumes =
    candles.map(
      c => c.volume
    );

  const price =
    closes.at(-1);

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
      20,
      2
    );

  const currentVolume =
    volumes.at(-1);

  const averageVolume =
    mean(
      volumes.slice(
        -21,
        -1
      )
    );

  const volumeRatio =
    averageVolume > 0
      ? currentVolume /
        averageVolume
      : 1;

  const resistance =
    Math.max(
      ...highs.slice(
        -21,
        -1
      )
    );

  const support =
    Math.min(
      ...lows.slice(
        -21,
        -1
      )
    );

  let structure =
    "RANGE";

  if (
    price > ema20 &&
    ema20 > ema50
  ) {

    structure =
      "BULLISH";

  }

  else if (
    price < ema20 &&
    ema20 < ema50
  ) {

    structure =
      "BEARISH";

  }

  const previous =
    closes.at(-2);

  let bos = "--";
  let choch = "--";

  if (
    price > resistance
  ) {

    bos =
      "BULLISH BOS";

  }

  else if (
    price < support
  ) {

    bos =
      "BEARISH BOS";

  }

  if (
    previous < ema20 &&
    price > ema20
  ) {

    choch =
      "BULLISH CHOCH";

  }

  else if (
    previous > ema20 &&
    price < ema20
  ) {

    choch =
      "BEARISH CHOCH";

  }

  let phase =
    "RANGE";

  if (
    volumeRatio >= 1.5 &&
    structure === "BULLISH"
  ) {

    phase =
      "BULLISH EXPANSION";

  }

  else if (
    volumeRatio >= 1.5 &&
    structure === "BEARISH"
  ) {

    phase =
      "BEARISH EXPANSION";

  }

  else if (
    volumeRatio < 0.7
  ) {

    phase =
      "LOW VOLUME";

  }

  else if (
    structure === "BULLISH"
  ) {

    phase =
      "BULLISH TREND";

  }

  else if (
    structure === "BEARISH"
  ) {

    phase =
      "BEARISH TREND";

  }

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
        averageVolume,

      ratio:
        volumeRatio,

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
        ? (
            atr /
            price *
            100
          )
        : 0,

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


/* =========================================================
   SIGNAL ENGINE
========================================================= */

function calculateSignal(
  tf
) {

  const m =
    tf.M15;

  const h =
    tf.H1;

  const q =
    tf.H4;

  let score =
    50;

  if (
    m.price >
    m.ema20
  ) {

    score += 8;

  } else {

    score -= 8;

  }

  if (
    m.ema20 >
    m.ema50
  ) {

    score += 8;

  } else {

    score -= 8;

  }

  if (
    h.price >
    h.ema20
  ) {

    score += 8;

  } else {

    score -= 8;

  }

  if (
    q.price >
    q.ema20
  ) {

    score += 6;

  } else {

    score -= 6;

  }

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
      m.price >
      m.ema20
        ? 6
        : -6;

  }

  score =
    Math.round(
      Math.max(
        0,
        Math.min(
          100,
          score
        )
      )
    );

  let signal =
    "WAIT";

  if (
    score >= 70 &&
    m.price > m.ema20 &&
    m.ema20 > m.ema50
  ) {

    signal =
      "BUY";

  }

  else if (
    score <= 30 &&
    m.price < m.ema20 &&
    m.ema20 < m.ema50
  ) {

    signal =
      "SELL";

  }

  return {

    signal,

    score

  };

}


/* =========================================================
   TRADE PLAN
========================================================= */

function makeTradePlan(
  signal,
  price,
  atr
) {

  if (
    signal === "WAIT" ||
    !Number.isFinite(price) ||
    !Number.isFinite(atr)
  ) {

    return null;

  }

  const risk =
    atr * 1.25;

  const tp1 =
    risk * 1.5;

  const tp2 =
    risk * 2.5;

  if (
    signal === "BUY"
  ) {

    return {

      entry:
        price,

      sl:
        price - risk,

      tp1:
        price + tp1,

      tp2:
        price + tp2,

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
      price - tp1,

    tp2:
      price - tp2,

    rr:
      "1:1.5 / 1:2.5"

  };

}


/* =========================================================
   ORDER FLOW
========================================================= */

function calculateOrderFlow(
  book
) {

  if (
    !book ||
    !Array.isArray(book.bids) ||
    !Array.isArray(book.asks)
  ) {

    return {

      bidVolume: 0,

      askVolume: 0,

      imbalance: 0,

      pressure:
        "UNAVAILABLE"

    };

  }

  const bidVolume =
    book.bids.reduce(
      (sum, item) =>
        sum +
        Number(item.amount || 0),
      0
    );

  const askVolume =
    book.asks.reduce(
      (sum, item) =>
        sum +
        Number(item.amount || 0),
      0
    );

  const total =
    bidVolume +
    askVolume;

  const imbalance =
    total > 0
      ? (
          (
            bidVolume -
            askVolume
          ) /
          total
        ) * 100
      : 0;

  let pressure =
    "BALANCED";

  if (
    imbalance >= 10
  ) {

    pressure =
      "BUY PRESSURE";

  }

  else if (
    imbalance <= -10
  ) {

    pressure =
      "SELL PRESSURE";

  }

  return {

    bidVolume,

    askVolume,

    imbalance,

    pressure

  };

}


/* =========================================================
   24H CHANGE
========================================================= */

function calculateChange(
  ticker
) {

  const open =
    Number(
      ticker.open
    );

  const close =
    Number(
      ticker.close
    );

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open === 0
  ) {

    return 0;

  }

  return (
    (
      close - open
    ) /
    open
  ) * 100;

}


/* =========================================================
   EMA
========================================================= */

function EMA(
  values,
  period
) {

  if (
    values.length < period
  ) {

    return NaN;

  }

  const multiplier =
    2 /
    (period + 1);

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
      (
        values[i] *
        multiplier
      ) +
      (
        ema *
        (
          1 -
          multiplier
        )
      );

  }

  return ema;

}


/* =========================================================
   RSI
========================================================= */

function RSI(
  values,
  period
) {

  if (
    values.length <
    period + 1
  ) {

    return NaN;

  }

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

    if (
      diff >= 0
    ) {

      gain += diff;

    } else {

      loss -= diff;

    }

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

    avgGain =
      (
        avgGain *
        (period - 1) +
        Math.max(
          diff,
          0
        )
      ) /
      period;

    avgLoss =
      (
        avgLoss *
        (period - 1) +
        Math.max(
          -diff,
          0
        )
      ) /
      period;

  }

  if (
    avgLoss === 0
  ) {

    return 100;

  }

  const rs =
    avgGain /
    avgLoss;

  return (
    100 -
    (
      100 /
      (1 + rs)
    )
  );

}


/* =========================================================
   ATR
========================================================= */

function ATR(
  candles,
  period
) {

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
    trs.slice(
      -period
    )
  );

}


/* =========================================================
   BOLLINGER BANDS
========================================================= */

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
    mean(slice);

  const variance =
    mean(
      slice.map(
        value =>
          Math.pow(
            value -
            middle,
            2
          )
      )
    );

  const deviation =
    Math.sqrt(
      variance
    );

  const upper =
    middle +
    (
      multiplier *
      deviation
    );

  const lower =
    middle -
    (
      multiplier *
      deviation
    );

  const price =
    values.at(-1);

  let position =
    "MIDDLE";

  if (
    price >= upper
  ) {

    position =
      "UPPER";

  }

  else if (
    price <= lower
  ) {

    position =
      "LOWER";

  }

  return {

    upper,

    middle,

    lower,

    position

  };

}


/* =========================================================
   LOCAL SCORE
========================================================= */

function localScore(
  price,
  ema20,
  ema50,
  rsi,
  volumeRatio
) {

  let score =
    50;

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


/* =========================================================
   MEAN
========================================================= */

function mean(
  values
) {

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
