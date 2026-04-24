# 更新日誌 CHANGELOG

本專案採用 [Semantic Versioning](https://semver.org/lang/zh-TW/) 版本命名規則。

---

## [0.2.3] — 2026-04-24 🔐 資安加固

### 🛡️ Security Hardening
- 處理 GitHub Secret Scanning 對 Firebase Web API Key 的 Public leak 誤報：
  - **自動化套用** GCP API Key HTTP Referrer 限制（透過 `gcloud services api-keys update`），將該 key 限制為只能從本專案相關網域呼叫：
    - `https://cagoooo.github.io/*`
    - `https://cagoooo.github.io/domain-meeting-go/*`
    - `https://teacher-c571b.web.app/*`
    - `https://teacher-c571b.firebaseapp.com/*`
    - `http://localhost:9002/*`（dev）
    - `http://localhost/*`
  - 確認 API Restrictions 未勾選任何收費 API（Maps / Places / Translate / Vision 等）
  - 受影響的 key：`projects/82691545657/locations/global/keys/058d381b-1f8f-455c-9eb8-9adc181bed29`（teacher-c571b 專案的 Firebase Browser Key）

### 📚 文件 Documentation
- 新增 `SECURITY.md`，記錄本專案的資安政策與 Firebase Web API Key 公開的官方依據，作為未來同類警告的一勞永逸應對文件。
- 更新 `README.md` 加入 SECURITY 連結。

### 💡 經驗記錄
- Firebase Web API Key 出現在前端 bundle 是官方設計（[Firebase 文件](https://firebase.google.com/docs/projects/api-keys)），GitHub Secret Scanning 此類 alert 屬誤報範疇
- 真正的保護靠 GCP Console 的 HTTP Referrer + API Restrictions，而非保密
- 後續處理此類 alert 的標準流程已寫入 `SECURITY.md`

---

## [0.2.2] — 2026-04-24 🚨 緊急修復

### 🐛 修正 Bug Fixes
- **v0.2.1 造成 PDF 下載後完全空白**：上一版嘗試用 `position: fixed; zIndex: -9999` 解決偏右問題，但該定位方式會讓 html2canvas 無法正確截取內容，產生空白 PDF。此版回滾所有臨時定位技巧，改用最精簡方案：
  - 回到 v0.1.x 原本的 `reportElement.style.display = 'block'` 單一步驟
  - **唯一真正有效的偏右修正**：不設 `html2canvas.windowWidth`（v0.2.0 設 `900` 才是原本偏右的真因）
  - margin 回到對稱安全值 `[15, 12, 15, 12]`
  - 保留 `try/finally` 確保 display 一定會還原

### 💡 經驗記錄
- `html2canvas.windowWidth` 一旦與 element 固定寬度同值，會造成 canvas 座標計算偏移——此參數在絕大多數情境應保留預設值。
- `position: fixed` + 負 z-index 的「隱形截圖」技巧在 html2pdf.js + html2canvas 組合下不可行，會導致截圖空白。

---

## [0.2.1] — 2026-04-24

### 🐛 修正 Bug Fixes
- **PDF 內容整體偏右未置中**：v0.2.0 加的 `windowWidth: 900` 會讓 html2canvas 的座標計算與 parent 佈局產生偏移（實測約 7mm）。此版：
  - 移除 `windowWidth: 900`
  - 加入 `x: 0, y: 0` 讓 html2canvas 從 element 左上角精準截取
  - 在匯出期間把 `#printable-report` 臨時 `position: fixed; left: 0; top: 0; margin: 0`，完全脫離父層 container / body 漸層佈局，截圖完成後用 `try/finally` 還原樣式

---

## [0.2.0] — 2026-04-24

### 🐛 修正 Bug Fixes
- **PDF 匯出文字被切半**：重構 `html2pdf.js` 的分頁策略，加入 `avoid-all` 模式與完整的 `avoid` 選擇器清單（涵蓋 `p`、`li`、`img`、`table`、`tr`、`h1~h4`、`.pdf-section`、`.photo-card`），並為會議總結區塊改為「內部段落級別 avoid」（因為區塊長度常超過一頁，整塊 avoid 反而造成硬切）。
- **PDF 底部文字貼邊被裁**：下邊距由 15mm 加大至 20mm，並新增 `windowWidth: 900` 穩定 canvas 渲染寬度。

### ✨ 新增 Features
- `globals.css` 加入完整的 PDF 列印分頁規則（`.pdf-section`、`.photo-card`、`.pdf-markdown-summary` 內的所有 `p`/`li`/`h*`/`blockquote`、`img`、`tr`），並設定 `orphans: 3` / `widows: 3` 避免孤字出現在頁面邊緣。
- 列印範本的基本資訊卡、簽到表卡、照片卡正式掛上對應 CSS 類別（`pdf-section` / `photo-card`），讓分頁規則能精準鎖定。

### 📚 文件 Documentation
- 新增正式的中文 `README.md`，涵蓋功能說明、技術棧、本地開發步驟、部署指令、專案結構圖。
- 新增 `CHANGELOG.md` 以記錄往後每次版本的變更。

---

## [0.1.x] — 先前歷史（未正式記錄）

以下為先前已推送至 GitHub、但尚未納入正式版本管理的重要變更摘要：

### PDF 匯出
- 導入 `html2pdf.js` 專業引擎取代早期的 `jsPDF` + 手動畫布切片方案
- 大升級 PDF 視覺與排版：卡片式佈局、邊界設定、標題分隔線
- 實作畫布切片技術並修正樣式 Bug

### 視覺資產
- 新增 Favicon（`public/favicon.png`）
- 新增社群分享預覽圖 OG Image（`public/og_preview.png`），解決 Facebook / LINE 分享卡片顯示問題
- 優化懸浮按鈕：RWD 響應式佈局、現代化視覺設計（桌機展開文字、手機收合為圓形 icon）

### AI 功能
- 基於 Firebase Functions v2 + Genkit + Gemini 2.5 Flash Lite 實作兩個 Cloud Functions：
  - `generatePhotoDescriptions`
  - `generateMeetingSummary`
- 前端加入重試機制（指數退避）、2 秒冷卻延遲、進度條、彩花動畫、自動捲動定位

### 匯出格式
- Word 匯出（`docx`）：基本資訊表、簽到表、照片紀錄、Markdown 解析後的格式化總結
- PDF 匯出：A4 版面、專業文書白底設計

---

## 版本命名規則

- `MAJOR`：破壞性變更（例：Cloud Functions API 介面大改）
- `MINOR`：向下相容的新功能（例：新增匯出格式、新增步驟）
- `PATCH`：向下相容的 Bug 修正（例：單一匯出格式的排版修正）
