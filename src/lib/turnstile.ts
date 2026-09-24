/**
 * Cloudflare Turnstile（vanilla，不用 @marsidev/react-turnstile —— Next 15 static export 會有時序競態）
 *
 * 只在 App Check 需要新 token 時呼叫 getTurnstileToken()：
 *   - 動態載入 api.js?render=explicit
 *   - widget 用 appearance: 'interaction-only'，多數人類完全無感；
 *     需要互動時才在畫面底部浮出驗證框
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 120_000;

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('無法載入 Cloudflare 人機驗證，請檢查網路後重新整理。'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

function getContainer(): HTMLElement {
  let el = document.getElementById('dmg-turnstile');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dmg-turnstile';
    el.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);';
    document.body.appendChild(el);
  }
  return el;
}

let inflight: Promise<string> | null = null;

export function getTurnstileToken(): Promise<string> {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve('');
  if (inflight) return inflight;

  inflight = (async () => {
    await loadScript();
    const turnstile = window.turnstile;
    if (!turnstile) throw new Error('Cloudflare 人機驗證尚未載入。');

    const container = getContainer();
    return await new Promise<string>((resolve, reject) => {
      let widgetId: string | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        if (widgetId) {
          try { turnstile.remove(widgetId); } catch { /* 已移除 */ }
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('人機驗證逾時，請再試一次。'));
      }, TOKEN_TIMEOUT_MS);

      widgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'light',
        appearance: 'interaction-only',
        callback: (token: string) => { cleanup(); resolve(token); },
        'error-callback': () => { cleanup(); reject(new Error('人機驗證失敗，請重新整理頁面再試。')); },
      });
    });
  })().finally(() => { inflight = null; });

  return inflight;
}
