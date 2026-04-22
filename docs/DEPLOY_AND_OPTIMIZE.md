# 🚀 領域共備GO — GitHub 部署指南與優化建議

> **更新日期**：2026-04-22

---

## 目錄

1. [GitHub 部署可行性分析](#1-github-部署可行性分析)
2. [建議部署方案：Vercel](#2-建議部署方案vercel)
3. [部署前安全檢查清單](#3-部署前安全檢查清單)
4. [GitHub Repository 建立步驟](#4-github-repository-建立步驟)
5. [GitHub Actions CI 設定](#5-github-actions-ci-設定)
6. [Vercel 環境變數設定](#6-vercel-環境變數設定)
7. [優化改良建議（優先度排序）](#7-優化改良建議優先度排序)

---

## 1. GitHub 部署可行性分析

### 可以部署的部分

| 功能 | 狀態 | 說明 |
|------|------|------|
| 前端 UI（表單、照片上傳、預覽） | 可部署 | 純 React Client 元件 |
| AI 照片描述（Genkit Server Action） | 可部署 | 需 Node.js 環境（Vercel） |
| AI 摘要生成（Genkit Server Action） | 可部署 | 同上 |
| 暗黑主題 + RWD 響應式設計 | 可部署 | Tailwind CSS 純靜態 |

### 需額外處理的部分

| 項目 | 問題 | 解決方案 |
|------|------|----------|
| `GOOGLE_GENAI_API_KEY` | 不可硬編碼 | 使用 Vercel 環境變數 |
| AI 模型版本 | `gemini-1.5-flash` 已停用 | 升級至 `gemini-2.5-flash-lite` |
| Word 匯出功能 | 按鈕邏輯未實作 | 見優化建議第 1 項 |
| Email 通知 | 僅為模擬 console.log | 見優化建議第 4 項 |

### 為何不能用 GitHub Pages？

Next.js Server Actions 需要 Node.js 執行環境。GitHub Pages 只能托管純靜態檔案，無法執行 Server Actions。因此必須使用支援 Node.js 的平台，首選 **Vercel**。

---

## 2. 建議部署方案：Vercel

Vercel 是 Next.js 官方推薦平台，完全支援 Server Actions，且有免費方案：

```
GitHub Repo (main branch push)
         → Vercel CI/CD Pipeline (npm run build)
         → Vercel Edge Network (全球 CDN)
         → https://your-app.vercel.app
```

**部署特點：**
- 零設定支援 Next.js 15
- 免費方案：100GB 頻寬/月、無限部署次數
- 自動 HTTPS
- 每次 `git push` 自動重新部署

---

## 3. 部署前安全檢查清單

**步驟一：確認 .gitignore 已排除 .env**

`.gitignore` 第 41 行已有 `.env*`，確認無誤後繼續。

**步驟二：執行 API Key 掃描（在 PowerShell 執行）**

```powershell
cd h:\report
python -c "
import os, re
pattern = re.compile(r'AIzaSy[0-9A-Za-z_-]{33}')
found = []
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ['.git','node_modules','.next']]
    for fname in files:
        if fname.endswith(('.tsx','.ts','.js','.json','.md','.py','.yml')):
            with open(os.path.join(root,fname), encoding='utf-8', errors='ignore') as f:
                for i, line in enumerate(f, 1):
                    if pattern.search(line):
                        found.append(f'{root}/{fname}:{i}')
print('發現 API Key：' if found else '無殘留 API Key')
for x in found: print(' ', x)
"
```

**步驟三：升級 AI 模型版本**

編輯 `src/ai/ai-instance.ts` 第 11 行：

```typescript
// 修改前
model: 'googleai/gemini-1.5-flash',

// 修改後
model: 'googleai/gemini-2.5-flash-lite',
```

---

## 4. GitHub Repository 建立步驟

```powershell
cd h:\report

# 加入所有檔案（.gitignore 自動排除 .env、node_modules）
git add .

# 提交
git commit -m "準備部署至 Vercel"

# 在 GitHub 建立 Repo 後，設定遠端並推送
git remote add origin https://github.com/你的帳號/domain-meeting-go.git
git push -u origin main
```

---

## 5. GitHub Actions CI 設定

建立 `.github/workflows/ci.yml`：

```yaml
name: CI 驗證流程

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 取出程式碼
        uses: actions/checkout@v4

      - name: 設定 Node.js 環境
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: 安裝相依套件
        run: npm ci

      - name: TypeScript 型別檢查
        run: npm run typecheck

      - name: 建置驗證
        run: npm run build
        env:
          GOOGLE_GENAI_API_KEY: ${{ secrets.GOOGLE_GENAI_API_KEY }}
```

**GitHub Secrets 設定位置：**
`Repo → Settings → Secrets and variables → Actions → New repository secret`

| Secret 名稱 | 值 |
|-------------|-----|
| `GOOGLE_GENAI_API_KEY` | 你的 Gemini API Key |

---

## 6. Vercel 環境變數設定

前往 `Vercel Dashboard → 你的專案 → Settings → Environment Variables`

| 變數名稱 | 值 | 環境 |
|----------|-----|------|
| `GOOGLE_GENAI_API_KEY` | 你的 Gemini API Key | Production + Preview |

---

## 7. 優化改良建議（優先度排序）

### 優先度 1（紅色）：完成 Word 匯出功能

**問題**：第四步匯出按鈕存在但邏輯未實作
**解決方案**：安裝 `docx` 套件

```powershell
npm install docx
```

實作方向（新建 `src/app/actions/export.ts`）：

```typescript
'use server';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function exportReport(data: ReportData): Promise<string> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: data.meetingTopic, heading: 'Heading1' }),
        new Paragraph({ text: data.summary }),
        // 加入圖片區塊...
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  return buffer.toString('base64');
}
```

Client 端接收 Base64 後轉 Blob 觸發下載：

```typescript
const blob = new Blob([Buffer.from(base64, 'base64')],
  { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a'); a.href = url; a.download = '會議報告.docx'; a.click();
```

---

### 優先度 2（紅色）：升級 AI 模型

已在步驟三說明，重新整理：

```typescript
// src/ai/ai-instance.ts
export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
  model: 'googleai/gemini-2.5-flash-lite', // 從 gemini-1.5-flash 升級
});
```

---

### 優先度 3（橘色）：Firebase Firestore 存檔

讓老師儲存歷史報告、跨裝置查看。

建議 Firestore 資料結構：

```
reports/{userId}/{reportId}
  - teachingArea: string
  - meetingTopic: string
  - meetingDate: timestamp
  - communityMembers: string
  - photoDescriptions: array
  - summary: string
  - createdAt: timestamp
```

搭配 Firebase Auth（Google 一鍵登入）。

---

### 優先度 4（橘色）：啟用 Email 通知

`src/lib/email-notifications.ts` 已有骨架，目前為模擬。
使用已安裝的 `nodemailer` + Gmail App Password 實作。

新增環境變數：
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

---

### 優先度 5（黃色）：UI/UX 完善

1. **修正摘要按鈕啟用條件**：目前只判斷 `photos.length > 0`，應改為所有描述均已完成

```typescript
const canGenerateSummary = photos.length > 0
  && photos.every(p => p.description && !p.isGenerating);
```

2. **移除摘要 readOnly**：讓老師可以手動編輯 AI 摘要

3. **加入單張照片重試按鈕**：針對產生失敗的照片重新送出

4. **localhost 資料快取**：使用 localStorage 存放草稿，防止重整遺失

---

### 優先度 6（黃色）：PWA 支援

```powershell
npm install next-pwa
```

讓老師可以加入主畫面如原生 App 使用（離線瀏覽已填資料）。

注意：開發環境下需排除 localhost 的 Service Worker 註冊。

---

### 優先度 7（黃色）：SEO 優化

- 加入 `public/robots.txt`
- 加入 Next.js sitemap（`src/app/sitemap.ts`）
- Open Graph 圖片設定（讓 LINE/FB 分享有預覽圖）

---

## 總結執行建議

**立即執行（上線前必要）：**
1. 升級 AI 模型至 `gemini-2.5-flash-lite`
2. 執行 API Key 掃描確認無洩漏
3. 建立 GitHub Repo 並連接 Vercel
4. 在 Vercel 設定 `GOOGLE_GENAI_API_KEY`

**短期優化（1–2 週）：**
5. 完成 Word (.docx) 匯出功能
6. 修正摘要按鈕啟用條件
7. 移除摘要 `readOnly` 屬性
8. 加入 localStorage 草稿快取

**中期優化（1 個月）：**
9. 加入 Firebase Auth + Firestore 存檔
10. 完成 Email 通知功能
11. 加入 PWA 支援
