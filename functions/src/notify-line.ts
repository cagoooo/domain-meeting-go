/**
 * LINE 管理員告警通知（單一接收者模式）
 *
 * 提供兩種 API:
 *   1. notifyAdmin(text)      — 純文字（簡單場景）
 *   2. notifyAdminCard(card)  — Flex Message 卡片（推薦：視覺更清晰）
 *
 * 設計原則:
 *   - 永不 throw、永不 await（fire-and-forget），絕不影響主 Cloud Function
 *   - Flex Message 失敗時自動 fallback 純文字（避雷 #9: invalid color 等）
 *   - 用原生 fetch 直接呼叫 LINE Push API，不需 @line/bot-sdk
 *   - secrets 缺失時靜默 noop
 *
 * Flex Message 守則（避雷）:
 *   - color 必須 6-digit hex（不接受 #FFF）
 *   - altText 必填（離線時顯示這段純文字）
 *   - 訊息結構錯時 LINE 回 400，故必加 fallback
 */
import * as logger from 'firebase-functions/logger';

const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

// ===== 卡片狀態主題（語意化色碼）=====
const CARD_THEMES = {
  started: { headerBg: '#3B82F6', headerSubColor: '#DBEAFE', icon: '🆕' },
  success: { headerBg: '#10B981', headerSubColor: '#D1FAE5', icon: '✅' },
  failed:  { headerBg: '#EF4444', headerSubColor: '#FEE2E2', icon: '❌' },
  warning: { headerBg: '#F59E0B', headerSubColor: '#FEF3C7', icon: '⚠️' },
} as const;

export type CardStatus = keyof typeof CARD_THEMES;

export type CardSpec = {
  status: CardStatus;
  title: string;                                                // 例：「開始產生會議摘要」
  appName?: string;                                             // 例：「領域共備GO」
  fields: Array<{ icon?: string; label: string; value: string }>;
  footerNote?: string;                                          // 例：「⏱️ 12.3s」
};

// ===== 純文字推送（保留供簡單場景或 fallback 用）=====

export function notifyAdmin(
  text: string,
  accessToken: string | undefined,
  userId: string | undefined
): void {
  if (!accessToken || !userId) {
    logger.warn('[notify-line] secrets 未設定，略過 LINE 通知');
    return;
  }
  const safeText = text.length > 4900 ? text.substring(0, 4900) + '…(截斷)' : text;
  pushToLine({ to: userId, messages: [{ type: 'text', text: safeText }] }, accessToken)
    .catch((err) => {
      logger.warn('[notify-line] LINE 純文字通知失敗（已忽略）', { message: err?.message || String(err) });
    });
}

// ===== Flex Message 卡片推送（推薦使用）=====

export function notifyAdminCard(
  card: CardSpec,
  accessToken: string | undefined,
  userId: string | undefined
): void {
  if (!accessToken || !userId) {
    logger.warn('[notify-line] secrets 未設定，略過 LINE 通知');
    return;
  }

  const flexMessage = buildFlexBubble(card);
  const altText = cardToAltText(card);

  pushToLine(
    { to: userId, messages: [{ type: 'flex', altText, contents: flexMessage }] },
    accessToken
  )
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn('[notify-line] Flex 失敗，fallback 純文字', {
          status: res.status,
          body: body.substring(0, 300),
        });
        // Fallback 純文字（雷 #9 invalid color 等情境的安全網）
        await pushToLine(
          { to: userId, messages: [{ type: 'text', text: cardToPlainText(card) }] },
          accessToken
        );
      }
      return;
    })
    .catch((err) => {
      logger.warn('[notify-line] LINE Flex 通知失敗（已忽略）', { message: err?.message || String(err) });
    });
}

// ===== 內部 helpers =====

