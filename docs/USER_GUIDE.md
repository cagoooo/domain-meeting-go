# 📘 領域共備GO — 詳細使用說明手冊

> **版本**：v0.1.0　｜　**更新日期**：2026-04-22　｜　**適用對象**：國小教師、行政人員

---

## 目錄

1. [專案簡介](#1-專案簡介)
2. [技術架構](#2-技術架構)
3. [本地環境設定與啟動](#3-本地環境設定與啟動)
4. [功能操作流程（四步驟）](#4-功能操作流程四步驟)
5. [AI 功能說明](#5-ai-功能說明)
6. [報告模板說明](#6-報告模板說明)
7. [常見問題 FAQ](#7-常見問題-faq)
8. [環境變數說明](#8-環境變數說明)

---

## 1. 專案簡介

**領域共備GO** 是一款專為國小教師設計的 AI 輔助會議報告產生工具。

透過上傳最多 4 張會議照片，並填寫基本的會議資訊，系統將自動：
- 利用 **Google Gemini API（視覺辨識）** 為每張照片產生專業的教育觀察描述
- 整合照片描述與會議資訊，產出一份 **300–500 字的繁體中文（台灣用語）會議摘要**
- 提供一鍵匯出功能，快速輸出正式會議報告

---

## 2. 技術架構

```
瀏覽器 (Client)
Next.js 15 App Router + React 18
Tailwind CSS + shadcn/ui Radix UI
          |（Server Actions）
Next.js Server (Node.js)
Firebase Genkit + Google AI Plugin
flows/generate-photo-descriptions.ts
flows/generate-meeting-summary.ts
          |（HTTPS API）
Google Gemini API
模型：gemini-1.5-flash
功能：視覺分析、文字生成
```

### 技術堆疊一覽

| 類別 | 技術 | 版本 |
|------|------|------|
| 框架 | Next.js | 15.2.3 |
| UI 函式庫 | React | ^18.3.1 |
| 元件庫 | shadcn/ui + Radix UI | 最新版 |
| 樣式 | Tailwind CSS | ^3.4.1 |
| AI 框架 | Firebase Genkit | ^1.32.0 |
| AI 模型 | Google Gemini (via @genkit-ai/google-genai) | ^1.32.0 |
| 表單驗證 | React Hook Form + Zod | 最新版 |
| 圖表 | Recharts | ^2.15.1 |
| 語言 | TypeScript | ^5 |

---

## 3. 本地環境設定與啟動

### 前置需求

- **Node.js** v18 以上（建議 v20 LTS）
- **npm** v9 以上
- **Google Gemini API Key**（至 Google AI Studio 免費申請）

### 步驟一：進入專案目錄

```powershell
cd h:\report
```

### 步驟二：安裝相依套件

```powershell
npm install
```

### 步驟三：建立環境變數檔案

在專案根目錄建立 `.env` 檔案（已被 `.gitignore` 排除，不會上傳至 GitHub）：

```env
GOOGLE_GENAI_API_KEY=你的_Gemini_API_Key
```

### 步驟四：啟動開發伺服器

```powershell
npm run dev
```

啟動成功後，在瀏覽器開啟：http://localhost:9002

### 常用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 啟動開發伺服器（Turbopack 加速，Port 9002） |
| `npm run build` | 打包正式環境版本 |
| `npm run start` | 啟動正式環境伺服器 |
| `npm run genkit:dev` | 啟動 Genkit 開發介面（除錯 AI Flow 用） |

---

## 4. 功能操作流程（四步驟）

### 第一步：輸入會議資訊（藍色卡片）

填寫以下四個必填欄位：

| 欄位名稱 | 範例輸入 | 說明 |
|----------|----------|------|
| **教學領域** | 國語、數學、自然 | 本次會議所屬的學科領域 |
| **會議主題** | 閱讀理解策略分享 | 本次會議的核心討論議題 |
| **會議日期** | 點選日曆選擇 | 格式：yyyy年MM月dd日 |
| **社群成員** | 王老師, 李老師, 陳老師 | 以逗號分隔 |

---

### 第二步：上傳會議照片（綠色卡片）

- 點擊或拖曳照片到上傳區域
- 支援格式：JPEG、PNG、WebP
- 每張大小限制：20MB 以內
- 最多上傳 4 張照片

上傳後以 2×2 格局預覽，可點 ✕ 刪除單張。

**產生照片描述流程：**
1. 點擊「產生照片描述」按鈕
2. 系統逐張傳送至 Gemini Vision API（每張間隔 2 秒避免超限）
3. 進度條即時呈現（0% → 100%）
4. 完成後每張照片下方顯示 60–100 字教育觀察描述

> **隱私保護**：AI 提示詞強制去識別化，僅使用「老師」、「學生們」等通用稱呼。

---

### 第三步：產生會議摘要（紫色卡片）

點擊「產生會議摘要」：
1. 整合所有資訊+各張照片描述
2. 送至 Gemini 生成 300–500 字繁體中文摘要
3. 模擬進度條避免長時間空白等待
4. 摘要顯示於可編輯文字框

---

### 第四步：匯出報告（橘色卡片）

- 點擊「匯出 Word (.doc)」（需先完成摘要）
- 目前匯出邏輯尚待完整實作（見優化建議文件）

---

### 浮動快捷按鈕（右下角）

| 按鈕 | 說明 |
|------|------|
| 創建專屬助手 | 跳轉至 Replit 自訂 AI 助手建置頁 |
| 點『石』成金（評語優化） | 跳轉至 LINE 教學評語 AI 優化 |

---

## 5. AI 功能說明

### 照片描述生成

**檔案**：`src/ai/flows/generate-photo-descriptions.ts`

- 輸入：教學領域、主題、成員、日期、照片（Base64）
- 輸出：60–100 字繁體中文教育觀察描述
- 安全設定：全部 `BLOCK_NONE`，確保教育場景不被誤攔截
- 錯誤處理：429/512 → 配額提示；安全機制 → 角度建議

### 會議摘要生成

**檔案**：`src/ai/flows/generate-meeting-summary.ts`

- 輸入：全部欄位 + 有效照片描述陣列
- 輸出：300–500 字正式繁體中文會議總結
- 使用 Handlebars 模板語法（`{{#each photoDescriptions}}`）

---

## 6. 報告模板說明

根目錄提供三種靜態 HTML 報告模板：

| 版本 | 檔案 | 特色 |
|------|------|------|
| v1 | `meeting_report_template.html` | 基本版，標楷體字型，2×2 圖表格 |
| v2 | `meeting_report_template_v2.html` | 擴充版 |
| v3 | `meeting_report_template_v3.html` | 最新版 |

**手動使用流程：**
1. 文字編輯器開啟 HTML 模板
2. 貼入 AI 產生的摘要
3. 替換圖片路徑
4. 瀏覽器開啟 → 列印 → 另存 PDF

---

## 7. 常見問題 FAQ

**Q1：照片上傳後一直轉圈？**
確認 `.env` 中 `GOOGLE_GENAI_API_KEY` 是否正確，重啟開發伺服器。

**Q2：出現「模型目前忙碌中（配額限制）」？**
Gemini 免費層有每分鐘請求數限制，等待約 1 分鐘後再試，或升級 API 方案。

**Q3：圖片顯示「因人臉隱私無法描述」？**
建議拍攝側面、背面或遠景，避免正面特寫。

**Q4：「匯出 Word」按了沒反應？**
功能尚未完整實作，請改用 HTML 模板手動匯出。

**Q5：如何更換 AI 模型？**
編輯 `src/ai/ai-instance.ts` 第 11 行，將 `gemini-1.5-flash` 改為所需模型（建議：`gemini-2.5-flash-lite`）。

---

## 8. 環境變數說明

| 變數名稱 | 用途 | 必填 |
|----------|------|------|
| `GOOGLE_GENAI_API_KEY` | Genkit 使用的 Gemini API Key（伺服器端） | 必填 |
| `GEMINI_API_KEY` | 備用 Key（目前程式碼未直接使用） | 可選 |

> 以上變數由 Next.js Server Actions 在伺服器端讀取，不會暴露至瀏覽器，安全無虞。
