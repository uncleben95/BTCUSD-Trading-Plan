// =====================================================
// BTC MARKET DATA
// Coinbase Public API
// =====================================================

export default async function handler(req, res) {

  try {

    const product =
      "BTC-USD";

    const tickerURL =
      `https://api.exchange.coinbase.com/products/${product}/ticker`;

    const statsURL =
      `https://api.exchange.coinbase.com/products/${product}/stats`;

    const bookURL =
      `https://api.exchange.coinbase.com/products/${product}/book?level=2`;

    const [
      tickerRes,
      statsRes,
      bookRes
    ] = await Promise.all([

      fetch(tickerURL, {
        cache: "no-store"
      }),

      fetch(statsURL, {
        cache: "no-store"
      }),

      fetch(bookURL, {
        cache: "no-store"
      })

    ]);

    if (
      !tickerRes.ok ||
      !statsRes.ok ||
      !bookRes.ok
    ) {

      throw new Error(
        "Coinbase market API failed"
      );

    }

    const ticker =
      await tickerRes.json();

    const stats =
      await statsRes.json();

    const book =
      await bookRes.json();

    const price =
      Number(ticker.price);

    const open =
      Number(stats.open);

    const high =
      Number(stats.high);

    const low =
      Number(stats.low);

    const volume =
      Number(stats.volume);

    const change =
      open
        ? ((price - open) / open) * 100
        : 0;

    const changeAmount =
      price - open;

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

    const total =
      bidVolume +
      askVolume;

    const imbalance =
      total > 0
        ? (
            (bidVolume - askVolume) /
            total
          ) * 100
        : 0;

    let pressure =
      "NEUTRAL";

    if (imbalance >= 15)
      pressure =
        "BUYING PRESSURE";

    else if (imbalance <= -15)
      pressure =
        "SELLING PRESSURE";

    res.status(200).json({

      ok: true,

      source:
        "Coinbase Public Market Data",

      price,

      change,

      changeAmount,

      high,

      low,

      volume,

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

    res.status(500).json({

      ok: false,

      error:
        error.message ||
        "Market data unavailable"

    });

  }

}
