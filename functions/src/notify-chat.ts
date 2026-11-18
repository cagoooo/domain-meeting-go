import * as logger from 'firebase-functions/logger';
import type { CardSpec, CardStatus } from './notify-line';

const CHAT_ICONS: Record<CardStatus, string> = {
  started: '[START]',
  success: '[OK]',
  failed: '[FAIL]',
  warning: '[WARN]',
};

export async function notifyAdminChatCard(
  card: CardSpec,
  webhookUrl: string | undefined
): Promise<void> {
  const cleanWebhookUrl = webhookUrl?.replace(/^\uFEFF/, '').trim();
  if (!cleanWebhookUrl) {
    logger.warn('[notify-chat] GOOGLE_CHAT_WEBHOOK is not configured; skipping Google Chat notification.');
    return;
  }

  const payload = buildChatCard(card);

  try {
    const res = await pushToChat(cleanWebhookUrl, payload);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('[notify-chat] cardsV2 failed; falling back to plain text.', {
        status: res.status,
        body: body.substring(0, 300),
      });

      const fallbackRes = await pushToChat(cleanWebhookUrl, { text: cardToPlainText(card) });
      if (!fallbackRes.ok) {
        const fallbackBody = await fallbackRes.text().catch(() => '');
        logger.warn('[notify-chat] plain text fallback failed.', {
          status: fallbackRes.status,
          body: fallbackBody.substring(0, 300),
        });
        return;
      }
    }

    logger.info('[notify-chat] Google Chat Notification sent successfully.');
  } catch (err: any) {
    logger.warn('[notify-chat] Google Chat notification failed.', {
      message: err?.message || String(err),
    });
  }
}

async function pushToChat(webhookUrl: string, payload: object): Promise<Response> {
  return fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
}

// 平台名稱統一用中文；前端舊版送來的英文名也換成中文
const DEFAULT_APP_NAME = '領域共備GO';
const LEGACY_APP_NAMES = ['Domain Meeting GO'];

function platformName(card: CardSpec): string {
  const name = (card.appName || '').trim();
  return !name || LEGACY_APP_NAMES.includes(name) ? DEFAULT_APP_NAME : name;
}

/**
 * 拆出標題開頭的表情符號，並拿掉標題裡已經寫到的平台名（避免重複）。
 * 例：「✅ 有人使用了領域共備GO（會議摘要）」→ { emoji: '✅', body: '有人使用了（會議摘要）' }
 */
function splitTitle(title: string, appName: string): { emoji: string; body: string } {
  const match = title.match(/^((?:\p{Extended_Pictographic}[\p{Mn}\p{Cf}]*)+)\s*/u);
  const emoji = match ? match[1] : '';
  const rest = match ? title.slice(match[0].length) : title;
  const body = rest.split(appName).join('').replace(/\s{2,}/g, ' ').trim();
  return { emoji, body: body || '通知' };
}

function buildChatCard(card: CardSpec): object {
  const icon = CHAT_ICONS[card.status];
  const now = formatTaiwanTime();
  const appName = platformName(card);
  const { emoji, body } = splitTitle(card.title, appName);
  const lead = emoji ? `${icon} ${emoji}` : icon;
  // 手機推播只看得到這一行 → 平台名放在表情符號後面：「[OK] ✅ 【領域共備GO】有人使用了（會議摘要）」
  const previewText = `${lead} 【${appName}】${body}`;

  const widgets: any[] = card.fields.map((f) => ({
    decoratedText: {
      topLabel: `${f.icon ? f.icon + ' ' : ''}${f.label}`,
      text: f.value || '-',
      wrapText: true,
    },
  }));

  const footer = card.footerNote ? `${now} - ${card.footerNote}` : now;
  widgets.push({
    textParagraph: { text: `<font color="#94A3B8">${footer}</font>` },
  });

  return {
    text: previewText,
    cardsV2: [
      {
        cardId: `report-${Date.now()}`,
        card: {
          header: {
            title: `${lead} ${body}｜${appName}`,
            subtitle: appName,
          },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

function cardToPlainText(card: CardSpec): string {
  const icon = CHAT_ICONS[card.status];
  const appName = platformName(card);
  const { emoji, body } = splitTitle(card.title, appName);
  // 備援純文字的第一行也一樣把平台名放前面
  const lines: string[] = [`${emoji ? `${icon} ${emoji}` : icon} 【${appName}】${body}`];
  lines.push('');
  for (const f of card.fields) {
    lines.push(`${f.icon || ''} ${f.label}: ${f.value || '-'}`);
  }
  lines.push('', formatTaiwanTime());
  if (card.footerNote) lines.push(card.footerNote);
  const text = lines.join('\n');
  return text.length > 3900 ? `${text.substring(0, 3900)}...(truncated)` : text;
}

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
