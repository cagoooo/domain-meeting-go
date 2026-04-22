---
description: 自動化配置 GitHub Pages 與 Firebase 金鑰的完整部署流程
---

# 🚀 自動化 GitHub Pages & Firebase 部署設定流程

當專案完成開發並準備部署時，可以執行包含此工作流的指令，自動完成所有金鑰對接與分支發布，實現零手動部署。

## 📍 Step 1: 掃描 Firebase 專案衝突
確保目標專案乾淨無衝突：
```bash
# 尋找是否在 H:\ 下有其他專案也使用了相同的 firebase project id
grep -r "teacher-c571b" /mnt/h/
```

## 📍 Step 2: 從本地環境拉取 Gemini 金鑰至後端
若本地 `.env` 內有 `GEMINI_API_KEY`，則直接塞入 Firebase Cloud Functions Secret 中：
```powershell
// turbo
Get-Content .env | ForEach-Object { if ($_ -match '^GEMINI_API_KEY=(.*)$') { $matches[1] } } | firebase functions:secrets:set GEMINI_API_KEY --project teacher-c571b --force
```

## 📍 Step 3: 在 Firebase 建立 Web App 並擷取金鑰
強制新增一個專案對應的 Web App，並且取得 `sdkconfig` 產出 JSON 供前端使用。
```powershell
// turbo
firebase apps:create web $(basename $PWD) --project teacher-c571b
# 取出新建 App 的 ID 進行配置：
# firebase apps:sdkconfig WEB [APP_ID] --project teacher-c571b
```

## 📍 Step 4: 將 Firebase Config 注入 GitHub Action Secrets
將上一步的 JSON 拆解後，分別對應並自動填寫進入 GitHub Secrets (供 CI/CD 替換)：
```powershell
// turbo-all
gh secret set VITE_FIREBASE_API_KEY -b "[擷取出的API_KEY]"
gh secret set VITE_FIREBASE_AUTH_DOMAIN -b "[擷取出的Domain]"
gh secret set VITE_FIREBASE_PROJECT_ID -b "[擷取出的ProjectId]"
gh secret set VITE_FIREBASE_STORAGE_BUCKET -b "[擷取出的StorageBucket]"
gh secret set VITE_FIREBASE_MESSAGING_SENDER_ID -b "[擷取出的SenderId]"
gh secret set VITE_FIREBASE_APP_ID -b "[擷取出的AppId]"
```

## 📍 Step 5: 自動開啟 GitHub Pages 指定 gh-pages 分支
避免讓使用者手動到 Settings 點選，直接動用 `gh api` 將 Source 強制指向根目錄 `/(root)` 的 `gh-pages` 分支：
```powershell
// turbo
gh api -X PUT /repos/{owner}/{repo}/pages -f "source[branch]=gh-pages" -f "source[path]=/" -H "Accept: application/vnd.github.v3+json"
```

## 📍 Step 6: 分別推送後端與觸發前端 CI/CD
```powershell
// turbo-all
firebase deploy --only functions --project teacher-c571b
gh workflow run deploy.yml
```
