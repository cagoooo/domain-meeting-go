/**
 * Service Worker for 領域共備GO
 *
 * 策略:
 *   - HTML / 導航請求      → network-first (確保拿到最新版 shell)
 *   - /_next/static/*     → cache-first   (檔名已含 content hash，安全)
 *   - version.json        → network-only  (檢查更新時一定要新鮮)
 *   - 其他 GET 資源       → stale-while-revalidate
 *
 * 部署注意：basePath = /domain-meeting-go，因此 scope = /domain-meeting-go/
 * 版本號變更時，install → activate 會清掉舊 cache。
 */

const SW_VERSION = 'v0.3.5';
const HTML_CACHE = `html-${SW_VERSION}`;
const STATIC_CACHE = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

// ========== Lifecycle ==========

self.addEventListener('install', () => {
  // 不等舊 SW 退場，立刻進入 waiting
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉不屬於當前版本的舊 cache
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(SW_VERSION))
          .map((k) => caches.delete(k))
      );
      // 接管所有已開啟的頁面
      await self.clients.claim();
    })()
  );
});

// 前端可透過 postMessage 要求 SW 立刻進入 activating
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ========== Fetch ==========

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 GET
  if (request.method !== 'GET') return;
  // 只處理 http(s) —— 跳過 chrome-extension: 等特殊協定
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // 只處理同源
  if (url.origin !== self.location.origin) return;

  // version.json: 一定要新鮮
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    );
    return;
  }

  // HTML / 導航: network-first
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, HTML_CACHE));
    return;
  }

  // Next.js 靜態資源（檔名已含 content hash，可長期快取）
  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 其他（圖片、json 等）: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ========== Strategies ==========

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type !== 'opaque') {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}
