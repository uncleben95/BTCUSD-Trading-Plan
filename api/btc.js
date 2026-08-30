export default async function handler(req, res) {

    try {

        const path =
            req.query.path || "ticker/24hr";

        const symbol =
            req.query.symbol || "BTCUSDT";

        const interval =
            req.query.interval || "15m";

        let url =
            "https://fapi.binance.com/fapi/v1/" +
            path +
            "?symbol=" +
            encodeURIComponent(symbol);

        if(path === "klines"){

            url +=
                "&interval=" +
                encodeURIComponent(interval) +
                "&limit=150";

        }

        const response =
            await fetch(url);

        if(!response.ok){

            return res.status(
                response.status
            ).json({
                error:
                    "Binance HTTP " +
                    response.status
            });

        }

        const data =
            await response.json();

        return res.status(200).json(data);

    } catch(error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }

}
