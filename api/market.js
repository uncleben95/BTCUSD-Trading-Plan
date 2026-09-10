// Vercel market-data proxy. Uses public Coinbase Exchange data first,
// with Kraken as a fallback. No API key required.
const CB='https://api.exchange.coinbase.com';
const KR='https://api.kraken.com/0/public';
const map={
 '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'12h':43200,'1d':86400
};
async function j(url){const r=await fetch(url,{cache:'no-store',headers:{'Accept':'application/json','User-Agent':'BTCUSD-Market-Dashboard/6.0'}});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,160)}`);return JSON.parse(t)}
function interval(v){v=String(v||'1h');return map[v]?v:'1h'}
function normCB(rows){return (Array.isArray(rows)?rows:[]).map(x=>({t:Number(x[0])*1000,l:Number(x[1]),h:Number(x[2]),o:Number(x[3]),c:Number(x[4]),v:Number(x[5])})).filter(x=>Object.values(x).every(Number.isFinite)).sort((a,b)=>a.t-b.t)}
function normKR(rows){return (Array.isArray(rows)?rows:[]).map(x=>({t:Number(x[0])*1000,o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[6])})).filter(x=>Object.values(x).every(Number.isFinite)).sort((a,b)=>a.t-b.t)}
module.exports=async function handler(req,res){
 try{
  const q=req.query||{};
  if(q.type==='candles'){
   const tf=interval(q.interval||({60:'1m',300:'5m',900:'15m',1800:'30m',3600:'1h',21600:'6h',86400:'1d'}[Number(q.granularity)]||'1h'));
   const sec=map[tf], limit=Math.min(300,Math.max(100,Number(q.limit)||220)), end=Math.floor(Date.now()/1000), start=end-sec*limit;
   try{
    const raw=await j(`${CB}/products/BTC-USD/candles?granularity=${sec}&start=${new Date(start*1000).toISOString()}&end=${new Date(end*1000).toISOString()}`);
    const candles=normCB(raw).slice(-limit);
    if(candles.length>=50)return res.status(200).json({ok:true,source:'Coinbase Exchange',symbol:'BTC-USD',interval:tf,candles,updated:new Date().toISOString()});
    throw new Error('Coinbase returned too few candles');
   }catch(cbErr){
    const krInt={60:1,300:5,900:15,1800:30,3600:60,21600:240,86400:1440}[sec]||60;
    const raw=await j(`${KR}/OHLC?pair=XBTUSD&interval=${krInt}`); const key=Object.keys(raw.result||{}).find(k=>k!=='last');
    const candles=normKR(key?raw.result[key]:[]).slice(-limit);
    if(!candles.length)throw cbErr;
    return res.status(200).json({ok:true,source:'Kraken Public',symbol:'XBTUSD',interval:tf,candles,updated:new Date().toISOString(),fallback:true});
   }
  }
  try{
   const [ticker,book]=await Promise.all([j(`${CB}/products/BTC-USD/ticker`),j(`${CB}/products/BTC-USD/book?level=2`)]);
   const stats=await j(`${CB}/products/BTC-USD/stats`);
   const bids=(book.bids||[]).slice(0,50),asks=(book.asks||[]).slice(0,50);
   const bidVolume=bids.reduce((s,x)=>s+(Number(x[1])||0),0),askVolume=asks.reduce((s,x)=>s+(Number(x[1])||0),0),total=bidVolume+askVolume,imbalance=total?((bidVolume-askVolume)/total)*100:0;
   return res.status(200).json({ok:true,source:'Coinbase Exchange',symbol:'BTC-USD',price:Number(ticker.price),change:Number(stats.last)?((Number(stats.last)-Number(stats.open))/Number(stats.open))*100:0,high:Number(stats.high),low:Number(stats.low),volume:Number(stats.volume),orderBook:{bidVolume,askVolume,imbalance,pressure:imbalance>=15?'BUYING PRESSURE':imbalance<=-15?'SELLING PRESSURE':'NEUTRAL'},updated:new Date().toISOString()});
  }catch(cbErr){
   const raw=await j(`${KR}/Ticker?pair=XBTUSD`), k=Object.keys(raw.result||{})[0], x=raw.result?.[k];
   const price=Number(x?.c?.[0]),open=Number(x?.o),high=Number(x?.h?.[1]),low=Number(x?.l?.[1]),volume=Number(x?.v?.[1]);
   return res.status(200).json({ok:true,source:'Kraken Public',symbol:'XBTUSD',price,change:open?((price-open)/open)*100:0,high,low,volume,orderBook:{bidVolume:0,askVolume:0,imbalance:0,pressure:'UNAVAILABLE'},updated:new Date().toISOString(),fallback:true,note:'Order book unavailable on fallback provider'});
  }
 }catch(e){res.status(502).json({ok:false,error:e.message||'Market data unavailable'})}
}
