import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
import { getFunctions } from "firebase/functions";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type User } from "firebase/auth";
import { getTurnstileToken } from "./turnstile";

// 使用使用者嚴格規定的佔位符機制 (Placeholder)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "__FIREBASE_API_KEY__",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "__FIREBASE_AUTH_DOMAIN__",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "__FIREBASE_PROJECT_ID__",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "__FIREBASE_APP_ID__",
};

const REGION = "asia-east1";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// App Check：先過 Cloudflare Turnstile，再用 Turnstile token 向後端換 App Check token。
// 之後 httpsCallable 會自動在每個請求帶上 App Check token，後端 enforceAppCheck 擋掉腳本。
if (typeof window !== "undefined") {
  const issueUrl = `https://${REGION}-${firebaseConfig.projectId}.cloudfunctions.net/issueAppCheckToken`;
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const turnstileToken = await getTurnstileToken();
        const res = await fetch(issueUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnstileToken }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.token) {
          throw new Error(body.error || `App Check 驗證失敗 (HTTP ${res.status})`);
        }
        return { token: body.token, expireTimeMillis: Date.now() + body.ttlMillis };
      },
    }),
    // 過期才在下一次呼叫時重新驗證，避免背景一直跳 Turnstile
    isTokenAutoRefreshEnabled: false,
  });
}

export const functions = getFunctions(app, REGION);

// Google 登入：AI 功能必須登入（後端驗 ID Token，httpsCallable 會自動帶上）
export const auth = getAuth(app);

/** 和頁首 App 內建瀏覽器防護同一條判斷式 */
export const isInAppBrowser = () =>
  typeof navigator !== "undefined" &&
  /FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|KAKAOTALK|\bLine\//i.test(navigator.userAgent || "");

/** 回傳 null = 使用者取消（或在 App 內建瀏覽器中，已提醒改用瀏覽器） */
export async function signInWithGoogle(): Promise<User | null> {
  // App 內建瀏覽器（LINE／FB 等）：Google 禁止在此登入（403 disallowed_useragent）。
  // 頁首防護會自動跳轉／引導；這裡再提醒一次，不開登入視窗。
  if (isInAppBrowser()) {
    try {
      window.alert("您目前在 App 內建瀏覽器（LINE／FB 等）中，Google 基於安全政策禁止在此登入。\n\n請點右上／右下角「⋯」→ 選「用預設瀏覽器開啟」後再登入。");
    } catch (e) {
      /* 部分 App 不允許 alert */
    }
    return null;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
    throw e;
  }
}

export const signOutGoogle = () => signOut(auth);
