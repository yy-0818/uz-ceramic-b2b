/**
 * 轻量 Service Worker —— PWA 离线 shell + 静态资源缓存
 *
 * 策略：
 *   - HTML（/）：network-first（让用户看到最新版本，离线时降级到 cache）
 *   - 静态资源（/_assets/*, /icon-*.svg, /manifest.webmanifest）：
 *       cache-first（命中即返回）
 *   - API（*/rest/*, */auth/*, */functions/*）：永远不缓存
 *
 * 注意：
 *   - 部署新版本时 SW 检测到 hash 改变，会自动更新
 *   - 用户刷新页面后拿到新 assets
 */
const SW_VERSION = 'v1'
const STATIC_CACHE = `static-${SW_VERSION}`
const HTML_CACHE = `html-${SW_VERSION}`

const STATIC_HOSTS = [self.location.host]
const ALLOW_STATIC = /\/icon-.*\.svg$|^\/manifest\.webmanifest$|^\/favicon/

// 静态资源 → cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 只处理同源
  if (url.host !== self.location.host) return
  // 不缓存 API
  if (url.pathname.includes('/rest/') || url.pathname.includes('/auth/') || url.pathname.includes('/functions/')) return

  // 静态资源
  if (ALLOW_STATIC.test(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(STATIC_CACHE, req))
    return
  }

  // 其它（同源 GET）：尝试网络，失败 → 缓存（SPA 主页面都是 '/'）
  event.respondWith(networkFirst(HTML_CACHE, req))
})

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  try {
    const resp = await fetch(req)
    if (resp.ok && req.method === 'GET') cache.put(req, resp.clone())
    return resp
  } catch (e) {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(cacheName, req) {
  const cache = await caches.open(cacheName)
  try {
    const resp = await fetch(req)
    if (resp.ok && req.method === 'GET') {
      // 只缓存首页的 HTML（其它路由的 HTML 实际都一样）
      if (req.mode === 'navigate') cache.put('/', resp.clone())
    }
    return resp
  } catch (e) {
    const hit = await cache.match('/')
    if (hit) return hit
    return new Response(
      `<!doctype html><html><body><h1>Ceramic B2B</h1>
       <p>当前离线，且未缓存。可尝试刷新或检查网络。</p>
       </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

// install: 立刻生效（跳过 waiting）
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// activate: 接管页面
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本 cache
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !k.endsWith(`-${SW_VERSION}`)).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})
