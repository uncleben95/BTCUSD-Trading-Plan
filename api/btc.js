const TD = "https://api.twelvedata.com";

const API_KEY = process.env.TWELVE_DATA_API_KEY;

const SYMBOL = "BTC/USD";

const TIMEFRAMES = {
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H4: "4h",
  D1: "1day"
};

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

async function td(endpoint, params = {}) {

  const url = new URL(TD + endpoint);

  Object.entries({
    ...params,
    apikey: API_KEY
  }).forEach(([k, v]) => {
    url.searchParams.set(k, v);
  });

  const r = await fetch(url.toString(), {
    cache: "no-store"
  });

  const data = await r.json();

  if (!r.ok || data.status === "error") {
    throw new Error(
      data.message ||
      `Twelve Data HTTP ${r.status}`
    );
  }

  return data;
}

function candles(data) {

  if (!data || !Array.isArray(data.values)) {
    return [];
  }

  return data.values
    .map(x => ({
      datetime: x.datetime,
      open: n(x.open),
      high: n(x.high),
      low: n(x.low),
      close: n(x.close),
      volume: n(x.volume) || 0
    }))
    .reverse();
}

function ema(values, period) {

  if (values.length < period)
    return null;

  const k = 2 / (period + 1);

  let result =
    values
      .slice(0, period)
      .reduce((a, b) => a + b, 0) /
    period;

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    result =
      values[i] * k +
      result * (1 - k);
  }

  return result;
}

function sma(values, period) {

  if (values.length < period)
    return null;

  const a =
    values.slice(-period);

  return (
    a.reduce((x, y) => x + y, 0) /
    period
  );
}

function std(values, period) {

  if (values.length < period)
    return null;

  const a =
    values.slice(-period);

  const mean =
    a.reduce((x, y) => x + y, 0) /
    period;

  return Math.sqrt(
    a.reduce(
      (sum, x) =>
        sum + Math.pow(x - mean, 2),
      0
    ) / period
  );
}

function rsi(values, period = 14) {

  if (values.length < period + 1)
    return null;

  let gain = 0;
  let loss = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {

    const change =
      values[i] - values[i - 1];

    if (change >= 0)
      gain += change;
    else
      loss += Math.abs(change);
  }

  if (loss === 0)
    return 100;

  const rs = gain / loss;

  return 100 - 100 / (1 + rs);
}

