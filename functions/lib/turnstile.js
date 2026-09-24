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
exports.TURNSTILE_PLACEHOLDER = void 0;
exports.verifyTurnstile = verifyTurnstile;
/**
 * Cloudflare Turnstile 伺服器端驗證
 *
 * 設計原則:
 *   - secret 未設或為 placeholder → fail-open（讓第一次 deploy 不被擋，之後補真 key）
 *   - Cloudflare API 連不上 → fail-closed（不能讓攻擊者靠弄垮驗證來繞過）
 *   - 額外比對 hostname，避免別的網站用同一個 widget 拿到的 token 被拿來換
 */
const logger = __importStar(require("firebase-functions/logger"));
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
exports.TURNSTILE_PLACEHOLDER = 'PLACEHOLDER_NOT_CONFIGURED';
async function verifyTurnstile(token, secret, allowedHostnames, remoteIp) {
    const cleanSecret = secret?.replace(/^﻿/, '').trim();
    if (!cleanSecret || cleanSecret === exports.TURNSTILE_PLACEHOLDER) {
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
        if (remoteIp)
            params.append('remoteip', remoteIp);
        const res = await fetch(SITEVERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const data = (await res.json());
        if (!data.success) {
            return { ok: false, reason: `人機驗證失敗：${(data['error-codes'] ?? ['unknown']).join(', ')}` };
        }
        if (data.hostname && !allowedHostnames.includes(data.hostname)) {
            logger.warn('[turnstile] hostname 不在白名單', { hostname: data.hostname });
            return { ok: false, reason: '人機驗證來源網域不符。' };
        }
        return { ok: true };
    }
    catch (e) {
        logger.error('[turnstile] siteverify 呼叫失敗', { message: e?.message || String(e) });
        return { ok: false, reason: '人機驗證服務暫時無法存取，請稍後再試。' };
    }
}
//# sourceMappingURL=turnstile.js.map