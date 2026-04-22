import os
import glob

def inject_secrets():
    # 預期被置換的檔案為 Next.js 打包後的 out 資料夾中的所有 JS 與 HTML 檔案
    files = glob.glob('out/**/*.js', recursive=True) + glob.glob('out/**/*.html', recursive=True)
    
    placeholders = {
        '__FIREBASE_API_KEY__': os.environ.get('VITE_FIREBASE_API_KEY', ''),
        '__FIREBASE_AUTH_DOMAIN__': os.environ.get('VITE_FIREBASE_AUTH_DOMAIN', ''),
        '__FIREBASE_PROJECT_ID__': os.environ.get('VITE_FIREBASE_PROJECT_ID', ''),
        '__FIREBASE_STORAGE_BUCKET__': os.environ.get('VITE_FIREBASE_STORAGE_BUCKET', ''),
        '__FIREBASE_MESSAGING_SENDER_ID__': os.environ.get('VITE_FIREBASE_MESSAGING_SENDER_ID', ''),
        '__FIREBASE_APP_ID__': os.environ.get('VITE_FIREBASE_APP_ID', ''),
    }

    modified_count = 0
    for path in files:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        modified = False
        for key, value in placeholders.items():
            if value and key in content:
                content = content.replace(key, value)
                modified = True
        
        if modified:
            modified_count += 1
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            # print(f"Injected secrets into {path}")
            
    print(f"✅ 成功將環境變數注入 {modified_count} 個檔案。")

if __name__ == '__main__':
    inject_secrets()
