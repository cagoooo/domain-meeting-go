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
exports.NOTIFY_WINDOW_MS = void 0;
exports.notifySignature = notifySignature;
exports.shouldSendNotification = shouldSendNotification;
/**
 * 管理員通知節流（跨使用者、跨 instance 共用，Firestore 記錄）
 *
 * 規則：同一種失敗／警示（標題 + 錯誤類型／訊息，數字正規化）在 10 分鐘內只推第一則，
 * 其餘只計數；視窗過後同一種事件再發生時，推播並附上「期間另合併 N 則」。
 * 成功／開始類通知每則內容都不同（不同老師、不同會議），不節流。
 *
 * Firestore 出錯時 fail-open（寧可多推，不要漏掉告警）。
 */
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const COLLECTION = 'dmg_notify_throttle';
exports.NOTIFY_WINDOW_MS = 10 * 60 * 1000;
/** 數字、時間、ID 會讓同一種錯誤每次都長得不一樣，先正規化再比對 */
function notifySignature(parts) {
    return parts
        .map((p) => p.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().substring(0, 120))
        .join('|');
}
async function shouldSendNotification(signature) {
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection(COLLECTION).doc((0, node_crypto_1.createHash)('sha256').update(signature).digest('hex').substring(0, 32));
    const now = Date.now();
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const windowStart = snap.exists ? snap.get('windowStart') : 0;
            const suppressed = snap.exists ? snap.get('suppressed') : 0;
            if (!snap.exists || now - windowStart >= exports.NOTIFY_WINDOW_MS) {
                tx.set(ref, {
                    windowStart: now,
                    suppressed: 0,
                    expireAt: firestore_1.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
                });
                return { send: true, merged: suppressed };
            }
            tx.update(ref, { suppressed: suppressed + 1 });
            return { send: false, merged: 0 };
        });
    }
    catch (e) {
        logger.error('[notify-throttle] Firestore 失敗，照常推播', { message: e?.message || String(e) });
        return { send: true, merged: 0 };
    }
}
//# sourceMappingURL=notify-throttle.js.map