# 領域共備GO｜Domain Meeting Go

> 教師社群會議報告自動產出助手。上傳會議照片、填寫會議資訊，AI 自動生成每張照片的觀察描述與整場會議的深度總結，一鍵匯出高質感 Word 與 PDF 報告。

![Version](https://img.shields.io/badge/version-0.5.4-blue)
![Next.js](https://img.shields.io/badge/Next.js-15.2.3-black)
![Firebase](https://img.shields.io/badge/Firebase-Functions%20v2-orange)
![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash%20Lite-green)

🌐 **線上使用：[會議記錄自動產出平台 (Pro版)](https://cagoooo.github.io/domain-meeting-go/)**

---

## ✨ 核心功能

| 功能 | 說明 |
|---|---|
| 📝 **會議資訊輸入** | 教學領域、會議類別（備課 / 觀課 / 議課 / 講座 / 社群 / 其他）、主題、日期、社群成員 |
| 📷 **照片智慧描述** | 最多上傳 4 張會議照片，AI 逐張分析並產出符合教學情境的觀察描述（含重試機制 + 2 秒冷卻避開配額） |
| 🤖 **會議深度總結** | 結合會議資訊與照片描述，AI 產出結構化 Markdown 總結報告 |
| 📄 **Word 匯出** | 產出 `.docx`，含基本資訊表、簽到表、照片紀錄、Markdown 解析後的格式化總結 |
| 🖨️ **PDF 匯出** | 透過瀏覽器原生 `window.print()` + `@media print` CSS 產出 A4 版面 PDF，中文字型完美 + 標準分頁規則 |
| 🎯 **即時視覺回饋** | 成功產出時在照片位置播放彩花動畫、進度條、自動捲動定位目前處理的項目 |
| 🎨 **編輯部期刊風 UI** | v0.5.0 改版 — 報紙頭版 masthead + 酒紅×牛皮配色，AI 摘要以雙欄期刊版型呈現（首字下沉、■ 項目符號、底部簽名） |

---

## 🛠️ 技術棧

**前端**
- Next.js 15.2.3（App Router + Turbopack，dev port `9002`，靜態 export → GitHub Pages）
- React 18.3.1 + TypeScript 5
- Tailwind CSS 3.4 + shadcn/ui（Radix UI 元件庫）
- 自訂 `dmg-*` 編輯部期刊風 CSS 元件（v0.5.0 起）
- Google Fonts: Noto Serif TC / Noto Sans TC / JetBrains Mono
- React Hook Form + Zod 表單驗證
- `react-markdown` Markdown 渲染（列印範本用）
- `docx` Word 文件產生
- 瀏覽器原生 `window.print()` + `@media print` CSS（PDF 匯出 — v0.4.0 起取代 html2pdf.js）
- `canvas-confetti` 成功動畫

**後端 / AI**
- Firebase Cloud Functions v2（`onCall` 可呼叫函式）
- Google Genkit + `@genkit-ai/google-genai`
- **模型**：`googleai/gemini-2.5-flash-lite`
- API Key 透過 `defineSecret("GEMINI_API_KEY")` 管理

**對外 Cloud Functions**
- `generatePhotoDescriptions` — 單張照片的 AI 描述生成
- `generateMeetingSummary` — 整場會議的 Markdown 總結生成

---

## 🚀 本地開發

### 前置需求
- Node.js 20+
- Firebase CLI（`npm install -g firebase-tools`）
- Google Cloud 專案（開啟 Blaze 方案以使用 Functions v2）

### 安裝

```bash
npm install
cd functions && npm install && cd ..
```

### 設定 Gemini API Key

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

### 啟動開發伺服器

```bash
npm run dev           # Next.js 前端（http://localhost:9002）
npm run genkit:dev    # Genkit AI 開發介面（選用）
```

### 部署

```bash
# 部署 Cloud Functions
firebase deploy --only functions

# 部署前端（若使用 Firebase Hosting）
npm run build
firebase deploy --only hosting
```

---

## 📐 專案結構

```
report/
├── src/
│   ├── app/
│   │   ├── page.tsx           # 主頁面（會議資訊表單 + 照片上傳 + 匯出）
│   │   ├── layout.tsx         # 全域 layout（含 OG Image 設定）
│   │   └── globals.css        # Tailwind + PDF 列印分頁規則
│   ├── components/ui/         # shadcn/ui 元件
│   ├── hooks/                 # 自訂 React hooks（use-toast）
│   └── lib/                   # Firebase client、utils
├── functions/
│   └── src/index.ts           # Cloud Functions（照片描述 + 會議總結）
├── public/
│   ├── favicon.png
│   └── og_preview.png         # 社群分享預覽圖
├── meeting_report_template*.html  # 設計參考範本
└── firebase.json
```

---

## 📄 授權

內部教育研究與教師社群協作使用。

---

## 🔐 資安政策

關於 Firebase Web API Key 出現在前端 bundle 的安全說明，請見 [SECURITY.md](./SECURITY.md)。

---

## 🔗 關聯資源

- **線上版本**：由 Firebase Hosting 佈署
- **相關工具**：
  - 🦄 [創建專屬助手](https://document-ai-companion-ipad4.replit.app)
  - 🐝 [點『石』成金（評語優化）](https://line.me/R/ti/p/@733oiboa)

詳細版本變更請見 [CHANGELOG.md](./CHANGELOG.md)。

---

<!-- BEGIN:PROJECT_GUIDE -->
## 專案導覽

這個 repository 收錄 **domain-meeting-go** 專案的原始碼與相關資源。以下資訊依目前檔案結構整理；實際行為仍以程式碼與部署設定為準。

- 專案定位：實用工具／自動化原型
- Repository：`cagoooo/domain-meeting-go`
- 可見性：公開
- 主要技術：TypeScript、React、Next.js、Firebase、Tailwind CSS
- 線上入口：<https://cagoooo.github.io/domain-meeting-go/>

### 可以怎麼應用

- 解決特定工作流程中的重複操作或資訊整理需求
- 作為相近工具的功能原型與程式碼參考
- 串接新的資料來源、服務或介面後延伸到其他情境

這些是依目前專案定位整理的延伸方向，不代表所有情境都已內建完成；實作前請先確認現有功能與資料格式。

### 技術與專案結構

- `README.md`
- `docs`
- `firebase.json`
- `functions`
- `package.json`
- `public`
- `scripts`
- `src`

檔案結構會隨版本演進；若本節與程式碼不一致，以目前預設分支的原始碼為準。

### 本機執行

```bash
npm install
# dev
npm run dev
# start
npm run start
# build
npm run build
# lint
npm run lint
```
請以 `package.json` 的 `scripts` 為準；若專案需要雲端服務，請先建立自己的環境變數與測試專案。

### 給 AI Agent 的接手指南

1. 先閱讀本 README、`AGENTS.md`（若有）、套件腳本與部署設定。
2. 先從入口檔、設定檔與資料流確認真實行為，不要只依 repo 名稱推測。
3. 修改前檢查環境變數、外部服務、檔案格式與失敗處理。
4. 完成後執行既有檢查，並以最小可重現案例驗證主要流程。
5. 不要捏造尚未存在的功能；README 與實作有落差時，應同時更新文件。
6. 提交前只納入本次任務檔案，並記錄實際執行過的驗證。

### 安全與資料注意事項

- 不要提交 `.env`、服務帳號、API 金鑰、token、學生個資或正式環境匯出資料。
- 使用 Firebase、Supabase、Google API 或其他雲端服務時，請建立自己的測試專案並套用最小權限。
- 若要公開衍生作品，請先確認程式碼、圖片、音訊、字型與教材內容的授權。

### 貢獻與客製化

歡迎依教學現場、活動或工作流程需求進行 fork／客製化。建議在變更說明中交代使用情境、主要修改、測試方式，以及是否影響資料格式或部署設定。
<!-- END:PROJECT_GUIDE -->
