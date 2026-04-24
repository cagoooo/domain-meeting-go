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

## 🛡️ 回報漏洞

若發現**真正的**資安問題（例如 Cloud Function 未驗證輸入、或真的機敏憑證外洩），請透過 GitHub Issue 以 `security` 標籤回報，或私訊維護者。
