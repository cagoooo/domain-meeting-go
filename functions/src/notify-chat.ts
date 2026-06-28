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

function buildChatCard(card: CardSpec): object {
  const icon = CHAT_ICONS[card.status];
  const now = formatTaiwanTime();
  const previewText = `${icon} ${card.title} (${card.appName || 'Domain Meeting GO'})`;

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
            title: `${icon} ${card.title}`,
            subtitle: card.appName || 'Domain Meeting GO',
          },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

function cardToPlainText(card: CardSpec): string {
  const icon = CHAT_ICONS[card.status];
  const lines: string[] = [`${icon} ${card.title}`];
  if (card.appName) lines.push(`(${card.appName})`);
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
