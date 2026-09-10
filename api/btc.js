// Compatibility BTC price endpoint. No API key required.
module.exports = async function handler(req,res){
  try{
    const r=await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',{cache:'no-store'});
    if(!r.ok)throw new Error(`Binance HTTP ${r.status}`);
    const x=await r.json();
    res.status(200).json({ok:true,symbol:'BTCUSD',price:Number(x.lastPrice),volume:Number(x.volume),source:'Binance Public Spot Data',updated:new Date().toISOString()});
  }catch(e){res.status(502).json({ok:false,error:e.message||'BTC price unavailable'});}
};
