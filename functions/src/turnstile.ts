/**
 * Cloudflare Turnstile 伺服器端驗證
 *
 * 設計原則:
 *   - secret 未設或為 placeholder → fail-open（讓第一次 deploy 不被擋，之後補真 key）
 *   - Cloudflare API 連不上 → fail-closed（不能讓攻擊者靠弄垮驗證來繞過）
 *   - 額外比對 hostname，避免別的網站用同一個 widget 拿到的 token 被拿來換
 */
import * as logger from 'firebase-functions/logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_PLACEHOLDER = 'PLACEHOLDER_NOT_CONFIGURED';

export interface TurnstileVerifyResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  allowedHostnames: string[],
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  const cleanSecret = secret?.replace(/^﻿/, '').trim();
  if (!cleanSecret || cleanSecret === TURNSTILE_PLACEHOLDER) {
    logger.warn('[turnstile] TURNSTILE_SECRET 尚未設定，暫時略過人機驗證');
    return { ok: true, skipped: true };
  }

  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { ok: false, reason: '缺少人機驗證 token，請重新整理頁面再試。' };
  }

  try {
    const params = new URLSearchParams();
    params.append('secret', cleanSecret);
    params.append('response', token);
    if (remoteIp) params.append('remoteip', remoteIp);

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = (await res.json()) as {
      success: boolean;
      hostname?: string;
      'error-codes'?: string[];
    };

    if (!data.success) {
      return { ok: false, reason: `人機驗證失敗：${(data['error-codes'] ?? ['unknown']).join(', ')}` };
    }
    if (data.hostname && !allowedHostnames.includes(data.hostname)) {
      logger.warn('[turnstile] hostname 不在白名單', { hostname: data.hostname });
      return { ok: false, reason: '人機驗證來源網域不符。' };
    }
    return { ok: true };
  } catch (e: any) {
    logger.error('[turnstile] siteverify 呼叫失敗', { message: e?.message || String(e) });
    return { ok: false, reason: '人機驗證服務暫時無法存取，請稍後再試。' };
  }
}
