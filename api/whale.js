// =====================================================
// BTC LARGE TRADE / WHALE PROXY
// Coinbase Public Trades
// =====================================================

export default async function handler(req, res) {

  try {

    const tradesURL =
      "https://api.exchange.coinbase.com/products/BTC-USD/trades";

    const bookURL =
      "https://api.exchange.coinbase.com/products/BTC-USD/book?level=2";

    const [
      tradesRes,
      bookRes
    ] = await Promise.all([

      fetch(tradesURL, {
        cache: "no-store"
      }),

      fetch(bookURL, {
        cache: "no-store"
      })

    ]);

    if (
      !tradesRes.ok ||
      !bookRes.ok
    ) {

      throw new Error(
        "Flow API unavailable"
      );

    }

    const trades =
      await tradesRes.json();

    const book =
      await bookRes.json();

    let buyValue = 0;
    let sellValue = 0;

    let largeTrades = 0;

    const LARGE_TRADE_BTC =
      0.50;

    if (
      Array.isArray(trades)
    ) {

      for (
        const trade of trades
      ) {

        const size =
          Number(trade.size) || 0;

        const price =
          Number(trade.price) || 0;

        const value =
          size * price;

        /*
          Coinbase trade side:
          "buy" / "sell"
        */

        if (
          size >= LARGE_TRADE_BTC
        ) {

          largeTrades++;

        }

        if (
          trade.side === "buy"
        ) {

          buyValue += value;

        }

        else if (
          trade.side === "sell"
        ) {

          sellValue += value;

        }

      }

    }

    const totalFlow =
      buyValue +
      sellValue;

    const flowImbalance =
      totalFlow > 0
        ? (
            (buyValue - sellValue) /
            totalFlow
          ) * 100
        : 0;

    let bias =
      "NEUTRAL";

    if (
      flowImbalance >= 15
    )
      bias =
        "BUY FLOW";

    else if (
      flowImbalance <= -15
    )
      bias =
        "SELL FLOW";

    let bidVolume = 0;
    let askVolume = 0;

    if (
      Array.isArray(book.bids)
    ) {

      for (
        const bid of book.bids.slice(0, 50)
      ) {

        bidVolume +=
          Number(bid[1]) || 0;

      }

    }

    if (
      Array.isArray(book.asks)
    ) {

      for (
        const ask of book.asks.slice(0, 50)
      ) {

        askVolume +=
          Number(ask[1]) || 0;

      }

    }

    res.status(200).json({

      ok: true,

      source:
        "Coinbase Public Trades",

      whaleProxy: {

        largeTrades,

        buyValue,

        sellValue,

        flowImbalance,

        bias

      },

      futures: {

        /*
          Coinbase spot does not provide
          Binance-style funding/open-interest.
          Keep these explicitly unavailable
          instead of fake numbers.
        */

        fundingRate:
          null,

        openInterest:
          null,

        markPrice:
          null

      },

      orderBook: {

        bidVolume,

        askVolume

      },

      updated:
        new Date().toISOString()

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({

      ok: false,

      error:
        error.message ||
        "Whale data unavailable"

    });

  }

}
