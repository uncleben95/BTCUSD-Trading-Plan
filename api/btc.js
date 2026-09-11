// BTCUSD Signal Engine
// M15 = direction/confirmation
// M5  = trigger
// No order execution. No web-push dependency.

const CB = 'https://api.exchange.coinbase.com';
const KR = 'https://api.kraken.com/0/public';

async function json(url) {
  const r = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BTCUSD-Signal-Engine/1.0'
    }
  });

  const text = await r.text();

  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
  }

  return JSON.parse(text);
}

function ema(values, period) {
  if (!values.length) return 0;

  const k = 2 / (period + 1);
  let e = values[0];

  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }

  return e;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];

    if (d >= 0) gain += d;
    else loss -= d;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];

    avgGain =
      (avgGain * (period - 1) + (d > 0 ? d : 0)) /
      period;

    avgLoss =
      (avgLoss * (period - 1) + (d < 0 ? -d : 0)) /
      period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length <= period) return 0;

  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    tr.push(
      Math.max(
        c.h - c.l,
        Math.abs(c.h - p.c),
        Math.abs(c.l - p.c)
      )
    );
  }

  return (
    tr.slice(-period).reduce((a, b) => a + b, 0) /
    period
  );
}

function normalizeCoinbase(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(x => ({
      t: Number(x[0]) * 1000,
      l: Number(x[1]),
      h: Number(x[2]),
      o: Number(x[3]),
      c: Number(x[4]),
      v: Number(x[5])
    }))
    .filter(x =>
      Object.values(x).every(Number.isFinite)
    )
    .sort((a, b) => a.t - b.t);
}

function normalizeKraken(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(x => ({
      t: Number(x[0]) * 1000,
      o: Number(x[1]),
      h: Number(x[2]),
      l: Number(x[3]),
      c: Number(x[4]),
      v: Number(x[6])
    }))
    .filter(x =>
      Object.values(x).every(Number.isFinite)
    )
    .sort((a, b) => a.t - b.t);
}

async function getCandles(interval) {
  const seconds = {
    '5m': 300,
    '15m': 900
  }[interval];

  if (!seconds) {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - seconds * 220;

  try {
    const raw = await json(
      `${CB}/products/BTC-USD/candles` +
      `?granularity=${seconds}` +
      `&start=${new Date(start * 1000).toISOString()}` +
      `&end=${new Date(end * 1000).toISOString()}`
    );

    const candles = normalizeCoinbase(raw);

    if (candles.length >= 50) {
      return {
        candles: candles.slice(-220),
        source: 'Coinbase Exchange'
      };
    }

    throw new Error('Coinbase returned too few candles');
  } catch (coinbaseError) {
    const krakenInterval = {
      '5m': 5,
      '15m': 15
    }[interval];

    const raw = await json(
      `${KR}/OHLC?pair=XBTUSD&interval=${krakenInterval}`
    );

    const key = Object.keys(raw.result || {})
      .find(k => k !== 'last');

    const candles = normalizeKraken(
      key ? raw.result[key] : []
    );

    if (!candles.length) {
      throw coinbaseError;
    }

    return {
      candles: candles.slice(-220),
      source: 'Kraken Public',
      fallback: true
    };
  }
}

function analyse(candles, timeframe) {
  if (!candles || candles.length < 60) {
    throw new Error(`${timeframe} insufficient candle data`);
  }

  const closes = candles.map(x => x.c);

  const price = closes[closes.length - 1];

  const ema20 = ema(closes.slice(-80), 20);
  const ema50 = ema(closes.slice(-120), 50);

  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);

  const previous = candles[candles.length - 2];

  const last = candles[candles.length - 1];

  const bullishStructure =
    price > ema20 &&
    ema20 > ema50;

  const bearishStructure =
    price < ema20 &&
    ema20 < ema50;

  const bullishMomentum =
    rsi14 >= 55;

  const bearishMomentum =
    rsi14 <= 45;

  const bullishCandle =
    last.c > last.o &&
    last.c >= previous.c;

  const bearishCandle =
    last.c < last.o &&
    last.c <= previous.c;

  let score = 50;

  if (bullishStructure) score += 25;
  if (bearishStructure) score -= 25;

  if (bullishMomentum) score += 15;
  if (bearishMomentum) score -= 15;

  if (bullishCandle) score += 10;
  if (bearishCandle) score -= 10;

  score = Math.max(0, Math.min(100, score));

  let condition = 'WAIT';

  if (
    bullishStructure &&
    bullishMomentum &&
    bullishCandle &&
    score >= 70
  ) {
    condition = 'BUY';
  }

  if (
    bearishStructure &&
    bearishMomentum &&
    bearishCandle &&
    score <= 30
  ) {
    condition = 'SELL';
  }

  return {
    timeframe,
    price,
    ema20,
    ema50,
    rsi: rsi14,
    atr: atr14,
    score,
    condition,
    candle: {
      open: last.o,
      high: last.h,
      low: last.l,
      close: last.c
    }
  };
}

