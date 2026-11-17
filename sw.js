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

const SW_VERSION = 'v0.6.6';
// 同網域（cagoooo.github.io）其他工具也共用 Cache Storage，快取名稱要加本工具專屬前綴，清除時也只清自己的
const CACHE_PREFIX = 'domain-meeting-go-';
const HTML_CACHE = `${CACHE_PREFIX}html-${SW_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${SW_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${SW_VERSION}`;
// v0.6.5 以前沒有前綴（html-v0.x.y、static-v0.x.y、runtime-v0.x.y），只認得本站真的用過的版本，升級時清掉
const LEGACY_VERSIONS = [
  'v0.3.0', 'v0.3.1', 'v0.3.2', 'v0.3.3', 'v0.3.4', 'v0.3.5', 'v0.3.6', 'v0.3.7', 'v0.3.8', 'v0.3.9',
  'v0.4.0', 'v0.4.1', 'v0.4.2', 'v0.4.3', 'v0.4.4', 'v0.4.5',
  'v0.5.0', 'v0.5.1', 'v0.5.2', 'v0.5.3', 'v0.5.4',
  'v0.6.0', 'v0.6.1', 'v0.6.2', 'v0.6.3', 'v0.6.4', 'v0.6.5',
];
const LEGACY_CACHES = new Set(
  LEGACY_VERSIONS.flatMap((v) => [`html-${v}`, `static-${v}`, `runtime-${v}`])
);
const CURRENT_CACHES = [HTML_CACHE, STATIC_CACHE, RUNTIME_CACHE];
const isOwnOldCache = (k) =>
  (k.startsWith(CACHE_PREFIX) || LEGACY_CACHES.has(k)) && !CURRENT_CACHES.includes(k);

// ========== Lifecycle ==========

self.addEventListener('install', () => {
  // 不等舊 SW 退場，立刻進入 waiting
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 只清掉本工具自己的舊版 cache（不動同網域其他工具的快取）
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(isOwnOldCache)
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
