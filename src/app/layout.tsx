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
