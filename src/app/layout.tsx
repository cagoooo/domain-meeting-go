import type {Metadata} from 'next';
import { Inter } from 'next/font/google'; // Using Inter as a fallback/alternative to Geist
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster
import { cn } from '@/lib/utils'; // Import cn utility
import { ServiceWorkerRegister } from '@/components/sw-register';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' }); // Define Inter font

export const metadata: Metadata = {
  title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
  description: '專業國小教師社群會議紀錄助手，自動生成觀察描述、會議摘要與精美 Word/PDF 報告，提升協作與研究效率。',
  icons: {
    icon: './favicon.png',
    apple: './favicon.png',
  },
  openGraph: {
    title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
    description: '專業教學觀察、會議紀錄與自動化報告生成工具',
    url: 'https://cagoooo.github.io/domain-meeting-go/',
    siteName: '領域共備GO',
    images: [
      {
        url: './og_preview.png',
        width: 1200,
        height: 630,
        alt: '領域共備GO 預覽圖',
      },
    ],
    locale: 'zh_TW',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '領域共備GO - 教師社群 AI 觀察紀錄助手',
    description: '專業教學觀察、會議紀錄與自動化報告生成工具',
    images: ['./og_preview.png'],
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
