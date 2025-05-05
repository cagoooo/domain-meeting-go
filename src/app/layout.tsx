import type {Metadata} from 'next';
import { Inter } from 'next/font/google'; // Using Inter as a fallback/alternative to Geist
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster
import { cn } from '@/lib/utils'; // Import cn utility

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
    // Apply dark theme and font variable globally
    <html lang="zh-TW" className={cn('dark', inter.variable)}>
      {/* Add gradient background */}
      <body className={cn(
          "antialiased text-foreground",
          "bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900" // Vibrant gradient background
        )}>
        {children}
        <Toaster /> {/* Add Toaster here */}
      </body>
    </html>
  );
}
