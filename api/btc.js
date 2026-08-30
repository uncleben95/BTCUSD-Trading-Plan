// =========================================================
// BTCUSD TECHNICAL MONITOR
// CoinGecko based
// No Binance dependency
// =========================================================

export default async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "s-maxage=10, stale-while-revalidate=30"
  );

  try {

    // -----------------------------------------------------
    // COINGECKO
    // 2 days gives recent intraday data
    // -----------------------------------------------------

    const url =
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart" +
      "?vs_currency=usd" +
      "&days=2" +
      "&interval=5m";

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        "CoinGecko HTTP " + response.status
      );
    }

    const raw = await response.json();

    if (
      !raw ||
      !Array.isArray(raw.prices) ||
      raw.prices.length < 50
    ) {
      throw new Error("BTC historical data unavailable");
    }

    // -----------------------------------------------------
    // CONVERT COINGECKO DATA
    // -----------------------------------------------------

    const candles5m = [];

    for (let i = 0; i < raw.prices.length; i++) {

      const priceRow = raw.prices[i];
      const volumeRow = raw.total_volumes?.[i];

      if (!priceRow) continue;

      const timestamp = Number(priceRow[0]);
      const close = Number(priceRow[1]);

      if (!Number.isFinite(close)) continue;

      candles5m.push({
        time: timestamp,
        open: close,
        high: close,
        low: close,
        close: close,
        volume:
          Number(volumeRow?.[1]) || 0
      });

    }

    // -----------------------------------------------------
    // BUILD OHLC FROM PRICE STREAM
    // -----------------------------------------------------

    const grouped5m = {};

    for (const c of candles5m) {

      const bucket =
        Math.floor(c.time / 300000) * 300000;

      if (!grouped5m[bucket]) {

        grouped5m[bucket] = {
          time: bucket,
          open: c.close,
          high: c.close,
          low: c.close,
          close: c.close,
          volume: 0
        };

      }

      const x = grouped5m[bucket];

      x.high =
        Math.max(x.high, c.close);

      x.low =
        Math.min(x.low, c.close);

      x.close =
        c.close;

      x.volume += c.volume;

    }

    const m5 =
      Object.values(grouped5m)
        .sort((a,b) => a.time - b.time);

    // -----------------------------------------------------
    // AGGREGATE TIMEFRAMES
    // -----------------------------------------------------

    function aggregate(
      source,
      minutes
    ) {

      const size =
        minutes * 60 * 1000;

      const groups = {};

      for (const c of source) {

        const bucket =
          Math.floor(c.time / size) * size;

        if (!groups[bucket]) {

          groups[bucket] = {
            time: bucket,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: 0
          };

        }

        const x =
          groups[bucket];

        x.high =
          Math.max(x.high, c.high);

        x.low =
          Math.min(x.low, c.low);

        x.close =
          c.close;

        x.volume +=
          Number(c.volume) || 0;

      }

      return Object.values(groups)
        .sort((a,b) => a.time - b.time);

    }

    const m15 =
      aggregate(m5, 15);

    const m30 =
      aggregate(m5, 30);

    const h1 =
      aggregate(m5, 60);

    const h4 =
      aggregate(m5, 240);

    const d1 =
      aggregate(m5, 1440);

    // -----------------------------------------------------
    // INDICATORS
    // -----------------------------------------------------

    function ema(
      candles,
      period
    ) {

      if (candles.length < period)
        return null;

      const closes =
        candles.map(x => x.close);

      let value = 0;

      for (
        let i = 0;
        i < period;
        i++
      ) {

        value +=
          closes[i];

      }

      value /= period;

      const multiplier =
        2 / (period + 1);

      for (
        let i = period;
        i < closes.length;
        i++
      ) {

        value =
          (
            closes[i] - value
          ) *
          multiplier +
          value;

      }

      return value;

    }

    function sma(
      values,
      period
    ) {

      if (
        values.length < period
      )
        return null;

      let total = 0;

      for (
        let i =
          values.length - period;
        i < values.length;
        i++
      ) {

        total +=
          values[i];

      }

      return total / period;

    }

    function rsi(
      candles,
      period = 14
    ) {

      if (
        candles.length <
        period + 1
      )
        return null;

      let gains = 0;
      let losses = 0;

      for (
        let i =
          candles.length - period;
        i < candles.length;
        i++
      ) {

        const diff =
          candles[i].close -
          candles[i - 1].close;

        if (diff >= 0)
          gains += diff;

        else
          losses += Math.abs(diff);

      }

      if (losses === 0)
        return 100;

      const rs =
        gains / losses;

      return 100 -
        (
          100 /
          (1 + rs)
        );

    }

    function atr(
      candles,
      period = 14
    ) {

      if (
        candles.length <
        period + 1
      )
        return null;

      const tr = [];

      for (
        let i = 1;
        i < candles.length;
        i++
      ) {

        const high =
          candles[i].high;

        const low =
          candles[i].low;

        const prev =
          candles[i - 1].close;

        tr.push(
          Math.max(
            high - low,
            Math.abs(high - prev),
            Math.abs(low - prev)
          )
        );

      }

      return sma(
        tr,
        period
      );

    }

    function bollinger(
      candles,
      period = 20,
      multiplier = 2
    ) {

      if (
        candles.length < period
      )
        return null;

      const closes =
        candles
          .slice(-period)
          .map(x => x.close);

      const middle =
        closes.reduce(
          (a,b) => a + b,
          0
        ) / period;

      let variance = 0;

      for (const c of closes) {

        variance +=
          Math.pow(
            c - middle,
            2
          );

      }

      const sd =
        Math.sqrt(
          variance / period
        );

      const upper =
        middle +
        multiplier * sd;

      const lower =
        middle -
        multiplier * sd;

      const price =
        closes[closes.length - 1];

      let position =
        "MIDDLE";

      if (price >= upper)
        position = "UPPER";

      else if (price <= lower)
        position = "LOWER";

      else if (
        price >
        middle
      )
        position = "ABOVE MIDDLE";

      else
        position = "BELOW MIDDLE";

      return {
        upper,
        middle,
        lower,
        position
      };

    }

    // -----------------------------------------------------
    // SUPPORT / RESISTANCE
    // -----------------------------------------------------

    function structure(
      candles
    ) {

      if (
        candles.length < 30
      ) {

        return {
          resistance: null,
          support: null,
          structure: "WAIT",
          bos: "--",
          choch: "--"
        };

      }

      const recent =
        candles.slice(-30);

      const highs =
        recent.map(x => x.high);

      const lows =
        recent.map(x => x.low);

      const resistance =
        Math.max(...highs);

      const support =
        Math.min(...lows);

      const last =
        candles[candles.length - 1];

      const previous =
        candles[candles.length - 6];

      let trend =
        "RANGE";

      if (
        last.close >
        previous.close
      )
        trend = "BULLISH";

      else if (
        last.close <
        previous.close
      )
        trend = "BEARISH";

      let bos = "--";
      let choch = "--";

      if (
        last.close >
        resistance
      )
        bos = "BULLISH";

      if (
        last.close <
        support
      )
        bos = "BEARISH";

      return {
        resistance,
        support,
        structure: trend,
        bos,
        choch
      };

    }

    // -----------------------------------------------------
    // VOLUME
    // -----------------------------------------------------

    function volumeInfo(
      candles
    ) {

      if (
        candles.length < 21
      ) {

        return {
          current: null,
          ratio: null,
          state: "--"
        };

      }

      const current =
        candles[
          candles.length - 1
        ].volume;

      const previous =
        candles
          .slice(-21, -1)
          .map(x => x.volume);

      const average =
        previous.reduce(
          (a,b) => a + b,
          0
        ) / previous.length;

      const ratio =
        average > 0
        ? current / average
        : null;

      let state =
        "NORMAL";

      if (ratio >= 2)
        state = "VERY HIGH";

      else if (ratio >= 1.3)
        state = "HIGH";

      else if (ratio <= 0.7)
        state = "LOW";

      return {
        current,
        average,
        ratio,
        state
      };

    }

    // -----------------------------------------------------
    // ANALYSE TIMEFRAME
    // -----------------------------------------------------

    function analyse(
      candles
    ) {

      if (
        !candles ||
        candles.length < 20
      ) {

        return {
          condition: "WAIT",
          score: 0
        };

      }

      const price =
        candles[
          candles.length - 1
        ].close;

      const ema20 =
        ema(candles, 20);

      const ema50 =
        ema(candles, 50);

      const r =
        rsi(candles);

      const a =
        atr(candles);

      const bb =
        bollinger(candles);

      const vol =
        volumeInfo(candles);

      const s =
        structure(candles);

      let score = 50;

      if (
        ema20 &&
        price > ema20
      )
        score += 12;

      else
        score -= 12;

      if (
        ema50 &&
        price > ema50
      )
        score += 12;

      else
        score -= 12;

      if (
        r !== null &&
        r > 50 &&
        r < 70
      )
        score += 10;

      else if (
        r !== null &&
        r < 45
      )
        score -= 10;

      if (
        vol.ratio &&
        vol.ratio > 1.3
      ) {

        if (
          candles[
            candles.length - 1
          ].close >
          candles[
            candles.length - 2
          ].close
        )
          score += 8;

        else
          score -= 8;

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

      if (score >= 68)
        condition = "BULLISH";

      else if (score <= 32)
        condition = "BEARISH";

      return {

        condition,
        score,

        price,

        ema20,
        ema50,

        rsi: r,

        atr: a,

        bb,

        volume: vol,

        resistance:
          s.resistance,

        support:
          s.support,

        structure:
          s.structure,

        bos:
          s.bos,

        choch:
          s.choch

      };

    }

    // -----------------------------------------------------
    // ANALYSE ALL TF
    // -----------------------------------------------------

    const timeframes = {

      D1:
        analyse(d1),

      H4:
        analyse(h4),

      H1:
        analyse(h1),

      M30:
        analyse(m30),

      M15:
        analyse(m15),

      M5:
        analyse(m5)

    };

    // -----------------------------------------------------
    // CURRENT PRICE
    // -----------------------------------------------------

    const price =
      m5[m5.length - 1].close;

    const previous =
      m5[m5.length - 2]?.close ||
      price;

    const change =
      previous !== 0
        ? (
          (price - previous) /
          previous
        ) * 100
        : 0;

    // -----------------------------------------------------
    // SIGNAL
    // -----------------------------------------------------

    const m15data =
      timeframes.M15;

    const h1data =
      timeframes.H1;

    let signal =
      "WAIT";

    let score =
      m15data.score;

    if (
      m15data.score >= 70 &&
      h1data.score >= 55
    )
      signal = "BUY";

    else if (
      m15data.score <= 30 &&
      h1data.score <= 45
    )
      signal = "SELL";

    // -----------------------------------------------------
    // TRADE PLAN
    // -----------------------------------------------------

    let entry = null;
    let sl = null;
    let tp1 = null;
    let tp2 = null;
    let rr = null;

    const atrValue =
      m15data.atr;

    if (
      signal !== "WAIT" &&
      Number.isFinite(atrValue)
    ) {

      entry =
        price;

      if (signal === "BUY") {

        sl =
          price -
          atrValue * 1.5;

        tp1 =
          price +
          atrValue * 1.5;

        tp2 =
          price +
          atrValue * 3;

      }

      else {

        sl =
          price +
          atrValue * 1.5;

        tp1 =
          price -
          atrValue * 1.5;

        tp2 =
          price -
          atrValue * 3;

      }

      rr = "1:2";

    }

    // -----------------------------------------------------
    // MARKET PHASE
    // -----------------------------------------------------

    let phase =
      "RANGE";

    if (
      m15data.condition ===
      "BULLISH"
    )
      phase = "BULLISH TREND";

    else if (
      m15data.condition ===
      "BEARISH"
    )
      phase = "BEARISH TREND";

    // -----------------------------------------------------
    // RESPONSE
    // -----------------------------------------------------

    return res.status(200).json({

      ok: true,

      source:
        "CoinGecko",

      updated:
        new Date().toISOString(),

      btc: {

        signal,

        score,

        price,

        phase,

        trade: {

          entry,
          sl,
          tp1,
          tp2,
          rr

        },

        timeframes

      },

      market: {

        price,

        change,

        changeAmount:
          price - previous,

        high:
          Math.max(
            ...m5.slice(-288)
              .map(x => x.high)
          ),

        low:
          Math.min(
            ...m5.slice(-288)
              .map(x => x.low)
          ),

        volume:
          m5.slice(-288)
            .reduce(
              (a,b) =>
                a + b.volume,
              0
            ),

        orderBook: {

          bidVolume: null,

          askVolume: null,

          imbalance: null,

          pressure:
            "Order book unavailable from CoinGecko"

        }

      },

      whale: {

        whaleProxy: {

          largeTrades: null,

          buyValue: null,

          sellValue: null,

          bias:
            "Whale data unavailable"

        },

        futures: {

          fundingRate: null,

          openInterest: null,

          markPrice: null

        }

      }

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
        "BTC data unavailable"

    });

  }

}
