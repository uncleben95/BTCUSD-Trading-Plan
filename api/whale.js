// ============================================================
// BTC FLOW / WHALE PROXY
// Large trades + Open Interest + Funding
//
// NOTE:
// This is NOT blockchain whale wallet tracking.
// It is market-flow data.
// ============================================================

const SPOT =
  "https://api.binance.com/api/v3";

const FUTURES =
  "https://fapi.binance.com/fapi/v1";

async function getJSON(url) {

  const response =
    await fetch(url, {
      cache: "no-store"
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return response.json();
}

export default async function handler(req, res) {

  try {

    const [
      trades,
      funding,
      oi
    ] = await Promise.all([

      getJSON(
        `${SPOT}/aggTrades?symbol=BTCUSDT&limit=1000`
      ),

      getJSON(
        `${FUTURES}/premiumIndex?symbol=BTCUSDT`
      ),

      getJSON(
        `${FUTURES}/openInterest?symbol=BTCUSDT`
      )

    ]);

    const parsed =
      trades.map(t => ({

        price:
          Number(t.p),

        quantity:
          Number(t.q),

        value:
          Number(t.p) *
          Number(t.q),

        buyerMaker:
          Boolean(t.m)

      }));

    /*
      Large trade threshold:
      >= 1 BTC

      This is a market-flow proxy,
      NOT a wallet whale detector.
    */

    const large =
      parsed.filter(
        t => t.quantity >= 1
      );

    let buyValue = 0;
    let sellValue = 0;

    for (const trade of large) {

      if (trade.buyerMaker) {

        sellValue +=
          trade.value;

      } else {

        buyValue +=
          trade.value;
      }
    }

    const total =
      buyValue + sellValue;

    const flow =
      total
        ? ((buyValue - sellValue) / total) * 100
        : 0;

    let bias = "BALANCED";

    if (flow >= 10) {
      bias = "LARGE BUY FLOW";
    }

    if (flow <= -10) {
      bias = "LARGE SELL FLOW";
    }

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({

      ok: true,

      source: "Binance",

      whaleProxy: {

        status:
          large.length
            ? "AVAILABLE"
            : "NO LARGE TRADES",

        largeTrades:
          large.length,

        buyValue,

        sellValue,

        flow,

        bias

      },

      futures: {

        fundingRate:
          Number(
            funding.lastFundingRate
          ),

        markPrice:
          Number(
            funding.markPrice
          ),

        openInterest:
          Number(
            oi.openInterest
          )

      },

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(
      "WHALE API ERROR",
      error
    );

    return res.status(200).json({

      ok: false,

      error:
        error?.message ||
        "Flow data unavailable",

      whaleProxy: {
        status: "UNAVAILABLE"
      }

    });

  }

}
