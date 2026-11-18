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
exports.LOGIN_REQUIRED_MESSAGE = exports.DAILY_LIMITS = void 0;
exports.requireGoogleUser = requireGoogleUser;
exports.taipeiDate = taipeiDate;
exports.consumeDailyQuota = consumeDailyQuota;
exports.refundDailyQuota = refundDailyQuota;
exports.dailyExhaustedMessage = dailyExhaustedMessage;
/**
 * Google 登入檢查 + 每個帳號每日次數（台北時間午夜重置）
 *
 * 政策（2026-11-17 阿凱老師定案）：花 Gemini 額度的功能一律
 *   ① 必須 Google 帳號登入（拒絕匿名）
 *   ② 每個帳號每天 5 次（本站 1 次 = 產生 1 份會議摘要）
 *   ③ 每次使用發 Google Chat 通知
 * 照片描述另設每帳號每日上限當保險絲（一份報告最多 4 張照片）。
 *
 * 計數文件放在既有的 dmg_rate_limits 集合（同一個 expireAt TTL 自動清除）。
 * AI 呼叫失敗時呼叫 refundDailyQuota 把次數退回。
 */
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const COLLECTION = 'dmg_rate_limits';
exports.DAILY_LIMITS = {
    summary: 5,
    photo: 20,
};
exports.LOGIN_REQUIRED_MESSAGE = '請先用 Google 帳號登入才能使用 AI 功能。';
/** onCall 版：框架已驗過 ID Token（無效 token 在這之前就被擋），這裡再擋「沒帶」與「匿名」 */
function requireGoogleUser(request) {
    const auth = request.auth;
    if (!auth || !auth.uid)
        throw new https_1.HttpsError('unauthenticated', exports.LOGIN_REQUIRED_MESSAGE);
    const provider = auth.token?.firebase?.sign_in_provider;
    if (provider === 'anonymous')
        throw new https_1.HttpsError('unauthenticated', exports.LOGIN_REQUIRED_MESSAGE);
    const email = typeof auth.token?.email === 'string' ? auth.token.email : '';
    const name = typeof auth.token?.name === 'string' && auth.token.name.trim() ? auth.token.name.trim() : email || '未提供';
    return { uid: auth.uid, email: email || '未提供', name };
}
/** 台北時間日期 YYYY-MM-DD */
function taipeiDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}
function quotaRef(kind, uid, date = taipeiDate()) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(`daily_${kind}_${uid}_${date}`);
}
/** 扣 1 次；超過上限回 ok=false（不扣）。Firestore 故障時放行但記 log（不能因計數器壞掉讓老師無法用）。 */
async function consumeDailyQuota(kind, uid) {
    const limit = exports.DAILY_LIMITS[kind];
    const date = taipeiDate();
    const ref = quotaRef(kind, uid, date);
    // 兩天後自動清除（TTL）
    const expireAt = firestore_1.Timestamp.fromMillis(Date.now() + 2 * 24 * 60 * 60 * 1000);
    try {
        return await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const used = snap.exists ? Number(snap.get('count')) || 0 : 0;
            if (used >= limit)
                return { ok: false, used, limit, remaining: 0, date };
            tx.set(ref, { scope: `daily_${kind}`, uid, date, count: used + 1, expireAt, updatedAt: firestore_1.Timestamp.now() });
            return { ok: true, used: used + 1, limit, remaining: limit - used - 1, date };
        });
    }
    catch (e) {
        logger.error('[daily-quota] Firestore 計數失敗，暫時放行', { kind, message: e?.message || String(e) });
        return { ok: true, used: 0, limit, remaining: limit, date };
    }
}
/** AI 失敗時退回 1 次（用扣次當天的日期，跨午夜也退到正確那天） */
async function refundDailyQuota(kind, uid, date) {
    const ref = quotaRef(kind, uid, date);
    const limit = exports.DAILY_LIMITS[kind];
    try {
        return await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return limit;
            const used = Math.max(0, (Number(snap.get('count')) || 0) - 1);
            tx.update(ref, { count: used, updatedAt: firestore_1.Timestamp.now() });
            return limit - used;
        });
    }
    catch (e) {
        logger.error('[daily-quota] 退回次數失敗', { kind, message: e?.message || String(e) });
        return null;
    }
}
function dailyExhaustedMessage(kind) {
    return kind === 'summary'
        ? `今天的 ${exports.DAILY_LIMITS.summary} 次會議摘要已用完，明天（台北時間午夜後）再來。`
        : `今天的照片描述已達 ${exports.DAILY_LIMITS.photo} 張上限，明天（台北時間午夜後）再來。`;
}
//# sourceMappingURL=auth-quota.js.map