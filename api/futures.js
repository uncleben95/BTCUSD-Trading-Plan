// Public BTCUSDT perpetual sentiment proxies from Binance Futures.
export default async function handler(req, res) {
  try {
    const base="https://fapi.binance.com/fapi/v1";
    const [premiumRes, oiRes] = await Promise.all([
      fetch(`${base}/premiumIndex?symbol=BTCUSDT`,{cache:"no-store"}),
      fetch(`${base}/openInterest?symbol=BTCUSDT`,{cache:"no-store"})
    ]);
    if(!premiumRes.ok || !oiRes.ok) throw new Error("Futures sentiment API failed");
    const [premium,oi]=await Promise.all([premiumRes.json(),oiRes.json()]);
    res.status(200).json({ok:true,source:"Binance Futures Public Data",fundingRate:Number(premium.lastFundingRate),markPrice:Number(premium.markPrice),indexPrice:Number(premium.indexPrice),openInterestBTC:Number(oi.openInterest),updated:new Date().toISOString()});
  } catch(error) { res.status(500).json({ok:false,error:error.message||"Futures sentiment unavailable"}); }
}
