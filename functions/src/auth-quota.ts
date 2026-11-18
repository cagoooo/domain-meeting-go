/**
 * Google 登入檢查 + 每個帳號每日次數（台北時間午夜重置）
 *
 * 政策（2026-11-17 阿凱老師定案）：花 Gemini 額度的功能一律
 *   ① 必須 Google 帳號登入（拒絕匿名）
 *   ② 每個帳號每天 5 次（本站 1 次 = 產生 1 份會議摘要）
 *   ③ 每次使用發 Google Chat 通知
 * 照片描述另設每帳號每日上限當保險絲（一份報告最多 4 張照片）。
 *
 * 計數文件放在既有的 dmg_rate_limits 集合（同一個 expireAt TTL 自動清除）。
 * AI 呼叫失敗時呼叫 refundDailyQuota 把次數退回。
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

const COLLECTION = 'dmg_rate_limits';

export const DAILY_LIMITS = {
  summary: 5,
  photo: 20,
} as const;
export type QuotaKind = keyof typeof DAILY_LIMITS;

export interface GoogleUser {
  uid: string;
  email: string;
  name: string;
}

export const LOGIN_REQUIRED_MESSAGE = '請先用 Google 帳號登入才能使用 AI 功能。';

/** onCall 版：框架已驗過 ID Token（無效 token 在這之前就被擋），這裡再擋「沒帶」與「匿名」 */
export function requireGoogleUser(request: { auth?: { uid: string; token: any } }): GoogleUser {
  const auth = request.auth;
  if (!auth || !auth.uid) throw new HttpsError('unauthenticated', LOGIN_REQUIRED_MESSAGE);
  const provider = auth.token?.firebase?.sign_in_provider;
  if (provider === 'anonymous') throw new HttpsError('unauthenticated', LOGIN_REQUIRED_MESSAGE);
  const email = typeof auth.token?.email === 'string' ? auth.token.email : '';
  const name = typeof auth.token?.name === 'string' && auth.token.name.trim() ? auth.token.name.trim() : email || '未提供';
  return { uid: auth.uid, email: email || '未提供', name };
}

/** 台北時間日期 YYYY-MM-DD */
export function taipeiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function quotaRef(kind: QuotaKind, uid: string, date = taipeiDate()) {
  return getFirestore().collection(COLLECTION).doc(`daily_${kind}_${uid}_${date}`);
}

export interface QuotaResult {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  date: string;
}

/** 扣 1 次；超過上限回 ok=false（不扣）。Firestore 故障時放行但記 log（不能因計數器壞掉讓老師無法用）。 */
export async function consumeDailyQuota(kind: QuotaKind, uid: string): Promise<QuotaResult> {
  const limit = DAILY_LIMITS[kind];
  const date = taipeiDate();
  const ref = quotaRef(kind, uid, date);
  // 兩天後自動清除（TTL）
  const expireAt = Timestamp.fromMillis(Date.now() + 2 * 24 * 60 * 60 * 1000);
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? Number(snap.get('count')) || 0 : 0;
      if (used >= limit) return { ok: false, used, limit, remaining: 0, date };
      tx.set(ref, { scope: `daily_${kind}`, uid, date, count: used + 1, expireAt, updatedAt: Timestamp.now() });
      return { ok: true, used: used + 1, limit, remaining: limit - used - 1, date };
    });
  } catch (e: any) {
    logger.error('[daily-quota] Firestore 計數失敗，暫時放行', { kind, message: e?.message || String(e) });
    return { ok: true, used: 0, limit, remaining: limit, date };
  }
}

/** AI 失敗時退回 1 次（用扣次當天的日期，跨午夜也退到正確那天） */
export async function refundDailyQuota(kind: QuotaKind, uid: string, date: string): Promise<number | null> {
  const ref = quotaRef(kind, uid, date);
  const limit = DAILY_LIMITS[kind];
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return limit;
      const used = Math.max(0, (Number(snap.get('count')) || 0) - 1);
      tx.update(ref, { count: used, updatedAt: Timestamp.now() });
      return limit - used;
    });
  } catch (e: any) {
    logger.error('[daily-quota] 退回次數失敗', { kind, message: e?.message || String(e) });
    return null;
  }
}

export function dailyExhaustedMessage(kind: QuotaKind): string {
  return kind === 'summary'
    ? `今天的 ${DAILY_LIMITS.summary} 次會議摘要已用完，明天（台北時間午夜後）再來。`
    : `今天的照片描述已達 ${DAILY_LIMITS.photo} 張上限，明天（台北時間午夜後）再來。`;
}
