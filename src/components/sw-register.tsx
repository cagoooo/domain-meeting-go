'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-react';

/**
 * Service Worker 註冊 + 版本檢查元件
 *
 * 工作流程:
 *   1. 掛載時註冊 /domain-meeting-go/sw.js
 *   2. 每 5 分鐘 fetch /domain-meeting-go/version.json
 *   3. 若版本號變動 → 顯示「新版本已發佈」Banner
 *   4. 使用者點「立即更新」→ 通知 SW skipWaiting + 清 caches + reload
 *
 * 只在 production build 啟用（dev 時 SW 會干擾 HMR）
 */

// 需與 next.config.ts 的 basePath 一致
const BASE_PATH = '/domain-meeting-go';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分鐘檢查一次

type VersionInfo = {
  version: string;
  releasedAt?: string;
  notes?: string;
};

export function ServiceWorkerRegister() {
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const initialVersionRef = useRef<string | null>(null);

  // Step 1: 註冊 SW（只在 production）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then((reg) => {
        // 監聽 SW 狀態變化
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            // 有舊 SW 控制且新 SW 已 installed → 代表有新版
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // SW 已準備好，但版本號 banner 會從 version.json 路徑發現
              // 這裡先不主動彈 banner，交由 version.json 輪詢處理，避免重複
            }
          });
        });
      })
      .catch((err) => {
        // 註冊失敗（無 https / file protocol 等）→ 靜默略過
        console.warn('[SW] 註冊失敗，跳過:', err?.message || err);
      });
  }, []);

  // Step 2: 定期檢查 version.json
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/version.json?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data: VersionInfo = await res.json();
        if (cancelled) return;

        if (!initialVersionRef.current) {
          // 首次記錄，不彈 banner
          initialVersionRef.current = data.version;
          return;
        }
        if (data.version !== initialVersionRef.current) {
          setNewVersion(data.version);
        }
      } catch {
        // 離線或網路錯誤 → 靜默略過
      }
    };

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Step 3: 套用更新
  const applyUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      // 通知等待中的 SW 立刻 activate
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
      // 清所有 cache
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 重新載入（bypass disk cache）
      window.location.reload();
    } catch (err) {
      console.error('[SW] 套用更新失敗:', err);
      // fallback: 直接 reload
      window.location.reload();
    }
  }, []);

  if (!newVersion) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] no-print animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-2xl border border-white/20 backdrop-blur-md">
        <span className="text-lg">✨</span>
        <span className="text-sm font-medium">
          新版本 <span className="font-bold">{newVersion}</span> 已發佈
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={isUpdating}
          className="h-8 bg-white/95 hover:bg-white text-emerald-700 font-bold disabled:opacity-60"
          onClick={applyUpdate}
        >
          {isUpdating ? (
            <>
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> 更新中…
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3 mr-1" /> 立即更新
            </>
          )}
        </Button>
        <button
          type="button"
          aria-label="稍後再說"
          className="h-7 w-7 rounded hover:bg-white/10 flex items-center justify-center transition-colors"
          onClick={() => setNewVersion(null)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
