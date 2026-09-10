// Compatibility BTC price endpoint. Public data only; Coinbase first, Kraken fallback.
module.exports=async function handler(req,res){
 try{const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker',{cache:'no-store'});if(!r.ok)throw new Error(`Coinbase HTTP ${r.status}`);const x=await r.json();return res.status(200).json({ok:true,symbol:'BTCUSD',price:Number(x.price),source:'Coinbase Exchange',updated:new Date().toISOString()})}
 catch(e){try{const r=await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD',{cache:'no-store'});if(!r.ok)throw new Error(`Kraken HTTP ${r.status}`);const x=await r.json(),k=Object.keys(x.result||{})[0];return res.status(200).json({ok:true,symbol:'BTCUSD',price:Number(x.result[k].c[0]),source:'Kraken Public',updated:new Date().toISOString(),fallback:true})}catch(e2){return res.status(502).json({ok:false,error:e2.message||e.message})}}
}
