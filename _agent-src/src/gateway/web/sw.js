/* 遥测 · 会话查看器 — Service Worker（静态资源缓存 + 离线兜底） */
const CACHE = 'floria-v49'
const CORE = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon.ico',
  './char/1.jpg', './char/2.jpg', './char/3.jpg', './char/4.jpg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// 网络优先，失败回退缓存（静态）；API 不缓存
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('./'))),
  )
})
