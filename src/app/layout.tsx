import type {Metadata} from 'next';
import { Inter } from 'next/font/google'; // Using Inter as a fallback/alternative to Geist
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster
import { cn } from '@/lib/utils'; // Import cn utility
import { ServiceWorkerRegister } from '@/components/sw-register';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' }); // Define Inter font

// 必須設 metadataBase（避開 Next.js localhost:3000 fallback 警告）。
// 但 og:image / twitter:image 用「絕對 URL」直接寫死，繞過 Next.js
// metadataBase + basePath 的 URL 拼接 bug（會把 /domain-meeting-go/ 重複）。
const SITE_URL = 'https://cagoooo.github.io/domain-meeting-go/';
const FAVICON_URL = `${SITE_URL}favicon.png`;
const OG_IMAGE_URL = `${SITE_URL}og_preview.png`;

export const metadata: Metadata = {
  metadataBase: new URL('https://cagoooo.github.io/'),
  title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
  description: '專業國小教師社群會議紀錄助手，自動生成觀察描述、會議摘要與精美 Word/PDF 報告，提升協作與研究效率。',
  icons: {
    icon: FAVICON_URL,
    apple: FAVICON_URL,
  },
  openGraph: {
    title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
    description: '報紙頭版風教師社群會議報告自動產出助手 — 用 AI 為每一次共備留下溫度與紀錄',
    url: SITE_URL,
    siteName: '領域共備GO',
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: '領域共備GO — 教師社群會議報告自動產出助手（編輯部期刊風）',
      },
    ],
    locale: 'zh_TW',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
    description: '報紙頭版風教師社群會議報告自動產出助手 — 用 AI 為每一次共備留下溫度與紀錄',
    images: [OG_IMAGE_URL],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={inter.variable}>
      <head>
        {/* 🛡️ App 內建瀏覽器防護（變體 A：AI 功能必須登入，引導不可關閉）：Google OAuth 禁止在 WebView 登入（403 disallowed_useragent）
            LINE → 自動帶 openExternalBrowser=1 跳系統預設瀏覽器
            FB/IG/Messenger/微信/Kakao → Android 自動用 intent:// 叫出 Chrome 開本頁（只試一次），並顯示引導與「用 Chrome 開啟」按鈕；iPhone 只能顯示引導 */}
        <script
          dangerouslySetInnerHTML={{
            __html: String.raw`
                (function () {
                    var ua = navigator.userAgent || "";
                    var isLine = /\bLine\//i.test(ua);
                    var isOtherInApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|KAKAOTALK/i.test(ua);
                    var isAndroid = /Android/i.test(ua);

                    if (isLine && location.search.indexOf("openExternalBrowser=1") === -1) {
                        // LINE 官方參數：自動改用外部瀏覽器重開本頁（保留原有 query 與 hash）
                        var sep = location.search ? "&" : "?";
                        location.replace(location.href.split("#")[0] + sep + "openExternalBrowser=1" + location.hash);
                        return;
                    }
                    if (!isOtherInApp && !isLine) return;

                    // Android：用 intent:// 指定 Chrome 開啟本頁（保留 query 與 hash）。
                    // 沒裝 Chrome 時改回內建瀏覽器開「帶 iabEscape=1 的本頁」，不再重試，避免無限跳轉。
                    var chromeIntent = "";
                    if (isAndroid) {
                        var fallback = location.href.split("#")[0]
                            + (location.search ? "&" : "?") + "iabEscape=1" + location.hash;
                        chromeIntent = "intent://" + location.host + location.pathname + location.search + location.hash
                            + "#Intent;scheme=" + location.protocol.replace(":", "")
                            + ";package=com.android.chrome"
                            + ";S.browser_fallback_url=" + encodeURIComponent(fallback) + ";end";
                    }
                    var autoJump = false;
                    if (chromeIntent) {
                        autoJump = location.search.indexOf("iabEscape=1") === -1;
                        try { autoJump = autoJump && sessionStorage.getItem("iabEscapeTried") !== "1"; } catch (e) { }
                    }

                    // 自動跳轉沒生效（舊版 App、沒裝 Chrome、iPhone）→ 顯示全版引導，避免使用者白撞 Google 封鎖
                    document.addEventListener("DOMContentLoaded", function () {
                        var d = document.createElement("div");
                        d.id = "inapp-browser-guide";
                        d.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,'Microsoft JhengHei',sans-serif;";
                        var chromeBtn = chromeIntent
                            ? '<a id="inapp-open-chrome" href="' + chromeIntent.replace(/"/g, "&quot;") + '" style="display:block;margin:22px 0 4px;padding:14px 18px;border-radius:999px;background:#22c55e;color:#052e16;font-size:17px;font-weight:800;text-decoration:none;">用 Chrome 開啟</a>'
                                + '<p style="font-size:13px;color:#94a3b8;margin:8px 0 18px;">按了沒反應，再照下面的方法</p>'
                            : "";
                        d.innerHTML = '<div style="max-width:420px;width:100%;box-sizing:border-box;text-align:center;background:#1e293b;border-radius:16px;padding:32px 26px;">'
                            + '<div style="font-size:52px;">🌐</div>'
                            + '<h4 style="font-weight:800;margin:14px 0 10px;">請改用瀏覽器開啟</h4>'
                            + '<p style="font-size:15px;line-height:1.8;color:#cbd5e1;margin:0;">您目前在 <b style="color:#fbbf24;">App 內建瀏覽器</b>（LINE／FB 等）中開啟本頁，Google 基於安全政策<b>禁止在此環境登入</b>。</p>'
                            + chromeBtn
                            + '<p style="font-size:15px;line-height:1.8;color:#cbd5e1;margin:' + (chromeIntent ? "0" : "14px 0 0") + ';">請點右上／右下角「<b>⋯</b>」→ 選「<b style="color:#4ade80;">用預設瀏覽器開啟</b>」。<br><br>💡 也可以把本站「加入主畫面」，之後從桌面圖示開啟最穩定。</p>'
                            + '</div>';
                        document.body.appendChild(d);
                        // 先把引導畫出來再自動叫 Chrome：就算跳轉被 App 擋下，畫面也不會停在空白
                        if (autoJump) {
                            try { sessionStorage.setItem("iabEscapeTried", "1"); } catch (e) { }
                            setTimeout(function () { location.href = chromeIntent; }, 300);
                        }
                    });
                })();
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&family=Noto+Serif+TC:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={cn("dmg-body antialiased")}>
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
