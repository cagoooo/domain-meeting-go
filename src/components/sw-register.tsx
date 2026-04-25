'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, X, Check, AlertCircle } from 'lucide-react';

/**
 * Service Worker 註冊 + 版本檢查元件（含前端可見的版本徽章）
 *
 * UI 三層：
 *   1. 永遠可見的版本徽章（左下角）— 顯示當前版本 + 「檢查更新」按鈕
 *   2. 檢查中 / 已是最新版本 / 有新版可用 — 不同狀態顏色提示
 *   3. 有新版時頂部浮動橫幅（綠色）— 含「立即更新」按鈕
 *
 * 工作流程:
 *   - 掛載時註冊 /domain-meeting-go/sw.js（僅 production）
 *   - 每 5 分鐘 fetch /domain-meeting-go/version.json 比對
 *   - 頁面從背景切回前景時也會立刻 check（visibilitychange）
 *   - 使用者可以隨時手動點「檢查更新」立刻 fetch
 */

const BASE_PATH = '/domain-meeting-go';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘自動檢查

type VersionInfo = {
  version: string;
  releasedAt?: string;
  notes?: string;
};

type CheckStatus = 'idle' | 'checking' | 'up-to-date' | 'has-update' | 'error';

export function ServiceWorkerRegister() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<CheckStatus>('idle');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const initialVersionRef = useRef<string | null>(null);

  // ==== 註冊 SW（僅 production） ====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then(() => console.log('[SW] 已註冊'))
      .catch((err) => console.warn('[SW] 註冊失敗:', err?.message || err));
  }, []);

  // ==== ChunkLoadError 自動恢復 ====
  // 部署新版後，使用者開著舊頁面點功能時，動態 import 會 fetch 已被新版取代的舊 chunk hash → 404 → ChunkLoadError。
  // 偵測到此錯誤時自動清快取 + reload，使用者下次互動就會拿到新版。
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let recovering = false;
    const recover = async (errMsg: string) => {
      if (recovering) return;
      recovering = true;
      console.warn('[SW] 偵測到 ChunkLoadError，自動清快取並重載：', errMsg);
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        }
      } finally {
        window.location.reload();
      }
    };

    const isChunkErr = (msg: string) =>
      /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module/i.test(msg);

    const onError = (e: ErrorEvent) => {
      const msg = `${e.message || ''} ${e.error?.message || ''} ${e.error?.name || ''}`;
      if (isChunkErr(msg)) recover(msg);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e.reason;
      const msg = `${reason?.message || ''} ${reason?.name || ''} ${String(reason || '')}`;
      if (isChunkErr(msg)) recover(msg);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // ==== 檢查版本（共用函式） ====
  const checkVersion = useCallback(async (silent = false) => {
    if (!silent) setStatus('checking');
    try {
      const res = await fetch(`${BASE_PATH}/version.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (!silent) setStatus('error');
        return;
      }
      const data: VersionInfo = await res.json();
      setCurrentVersion(data.version);

      if (!initialVersionRef.current) {
        // 首次記錄基準版本
        initialVersionRef.current = data.version;
        if (!silent) setStatus('up-to-date');
        return;
      }

      if (data.version !== initialVersionRef.current) {
        setNewVersion(data.version);
        setShowBanner(true);
        setStatus('has-update');
      } else {
        setStatus('up-to-date');
      }
    } catch {
      if (!silent) setStatus('error');
    }
  }, []);

  // ==== 啟動：載入 version.json + 自動輪詢 + visibility 立即 check ====
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 第一次載入
    checkVersion(true);

    const interval = setInterval(() => checkVersion(true), CHECK_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkVersion(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkVersion]);

  // ==== 套用更新（清 caches + skipWaiting + reload） ====
  const applyUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      window.location.reload();
    } catch (err) {
      console.error('[SW] 套用更新失敗:', err);
      window.location.reload();
    }
  }, []);

  // ==== 手動檢查按鈕的視覺狀態 ====
  const statusConfig = {
    idle: { icon: RefreshCw, text: '檢查更新', color: 'text-slate-300', spin: false },
    checking: { icon: RefreshCw, text: '檢查中…', color: 'text-blue-300', spin: true },
    'up-to-date': { icon: Check, text: '已是最新', color: 'text-emerald-300', spin: false },
    'has-update': { icon: AlertCircle, text: '有新版本', color: 'text-amber-300', spin: false },
    error: { icon: AlertCircle, text: '檢查失敗', color: 'text-rose-300', spin: false },
  };
  const statusUI = statusConfig[status];
  const StatusIcon = statusUI.icon;

  return (
    <>
      {/* === 1. 永遠可見的版本徽章（左下角） === */}
      <div className="fixed bottom-4 left-4 z-[150] no-print">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/85 border border-white/10 shadow-lg backdrop-blur-md text-xs">
          <span className="font-mono text-slate-300">
            v<span className="font-bold text-white">{currentVersion ?? '--'}</span>
          </span>
          <div className="w-px h-4 bg-white/10" />
          <button
            type="button"
            onClick={() => checkVersion(false)}
            disabled={status === 'checking'}
            className={`flex items-center gap-1.5 hover:text-white transition-colors ${statusUI.color}`}
            aria-label="檢查更新"
          >
            <StatusIcon className={`h-3.5 w-3.5 ${statusUI.spin ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{statusUI.text}</span>
          </button>
        </div>
      </div>

      {/* === 2. 有新版本時的頂部浮動橫幅 === */}
      {newVersion && showBanner && (
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
              onClick={() => setShowBanner(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
