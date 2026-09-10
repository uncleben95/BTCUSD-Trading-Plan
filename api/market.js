// BTC market data + order-book pressure. Public Coinbase API only.
export default async function handler(req, res) {
  try {
    const product = "BTC-USD";
    const base = `https://api.exchange.coinbase.com/products/${product}`;
    const [tickerRes, statsRes, bookRes] = await Promise.all([
      fetch(`${base}/ticker`, { cache: "no-store" }),
      fetch(`${base}/stats`, { cache: "no-store" }),
      fetch(`${base}/book?level=2`, { cache: "no-store" })
    ]);
    if (!tickerRes.ok || !statsRes.ok || !bookRes.ok) throw new Error("Coinbase market API failed");
    const [ticker, stats, book] = await Promise.all([tickerRes.json(), statsRes.json(), bookRes.json()]);
    const price = Number(ticker.price), open = Number(stats.open);
    const bid = (book.bids || []).slice(0, 50).reduce((s, x) => s + (Number(x[1]) || 0), 0);
    const ask = (book.asks || []).slice(0, 50).reduce((s, x) => s + (Number(x[1]) || 0), 0);
    const total = bid + ask;
    const imbalance = total ? ((bid - ask) / total) * 100 : 0;
    res.status(200).json({
      ok: true, source: "Coinbase Public Market Data", price,
      change: open ? ((price-open)/open)*100 : 0,
      changeAmount: price-open, high: Number(stats.high), low: Number(stats.low), volume: Number(stats.volume),
      orderBook: { bidVolume: bid, askVolume: ask, imbalance, pressure: imbalance >= 15 ? "BUYING PRESSURE" : imbalance <= -15 ? "SELLING PRESSURE" : "NEUTRAL" },
      updated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok:false, error: error.message || "Market data unavailable" });
  }
}
