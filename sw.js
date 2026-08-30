const CACHE_NAME =
  "btc-monitor-v2";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener(
  "install",
  event => {

    event.waitUntil(

      caches.open(
        CACHE_NAME
      ).then(cache =>
        cache.addAll(
          APP_SHELL
        )
      )

    );

    self.skipWaiting();
  }
);

self.addEventListener(
  "activate",
  event => {

    event.waitUntil(

      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(
              key =>
                key !== CACHE_NAME
            )
            .map(key =>
              caches.delete(key)
            )
        )
      )

    );

    self.clients.claim();
  }
);

self.addEventListener(
  "fetch",
  event => {

    const request =
      event.request;

    if (
      request.method !== "GET"
    ) {
      return;
    }

    /*
      API jangan cache melalui
      service worker.
    */

    if (
      new URL(
        request.url
      ).pathname.startsWith("/api/")
    ) {
      return;
    }

    event.respondWith(

      caches.match(
        request
      ).then(cached => {

        if (cached) {

          fetch(request)
            .then(response => {

              if (
                response.ok
              ) {

                caches.open(
                  CACHE_NAME
                ).then(cache =>
                  cache.put(
                    request,
                    response
                  )
                );

              }

            })
            .catch(() => {});

          return cached;
        }

        return fetch(request);

      })

    );
  }
);
