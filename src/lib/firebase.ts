import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
import { getFunctions } from "firebase/functions";
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
