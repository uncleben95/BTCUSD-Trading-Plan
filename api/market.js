export default async function handler(req, res) {

  try {

    const response =
      await fetch(
        "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
        {
          headers: {
            "Accept":
              "application/json"
          }
        }
      );

    if (!response.ok)
      throw new Error(
        `Binance HTTP ${response.status}`
      );

    const d =
      await response.json();

    const orderbookResponse =
      await fetch(
        "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100"
      );

    if (!orderbookResponse.ok)
      throw new Error(
        "Order book unavailable"
      );

    const ob =
      await orderbookResponse.json();

    let bidVolume = 0;
    let askVolume = 0;

    for (
      const bid of ob.bids
    ) {

      bidVolume +=
        Number(bid[1]);

    }

    for (
      const ask of ob.asks
    ) {

      askVolume +=
        Number(ask[1]);

    }

    const total =
      bidVolume + askVolume;

    const imbalance =
      total > 0
        ? (
            (bidVolume -
             askVolume) /
            total
          ) * 100
        : 0;

    let pressure =
      "BALANCED";

    if (imbalance > 10)
      pressure =
        "BUY PRESSURE";

    else if (imbalance < -10)
      pressure =
        "SELL PRESSURE";


    res.setHeader(
      "Cache-Control",
      "s-maxage=3, stale-while-revalidate=10"
    );

    return res.status(200).json({

      price:
        Number(d.lastPrice),

      change:
        Number(d.priceChangePercent),

      changeAmount:
        Number(d.priceChange),

      high:
        Number(d.highPrice),

      low:
        Number(d.lowPrice),

      volume:
        Number(d.volume),

      orderBook: {

        bidVolume,

        askVolume,

        imbalance,

        pressure

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
