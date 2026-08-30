export default async function handler(req, res) {

  try {

    const tradesResponse =
      await fetch(
        "https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=1000"
      );

    if (!tradesResponse.ok)
      throw new Error(
        "Trades unavailable"
      );

    const trades =
      await tradesResponse.json();

    let buyValue = 0;
    let sellValue = 0;

    let largeTrades = 0;

    for (
      const trade of trades
    ) {

      const price =
        Number(trade.p);

      const quantity =
        Number(trade.q);

      const value =
        price * quantity;

      /*
        Large trade proxy:
        >= $100k notional
      */

      if (
        value >= 100000
      ) {

        largeTrades++;

        if (
          trade.m === false
        )
          buyValue += value;

        else
          sellValue += value;

      }

    }


    let bias =
      "BALANCED";

    if (
      buyValue >
      sellValue * 1.20
    ) {

      bias =
        "LARGE BUY FLOW";

    }

    else if (
      sellValue >
      buyValue * 1.20
    ) {

      bias =
        "LARGE SELL FLOW";

    }


    const fundingResponse =
      await fetch(
        "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"
      );

    const funding =
      fundingResponse.ok
        ? await fundingResponse.json()
        : {};


    const oiResponse =
      await fetch(
        "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"
      );

    const oi =
      oiResponse.ok
        ? await oiResponse.json()
        : {};


    return res.status(200).json({

      whaleProxy: {

        largeTrades,

        buyValue,

        sellValue,

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

    console.error(error);

    return res.status(500).json({

      error: true,

      message:
        error.message

    });

  }

}
