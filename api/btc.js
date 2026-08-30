export default async function handler(req, res) {
  try {
    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "TWELVE_DATA_API_KEY missing"
      });
    }

    // Vercel cache: 5 min
    res.setHeader(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600"
    );

    // =====================================================
    // ONE API REQUEST ONLY
    // =====================================================

    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=BTC/USD" +
      "&interval=15min" +
      "&outputsize=500" +
      "&apikey=" +
      encodeURIComponent(API_KEY);

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "Twelve Data HTTP " + response.status,
        detail: data
      });
    }

    if (data.status === "error") {
      return res.status(429).json({
        ok: false,
        error: "Twelve Data unavailable",
        detail: data
      });
    }

    if (!Array.isArray(data.values)) {
      return res.status(400).json({
        ok: false,
        error: "BTC candle data unavailable",
        detail: data
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
        volume: Number(c.volume || 0)
      }))
      .filter(c =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
      )
      .reverse();

    if (candles.length < 100) {
      return res.status(400).json({
        ok: false,
        error: "Not enough BTC M15 candles"
      });
    }

    // =====================================================
    // HELPERS
    // =====================================================

    const closes =
      candles.map(c => c.close);

    function ema(values, period) {

      if (values.length < period)
        return null;

      const k =
        2 / (period + 1);

      let value =
        values
          .slice(0, period)
          .reduce((a, b) => a + b, 0)
        / period;

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

    function rsi(values, period = 14) {

      if (values.length <= period)
        return null;

      let gain = 0;
      let loss = 0;

      for (let i = 1; i <= period; i++) {

        const diff =
          values[i] - values[i - 1];

        if (diff >= 0)
          gain += diff;
        else
          loss += Math.abs(diff);
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
          values[i] - values[i - 1];

        const g =
          diff > 0 ? diff : 0;

        const l =
          diff < 0 ? Math.abs(diff) : 0;

        avgGain =
          (
            avgGain * (period - 1) +
            g
          ) / period;

        avgLoss =
          (
            avgLoss * (period - 1) +
            l
          ) / period;
      }

      if (avgLoss === 0)
        return 100;

      const rs =
        avgGain / avgLoss;

      return 100 -
        100 / (1 + rs);
    }

    function atr(data, period = 14) {

      if (data.length <= period)
        return null;

      const trs = [];

      for (let i = 1; i < data.length; i++) {

        const c = data[i];
        const p = data[i - 1];

        trs.push(
          Math.max(
            c.high - c.low,
            Math.abs(c.high - p.close),
            Math.abs(c.low - p.close)
          )
        );
      }

      let value =
        trs
          .slice(0, period)
          .reduce((a, b) => a + b, 0)
        / period;

      for (
        let i = period;
        i < trs.length;
        i++
      ) {

        value =
          (
            value * (period - 1) +
            trs[i]
          ) / period;
      }

      return value;
    }

    function bollinger(values, period = 20) {

      if (values.length < period)
        return null;

      const slice =
        values.slice(-period);

      const middle =
        slice.reduce((a, b) => a + b, 0)
        / period;

      const variance =
        slice.reduce(
          (sum, v) =>
            sum +
            Math.pow(v - middle, 2),
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
        data[data.length - 1].volume || 0;

      const previous =
        data
          .slice(-21, -1)
          .map(c => c.volume || 0);

      const average =
        previous.length
          ? previous.reduce(
              (a, b) => a + b,
              0
            ) / previous.length
          : 0;

      const ratio =
        average > 0
          ? current / average
          : 0;

      let state = "NORMAL";

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
    // AGGREGATE M15 → HIGHER TIMEFRAMES
    // =====================================================

    function aggregate(data, candlesPerBar) {

      const result = [];

      for (
        let i = 0;
        i + candlesPerBar <= data.length;
        i += candlesPerBar
      ) {

        const group =
          data.slice(
            i,
            i + candlesPerBar
          );

        result.push({

          time:
            group[0].time,

          open:
            group[0].open,

          high:
            Math.max(
              ...group.map(c => c.high)
            ),

          low:
            Math.min(
              ...group.map(c => c.low)
            ),

          close:
            group[group.length - 1].close,

          volume:
            group.reduce(
              (sum, c) =>
                sum + c.volume,
              0
            )

        });
      }

      return result;
    }

    // =====================================================
    // BUILD TIMEFRAMES
    // =====================================================

    const timeframeSets = {

      M15: candles,

      M30:
        aggregate(candles, 2),

      H1:
        aggregate(candles, 4),

      H4:
        aggregate(candles, 16),

      D1:
        aggregate(candles, 96)

    };

    function timeframeAnalysis(data) {

      if (!data.length)
        return null;

      const close =
        data.map(c => c.close);

      const price =
        data[data.length - 1].close;

      const e20 =
        ema(close, 20);

      const e50 =
        ema(close, 50);

      const r =
        rsi(close, 14);

      let score = 50;

      if (e20 !== null) {

        if (price > e20)
          score += 10;
        else
          score -= 10;

      }

      if (e50 !== null) {

        if (price > e50)
          score += 10;
        else
          score -= 10;

      }

      if (r !== null) {

        if (r > 50 && r < 70)
          score += 10;

        else if (r < 50 && r > 30)
          score -= 10;

      }

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

      return {
        price,
        ema20: e20,
        ema50: e50,
        rsi: r,
        score,
        condition
      };
    }

    const tf = {};

    Object.keys(timeframeSets)
      .forEach(key => {

        tf[key] =
          timeframeAnalysis(
            timeframeSets[key]
          );

      });

    // =====================================================
    // M15 ENGINE
    // =====================================================

    const m15 = candles;

    const price =
      m15[m15.length - 1].close;

    const previousPrice =
      m15[m15.length - 2].close;

    const ema20 =
      ema(closes, 20);

    const ema50 =
      ema(closes, 50);

    const rsi14 =
      rsi(closes, 14);

    const atr14 =
      atr(m15, 14);

    const bb =
      bollinger(closes, 20);

    const volume =
      volumeStats(m15);

    // =====================================================
    // 24H
    // =====================================================

    const last24 =
      m15.slice(-96);

    const high24 =
      Math.max(
        ...last24.map(c => c.high)
      );

    const low24 =
      Math.min(
        ...last24.map(c => c.low)
      );

    const volume24 =
      last24.reduce(
        (sum, c) =>
          sum + c.volume,
        0
      );

    const change24 =
      (
        (
          price -
          last24[0].open
        ) /
        last24[0].open
      ) * 100;

    // =====================================================
    // SUPPORT / RESISTANCE
    // =====================================================

    const recent =
      m15.slice(-50);

    const resistance =
      Math.max(
        ...recent.map(c => c.high)
      );

    const support =
      Math.min(
        ...recent.map(c => c.low)
      );

    // =====================================================
    // STRUCTURE
    // =====================================================

    const structureCandles =
      m15.slice(-20);

    const previousHigh =
      Math.max(
        ...structureCandles
          .slice(0, -3)
          .map(c => c.high)
      );

    const previousLow =
      Math.min(
        ...structureCandles
          .slice(0, -3)
          .map(c => c.low)
      );

    let structure = "RANGE";
    let bos = "NONE";
    let choch = "NONE";

    if (price > previousHigh) {

      structure = "BULLISH";
      bos = "BULLISH BOS";

    }

    else if (price < previousLow) {

      structure = "BEARISH";
      bos = "BEARISH BOS";

    }

    else if (
      ema20 &&
      ema50 &&
      ema20 > ema50
    ) {

      structure = "BULLISH";

    }

    else if (
      ema20 &&
      ema50 &&
      ema20 < ema50
    ) {

      structure = "BEARISH";

    }

    // =====================================================
    // SCORE
    // =====================================================

    let score = 50;

    if (price > ema20)
      score += 10;
    else
      score -= 10;

    if (price > ema50)
      score += 10;
    else
      score -= 10;

    if (
      rsi14 > 50 &&
      rsi14 < 70
    )
      score += 10;

    else if (
      rsi14 < 50 &&
      rsi14 > 30
    )
      score -= 10;

    if (volume.ratio >= 1.3) {

      if (price > previousPrice)
        score += 5;

      else
        score -= 5;

    }

    if (structure === "BULLISH")
      score += 5;

    if (structure === "BEARISH")
      score -= 5;

    score =
      Math.max(
        0,
        Math.min(100, score)
      );

    let signal = "WAIT";

    if (score >= 70)
      signal = "BUY";

    else if (score <= 30)
      signal = "SELL";

    // =====================================================
    // MARKET PHASE
    // =====================================================

    let phase = "RANGING";

    if (
      price > ema20 &&
      ema20 > ema50
    ) {

      phase = "BULLISH TREND";

    }

    else if (
      price < ema20 &&
      ema20 < ema50
    ) {

      phase = "BEARISH TREND";

    }

    // =====================================================
    // TRADE PLAN
    // =====================================================

    let entry = null;
    let sl = null;
    let tp1 = null;
    let tp2 = null;
    let rr = null;

    if (
      signal === "BUY" &&
      atr14
    ) {

      entry = price;

      sl =
        price -
        atr14 * 1.2;

      tp1 =
        price +
        atr14 * 1.5;

      tp2 =
        price +
        atr14 * 2.5;

      rr =
        (
          (tp1 - entry) /
          (entry - sl)
        ).toFixed(2);

    }

    if (
      signal === "SELL" &&
      atr14
    ) {

      entry = price;

      sl =
        price +
        atr14 * 1.2;

      tp1 =
        price -
        atr14 * 1.5;

      tp2 =
        price -
        atr14 * 2.5;

      rr =
        (
          (entry - tp1) /
          (sl - entry)
        ).toFixed(2);

    }

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({

      ok: true,

      source: "Twelve Data",

      symbol: "BTC/USD",

      baseTimeframe: "15min",

      price,

      signal,

      score,

      phase,

      trade: {
        entry,
        sl,
        tp1,
        tp2,
        rr
      },

      market: {

        current: price,

        high24,

        low24,

        volume24,

        change24

      },

      timeframes: {

        D1: tf.D1,

        H4: tf.H4,

        H1: tf.H1,

        M30: tf.M30,

        M15: {

          ...tf.M15,

          volume,

          atr: atr14,

          bb: bb
            ? {
                ...bb,

                position:
                  price >= bb.upper
                    ? "ABOVE UPPER"
                    : price <= bb.lower
                      ? "BELOW LOWER"
                      : "INSIDE"
              }
            : null,

          resistance,

          support,

          structure,

          bos,

          choch,

          volatility:
            atr14
              ? (
                  atr14 /
                  price *
                  100
                )
                .toFixed(2) +
                "%"
              : "--"
        },

        M5: null

      },

      candles,

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      ok: false,

      error:
        "BTC candle data unavailable",

      detail:
        error.message

    });

  }
}
