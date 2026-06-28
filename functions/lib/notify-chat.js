"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyAdminChatCard = notifyAdminChatCard;
const logger = __importStar(require("firebase-functions/logger"));
const CHAT_ICONS = {
    started: '[START]',
    success: '[OK]',
    failed: '[FAIL]',
    warning: '[WARN]',
};
async function notifyAdminChatCard(card, webhookUrl) {
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
    }
    catch (err) {
        logger.warn('[notify-chat] Google Chat notification failed.', {
            message: err?.message || String(err),
        });
    }
}
async function pushToChat(webhookUrl, payload) {
    return fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
    });
}
function buildChatCard(card) {
    const icon = CHAT_ICONS[card.status];
    const now = formatTaiwanTime();
    const previewText = `${icon} ${card.title} (${card.appName || 'Domain Meeting GO'})`;
    const widgets = card.fields.map((f) => ({
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
function cardToPlainText(card) {
    const icon = CHAT_ICONS[card.status];
    const lines = [`${icon} ${card.title}`];
    if (card.appName)
        lines.push(`(${card.appName})`);
    lines.push('');
    for (const f of card.fields) {
        lines.push(`${f.icon || ''} ${f.label}: ${f.value || '-'}`);
    }
    lines.push('', formatTaiwanTime());
    if (card.footerNote)
        lines.push(card.footerNote);
    const text = lines.join('\n');
    return text.length > 3900 ? `${text.substring(0, 3900)}...(truncated)` : text;
}
function formatTaiwanTime() {
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
//# sourceMappingURL=notify-chat.js.map