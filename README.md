# 領域共備GO｜Domain Meeting Go

> 教師社群會議報告自動產出助手。上傳會議照片、填寫會議資訊，AI 自動生成每張照片的觀察描述與整場會議的深度總結，一鍵匯出高質感 Word 與 PDF 報告。

![Version](https://img.shields.io/badge/version-0.2.1-blue)
![Next.js](https://img.shields.io/badge/Next.js-15.2.3-black)
![Firebase](https://img.shields.io/badge/Firebase-Functions%20v2-orange)
![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash%20Lite-green)

---

## ✨ 核心功能

| 功能 | 說明 |
|---|---|
| 📝 **會議資訊輸入** | 教學領域、會議類別（備課 / 觀課 / 議課 / 講座 / 社群 / 其他）、主題、日期、社群成員 |
| 📷 **照片智慧描述** | 最多上傳 4 張會議照片，AI 逐張分析並產出符合教學情境的觀察描述（含重試機制 + 2 秒冷卻避開配額） |
| 🤖 **會議深度總結** | 結合會議資訊與照片描述，AI 產出結構化 Markdown 總結報告 |
| 📄 **Word 匯出** | 產出 `.docx`，含基本資訊表、簽到表、照片紀錄、Markdown 解析後的格式化總結 |
| 🖨️ **PDF 匯出** | 透過 `html2pdf.js` 產出 A4 版面 PDF，段落級別分頁避免字被切半 |
| 🎯 **即時視覺回饋** | 成功產出時在照片位置播放彩花動畫、進度條、自動捲動定位目前處理的項目 |

---

## 🛠️ 技術棧

**前端**
- Next.js 15.2.3（App Router + Turbopack，dev port `9002`）
- React 18.3.1 + TypeScript 5
- Tailwind CSS 3.4 + shadcn/ui（Radix UI 元件庫）
- React Hook Form + Zod 表單驗證
- `react-markdown` Markdown 渲染
- `docx` Word 文件產生
- `html2pdf.js` PDF 匯出（基於 html2canvas + jsPDF）
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

## 🔗 關聯資源

- **線上版本**：由 Firebase Hosting 佈署
- **相關工具**：
  - 🦄 [創建專屬助手](https://document-ai-companion-ipad4.replit.app)
  - 🐝 [點『石』成金（評語優化）](https://line.me/R/ti/p/@733oiboa)

詳細版本變更請見 [CHANGELOG.md](./CHANGELOG.md)。
