/**
 * Google Chat 管理員通知（incoming webhook，免費・無則數上限・即時手機推播）
 *
 * 與 notify-line.ts 互補：兩者共用同一份 CardSpec，由 index.ts 的 notifyAdminAll()
 * 同時 fan-out 到 LINE + Google Chat。任一管道缺 secret 各自靜默 noop，互不影響。
 *
 * 設計原則（對齊 notify-line.ts）：
 *   - 永不 throw、永不 await（fire-and-forget），絕不影響主 Cloud Function
 *   - cardsV2 失敗時自動 fallback 純文字
 *   - 用原生 fetch（nodejs20 內建，自動 UTF-8，中文不亂碼）
 *   - webhook URL 缺失時靜默 noop
 *
 * webhook 來源：Google Chat → 建聊天室(space) → 應用程式與整合 → 管理 Webhook → 新增
 *   網址存 Secret Manager：firebase functions:secrets:set GOOGLE_CHAT_WEBHOOK
 *   （webhook = 發文金鑰，絕不寫進原始碼）
 */
import * as logger from 'firebase-functions/logger';
import type { CardSpec, CardStatus } from './notify-line';

// 狀態 → emoji（Google Chat 卡片無法像 LINE 設 header 背景色，改用 emoji 標示語意）
const CHAT_ICONS: Record<CardStatus, string> = {
  started: '🆕',
  success: '✅',
  failed: '❌',
  warning: '⚠️',
};

export function notifyAdminChatCard(
  card: CardSpec,
  webhookUrl: string | undefined
): void {
  if (!webhookUrl) {
    logger.warn('[notify-chat] GOOGLE_CHAT_WEBHOOK 未設定，略過 Google Chat 通知');
    return;
  }

  const payload = buildChatCard(card);

  pushToChat(webhookUrl, payload)
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn('[notify-chat] cardsV2 失敗，fallback 純文字', {
          status: res.status,
          body: body.substring(0, 300),
        });
        // Fallback 純文字（cardsV2 結構錯時 Chat 回 400 的安全網）
        await pushToChat(webhookUrl, { text: cardToPlainText(card) });
      }
      return;
    })
    .catch((err) => {
      logger.warn('[notify-chat] Google Chat 通知失敗（已忽略）', {
        message: err?.message || String(err),
      });
    });
}

// ===== 內部 helpers =====

async function pushToChat(webhookUrl: string, payload: object): Promise<Response> {
  return fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
}

/** 把 CardSpec 組成 Google Chat cardsV2（header + decoratedText 欄位 + 時間戳）。*/
function buildChatCard(card: CardSpec): object {
  const icon = CHAT_ICONS[card.status];
  const now = formatTaiwanTime();
  const previewText = `${icon} ${card.title} (${card.appName || '領域共備GO'})`;

  const widgets: any[] = card.fields.map((f) => ({
    decoratedText: {
      topLabel: `${f.icon ? f.icon + ' ' : ''}${f.label}`,
      text: f.value || '—',
      wrapText: true,
    },
  }));

  // 時間戳 + 選用備註
  const footer = card.footerNote ? `${now} · ${card.footerNote}` : now;
  widgets.push({
    textParagraph: { text: `<font color="#94A3B8">🕒 ${footer}</font>` },
  });

  return {
    text: previewText,
    cardsV2: [
      {
        cardId: `report-${Date.now()}`,
        card: {
          header: {
            title: `${icon} ${card.title}`,
            subtitle: card.appName || '領域共備GO',
          },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

/** cardsV2 失敗時的 fallback 純文字（保留所有資訊但無視覺）。*/
function cardToPlainText(card: CardSpec): string {
  const icon = CHAT_ICONS[card.status];
  const lines: string[] = [`${icon} ${card.title}`];
  if (card.appName) lines.push(`(${card.appName})`);
  lines.push('');
  for (const f of card.fields) {
    lines.push(`${f.icon || ''} ${f.label}：${f.value || '—'}`);
  }
  lines.push('', `🕒 ${formatTaiwanTime()}`);
  if (card.footerNote) lines.push(card.footerNote);
  const text = lines.join('\n');
  return text.length > 3900 ? text.substring(0, 3900) + '…(截斷)' : text;
}

/** 台灣時間 MM/DD HH:mm */
function formatTaiwanTime(): string {
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date());
}
