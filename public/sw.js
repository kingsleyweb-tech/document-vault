const CACHE_NAME = 'document-vault-app-v3'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/dv.png', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  const isNavigation = event.request.mode === 'navigate'

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseCopy = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseCopy)
            })
          }

          return networkResponse
        })
        .catch(() => caches.match('/index.html').then((cachedResponse) => cachedResponse ?? caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok && ['style', 'script', 'image', 'font', 'manifest'].includes(event.request.destination)) {
            const responseCopy = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseCopy)
            })
          }

          return networkResponse
        })
        .catch(() => caches.match('/index.html'))
    }),
  )
})
