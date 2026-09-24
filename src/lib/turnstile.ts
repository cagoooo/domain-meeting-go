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

// 驗證框容器：平常是空的（interaction-only 不佔畫面），需要真人互動時才變成置中卡片 + 半透明背景
function getContainer(): { slot: HTMLElement; setInteractive: (on: boolean) => void } {
  let root = document.getElementById('dmg-turnstile');
  if (!root) {
    root = document.createElement('div');
    root.id = 'dmg-turnstile';
    root.innerHTML =
      '<div data-part="backdrop" style="display:none;position:fixed;inset:0;background:rgba(40,20,20,.45);z-index:10000"></div>' +
      '<div data-part="card" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;max-width:calc(100vw - 32px);text-align:center;border-radius:12px">' +
      '<p data-part="caption" style="display:none;margin:0 0 12px;font:600 15px/1.5 &quot;Noto Sans TC&quot;,sans-serif;color:#4a1d1f">🛡️ 請勾選下方驗證，完成後 AI 會自動開始</p>' +
      '<div data-part="slot"></div></div>';
    document.body.appendChild(root);
  }
  const part = (name: string) => root!.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const card = part('card');
  return {
    slot: part('slot'),
    setInteractive: (on) => {
      part('backdrop').style.display = on ? 'block' : 'none';
      part('caption').style.display = on ? 'block' : 'none';
      card.style.background = on ? '#fffaf2' : 'transparent';
      card.style.padding = on ? '20px 20px 16px' : '0';
      card.style.boxShadow = on ? '0 12px 40px rgba(0,0,0,.25)' : 'none';
    },
  };
}

let inflight: Promise<string> | null = null;

export function getTurnstileToken(): Promise<string> {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve('');
  if (inflight) return inflight;

  inflight = (async () => {
    await loadScript();
    const turnstile = window.turnstile;
    if (!turnstile) throw new Error('Cloudflare 人機驗證尚未載入。');

    const { slot, setInteractive } = getContainer();
    return await new Promise<string>((resolve, reject) => {
      let widgetId: string | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        setInteractive(false);
        // 等 Turnstile 自己的 callback 跑完再移除，否則它內部 reset 會丟 "Nothing to reset"
        const id = widgetId;
        widgetId = undefined;
        if (id) setTimeout(() => { try { turnstile.remove(id); } catch { /* 已移除 */ } }, 0);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('人機驗證逾時，請再試一次。'));
      }, TOKEN_TIMEOUT_MS);

      widgetId = turnstile.render(slot, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'light',
        appearance: 'interaction-only',
        retry: 'never',
        'before-interactive-callback': () => setInteractive(true),
        'after-interactive-callback': () => setInteractive(false),
        callback: (token: string) => { cleanup(); resolve(token); },
        'error-callback': (code: string) => {
          cleanup();
          reject(new Error(`人機驗證失敗（${code}），請重新整理頁面再試。`));
          return true; // 告訴 Turnstile 錯誤已處理，不要再丟例外
        },
      });
    });
  })().finally(() => { inflight = null; });

  return inflight;
}
