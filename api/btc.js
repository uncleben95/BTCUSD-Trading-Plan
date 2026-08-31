export default async function handler(req, res) {
  try {

    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "TWELVE_DATA_API_KEY missing"
      });
    }

    // =====================================================
    // TWELVE DATA
    // XAU ENGINE:
    // 3000 x M5 candles
    // =====================================================

    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=BTC/USD" +
      "&interval=5min" +
      "&outputsize=3000" +
      "&order=ASC" +
      "&apikey=" +
      encodeURIComponent(API_KEY);

    const response = await fetch(url, {
      cache: "no-store"
    });

    let data;

    try {
      data = await response.json();
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Twelve Data returned invalid JSON"
      });
    }

    if (!response.ok || data.status === "error") {
      return res.status(502).json({
        ok: false,
        error:
          data.message ||
          "Twelve Data API error",
        code:
          data.code ||
          response.status
      });
    }

    if (
      !Array.isArray(data.values) ||
      data.values.length === 0
    ) {
      return res.status(502).json({
        ok: false,
        error: "BTC candle data unavailable"
      });
    }

    // =====================================================
    // NORMALISE
    // =====================================================

    const candles = data.values
      .map(c => ({
        time: c.datetime,

        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),

        volume:
          c.volume !== undefined &&
          Number.isFinite(Number(c.volume))
            ? Number(c.volume)
            : 0
      }))

      .filter(c =>
        c.time &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&

        c.high >= c.low &&
        c.high >= c.open &&
        c.high >= c.close &&
        c.low <= c.open &&
        c.low <= c.close
      )

      .sort(
        (a, b) =>
          new Date(a.time).getTime() -
          new Date(b.time).getTime()
      );

    if (candles.length < 250) {
      return res.status(422).json({
        ok: false,
        error: "BTC candle data tidak mencukupi",
        count: candles.length
      });
    }

    // =====================================================
    // HELPERS
    // =====================================================

    const avg = arr =>
      arr.length
        ? arr.reduce((a, b) => a + b, 0) / arr.length
        : null;


    function ema(values, period) {

      if (values.length < period)
        return null;

      const k =
        2 / (period + 1);

      let value =
        avg(
          values.slice(0, period)
        );

      for (
        let i = period;
        i < values.length;
        i++
      ) {

        value =
          values[i] * k +
          value * (1 - k);
      }

      return value;
    }


    function sma(values, period) {

      if (values.length < period)
        return null;

      return avg(
        values.slice(-period)
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
          values[i] -
          values[i - 1];

        if (change > 0)
          gain += change;

        if (change < 0)
          loss -= change;
      }

      if (loss === 0)
        return 100;

      const rs =
        (gain / period) /
        (loss / period);

      return (
        100 -
        100 / (1 + rs)
      );
    }


    function atr(data, period = 14) {

      if (data.length < period + 1)
        return null;

      const trs = [];

      for (
        let i = 1;
        i < data.length;
        i++
      ) {

        const h = data[i].high;
        const l = data[i].low;
        const pc =
          data[i - 1].close;

        trs.push(
          Math.max(
            h - l,
            Math.abs(h - pc),
            Math.abs(l - pc)
          )
        );
      }

      return avg(
        trs.slice(-period)
      );
    }


    function macd(values) {

      if (values.length < 35)
        return null;

      const lineValues = [];

      for (
        let i = 26;
        i <= values.length;
        i++
      ) {

        const slice =
          values.slice(0, i);

        const e12 =
          ema(slice, 12);

        const e26 =
          ema(slice, 26);

        if (
          e12 !== null &&
          e26 !== null
        ) {

          lineValues.push(
            e12 - e26
          );
        }
      }

      const line =
        lineValues.at(-1);

      const signal =
        ema(lineValues, 9);

      if (line === undefined)
        return null;

      return {
        line,
        signal,

        bullish:
          signal !== null &&
          line > signal,

        bearish:
          signal !== null &&
          line < signal
      };
    }


    function adx(data, period = 14) {

      if (
        data.length <
        period * 2 + 2
      )
        return null;

      const trs = [];
      const plusDM = [];
      const minusDM = [];

      for (
        let i = 1;
        i < data.length;
        i++
      ) {

        const h =
          data[i].high;

        const l =
          data[i].low;

        const ph =
          data[i - 1].high;

        const pl =
          data[i - 1].low;

        const pc =
          data[i - 1].close;

        trs.push(
          Math.max(
            h - l,
            Math.abs(h - pc),
            Math.abs(l - pc)
          )
        );

        const up =
          h - ph;

        const down =
          pl - l;

        plusDM.push(
          up > down && up > 0
            ? up
            : 0
        );

        minusDM.push(
          down > up && down > 0
            ? down
            : 0
        );
      }

      const tr =
        avg(
          trs.slice(-period)
        );

      const plus =
        avg(
          plusDM.slice(-period)
        );

      const minus =
        avg(
          minusDM.slice(-period)
        );

      if (!tr)
        return null;

      const plusDI =
        100 * plus / tr;

      const minusDI =
        100 * minus / tr;

      const value =
        100 *
        Math.abs(
          plusDI - minusDI
        ) /
        (
          plusDI +
          minusDI ||
          1
        );

      return {
        value,

        bullish:
          plusDI > minusDI,

        bearish:
          minusDI > plusDI
      };
    }


    // =====================================================
    // AGGREGATE
    // =====================================================

    function aggregate(
      data,
      minutes
    ) {

      const buckets = {};

      data.forEach(c => {

        const time =
          new Date(c.time)
            .getTime();

        const size =
          minutes *
          60 *
          1000;

        const key =
          Math.floor(
            time / size
          ) * size;

        if (!buckets[key]) {

          buckets[key] = {

            time:
              new Date(key)
                .toISOString(),

            open:
              c.open,

            high:
              c.high,

            low:
              c.low,

            close:
              c.close,

            volume:
              c.volume
          };

        } else {

          buckets[key].high =
            Math.max(
              buckets[key].high,
              c.high
            );

          buckets[key].low =
            Math.min(
              buckets[key].low,
              c.low
            );

          buckets[key].close =
            c.close;

          buckets[key].volume +=
            c.volume;
        }
      });

      return Object.keys(buckets)
        .sort(
          (a, b) =>
            Number(a) -
            Number(b)
        )
        .map(
          k =>
            buckets[k]
        );
    }


    function swingHigh(
      data,
      lookback = 30
    ) {

      const recent =
        data.slice(-lookback);

      return Math.max(
        ...recent.map(
          c => c.high
        )
      );
    }


    function swingLow(
      data,
      lookback = 30
    ) {

      const recent =
        data.slice(-lookback);

      return Math.min(
        ...recent.map(
          c => c.low
        )
      );
    }


    function bollinger(
      values,
      period = 20
    ) {

      if (
        values.length <
        period
      )
        return null;

      const slice =
        values.slice(-period);

      const middle =
        avg(slice);

      const variance =
        slice.reduce(
          (sum, v) =>
            sum +
            Math.pow(
              v - middle,
              2
            ),
          0
        ) / period;

      const sd =
        Math.sqrt(variance);

      return {

        upper:
          middle + sd * 2,

        middle,

        lower:
          middle - sd * 2
      };
    }


    function volumeStats(data) {

      const current =
        data.at(-1)?.volume || 0;

      const previous =
        data
          .slice(-21, -1)
          .map(
            c =>
              c.volume || 0
          );

      const average =
        previous.length
          ? avg(previous)
          : 0;

      const ratio =
        average > 0
          ? current / average
          : 0;

      let state =
        "NORMAL";

      if (ratio >= 2)
        state = "VERY HIGH";

      else if (ratio >= 1.3)
        state = "HIGH";

      else if (ratio < 0.7)
        state = "LOW";

      return {
        current,
        average,
        ratio,
        state
      };
    }


    // =====================================================
    // TIMEFRAMES
    // =====================================================

    const m5 =
      candles;

    const m15 =
      aggregate(
        candles,
        15
      );

    const h1 =
      aggregate(
        candles,
        60
      );

    const h4 =
      aggregate(
        candles,
        240
      );

    const d1 =
      aggregate(
        candles,
        1440
      );


    const c5 =
      m5.map(
        c => c.close
      );

    const c15 =
      m15.map(
        c => c.close
      );

    const c1 =
      h1.map(
        c => c.close
      );

    const c4 =
      h4.map(
        c => c.close
      );

    const cd1 =
      d1.map(
        c => c.close
      );


    const price =
      c5.at(-1);


    // =====================================================
    // INDICATORS
    // =====================================================

    const h1EMA200 =
      ema(c1, 200);

    const h1EMA50 =
      ema(c1, 50);


    const m15EMA20 =
      ema(c15, 20);

    const m15EMA50 =
      ema(c15, 50);

    const m15RSI =
      rsi(c15);

    const m15MACD =
      macd(c15);

    const m15ADX =
      adx(m15);


    const m5EMA20 =
      ema(c5, 20);

    const m5EMA50 =
      ema(c5, 50);

    const m5RSI =
      rsi(c5);

    const m5MACD =
      macd(c5);

    const m5ATR =
      atr(m5);


    // =====================================================
    // H1 BIAS
    // =====================================================

    const h1Bull =
      h1EMA200 !== null &&
      price > h1EMA200 &&
      h1EMA50 !== null &&
      h1EMA50 > h1EMA200;


    const h1Bear =
      h1EMA200 !== null &&
      price < h1EMA200 &&
      h1EMA50 !== null &&
      h1EMA50 < h1EMA200;


    // =====================================================
    // M15 CONFIRMATION
    // =====================================================

    const m15Bull =
      m15EMA20 !== null &&
      m15EMA50 !== null &&
      m15EMA20 > m15EMA50;


    const m15Bear =
      m15EMA20 !== null &&
      m15EMA50 !== null &&
      m15EMA20 < m15EMA50;


    const m15MomentumBull =
      m15RSI !== null &&
      m15RSI >= 50 &&
      m15RSI <= 68;


    const m15MomentumBear =
      m15RSI !== null &&
      m15RSI >= 32 &&
      m15RSI < 50;


    // =====================================================
    // M5 TRIGGER
    // =====================================================

    const last5 =
      m5.at(-1);

    const prev5 =
      m5.at(-2);


    const bullishBreak =
      !!last5 &&
      !!prev5 &&
      last5.close >
      prev5.high;


    const bearishBreak =
      !!last5 &&
      !!prev5 &&
      last5.close <
      prev5.low;


    const m5Bull =
      m5EMA20 !== null &&
      m5EMA50 !== null &&
      m5EMA20 > m5EMA50;


    const m5Bear =
      m5EMA20 !== null &&
      m5EMA50 !== null &&
      m5EMA20 < m5EMA50;


    // =====================================================
    // LIQUIDITY
    // =====================================================

    const buySideLiquidity =
      swingHigh(
        m5,
        48
      );


    const sellSideLiquidity =
      swingLow(
        m5,
        48
      );


    // =====================================================
    // ASIAN RANGE
    // =====================================================

    const asianCandles =
      m5.filter(c => {

        const d =
          new Date(c.time);

        const hour =
          d.getUTCHours();

        return (
          hour >= 0 &&
          hour < 8
        );
      });


    const asianHigh =
      asianCandles.length
        ? Math.max(
            ...asianCandles.map(
              c => c.high
            )
          )
        : buySideLiquidity;


    const asianLow =
      asianCandles.length
        ? Math.min(
            ...asianCandles.map(
              c => c.low
            )
          )
        : sellSideLiquidity;


    const bullishSweep =
      !!last5 &&
      last5.low <
        asianLow &&
      last5.close >
        asianLow;


    const bearishSweep =
      !!last5 &&
      last5.high >
        asianHigh &&
      last5.close <
        asianHigh;


    // =====================================================
    // SUPPORT / RESISTANCE
    // =====================================================

    const support =
      swingLow(
        m15,
        30
      );


    const resistance =
      swingHigh(
        m15,
        30
      );


    const nearSupport =
      Number.isFinite(m5ATR) &&
      Math.abs(
        price - support
      ) <=
      m5ATR * 1.0;


    const nearResistance =
      Number.isFinite(m5ATR) &&
      Math.abs(
        price - resistance
      ) <=
      m5ATR * 1.0;


    // =====================================================
    // FVG
    // =====================================================

    const c3 =
      m5.at(-3);


    const bullishFVG =
      !!c3 &&
      !!last5 &&
      last5.low >
        c3.high;


    const bearishFVG =
      !!c3 &&
      !!last5 &&
      last5.high <
        c3.low;


    // =====================================================
    // VWAP
    // =====================================================

    const vwapData =
      m5.slice(-288);

    let pv = 0;
    let volume = 0;


    vwapData.forEach(c => {

      const typical =
        (
          c.high +
          c.low +
          c.close
        ) / 3;

      const v =
        c.volume || 1;

      pv +=
        typical * v;

      volume += v;
    });


    const vwap =
      volume
        ? pv / volume
        : price;


    const aboveVWAP =
      price > vwap;

    const belowVWAP =
      price < vwap;


    // =====================================================
    // BOLLINGER
    // =====================================================

    const bb =
      bollinger(
        c15,
        20
      );


    // =====================================================
    // VOLUME
    // =====================================================

    const volumeStats15 =
      volumeStats(m15);


    // =====================================================
    // MARKET STRUCTURE
    // =====================================================

    const structureCandles =
      m15.slice(-20);


    const previousHigh =
      structureCandles.length
        ? Math.max(
            ...structureCandles
              .slice(0, -3)
              .map(
                c => c.high
              )
          )
        : null;


    const previousLow =
      structureCandles.length
        ? Math.min(
            ...structureCandles
              .slice(0, -3)
              .map(
                c => c.low
              )
          )
        : null;


    let structure =
      "RANGE";

    let bos =
      "NONE";

    let choch =
      "NONE";


    if (
      previousHigh !== null &&
      price > previousHigh
    ) {

      structure =
        "BULLISH";

      bos =
        "BULLISH BOS";

    }

    else if (
      previousLow !== null &&
      price < previousLow
    ) {

      structure =
        "BEARISH";

      bos =
        "BEARISH BOS";
    }

    else if (
      m15EMA20 &&
      m15EMA50 &&
      m15EMA20 >
        m15EMA50
    ) {

      structure =
        "BULLISH";

    }

    else if (
      m15EMA20 &&
      m15EMA50 &&
      m15EMA20 <
        m15EMA50
    ) {

      structure =
        "BEARISH";
    }


    // =====================================================
    // SCORING
    // EXACT XAU WEIGHTS
    // =====================================================

    let buyScore = 0;
    let sellScore = 0;


    // H1 = 25
    if (h1Bull)
      buyScore += 25;

    if (h1Bear)
      sellScore += 25;


    // M15 EMA = 15
    if (m15Bull)
      buyScore += 15;

    if (m15Bear)
      sellScore += 15;


    // M15 RSI = 10
    if (m15MomentumBull)
      buyScore += 10;

    if (m15MomentumBear)
      sellScore += 10;


    // M15 MACD = 10
    if (m15MACD?.bullish)
      buyScore += 10;

    if (m15MACD?.bearish)
      sellScore += 10;


    // ADX = 5
    if (
      m15ADX?.value >= 20
    ) {

      if (m15ADX.bullish)
        buyScore += 5;

      if (m15ADX.bearish)
        sellScore += 5;
    }


    // M5 trend = 10
    if (m5Bull)
      buyScore += 10;

    if (m5Bear)
      sellScore += 10;


    // M5 trigger = 10
    if (bullishBreak)
      buyScore += 10;

    if (bearishBreak)
      sellScore += 10;


    // Liquidity = 5
    if (bullishSweep)
      buyScore += 5;

    if (bearishSweep)
      sellScore += 5;


    // FVG = 5
    if (bullishFVG)
      buyScore += 5;

    if (bearishFVG)
      sellScore += 5;


    // VWAP = 5
    if (aboveVWAP)
      buyScore += 5;

    if (belowVWAP)
      sellScore += 5;


    // =====================================================
    // FINAL SIGNAL
    // =====================================================

    let signal =
      "WAIT";


    let score =
      Math.max(
        buyScore,
        sellScore
      );


    const strongBuy =
      buyScore >= 75 &&
      buyScore >=
        sellScore + 15 &&
      h1Bull &&
      m15Bull &&
      m15MomentumBull &&
      m15MACD?.bullish;


    const strongSell =
      sellScore >= 75 &&
      sellScore >=
        buyScore + 15 &&
      h1Bear &&
      m15Bear &&
      m15MomentumBear &&
      m15MACD?.bearish;


    if (strongBuy)
      signal = "BUY";


    if (strongSell)
      signal = "SELL";


    // =====================================================
    // TRADE PLAN
    // =====================================================

    let trade = {

      entry: null,

      entryLow: null,

      entryHigh: null,

      sl: null,

      tp1: null,

      tp2: null,

      tp3: null,

      risk: null,

      rr: null
    };


    if (
      signal !== "WAIT" &&
      m5ATR > 0
    ) {

      const entry =
        price;


      if (signal === "BUY") {

        const structureSL =
          support -
          m5ATR * 0.25;


        const atrSL =
          entry -
          m5ATR * 1.2;


        const sl =
          Math.min(
            structureSL,
            atrSL
          );


        const risk =
          entry - sl;


        trade = {

          entry,

          entryLow:
            entry -
            m5ATR * 0.20,

          entryHigh:
            entry +
            m5ATR * 0.20,

          sl,

          tp1:
            entry +
            risk * 1.5,

          tp2:
            entry +
            risk * 2.5,

          tp3:
            entry +
            risk * 4,

          risk,

          rr: 4
        };
      }


      if (signal === "SELL") {

        const structureSL =
          resistance +
          m5ATR * 0.25;


        const atrSL =
          entry +
          m5ATR * 1.2;


        const sl =
          Math.max(
            structureSL,
            atrSL
          );


        const risk =
          sl - entry;


        trade = {

          entry,

          entryLow:
            entry -
            m5ATR * 0.20,

          entryHigh:
            entry +
            m5ATR * 0.20,

          sl,

          tp1:
            entry -
            risk * 1.5,

          tp2:
            entry -
            risk * 2.5,

          tp3:
            entry -
            risk * 4,

          risk,

          rr: 4
        };
      }
    }


    // =====================================================
    // TIMEFRAME ANALYSIS
    // =====================================================

    function timeframeAnalysis(
      data
    ) {

      if (!data.length)
        return null;

      const close =
        data.map(
          c => c.close
        );


      const current =
        data.at(-1).close;


      const e20 =
        ema(close, 20);

      const e50 =
        ema(close, 50);

      const r =
        rsi(close, 14);


      let tfScore =
        50;


      if (e20 !== null) {

        if (current > e20)
          tfScore += 10;

        else
          tfScore -= 10;
      }


      if (e50 !== null) {

        if (current > e50)
          tfScore += 10;

        else
          tfScore -= 10;
      }


      if (r !== null) {

        if (
          r > 50 &&
          r < 70
        )
          tfScore += 10;

        else if (
          r < 50 &&
          r > 30
        )
          tfScore -= 10;
      }


      tfScore =
        Math.max(
          0,
          Math.min(
            100,
            tfScore
          )
        );


      let condition =
        "NEUTRAL";


      if (tfScore >= 65)
        condition =
          "BULLISH";

      else if (tfScore <= 35)
        condition =
          "BEARISH";


      return {

        price:
          current,

        ema20:
          e20,

        ema50:
          e50,

        rsi:
          r,

        score:
          tfScore,

        condition
      };
    }


    const timeframes = {

      M5:
        timeframeAnalysis(m5),

      M15:
        timeframeAnalysis(m15),

      H1:
        timeframeAnalysis(h1),

      H4:
        timeframeAnalysis(h4),

      D1:
        timeframeAnalysis(d1)
    };


    // =====================================================
    // LEGACY BTC FIELDS
    // Keeps current index.html compatible
    // =====================================================

    timeframes.M15.support =
      support;

    timeframes.M15.resistance =
      resistance;

    timeframes.M15.volume =
      volumeStats15;


    // =====================================================
    // 24H INFORMATION
    // =====================================================

    const last24 =
      m5.slice(-288);


    const high24 =
      last24.length
        ? Math.max(
            ...last24.map(
              c => c.high
            )
          )
        : null;


    const low24 =
      last24.length
        ? Math.min(
            ...last24.map(
              c => c.low
            )
          )
        : null;


    const volume24 =
      last24.reduce(
        (sum, c) =>
          sum +
          (c.volume || 0),
        0
      );


    const change24 =
      last24.length &&
      last24[0].open
        ? (
            (
              price -
              last24[0].open
            ) /
            last24[0].open
          ) * 100
        : null;


    // =====================================================
    // MARKET PHASE
    // =====================================================

    let phase =
      "RANGING";


    if (
      m15EMA20 !== null &&
      m15EMA50 !== null &&
      price >
        m15EMA20 &&
      m15EMA20 >
        m15EMA50
    ) {

      phase =
        "BULLISH TREND";
    }


    else if (
      m15EMA20 !== null &&
      m15EMA50 !== null &&
      price <
        m15EMA20 &&
      m15EMA20 <
        m15EMA50
    ) {

      phase =
        "BEARISH TREND";
    }


    // =====================================================
    // RESPONSE
    // =====================================================

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0, must-revalidate"
    );


    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );


    return res.status(200).json({

      ok: true,

      symbol:
        "BTC/USD",

      interval:
        "5min",

      updated:
        new Date().toISOString(),

      timestamp:
        new Date().toISOString(),

      count:
        candles.length,

      lastPrice:
        price,

      price,

      lastCandleTime:
        last5?.time || null,


      // ===================================================
      // MAIN SIGNAL
      // ===================================================

      signal,

      score,

      scores: {

        buy:
          buyScore,

        sell:
          sellScore
      },


      // ===================================================
      // TREND
      // ===================================================

      trend: {

        h1:
          h1Bull
            ? "BULLISH"
            : h1Bear
              ? "BEARISH"
              : "NEUTRAL",

        m15:
          m15Bull
            ? "BULLISH"
            : m15Bear
              ? "BEARISH"
              : "NEUTRAL",

        m5:
          m5Bull
            ? "BULLISH"
            : m5Bear
              ? "BEARISH"
              : "NEUTRAL"
      },


      // ===================================================
      // INDICATORS
      // ===================================================

      indicators: {

        h1: {

          ema200:
            h1EMA200,

          ema50:
            h1EMA50
        },


        m15: {

          ema20:
            m15EMA20,

          ema50:
            m15EMA50,

          rsi:
            m15RSI,

          macd:
            m15MACD,

          adx:
            m15ADX
        },


        m5: {

          ema20:
            m5EMA20,

          ema50:
            m5EMA50,

          rsi:
            m5RSI,

          atr:
            m5ATR,

          macd:
            m5MACD
        }
      },


      // ===================================================
      // LEVELS
      // ===================================================

      levels: {

        support,

        resistance,

        buySideLiquidity,

        sellSideLiquidity,

        asianHigh,

        asianLow,

        vwap
      },


      // ===================================================
      // CONFIRMATION
      // ===================================================

      confirmation: {

        bullishBreak,

        bearishBreak,

        bullishSweep,

        bearishSweep,

        bullishFVG,

        bearishFVG,

        nearSupport,

        nearResistance,

        aboveVWAP,

        belowVWAP
      },


      // ===================================================
      // TRADE
      // ===================================================

      trade,


      // ===================================================
      // TIMEFRAMES
      // ===================================================

      timeframes,


      // ===================================================
      // LEGACY FIELDS
      // ===================================================

      ema20:
        m15EMA20,

      ema50:
        m15EMA50,

      rsi:
        m15RSI,

      atr:
        m5ATR,

      volume:
        volumeStats15.current,

      volumeRatio:
        volumeStats15.ratio,

      volumeState:
        volumeStats15.state,


      bb: {

        upper:
          bb?.upper ?? null,

        middle:
          bb?.middle ?? null,

        lower:
          bb?.lower ?? null
      },


      high:
        last5?.high ?? null,

      low:
        last5?.low ?? null,


      high24,

      low24,

      volume24,

      change24,


      structure,

      bos,

      choch,

      phase,


      // ===================================================
      // RAW CANDLES
      // ===================================================

      candles
    });

  } catch (error) {

    console.error(
      "BTC ANALYSIS ERROR:",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        "Analysis engine error",

      message:
        error?.message ||
        "Unknown error"
    });
  }
}
