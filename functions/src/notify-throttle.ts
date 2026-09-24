/**
 * 管理員通知節流（跨使用者、跨 instance 共用，Firestore 記錄）
 *
 * 規則：同一種失敗／警示（標題 + 錯誤類型／訊息，數字正規化）在 10 分鐘內只推第一則，
 * 其餘只計數；視窗過後同一種事件再發生時，推播並附上「期間另合併 N 則」。
 * 成功／開始類通知每則內容都不同（不同老師、不同會議），不節流。
 *
 * Firestore 出錯時 fail-open（寧可多推，不要漏掉告警）。
 */
import { createHash } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

const COLLECTION = 'dmg_notify_throttle';
export const NOTIFY_WINDOW_MS = 10 * 60 * 1000;

export interface ThrottleDecision {
  send: boolean;
  /** 上一個視窗被合併（沒推出去）的相同通知數 */
  merged: number;
}

/** 數字、時間、ID 會讓同一種錯誤每次都長得不一樣，先正規化再比對 */
export function notifySignature(parts: string[]): string {
  return parts
    .map((p) => p.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().substring(0, 120))
    .join('|');
}

export async function shouldSendNotification(signature: string): Promise<ThrottleDecision> {
  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(createHash('sha256').update(signature).digest('hex').substring(0, 32));
  const now = Date.now();

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const windowStart = snap.exists ? (snap.get('windowStart') as number) : 0;
      const suppressed = snap.exists ? (snap.get('suppressed') as number) : 0;

      if (!snap.exists || now - windowStart >= NOTIFY_WINDOW_MS) {
        tx.set(ref, {
          windowStart: now,
          suppressed: 0,
          expireAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
        });
        return { send: true, merged: suppressed };
      }

      tx.update(ref, { suppressed: suppressed + 1 });
      return { send: false, merged: 0 };
    });
  } catch (e: any) {
    logger.error('[notify-throttle] Firestore 失敗，照常推播', { message: e?.message || String(e) });
    return { send: true, merged: 0 };
  }
}
