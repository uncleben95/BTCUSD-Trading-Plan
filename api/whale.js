// Exchange large-trade / whale proxy. This is NOT on-chain wallet identification.
export default async function handler(req, res) {
  try {
    const threshold = Math.max(0.05, Math.min(Number(req.query?.threshold) || 0.5, 100));
    const base = "https://api.exchange.coinbase.com/products/BTC-USD";
    const [tradesRes, bookRes] = await Promise.all([
      fetch(`${base}/trades`, { cache:"no-store" }),
      fetch(`${base}/book?level=2`, { cache:"no-store" })
    ]);
    if (!tradesRes.ok || !bookRes.ok) throw new Error("Whale flow API unavailable");
    const [trades, book] = await Promise.all([tradesRes.json(), bookRes.json()]);
    let buyValue=0, sellValue=0, buyBTC=0, sellBTC=0, largeTrades=0, largest=null;
    for (const t of (Array.isArray(trades) ? trades : [])) {
      const size=Number(t.size)||0, price=Number(t.price)||0, value=size*price;
      if (size >= threshold) largeTrades++;
      if (!largest || value > largest.value) largest={size, price, value, side:t.side||"unknown", time:t.time||null};
      if (t.side === "buy") { buyValue += value; buyBTC += size; }
      if (t.side === "sell") { sellValue += value; sellBTC += size; }
    }
    const total=buyValue+sellValue, imbalance=total ? ((buyValue-sellValue)/total)*100 : 0;
    const bid=(book.bids||[]).slice(0,50).reduce((s,x)=>s+(Number(x[1])||0),0);
    const ask=(book.asks||[]).slice(0,50).reduce((s,x)=>s+(Number(x[1])||0),0);
    res.status(200).json({
      ok:true, source:"Coinbase Public Trades", thresholdBTC:threshold,
      whaleProxy:{largeTrades,buyValue,sellValue,buyBTC,sellBTC,flowImbalance:imbalance,bias:imbalance>=15?"BUY FLOW":imbalance<=-15?"SELL FLOW":"NEUTRAL",largest},
      orderBook:{bidVolume:bid,askVolume:ask},
      note:"Large exchange trades are a flow proxy; they do not prove a specific whale wallet or intent.", updated:new Date().toISOString()
    });
  } catch(error) { res.status(500).json({ok:false,error:error.message||"Whale data unavailable"}); }
}
