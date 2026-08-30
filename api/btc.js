export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "TWELVE_DATA_API_KEY missing"
      });
    }

    // =====================================================
    // ONLY ONE TWELVE DATA REQUEST
    // M15 BTC/USD candles
    // =====================================================

    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=BTC/USD" +
      "&interval=15min" +
      "&outputsize=150" +
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
      return res.status(400).json({
        ok: false,
        error: "Twelve Data error",
        detail: data
      });
    }

    if (!Array.isArray(data.values) || data.values.length < 50) {
      return res.status(400).json({
        ok: false,
        error: "BTC candle data unavailable",
        detail: data
      });
    }

    // =====================================================
    // NORMALISE CANDLES
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

    if (candles.length < 50) {
      return res.status(400).json({
        ok: false,
        error: "Not enough valid BTC candles"
      });
    }

    // =====================================================
    // HELPERS
    // =====================================================

    const closes = candles.map(c => c.close);

    function sma(values, period) {
      if (values.length < period) return null;

      const slice = values.slice(-period);

      return slice.reduce((a, b) => a + b, 0) / period;
    }

    function ema(values, period) {
      if (values.length < period) return null;

      const k = 2 / (period + 1);

      let result =
        values
          .slice(0, period)
          .reduce((a, b) => a + b, 0) / period;

      for (let i = period; i < values.length; i++) {
        result =
          values[i] * k +
          result * (1 - k);
      }

      return result;
    }

    function rsi(values, period = 14) {
      if (values.length <= period) return null;

      let gain = 0;
      let loss = 0;

      for (let i = 1; i <= period; i++) {
        const diff =
          values[i] - values[i - 1];

        if (diff >= 0) {
          gain += diff;
        } else {
          loss += Math.abs(diff);
        }
      }

      let avgGain = gain / period;
      let avgLoss = loss / period;

      for (let i = period + 1; i < values.length; i++) {
        const diff =
          values[i] - values[i - 1];

        const currentGain =
          diff > 0 ? diff : 0;

        const currentLoss =
          diff < 0 ? Math.abs(diff) : 0;

        avgGain =
          ((avgGain * (period - 1)) +
            currentGain) / period;

        avgLoss =
          ((avgLoss * (period - 1)) +
            currentLoss) / period;
      }

      if (avgLoss === 0) return 100;

      const rs =
        avgGain / avgLoss;

      return 100 - (100 / (1 + rs));
    }

    function atr(candles, period = 14) {
      if (candles.length <= period) return null;

      const trs = [];

      for (let i = 1; i < candles.length; i++) {

        const current = candles[i];
        const previous = candles[i - 1];

        const tr = Math.max(
          current.high - current.low,
          Math.abs(
            current.high - previous.close
          ),
          Math.abs(
            current.low - previous.close
          )
        );

        trs.push(tr);
      }

      if (trs.length < period) return null;

      let result =
        trs
          .slice(0, period)
          .reduce((a, b) => a + b, 0) /
        period;

      for (let i = period; i < trs.length; i++) {
        result =
          ((result * (period - 1)) +
            trs[i]) / period;
      }

      return result;
    }

    function bollinger(values, period = 20, multiplier = 2) {

      if (values.length < period) {
        return null;
      }

      const slice =
        values.slice(-period);

      const middle =
        slice.reduce(
          (a, b) => a + b,
          0
        ) / period;

      const variance =
        slice.reduce(
          (sum, value) =>
            sum +
            Math.pow(value - middle, 2),
          0
        ) / period;

      const std =
        Math.sqrt(variance);

      return {
        upper:
          middle + multiplier * std,

        middle,

        lower:
          middle - multiplier * std
      };
    }

    function volumeStats(candles) {

      const current =
        candles[candles.length - 1].volume || 0;

      const previous =
        candles
          .slice(-21, -1)
          .map(c => c.volume || 0);

      if (!previous.length) {
        return {
          current,
          average: 0,
          ratio: 0,
          state: "UNKNOWN"
        };
      }

      const average =
        previous.reduce(
          (a, b) => a + b,
          0
        ) / previous.length;

      const ratio =
        average > 0
          ? current / average
          : 0;

      let state = "NORMAL";

      if (ratio >= 2) {
        state = "VERY HIGH";
      } else if (ratio >= 1.3) {
        state = "HIGH";
      } else if (ratio < 0.7) {
        state = "LOW";
      }

      return {
        current,
        average,
        ratio,
        state
      };
    }

    // =====================================================
    // CURRENT M15 DATA
    // =====================================================

    const price =
      candles[candles.length - 1].close;

    const ema20 =
      ema(closes, 20);

    const ema50 =
      ema(closes, 50);

    const rsi14 =
      rsi(closes, 14);

    const atr14 =
      atr(candles, 14);

    const bb =
      bollinger(closes, 20, 2);

    const volume =
      volumeStats(candles);

    // =====================================================
    // SUPPORT / RESISTANCE
    // =====================================================

    const recent =
      candles.slice(-50);

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

    const previousHighs =
      candles
        .slice(-20, -5)
        .map(c => c.high);

    const previousLows =
      candles
        .slice(-20, -5)
        .map(c => c.low);

    const lastHigh =
      Math.max(...previousHighs);

    const lastLow =
      Math.min(...previousLows);

    let structure = "RANGE";
    let bos = "NONE";
    let choch = "NONE";

    if (price > lastHigh) {
      structure = "BULLISH";
      bos = "BULLISH BOS";
    }

    else if (price < lastLow) {
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
    // TECHNICAL SCORE
    // =====================================================

    let score = 50;

    if (price > ema20) score += 10;
    else score -= 10;

    if (price > ema50) score += 10;
    else score -= 10;

    if (rsi14 > 50 && rsi14 < 70) {
      score += 10;
    }

    if (rsi14 < 50 && rsi14 > 30) {
      score -= 10;
    }

    if (volume.ratio >= 1.3) {

      if (price > candles[candles.length - 2].close) {
        score += 5;
      } else {
        score -= 5;
      }

    }

    if (structure === "BULLISH") {
      score += 5;
    }

    if (structure === "BEARISH") {
      score -= 5;
    }

    score =
      Math.max(
        0,
        Math.min(100, score)
      );

    let signal = "WAIT";

    if (score >= 70) {
      signal = "BUY";
    }

    else if (score <= 30) {
      signal = "SELL";
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
        price - atr14 * 1.2;

      tp1 =
        price + atr14 * 1.5;

      tp2 =
        price + atr14 * 2.5;

      rr =
        (
          (tp1 - entry) /
          (entry - sl)
        ).toFixed(2);

    }

    else if (
      signal === "SELL" &&
      atr14
    ) {

      entry = price;

      sl =
        price + atr14 * 1.2;

      tp1 =
        price - atr14 * 1.5;

      tp2 =
        price - atr14 * 2.5;

      rr =
        (
          (entry - tp1) /
          (sl - entry)
        ).toFixed(2);
    }

    // =====================================================
    // MARKET PHASE
    // =====================================================

    let phase = "RANGING";

    if (
      ema20 &&
      ema50 &&
      price > ema20 &&
      ema20 > ema50
    ) {
      phase = "BULLISH TREND";
    }

    else if (
      ema20 &&
      ema50 &&
      price < ema20 &&
      ema20 < ema50
    ) {
      phase = "BEARISH TREND";
    }

    // =====================================================
    // RETURN
    // =====================================================

    return res.status(200).json({

      ok: true,

      source: "Twelve Data",

      symbol: "BTC/USD",

      interval: "15min",

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

      timeframes: {

        M15: {

          price,

          condition:
            structure === "BULLISH"
              ? "BULLISH"
              : structure === "BEARISH"
                ? "BEARISH"
                : "NEUTRAL",

          score,

          ema20,

          ema50,

          rsi: rsi14,

          atr: atr14,

          volume,

          bb: {
            ...bb,
            position:
              bb
                ? price >= bb.upper
                  ? "ABOVE UPPER"
                  : price <= bb.lower
                    ? "BELOW LOWER"
                    : "INSIDE"
                : "--"
          },

          resistance,

          support,

          structure,

          bos,

          choch
        }

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
