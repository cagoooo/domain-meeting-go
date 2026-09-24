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
exports.getClientIp = getClientIp;
exports.consumeRateLimit = consumeRateLimit;
/**
 * 每小時固定視窗限流（Firestore 計數）
 *
 * 設計原則:
 *   - 主要以「App Check token」計次（一個人一次 session 一把 token），
 *     IP 只當寬鬆上限——學校常整校共用同一個對外 IP，不能只看 IP
 *   - 只存 SHA-256 雜湊，不落地原始 IP / token
 *   - 計數文件帶 expireAt，搭配 Firestore TTL policy 自動清除
 *   - Firestore 出錯時 fail-open（不能因為計數器故障就讓老師無法使用），但會記 log
 */
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const COLLECTION = 'dmg_rate_limits';
const WINDOW_MS = 60 * 60 * 1000;
function hash(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex').substring(0, 24);
}
/**
 * Cloud Run 前端會把真實來源 IP 附加在 X-Forwarded-For 最後面；
 * 取最後一個才不會被使用者自己塞的 header 偽造。
 */
function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : typeof xff === 'string' ? xff : '';
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || req.ip || 'unknown';
}
/** 回傳 true = 允許；false = 已超過任一規則的上限 */
async function consumeRateLimit(scope, rules) {
    const bucket = Math.floor(Date.now() / WINDOW_MS);
    const expireAt = firestore_1.Timestamp.fromMillis((bucket + 2) * WINDOW_MS);
    const db = (0, firestore_1.getFirestore)();
    const active = rules.filter((r) => r.key);
    try {
        return await db.runTransaction(async (tx) => {
            const refs = active.map((r) => db.collection(COLLECTION).doc(`${scope}_${hash(r.key)}_${bucket}`));
            const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
            const counts = snaps.map((s) => (s.exists ? s.get('count') : 0));
            if (counts.some((count, i) => count >= active[i].limit))
                return false;
            refs.forEach((ref, i) => tx.set(ref, { scope, count: counts[i] + 1, expireAt }));
            return true;
        });
    }
    catch (e) {
        logger.error('[rate-limit] Firestore 計數失敗，暫時放行', { scope, message: e?.message || String(e) });
        return true;
    }
}
//# sourceMappingURL=rate-limit.js.map