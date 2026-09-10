// BTC large-trade / whale-flow proxy.
// Uses recent Binance spot trades. This cannot identify a real wallet owner.
const BASE = 'https://api.binance.com/api/v3';
async function json(url){
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'BTCUSD-Market-Intelligence/4.0'}});
  const text=await r.text();
  if(!r.ok) throw new Error(`Upstream HTTP ${r.status}: ${text.slice(0,180)}`);
  try{return JSON.parse(text)}catch{throw new Error('Upstream returned invalid JSON')}
}
module.exports=async function handler(req,res){
  try{
    const q=req.query||{};
    const raw=Number(q.threshold);
    const threshold=Math.max(0.05,Math.min(Number.isFinite(raw)&&raw>0?raw:0.5,100));
    const trades=await json(`${BASE}/trades?symbol=BTCUSDT&limit=1000`);
    let buyValue=0,sellValue=0,buyBTC=0,sellBTC=0,largeTrades=0,largest=null;
    for(const t of (Array.isArray(trades)?trades:[])){
      const qty=Number(t.qty)||0, price=Number(t.price)||0, value=qty*price;
      // isBuyerMaker=false means aggressive buyer; true means aggressive seller.
      const side=t.isBuyerMaker?'sell':'buy';
      if(qty>=threshold) largeTrades++;
      if(!largest||value>largest.value) largest={size:qty,price,value,side,time:t.time?new Date(t.time).toISOString():null};
      if(side==='buy'){buyValue+=value;buyBTC+=qty}else{sellValue+=value;sellBTC+=qty}
    }
    const total=buyValue+sellValue, imbalance=total?((buyValue-sellValue)/total)*100:0;
    res.status(200).json({
      ok:true,source:'Binance Public Spot Trades',thresholdBTC:threshold,
      whaleProxy:{largeTrades,buyValue,sellValue,buyBTC,sellBTC,flowImbalance:imbalance,bias:imbalance>=15?'BUY FLOW':imbalance<=-15?'SELL FLOW':'NEUTRAL',largest},
      note:'Large exchange trades are a flow proxy; they do not prove a specific whale wallet or intent.',updated:new Date().toISOString()
    });
  }catch(error){console.error(error);res.status(502).json({ok:false,error:error.message||'Whale data unavailable'});}
};
