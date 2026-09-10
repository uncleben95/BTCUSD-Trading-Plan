// BTCUSD market proxy for Vercel.
// Primary source: Binance public BTCUSDT spot endpoints (no API key).
const BASE = 'https://api.binance.com/api/v3';

async function json(url) {
  const r = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'BTCUSD-Market-Intelligence/4.0' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Upstream HTTP ${r.status}: ${text.slice(0,180)}`);
  try { return JSON.parse(text); } catch { throw new Error('Upstream returned invalid JSON'); }
}

module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};

    if (q.type === 'candles') {
      const allowed = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d']);
      const interval = allowed.has(String(q.interval)) ? String(q.interval) : ({60:'1m',300:'5m',900:'15m',1800:'30m',3600:'1h',21600:'6h',86400:'1d'}[Number(q.granularity)] || '1h');
      const limit = Math.min(1000, Math.max(100, Number(q.limit) || 500));
      const raw = await json(`${BASE}/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
      const candles = Array.isArray(raw) ? raw.map(x => ({
        t:Number(x[0]), o:Number(x[1]), h:Number(x[2]), l:Number(x[3]), c:Number(x[4]), v:Number(x[5])
      })).filter(x => [x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite)) : [];
      return res.status(200).json({ ok:true, source:'Binance Public Spot Data', symbol:'BTCUSDT', interval, candles, updated:new Date().toISOString() });
    }

    const [ticker, depth] = await Promise.all([
      json(`${BASE}/ticker/24hr?symbol=BTCUSDT`),
      json(`${BASE}/depth?symbol=BTCUSDT&limit=50`)
    ]);
    const price = Number(ticker.lastPrice);
    const bidVolume = (depth.bids || []).reduce((s,x)=>s+(Number(x[1])||0),0);
    const askVolume = (depth.asks || []).reduce((s,x)=>s+(Number(x[1])||0),0);
    const total = bidVolume + askVolume;
    const imbalance = total ? ((bidVolume-askVolume)/total)*100 : 0;
    res.status(200).json({
      ok:true, source:'Binance Public Spot Data', symbol:'BTCUSDT', price,
      change:Number(ticker.priceChangePercent)||0, changeAmount:Number(ticker.priceChange)||0,
      high:Number(ticker.highPrice)||0, low:Number(ticker.lowPrice)||0, volume:Number(ticker.volume)||0,
      orderBook:{ bidVolume, askVolume, imbalance, pressure:imbalance>=15?'BUYING PRESSURE':imbalance<=-15?'SELLING PRESSURE':'NEUTRAL' },
      updated:new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ ok:false, error:error.message || 'Market data unavailable' });
  }
};
