// ============================================================
// BTC MARKET DATA
// Price / Order Book / Volume
// ============================================================

const SPOT =
  "https://api.binance.com/api/v3";

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
      ticker,
      book
    ] = await Promise.all([

      getJSON(
        `${SPOT}/ticker/24hr?symbol=BTCUSDT`
      ),

      getJSON(
        `${SPOT}/depth?symbol=BTCUSDT&limit=100`
      )

    ]);

    const bids =
      book.bids.map(x => ({
        price: Number(x[0]),
        quantity: Number(x[1])
      }));

    const asks =
      book.asks.map(x => ({
        price: Number(x[0]),
        quantity: Number(x[1])
      }));

    const bidVolume =
      bids.reduce(
        (sum, x) =>
          sum + x.quantity,
        0
      );

    const askVolume =
      asks.reduce(
        (sum, x) =>
          sum + x.quantity,
        0
      );

    const total =
      bidVolume + askVolume;

    const imbalance =
      total
        ? ((bidVolume - askVolume) / total) * 100
        : 0;

    let pressure =
      "BALANCED";

    if (imbalance >= 10) {
      pressure = "BUY PRESSURE";
    }

    if (imbalance <= -10) {
      pressure = "SELL PRESSURE";
    }

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({

      ok: true,

      source: "Binance",

      price:
        Number(ticker.lastPrice),

      change:
        Number(ticker.priceChangePercent),

      changeAmount:
        Number(ticker.priceChange),

      high:
        Number(ticker.highPrice),

      low:
        Number(ticker.lowPrice),

      volume:
        Number(ticker.volume),

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

    console.error(
      "MARKET API ERROR",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        error?.message ||
        "Market data unavailable"

    });
  }
}
