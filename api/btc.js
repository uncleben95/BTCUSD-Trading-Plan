export default async function handler(req, res) {
  try {
    const API_KEY = process.env.TWELVE_DATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "TWELVE_DATA_API_KEY missing"
      });
    }

    /*
      IMPORTANT:
      Vercel cache response for 5 minutes.
      Browser refresh will normally receive
      cached result instead of hitting Twelve Data.
    */
    res.setHeader(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600"
    );

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

    if (
      data.status === "error" ||
      !Array.isArray(data.values)
    ) {
      return res.status(429).json({
        ok: false,
        error: "Twelve Data unavailable",
        detail: data
      });
    }

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
        error: "Not enough BTC candles"
      });
    }

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

      if (avgLoss === 0)
        return 100;

      const rs =
        avgGain / avgLoss;

      return 100 -
        (100 / (1 + rs));
    }

    function atr(candles, period = 14) {

      if (candles.length <= period)
        return null;

      const trs = [];

      for (let i = 1; i < candles.length; i++) {

        const c = candles[i];
        const p = candles[i - 1];

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

    function bollinger(values) {

      const period = 20;

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

      const deviation =
        Math.sqrt(variance);

      return {
        upper:
          middle + deviation * 2,

        middle,

        lower:
          middle - deviation * 2
      };
    }

    function volumeStats(candles) {

      const current =
        candles[candles.length - 1].volume || 0;

      const previous =
        candles
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
      bollinger(closes);

    const volume =
      volumeStats(candles);

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

    let score = 50;

    if (price > ema20)
      score += 10;
    else
      score -= 10;

    if (price > ema50)
      score += 10;
    else
      score -= 10;

    if (rsi14 > 50 && rsi14 < 70)
      score += 10;

    if (rsi14 < 50 && rsi14 > 30)
      score -= 10;

    if (volume.ratio >= 1.3) {

      const previousClose =
        candles[candles.length - 2].close;

      if (price > previousClose)
        score += 5;
      else
        score -= 5;
    }

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

    return res.status(200).json({

      ok: true,

      source: "Twelve Data",

      symbol: "BTC/USD",

      interval: "15min",

      price,

      signal,

      score,

      phase,

      timeframes: {

        M15: {

          price,

          condition:
            signal === "BUY"
              ? "BULLISH"
              : signal === "SELL"
                ? "BEARISH"
                : "NEUTRAL",

          score,

          ema20,

          ema50,

          rsi: rsi14,

          atr: atr14,

          volume,

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

          structure:
            price > ema20 &&
            ema20 > ema50
              ? "BULLISH"
              : price < ema20 &&
                ema20 < ema50
                ? "BEARISH"
                : "RANGE",

          bos: "AUTO",

          choch: "AUTO"
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

      error: "BTC candle data unavailable",

      detail: error.message

    });

  }
}