function atr(data, period = 14) {

  if (data.length < period + 1)
    return null;

  const tr = [];

  for (let i = 1; i < data.length; i++) {

    const c = data[i];
    const p = data[i - 1];

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  return sma(tr, period);
}

function analyse(data) {

  if (data.length < 60) {

    return {
      condition: "WAIT",
      score: 0
    };

  }

  const close =
    data.map(x => x.close);

  const price =
    close.at(-1);

  const ema20 =
    ema(close, 20);

  const ema50 =
    ema(close, 50);

  const RSI =
    rsi(close);

  const ATR =
    atr(data);

  const middle =
    sma(close, 20);

  const deviation =
    std(close, 20);

  const upper =
    middle !== null &&
    deviation !== null
      ? middle + deviation * 2
      : null;

  const lower =
    middle !== null &&
    deviation !== null
      ? middle - deviation * 2
      : null;

  const volumes =
    data
      .slice(-21)
      .map(x => x.volume);

  const currentVolume =
    volumes.at(-1) || 0;

  const averageVolume =
    sma(
      volumes.slice(0, -1),
      Math.min(
        20,
        volumes.length - 1
      )
    );

  const volumeRatio =
    averageVolume
      ? currentVolume / averageVolume
      : null;

  let bull = 0;
  let bear = 0;

  if (price > ema20)
    bull++;
  else
    bear++;

  if (ema20 > ema50)
    bull += 2;
  else
    bear += 2;

  if (RSI !== null) {

    if (RSI > 50 && RSI < 70)
      bull++;

    if (RSI < 50 && RSI > 30)
      bear++;

  }

  if (
    volumeRatio !== null &&
    volumeRatio >= 1.2
  ) {

    if (price > ema20)
      bull++;

    else
      bear++;

  }

  const total =
    bull + bear;

  let condition = "WAIT";
  let score = 0;

  if (bull > bear) {

    condition = "BULLISH";

    score =
      Math.round(
        bull / total * 100
      );

  }

  else if (bear > bull) {

    condition = "BEARISH";

    score =
      Math.round(
        bear / total * 100
      );

  }

  let phase = "RANGING";

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

  const recent =
    data.slice(-20);

  const resistance =
    Math.max(
      ...recent.map(x => x.high)
    );

  const support =
    Math.min(
      ...recent.map(x => x.low)
    );

  let structure = "NEUTRAL";

  if (price > ema20 && ema20 > ema50)
    structure = "HH / HL BIAS";

  else if (
    price < ema20 &&
    ema20 < ema50
  )
    structure = "LH / LL BIAS";

  let bos = "NONE";
  let choch = "NONE";

  if (price > resistance)
    bos = "BULLISH";

  if (price < support)
    bos = "BEARISH";

  if (
    ema20 > ema50 &&
    price < ema20
  )
    choch = "BEARISH";

  if (
    ema20 < ema50 &&
    price > ema20
  )
    choch = "BULLISH";

  let bbPosition = "MIDDLE";

  if (
    upper !== null &&
    price >= upper
  )
    bbPosition = "UPPER";

  else if (
    lower !== null &&
    price <= lower
  )
    bbPosition = "LOWER";

  let volumeState = "NORMAL";

  if (volumeRatio >= 2)
    volumeState = "VERY HIGH";

  else if (volumeRatio >= 1.2)
    volumeState = "HIGH";

  else if (volumeRatio < 0.8)
    volumeState = "LOW";

  return {

    condition,
    score,

    price,

    phase,

    ema20,
    ema50,

    rsi: RSI,
    atr: ATR,

    volume: {
      current: currentVolume,
      average: averageVolume,
      ratio: volumeRatio,
      state: volumeState
    },

    bb: {
      upper,
      middle,
      lower,
      position: bbPosition
    },

    resistance,
    support,

    structure,
    bos,
    choch

  };

}

function tradePlan(a) {

  if (!a.price || !a.atr)
    return {
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      rr: null
    };

  const risk =
    a.atr * 1.2;

  if (
    a.condition === "BULLISH" &&
    a.score >= 70
  ) {

    return {

      entry: a.price,

      sl:
        a.price - risk,

      tp1:
        a.price + risk * 1.5,

      tp2:
        a.price + risk * 2.5,

      rr: "1:1.5 / 1:2.5"

    };

  }

  if (
    a.condition === "BEARISH" &&
    a.score >= 70
  ) {

    return {

      entry: a.price,

      sl:
        a.price + risk,

      tp1:
        a.price - risk * 1.5,

      tp2:
        a.price - risk * 2.5,

      rr: "1:1.5 / 1:2.5"

    };

  }

  return {

    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    rr: null

  };

}

async function getSeries(interval) {

  const data =
    await td(
      "/time_series",
      {
        symbol: SYMBOL,
        interval,
        outputsize: 200
      }
    );

  return candles(data);

}

module.exports = async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "s-maxage=10, stale-while-revalidate=30"
  );

  try {

    if (!API_KEY) {

      return res.status(500).json({

        ok: false,

        error:
          "TWELVE_DATA_API_KEY missing"

      });

    }

    /*
      One batch request for all
      timeframes.
    */

    const [
      quote,
      m15,
      m30,
      h1,
      h4,
      d1
    ] = await Promise.all([

      td(
        "/quote",
        {
          symbol: SYMBOL
        }
      ),

      getSeries(
        TIMEFRAMES.M15
      ),

      getSeries(
        TIMEFRAMES.M30
      ),

      getSeries(
        TIMEFRAMES.H1
      ),

      getSeries(
        TIMEFRAMES.H4
      ),

      getSeries(
        TIMEFRAMES.D1
      )

    ]);

    const datasets = {

      M15: m15,
      M30: m30,
      H1: h1,
      H4: h4,
      D1: d1

    };

    const analysis = {};

    for (
      const [tf, data]
      of Object.entries(datasets)
    ) {

      analysis[tf] =
        analyse(data);

    }

    const main =
      analysis.M15;

    const signal =
      main.condition === "BULLISH" &&
      main.score >= 70

        ? "BUY"

        : main.condition === "BEARISH" &&
          main.score >= 70

        ? "SELL"

        : "WAIT";

    const trade =
      tradePlan(main);

    const price =
      n(
        quote.close
      );

    const previousClose =
      n(
        quote.previous_close
      );

    const change =
      n(
        quote.percent_change
      );

    const changeAmount =
      price !== null &&
      previousClose !== null

        ? price - previousClose

        : null;

    const latest =
      m15.at(-1);

    const market = {

      price,

      change,

      changeAmount,

      high:
        n(quote.high),

      low:
        n(quote.low),

      volume:
        n(quote.volume),

      orderBook: {

        bidVolume: null,
        askVolume: null,
        imbalance: null,
        pressure:
          "NOT PROVIDED BY TWELVE DATA"

      }

    };

    res.status(200).json({

      ok: true,

      source:
        "Twelve Data",

      symbol:
        SYMBOL,

      updated:
        new Date().toISOString(),

      price,

      change,

      changeAmount,

      high:
        n(quote.high),

      low:
        n(quote.low),

      volume:
        n(quote.volume),

      signal,

      score:
        main.score,

      phase:
        main.phase,

      trade,

      timeframes:
        analysis,

      market,

      whale: {

        whaleProxy: {

          largeTrades: null,

          buyValue: null,

          sellValue: null,

          bias:
            "NOT AVAILABLE FROM TWELVE DATA"

        },

        futures: {

          fundingRate: null,

          openInterest: null,

          markPrice: price

        }

      },

      latestCandle: latest

    });

  }

  catch (error) {

    console.error(
      "Twelve Data BTC ERROR:",
      error
    );

    res.status(500).json({

      ok: false,

      error:
        "BTC candle data unavailable",

      detail:
        error.message

    });

  }

};