async function pushToLine(payload: object, accessToken: string): Promise<Response> {
  return fetch(LINE_PUSH_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * 把 CardSpec 組成 LINE Flex Message bubble。
 * 注意：所有 color 必須是 6-digit hex（雷 #9）。
 */
function buildFlexBubble(card: CardSpec): object {
  const theme = CARD_THEMES[card.status];
  const now = formatTaiwanTime();

  // Header: app name (subtitle) + 主標題（含 emoji）
  const headerContents: any[] = [
    {
      type: 'text',
      text: `${theme.icon}  ${card.title}`,
      color: '#FFFFFF',
      weight: 'bold',
      size: 'md',
      wrap: true,
    },
  ];
  if (card.appName) {
    headerContents.push({
      type: 'text',
      text: card.appName,
      color: theme.headerSubColor,
      size: 'xs',
      margin: 'sm',
    });
  }

  // Body: 一行一個欄位（icon + label + value）
  const bodyContents: any[] = card.fields.map((f) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      {
        type: 'text',
        text: `${f.icon ? f.icon + ' ' : ''}${f.label}`,
        color: '#888888',
        size: 'sm',
        flex: 3,
      },
      {
        type: 'text',
        text: f.value || '—',
        color: '#1E293B',
        size: 'sm',
        flex: 7,
        wrap: true,
      },
    ],
  }));

  // Footer: 時間戳 + 選用備註
  const footerText = card.footerNote ? `${now} · ${card.footerNote}` : now;

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.headerBg,
      paddingAll: '16px',
      contents: headerContents,
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: footerText,
          color: '#94A3B8',
          size: 'xxs',
          align: 'end',
          wrap: true,
        },
      ],
    },
  };
}

/** Flex 失敗時的 fallback 純文字（保留所有資訊但無視覺） */
function cardToPlainText(card: CardSpec): string {
  const theme = CARD_THEMES[card.status];
  const lines: string[] = [`${theme.icon} ${card.title}`];
  if (card.appName) lines.push(`(${card.appName})`);
  lines.push('');
  for (const f of card.fields) {
    lines.push(`${f.icon || ''} ${f.label}：${f.value || '—'}`);
  }
  if (card.footerNote) lines.push('', card.footerNote);
  const text = lines.join('\n');
  return text.length > 4900 ? text.substring(0, 4900) + '…(截斷)' : text;
}

/** altText：LINE App icon 預覽列 / 離線通知 顯示的純文字（最多 400 字） */
function cardToAltText(card: CardSpec): string {
  const theme = CARD_THEMES[card.status];
  const summary = card.fields.slice(0, 2).map((f) => `${f.label}:${f.value}`).join(' | ');
  const text = `${theme.icon} ${card.title}${summary ? ' — ' + summary : ''}`;
  return text.length > 380 ? text.substring(0, 380) + '…' : text;
}

/** 台灣時間 MM/DD HH:mm */
function formatTaiwanTime(): string {
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date()).replace(/\//g, '/');
}

/** 從 request.data 抽會議資訊組 fields */
export function meetingFields(data: {
  teachingArea?: string;
  meetingTopic?: string;
  meetingDate?: string;
  communityMembers?: string;
}): CardSpec['fields'] {
  const fields: CardSpec['fields'] = [];
  if (data.teachingArea) fields.push({ icon: '📚', label: '領域', value: data.teachingArea });
  if (data.meetingTopic) fields.push({ icon: '📌', label: '主題', value: data.meetingTopic });
  if (data.meetingDate) fields.push({ icon: '📅', label: '日期', value: data.meetingDate });
  if (data.communityMembers) fields.push({ icon: '👥', label: '成員', value: data.communityMembers });
  return fields;
}

// 向後相容：保留舊的 helper（v0.4.2 用過，已不推薦）
export function formatMeetingContext(data: {
  teachingArea?: string; meetingTopic?: string; meetingDate?: string; communityMembers?: string;
}): string {
  return meetingFields(data).map((f) => `${f.icon} ${f.label}：${f.value}`).join('\n');
}
