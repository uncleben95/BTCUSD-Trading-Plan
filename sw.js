const CACHE = "btc-intel-v4";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        "/",
        "/index.html",
        "/manifest.json"
      ])
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});


/* =========================
   NORMAL CACHE
========================= */

self.addEventListener("fetch", event => {

  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {

      if (cached) return cached;

      return fetch(event.request)
        .then(response => {

          const copy = response.clone();

          caches.open(CACHE).then(cache => {
            cache.put(event.request, copy);
          });

          return response;

        })
        .catch(() =>
          caches.match("/index.html")
        );

    })
  );

});


/* =========================
   PUSH NOTIFICATION
========================= */

self.addEventListener("push", event => {

  let data = {};

  try {

    data = event.data
      ? event.data.json()
      : {};

  } catch (e) {

    data = {
      title: "BTCUSD Trading Plan",
      body: event.data
        ? event.data.text()
        : "New BTC signal"
    };

  }

  const title =
    data.title ||
    "BTCUSD Trading Plan";

  const options = {

    body:
      data.body ||
      "New BTC signal detected",

    icon:
      data.icon ||
      "/icon.png",

    badge:
      data.badge ||
      "/icon.png",

    tag:
      data.tag ||
      "btc-signal",

    renotify: true,

    data: {

      url:
        data.url ||
        "/",

      signal:
        data.signal ||
        null,

      entry:
        data.entry ||
        null,

      sl:
        data.sl ||
        null,

      tp1:
        data.tp1 ||
        null,

      tp2:
        data.tp2 ||
        null,

      tp3:
        data.tp3 ||
        null

    }

  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options
    )
  );

});


/* =========================
   NOTIFICATION CLICK
========================= */

self.addEventListener(
  "notificationclick",
  event => {

    event.notification.close();

    const url =
      event.notification.data?.url ||
      "/";

    event.waitUntil(

      clients.matchAll({
        type: "window",
        includeUncontrolled: true
      }).then(clientList => {

        for (const client of clientList) {

          if (
            "focus" in client &&
            client.url.includes(
              self.location.origin
            )
          ) {

            return client.focus();

          }

        }

        if (clients.openWindow) {

          return clients.openWindow(url);

        }

      })

    );

  }
);