function buildTrade(signal) {
  const entry = signal.price;
  const atrValue = signal.atr;

  if (!Number.isFinite(entry) || !Number.isFinite(atrValue) || atrValue <= 0) {
    return null;
  }

  if (signal.condition === 'BUY') {
    return {
      side: 'BUY',
      entry,
      sl: entry - atrValue * 1.2,
      tp1: entry + atrValue * 1.0,
      tp2: entry + atrValue * 2.0,
      tp3: entry + atrValue * 3.0
    };
  }

  if (signal.condition === 'SELL') {
    return {
      side: 'SELL',
      entry,
      sl: entry + atrValue * 1.2,
      tp1: entry - atrValue * 1.0,
      tp2: entry - atrValue * 2.0,
      tp3: entry - atrValue * 3.0
    };
  }

  return null;
}

module.exports = async function handler(req, res) {
  try {
    const [m15Data, m5Data, ticker] =
      await Promise.all([
        getCandles('15m'),
        getCandles('5m'),
        getTicker()
      ]);

    const m15 = analyse(
      m15Data.candles,
      'M15'
    );

    const m5 = analyse(
      m5Data.candles,
      'M5'
    );

    let signal = 'WAIT';
    let reason = 'M15 and M5 are not aligned';

    if (
      m15.condition === 'BUY' &&
      m5.condition === 'BUY'
    ) {
      signal = 'BUY';
      reason = 'M15 + M5 bullish alignment';
    }

    if (
      m15.condition === 'SELL' &&
      m5.condition === 'SELL'
    ) {
      signal = 'SELL';
      reason = 'M15 + M5 bearish alignment';
    }

    const finalSignal = {
      signal,
      reason,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null
    };

    if (signal !== 'WAIT') {
      const trade = buildTrade({
        condition: signal,
        price: ticker.price,
        atr: m5.atr
      });

      if (trade) {
        finalSignal.entry = trade.entry;
        finalSignal.sl = trade.sl;
        finalSignal.tp1 = trade.tp1;
        finalSignal.tp2 = trade.tp2;
        finalSignal.tp3 = trade.tp3;
      }
    }

    return res.status(200).json({
      ok: true,
      symbol: 'BTCUSD',
      mode: 'SCALP',
      architecture: 'M15 CONFIRMATION + M5 TRIGGER',
      price: ticker.price,
      signal: finalSignal,
      analysis: {
        m15,
        m5
      },
      sources: {
        price: ticker.source,
        m15: m15Data.source,
        m5: m5Data.source
      },
      notification: {
        ready: false,
        note: 'Signal engine ready. Notification layer not connected yet.'
      },
      updated: new Date().toISOString()
    });

  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: e.message || 'BTC signal engine unavailable',
      updated: new Date().toISOString()
    });
  }
};

async function getTicker() {
  try {
    const x = await json(
      `${CB}/products/BTC-USD/ticker`
    );

    return {
      price: Number(x.price),
      source: 'Coinbase Exchange'
    };
  } catch (coinbaseError) {
    const x = await json(
      `${KR}/Ticker?pair=XBTUSD`
    );

    const key =
      Object.keys(x.result || {})[0];

    const price =
      Number(x.result?.[key]?.c?.[0]);

    if (!Number.isFinite(price)) {
      throw coinbaseError;
    }

    return {
      price,
      source: 'Kraken Public'
    };
  }
}
