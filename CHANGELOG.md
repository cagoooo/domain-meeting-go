# 更新日誌 CHANGELOG

本專案採用 [Semantic Versioning](https://semver.org/lang/zh-TW/) 版本命名規則。

---

## [0.3.0] — 2026-04-25 🚀 SW 更新機制 + PDF 偏右終極修復

### ✨ 新增 Features：Service Worker 自動更新機制
解決使用者「程式碼改了但還看舊版」的經典坑——這個專案部署在 GitHub Pages，瀏覽器 / SW 快取常讓使用者測不到新版（剛才連續 5 次 PDF 修復就被快取困擾）。

| 元件 | 角色 |
|---|---|
| `public/sw.js` | Service Worker：HTML network-first、Next.js `_next/static/*` cache-first（檔名已含 hash 安全）、`version.json` network-only、其他 stale-while-revalidate |
| `public/version.json` | 版本中央資料源，前端定期輪詢比對 |
| `src/components/sw-register.tsx` | 客戶端元件：註冊 SW + 每 5 分鐘檢查版本 + 新版浮動 banner（含「立即更新」按鈕，會 `skipWaiting` + 清 caches + reload）|
| `scripts/bump-version.mjs` | 一鍵同步 `package.json` / `version.json` / `sw.js` / `README.md` 的版本號 |
| `npm run bump 0.3.1` | 對應 npm script |

**只在 production 啟用 SW**（dev 不會干擾 HMR）。

### 🐛 修正 Bug Fixes：PDF 偏右終極修復
v0.2.5 的 `windowWidth: 1100` 仍然失效——使用者 v0.3.0 重新測試還是偏右且表格被切。實證原因：

> **element 在 html2canvas 處理之前，就已經在原本 container 裡 layout 過一次。** 若使用者瀏覽器視窗 < 900px 或 container 有 padding/max-width 限制，element 的實際 `offsetWidth` 在被搬到 onclone 副本前就已經 < 900px。`windowWidth` 與 `onclone` 都修不了「已凝固的 layout 狀態」。

**真正的解法**——在匯出**前**，先把 element 在實際 DOM 上：
- 移到 off-screen (`position: absolute; left: -99999px`)
- 三重寬度鎖：`width / min-width / max-width = 900px`
- 等兩個 animation frame 讓 layout flush
- 再交給 html2canvas 截圖
- 完成後 `try/finally` 還原原始 inline style

這樣 element 完全脫離 viewport / container 約束，以乾淨的 900px 寬度 layout 一次，使用者瀏覽器視窗大小不再影響截圖。

### 💡 經驗記錄
- **html2canvas 截圖前的 element layout 才是關鍵**——`windowWidth` / `onclone` 只影響截圖階段，無法改寫 element 在 DOM 上已經完成的 layout。要強制特定寬度，必須在實際 DOM 上預先「凍結」layout。
- **GitHub Pages 部署的 PWA 需要 SW 更新機制**，不然 bug 修了使用者也測不到。`version.json` + 5 分鐘輪詢 + banner 是輕量可靠的模式。

---

## [0.2.5] — 2026-04-24 🎯 PDF 偏右根本原因定位 + 修復

### 🔬 根因分析（終於找到真兇）
前四版（0.2.0~0.2.4）都以為偏右是「座標計算問題」，一再改 margin、`position: fixed`、`onclone`，都沒命中根因。

此版用 `pypdf` 解析 PDF 內容後才發現實情：
1. **PDF 層面完全置中**（image 在 A4 上左右各 12mm，偏移 0mm）
2. **但 image 本身被裁切**：html2canvas 產出的 PNG 是 **1406×2018**，而 `#printable-report` 寬 900px × scale 2 **應該是 1800px**，**394px 被截掉在右邊**
3. 於是視覺上看起來像「整體內容偏左、右邊留白」——其實是右半內容掉了

### 🐛 真正的 Bug Fix
- 加回 `html2canvas.windowWidth: 1100`：明確告訴 html2canvas 用 1100px 視窗寬度渲染 DOM，確保 900px 的 `#printable-report` 能完整顯示、不被右側裁切。
  - 之前 v0.2.0 用 `windowWidth: 900`（和 element 同寬）會邊界效應，引發誤判以為 windowWidth 本身有問題。實際只要 `windowWidth > element width` 就不會偏移。
- 保留 v0.2.4 的 `onclone` hook（避免父層 container / body 漸層干擾）。
- 保留 v0.2.3 的 `['css', 'legacy']` 分頁模式（不再用 avoid-all，改靠 CSS rules）。

### 🛠️ 新增開發工具（未 commit 進 repo）
為診斷此問題寫了兩個 Python script（本地保留，不加入 repo）：
- `scripts/analyze_pdf.py`：解析 PDF 內的 image content stream，量化 image 在 A4 上的位置與偏移
- `scripts/extract_pdf_image.py`：把 PDF 裡的 image 物件 dump 出來，直接檢查 html2canvas 截的 PNG 是否完整

### 💡 經驗記錄
- **診斷 PDF 視覺問題時，先看「PDF 結構層」與「canvas 圖像層」分別的狀態**，不要混為一談：
  - PDF 結構錯（image 在頁面上位置錯）→ 調 `margin` / `jsPDF` 選項
  - Canvas 圖錯（image 內容被裁切或縮放錯）→ 調 `html2canvas.windowWidth` / `scale` / `onclone`
- `pypdf` + 讀取 content stream 的 `cm` 矩陣，是診斷 html2pdf 輸出的利器
- `html2canvas.windowWidth` 必須 **大於** element 寬度，同值會有邊界效應

---

## [0.2.4] — 2026-04-24 📄 PDF 置中徹底修正

### 🐛 修正 Bug Fixes
- **PDF 內容依舊偏右未置中**（v0.2.2 試過移除 `windowWidth` 仍無效）：真正根因是 `#printable-report` 位於 `TooltipProvider > container` 等多層父層結構中，加上 body 的 `bg-gradient` 漸層背景，html2canvas 的座標系統被這些祖先影響；外加 `pagebreak.mode` 的 `avoid-all` 會干擾尺寸計算。
- **雙管齊下解法**：
  - **html2canvas `onclone` hook**：在 html2canvas 內部克隆的 DOM 副本中，把 `#printable-report` 搬到 body 根、清除 margin/position/transform、重設 body 為白底無邊距。這讓截圖的座標系統完全乾淨，但使用者真實頁面完全不受影響。
  - 移除 `pagebreak.mode` 中的 `'avoid-all'`，改回 `['css', 'legacy']`，依靠 `globals.css` 的 `page-break-inside: avoid` rules + 區塊類別 (`.pdf-section`, `.photo-card`, `.pdf-avoid`) 來處理分頁避切割。
- `pagebreak.avoid` 也移除 `p, li`（避免被 legacy 模式當作切片單位，造成額外位移）。

### 💡 經驗記錄
- 當 PDF 匯出偏移時，**onclone** 是最乾淨的調整手法——改副本 DOM 而非真實 DOM，比 `position: fixed` / `margin: 0 auto` hack 都可靠。
- `html2pdf.js` 的 `avoid-all` 模式雖然方便但有副作用，小心用；優先以 CSS `page-break-inside: avoid` 規則替代。

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
