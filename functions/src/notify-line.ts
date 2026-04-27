/**
 * LINE 管理員告警通知（單一接收者模式）
 *
 * 設計原則：
 *   - 永不 throw、永不 await（fire-and-forget），絕不影響主 Cloud Function 運作
 *   - 用原生 fetch 直接呼叫 LINE Push API，不需要 @line/bot-sdk 額外依賴
 *   - secrets 缺失時靜默 noop（log 警告但不中斷）
 *
 * 使用方式：
 *   import { notifyAdmin } from './notify-line';
 *   notifyAdmin('🆕 使用者開始產生照片描述', LINE_CHANNEL_ACCESS_TOKEN, LINE_ADMIN_USER_ID);
 *   // 不要 await，讓主 function 直接繼續做事
 */
import * as logger from 'firebase-functions/logger';

const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

/**
 * 推一段純文字訊息給管理員（fire-and-forget）。
 *
 * @param text 訊息內容（最多 5000 字元）
 * @param accessToken Channel Access Token（從 defineSecret 取得）
 * @param userId 管理員的 LINE userId（從 defineSecret 取得）
 */
export function notifyAdmin(
  text: string,
  accessToken: string | undefined,
  userId: string | undefined
): void {
  if (!accessToken || !userId) {
    logger.warn('[notify-line] secrets 未設定，略過 LINE 通知');
    return;
  }

  // 截斷過長內容（LINE 上限 5000 字）
  const safeText = text.length > 4900 ? text.substring(0, 4900) + '…(截斷)' : text;

  fetch(LINE_PUSH_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: safeText }],
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn('[notify-line] LINE API 回應非 200', {
          status: res.status,
          body: body.substring(0, 300),
        });
      }
    })
    .catch((err) => {
      // 網路錯誤等，記 log 但不影響主流程
      logger.warn('[notify-line] LINE 通知失敗（已忽略）', {
        message: err?.message || String(err),
      });
    });
}

/**
 * 包裝會議資訊為易讀格式
 */
export function formatMeetingContext(data: {
  teachingArea?: string;
  meetingTopic?: string;
  meetingDate?: string;
  communityMembers?: string;
}): string {
  const lines: string[] = [];
  if (data.teachingArea) lines.push(`📚 領域：${data.teachingArea}`);
  if (data.meetingTopic) lines.push(`📌 主題：${data.meetingTopic}`);
  if (data.meetingDate) lines.push(`📅 日期：${data.meetingDate}`);
  if (data.communityMembers) lines.push(`👥 成員：${data.communityMembers}`);
  return lines.join('\n');
}
