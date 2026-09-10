// Optional futures data. Binance is intentionally NOT used because the deployment
// environment returned HTTP 451. Endpoint stays healthy and reports unavailable data.
module.exports=async function handler(req,res){
 return res.status(200).json({ok:true,available:false,source:'Unavailable in current deployment',fundingRate:null,markPrice:null,indexPrice:null,openInterest:null,note:'Futures provider disabled after restricted-location response. Spot/market data remains available.',updated:new Date().toISOString()});
}
