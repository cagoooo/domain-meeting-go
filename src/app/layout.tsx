import type {Metadata} from 'next';
import { Inter } from 'next/font/google'; // Using Inter as a fallback/alternative to Geist
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' }); // Define Inter font

export const metadata: Metadata = {
  title: '領域共備GO', // Updated title
  description: '自動生成國小教師社群領域會議記錄摘要，提升協作效率', // Updated description reflecting the new focus
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body className={`${inter.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster /> {/* Add Toaster here */}
      </body>
    </html>
  );
}
