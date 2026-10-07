# 安全政策 Security Policy

## 🔑 關於 Firebase Web API Key 出現在前端 bundle

如果您在 GitHub Secret Scanning、安全掃描工具或手動檢視 `_next/.../app/page-*.js` 時看到形如 `AIzaSy...` 的 Google API Key，**這是 Firebase 的設計，不是資安漏洞**。

### 官方依據

根據 [Firebase 官方文件 — API keys](https://firebase.google.com/docs/projects/api-keys)：

> *"Firebase API keys are different from typical API keys... it is OK for these to be publicly exposed."*

### 本專案的實際保護層

這把 Firebase Web API Key 已經在 **Google Cloud Console** 套用下列限制：

#### ① HTTP Referrer 限制（防止別人拿走你的 key 從其他網域亂用）
允許的來源：
```
https://cagoooo.github.io/*
https://cagoooo.github.io/domain-meeting-go/*
https://teacher-c571b.web.app/*
https://teacher-c571b.firebaseapp.com/*
http://localhost:9002/*          # Next.js dev server
http://localhost/*
```

#### ② API Restrictions（限制能呼叫哪些 Google Cloud API）
只啟用 Firebase 相關 service（Firestore、Auth、Functions、Storage 等），**未啟用**任何會噴錢的收費 API（Maps / Places / Translate / Vision 等）。

#### ③ Firebase Cloud Functions 的機敏資料處理
真正機敏的 API Key（如 Gemini API Key）**不在前端 bundle**，而是透過：
- `firebase functions:secrets:set GEMINI_API_KEY`
- `defineSecret("GEMINI_API_KEY")` 在 Cloud Function 內以 Secret Manager 讀取

前端只透過 `httpsCallable` 呼叫 Cloud Functions，不直接接觸外部 API。

---

## 🚨 處理 GitHub Secret Scanning Alert 的標準流程

收到 `Google API Key ... Public leak` 警告時：

1. **先確認來源**：看檔案路徑是否為 build 產物（`_next/`、`dist/`、`build/`、`assets/index-*.js` 等）。若是 → 幾乎可確定是 Firebase Web Key 誤報。
2. **驗證限制是否到位**：Google Cloud Console → APIs & Services → Credentials → 點該 Key → 確認 HTTP Referrers 和 API Restrictions 已設。
3. **Dismiss Alert**：GitHub → Security → Secret scanning alerts → 選 `False positive`（若只加限制）或 `Revoked`（若有做金鑰輪替）。建議 comment：
   ```
   Firebase Web API Key is public by design per Firebase docs.
   Protected via GCP HTTP referrer + API restrictions. See SECURITY.md.
   ```

---

## ❌ 絕對不要做

- **不要** 用 `git filter-repo` / BFG 刪歷史 — key 早已被索引，無意義還會搞壞協作者的 clone
- **不要** 改成後端 proxy fetch — 複雜度遠超收益，業界沒人這樣做
- **不要** 忽略不設 restrictions — 這才是真正的漏洞（會被濫刷帳單）

---

## 🤖 Cloud Functions 防濫用（v0.6.0 起）

```
瀏覽器 → Cloudflare Turnstile（Managed，interaction-only）
      → issueAppCheckToken：siteverify 通過才簽發 App Check token（1 小時）
      → 所有 onCall：enforceAppCheck + CORS 白名單 + maxInstances 5 + 輸入驗證
      → 每小時上限：依 App Check token（每人）與 IP（寬鬆）計次，Firestore `dmg_rate_limits`
```

- Turnstile site key：GitHub repo **Variables** `TURNSTILE_SITE_KEY`（公開值）
- Turnstile secret key：Firebase Secret Manager `TURNSTILE_SECRET`
- 與「台灣本土 AI 教育平台」共用同一個 Turnstile widget（hostname `cagoooo.github.io`），**輪換金鑰時兩邊要一起更新**
- 預算告警：Gemini 金鑰所在的 `photopoet-ha364`（NT$30／月，與 PhotoPoet 共用）與 Cloud Functions 所在的 `teacher-c571b`（NT$5／月），實際花費 50%／90%／100% 與預測超過 100% 時寄信
- 上限數值在 `functions/src/index.ts` 的 `RATE_LIMITS`；計數文件有 `expireAt`，由 Firestore TTL 自動刪除
- widget 的 hostname 為 `cagoooo.github.io` 與 `localhost`（2026-09-24 加入 localhost），本機開發可正常通過人機驗證

---

## 📦 Dependabot 警告評估紀錄（2026-10-07）

前端是純靜態輸出（`output: 'export'`），AI 功能全部在 `functions/`。下列 16 則已在 GitHub 標成「已評估」關閉，每則都有簡短留言：

| 警告 | 套件（位置） | 判斷 |
|---|---|---|
| #1、#2 | `@opentelemetry/sdk-node`、`auto-instrumentations-node`（functions） | 未啟用 Prometheus exporter：genkit 啟動 NodeSDK 時沒設 metric reader，也沒設 `OTEL_METRICS_EXPORTER` |
| #5 | `@opentelemetry/propagator-jaeger`（functions） | 未使用 JaegerPropagator，NodeSDK 也沒註冊 HTTP instrumentation |
| #4 | `@opentelemetry/core`（functions） | 沒註冊 HTTP instrumentation，不會解析傳入的 `baggage` 標頭 |
| #3 | `uuid`（functions） | 本專案與相依套件都沒有呼叫 v3/v5/v6 |
| #191–#197 | OpenTelemetry 資料庫 instrumentation（functions） | 只用 Firestore，沒用 PostgreSQL、MySQL、Mongoose 等資料庫 |
| #198、#199 | `@grpc/grpc-js`（前端，Firebase SDK 帶入） | 瀏覽器版 Firestore 走 WebChannel，打包結果不含 grpc-js；漏洞屬 gRPC 伺服器端 |
| #200、#201 | `braces`、`postcss-selector-parser`（前端，Tailwind 帶入） | 只在建置時處理自己寫的設定與 CSS，不進瀏覽器；要升級 Tailwind v4 才能移除 |

**要重新打開的時機**（GitHub → Security → Dependabot → Closed → 點進警告 → Reopen，或 `gh api -X PATCH repos/cagoooo/domain-meeting-go/dependabot/alerts/<編號> -f state=open`）：

- `functions/` 呼叫 `enableFirebaseTelemetry()`，或在 Cloud Functions 設定任何 `OTEL_*` 環境變數 → 重開 #1、#2、#4、#5
- 改用 PostgreSQL、MySQL 等上表列出的資料庫 → 重開 #191–#197

---

## 🛡️ 回報漏洞

若發現**真正的**資安問題（例如 Cloud Function 未驗證輸入、或真的機敏憑證外洩），請透過 GitHub Issue 以 `security` 標籤回報，或私訊維護者。
