// Large-trade flow proxy. This is NOT wallet identification.
async function j(url){const r=await fetch(url,{cache:'no-store',headers:{'Accept':'application/json','User-Agent':'BTCUSD-Market-Dashboard/6.0'}});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,160)}`);return JSON.parse(t)}
module.exports=async function handler(req,res){
 const q=req.query||{}, raw=Number(q.threshold), threshold=Math.max(0.05,Math.min(Number.isFinite(raw)&&raw>0?raw:0.5,50));
 try{
  const trades=await j('https://api.exchange.coinbase.com/products/BTC-USD/trades');
  let buyValue=0,sellValue=0,buyBTC=0,sellBTC=0,largeTrades=0,largest=null;
  for(const t of (Array.isArray(trades)?trades:[])){const qty=Number(t.size)||0,price=Number(t.price)||0,value=qty*price;const side=String(t.side).toLowerCase()==='sell'?'sell':'buy';if(qty>=threshold)largeTrades++;if(!largest||value>largest.value)largest={size:qty,price,value,side,time:t.time||null};if(side==='buy'){buyValue+=value;buyBTC+=qty}else{sellValue+=value;sellBTC+=qty}}
  const total=buyValue+sellValue,imbalance=total?((buyValue-sellValue)/total)*100:0;
  return res.status(200).json({ok:true,source:'Coinbase Exchange trades',thresholdBTC:threshold,whaleProxy:{largeTrades,buyValue,sellValue,buyBTC,sellBTC,flowImbalance:imbalance,bias:imbalance>=15?'BUY FLOW':imbalance<=-15?'SELL FLOW':'NEUTRAL',largest},note:'Large exchange trades are only a flow proxy; they do not identify a wallet or prove intent.',updated:new Date().toISOString()})
 }catch(e){
  try{const raw=await j('https://api.kraken.com/0/public/Trades?pair=XBTUSD'),key=Object.keys(raw.result||{}).find(k=>k!=='last'),trades=key?raw.result[key]:[];let buyValue=0,sellValue=0,buyBTC=0,sellBTC=0,largeTrades=0,largest=null;for(const t of trades){const price=Number(t[0])||0,qty=Number(t[1])||0,value=price*qty,side=String(t[3]).toLowerCase()==='s'?'sell':'buy';if(qty>=threshold)largeTrades++;if(!largest||value>largest.value)largest={size:qty,price,value,side};if(side==='buy'){buyValue+=value;buyBTC+=qty}else{sellValue+=value;sellBTC+=qty}}const total=buyValue+sellValue,imbalance=total?((buyValue-sellValue)/total)*100:0;return res.status(200).json({ok:true,source:'Kraken public trades',thresholdBTC:threshold,whaleProxy:{largeTrades,buyValue,sellValue,buyBTC,sellBTC,flowImbalance:imbalance,bias:imbalance>=15?'BUY FLOW':imbalance<=-15?'SELL FLOW':'NEUTRAL',largest},note:'Fallback provider. Large exchange trades are only a flow proxy.',updated:new Date().toISOString(),fallback:true})}catch(e2){return res.status(502).json({ok:false,error:e2.message||e.message})}
 }
}
