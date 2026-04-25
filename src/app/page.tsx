
'use client';

import type { ChangeEvent } from 'react';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer, Info, Image as ImageIcon, FileText, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import confetti from 'canvas-confetti';
import ReactMarkdown from 'react-markdown';



// 匯出套件
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  ImageRun, 
  AlignmentType, 
  HeadingLevel,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign
} from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const MAX_PHOTOS = 4;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const formSchema = z.object({
  teachingArea: z.string().min(1, '教學領域不能為空'),
  meetingType: z.string().min(1, '請選擇會議類別'),
  meetingTopic: z.string().min(1, '會議主題不能為空'),
  meetingDate: z.date({ required_error: '請選擇會議日期' }),
  communityMembers: z.string().min(1, '社群成員不能為空'),
});

type Photo = {
  id: string;
  file: File;
  previewUrl: string;
  description: string;
  isGenerating: boolean;
  dataUrl?: string;
};

/**
 * 🎉 巨大彩花特效——四波連環爆發
 *
 * Wave 1（即時）：中央巨型爆發，200 顆放射粒子（scalar 1.5 加大）
 * Wave 2（+250ms）：左右兩側同時對射，兩個 150 顆粒子流
 * Wave 3（+500ms）：頂部往下灑彩帶，100 顆 + 大角度散布
 * Wave 4（+750ms ~ 3s）：每 200ms 隨機位置補充小爆發，營造持續慶祝氛圍
 */
const fireMassiveConfetti = () => {
  const colors = ['#a855f7', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

  // Wave 1: 中央巨型爆發
  confetti({
    particleCount: 200,
    spread: 100,
    origin: { x: 0.5, y: 0.5 },
    colors,
    startVelocity: 50,
    scalar: 1.5,
    ticks: 250,
  });

  // Wave 2: 左右兩側對射
  setTimeout(() => {
    confetti({
      particleCount: 150,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.65 },
      colors,
      startVelocity: 60,
      scalar: 1.2,
    });
    confetti({
      particleCount: 150,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.65 },
      colors,
      startVelocity: 60,
      scalar: 1.2,
    });
  }, 250);

  // Wave 3: 頂部往下灑
  setTimeout(() => {
    confetti({
      particleCount: 100,
      angle: 270,
      spread: 180,
      origin: { x: 0.5, y: 0 },
      colors,
      startVelocity: 40,
      scalar: 1.3,
      gravity: 0.8,
      ticks: 300,
    });
  }, 500);

  // Wave 4: 持續飄灑 3 秒
  const end = Date.now() + 3000;
  const flutter = setInterval(() => {
    if (Date.now() > end) {
      clearInterval(flutter);
      return;
    }
    confetti({
      particleCount: 30,
      startVelocity: 30,
      spread: 360,
      ticks: 150,
      origin: { x: Math.random(), y: Math.random() * 0.5 },
      colors,
      scalar: 0.8 + Math.random() * 0.6,
    });
  }, 200);
};

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationProgress, setSummaryGenerationProgress] = useState<number | null>(null);
  const [descriptionProgress, setDescriptionProgress] = useState<number | null>(null);
  const [isGeneratingAllDescriptions, setIsGeneratingAllDescriptions] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const generateDescriptionsButtonRef = useRef<HTMLButtonElement>(null);
  const summaryPreviewRef = useRef<HTMLDivElement>(null);    // 摘要預覽區塊（產出後 scroll 到此）
  const summaryProgressRef = useRef<HTMLDivElement>(null);   // 進度條區塊（產生中 scroll 到此）
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      teachingArea: '',
      meetingType: '社群會議紀錄',
      meetingTopic: '',
      communityMembers: '',
    },
  });

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const newPhotosPromises: Promise<Photo | null>[] = [];
      let currentPhotoCount = photos.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (currentPhotoCount + i >= MAX_PHOTOS) break;
        if (file.size > MAX_FILE_SIZE) continue;
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;

        const photoId = `${file.name}-${Date.now()}`;
        const previewUrl = URL.createObjectURL(file);

        newPhotosPromises.push(
          readFileAsDataURL(file).then(dataUrl => ({
            id: photoId,
            file,
            previewUrl,
            description: '',
            isGenerating: false,
            dataUrl,
          }))
        );
      }

      const validNewPhotos = (await Promise.all(newPhotosPromises)).filter((p): p is Photo => p !== null);

      if (validNewPhotos.length > 0) {
        setPhotos(prev => [...prev, ...validNewPhotos].slice(0, MAX_PHOTOS));
        // 自動滾動到產生描述按鈕
        setTimeout(() => {
          generateDescriptionsButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }

      if (event.target) event.target.value = '';
    },
    [photos.length]
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos(prev => {
      const photoToRemove = prev.find(p => p.id === id);
      if (photoToRemove) URL.revokeObjectURL(photoToRemove.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const callWithRetry = async (fnName: string, data: any, maxRetries = 2) => {
    let lastError;
    const callableFn = httpsCallable<any, any>(functions, fnName);
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const result = await callableFn(data);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`Function ${fnName} failed (attempt ${i + 1}/${maxRetries + 1}). Retrying...`, error);
        if (i < maxRetries) {
          // 指數退避延遲
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        }
      }
    }
    throw lastError;
  };

  /**
   * 找出第一個未填寫的欄位，自動捲動到該位置並高亮。
   * 回傳 true 代表全部填寫完整、可繼續執行；false 代表已彈出錯誤、應 return。
   */
  const validateAndFocusFirstMissing = useCallback((): boolean => {
    const values = form.getValues();
    let target: { id: string; name?: 'teachingArea' | 'meetingType' | 'meetingTopic' | 'meetingDate' | 'communityMembers'; label: string } | null = null;

    if (!values.teachingArea) target = { id: 'field-teachingArea', name: 'teachingArea', label: '教學領域' };
    else if (!values.meetingType) target = { id: 'field-meetingType', name: 'meetingType', label: '會議類別' };
    else if (!values.meetingTopic) target = { id: 'field-meetingTopic', name: 'meetingTopic', label: '會議主題' };
    else if (!values.meetingDate) target = { id: 'field-meetingDate', name: 'meetingDate', label: '會議日期' };
    else if (!values.communityMembers) target = { id: 'field-communityMembers', name: 'communityMembers', label: '社群成員' };
    else if (photos.length === 0) target = { id: 'field-photos', label: '會議照片' };

    if (!target) return true;

    const el = document.getElementById(target.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 紅光閃爍
      el.classList.add('animate-field-highlight');
      setTimeout(() => el.classList.remove('animate-field-highlight'), 2500);
      // 觸發 react-hook-form 錯誤訊息（讓 FormMessage 顯示）
      if (target.name) {
        form.setError(target.name, { type: 'manual', message: `請輸入${target.label}` });
        // focus 到欄位內的可聚焦元素
        setTimeout(() => {
          const focusable = el.querySelector('input, textarea, button[role="combobox"], button[type="button"]') as HTMLElement | null;
          focusable?.focus();
        }, 600);
      }
    }

    toast({
      title: `尚未填寫：${target.label}`,
      description: '已自動捲動到該欄位，請補齊後再試。',
      variant: 'destructive',
    });
    return false;
  }, [form, photos, toast]);

  const handleGenerateDescriptions = useCallback(async () => {
    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0);

    // UX 優化：按下產生的瞬間，立即自動滾動到第一張照片的位置
    // 使用 setTimeout 確保 UI 渲染與模糊效果套用後再進行精細滾動
    if (photos.length > 0) {
      setTimeout(() => {
        const firstPhotoId = photos[0].id;
        const element = photoRefs.current[firstPhotoId];
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
    
    // 循序處理以避開 429 頻率限制
    let index = 0;
    for (const photo of photos) {
      index++;
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, isGenerating: true } : p));
      
      // 自動滾動到目前處理的照片
      photoRefs.current[photo.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      try {
        const response = await callWithRetry('generatePhotoDescriptions', {
          teachingArea,
          meetingTopic,
          communityMembers,
          meetingDate: format(meetingDate, 'yyyy-MM-dd'),
          photoDataUri: photo.dataUrl!,
        });
        const result = response.data;

        const isError = result.photoDescription.includes('忙碌') || result.photoDescription.includes('錯誤') || result.photoDescription.includes('機制') || result.photoDescription.includes('無法描述');
        
        setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: result.photoDescription, isGenerating: false } : p));
        
        if (!isError) {
          // 成功時在照片位置放彩花
          const element = photoRefs.current[photo.id];
          if (element) {
            const rect = element.getBoundingClientRect();
            confetti({
              particleCount: 100,
              spread: 70,
              origin: {
                x: (rect.left + rect.width / 2) / window.innerWidth,
                y: (rect.top + rect.height / 2) / window.innerHeight
              }
            });
          }
        }
        
        if (isError) {
          toast({ title: '處理異常', description: `照片 ${index}：${result.photoDescription}`, variant: 'destructive' });
        }
      } catch (error) {
        setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: '產出失敗', isGenerating: false } : p));
      }

      setDescriptionProgress(Math.round((index / photos.length) * 100));
      
      // 加入 2 秒的冷卻延遲，確保 API 配額不被瞬間耗盡
      if (index < photos.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setIsGeneratingAllDescriptions(false);
    toast({ title: '照片描述處理完畢', description: '所有圖片已處理完成。' });
  }, [form, photos, toast]);

  const handleGenerateSingleDescription = useCallback(async (photoId: string) => {
    const photo = photos.find(p => p.id === photoId);
    if (!photo || photo.isGenerating) return;

    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isGenerating: true } : p));

    try {
      const response = await callWithRetry('generatePhotoDescriptions', {
        teachingArea,
        meetingTopic,
        communityMembers,
        meetingDate: format(meetingDate, 'yyyy-MM-dd'),
        photoDataUri: photo.dataUrl!,
      });
      const result = response.data;

      const isError = result.photoDescription.includes('忙碌') || result.photoDescription.includes('錯誤') || result.photoDescription.includes('機制') || result.photoDescription.includes('無法描述');
      
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, description: result.photoDescription, isGenerating: false } : p));
      
      if (!isError) {
        // 成功時在照片位置放彩花
        const element = photoRefs.current[photoId];
        if (element) {
          const rect = element.getBoundingClientRect();
          confetti({
            particleCount: 100,
            spread: 70,
            origin: {
              x: (rect.left + rect.width / 2) / window.innerWidth,
              y: (rect.top + rect.height / 2) / window.innerHeight
            }
          });
        }
      } else {
        toast({ title: '處理異常', description: result.photoDescription, variant: 'destructive' });
      }
    } catch (error: any) {
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, description: '產出失敗', isGenerating: false } : p));
      toast({ title: '系統錯誤', description: '呼叫分析函式時發生錯誤。', variant: 'destructive' });
    }
  }, [form, photos, toast]);

  const handleGenerateSummary = useCallback(async () => {
    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.includes('失敗') && !d.includes('忙碌') && !d.includes('無法描述'));

    setIsGeneratingSummary(true);
    setSummaryGenerationProgress(0);

    // 🎯 UX：開始產生時立刻捲動到進度條區，讓使用者看見進度
    setTimeout(() => {
      summaryProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    try {
      const generateSummaryFn = httpsCallable<any, { summary: string }>(functions, 'generateMeetingSummary');
      const response = await generateSummaryFn({
        meetingType,
        teachingArea,
        meetingTopic,
        meetingDate: format(meetingDate, 'yyyy-MM-dd'),
        communityMembers,
        photoDescriptions,
      });
      setSummary(response.data.summary);
      setSummaryGenerationProgress(100);

      // 🎉 巨大彩花特效——四波連環爆發慶祝會議摘要產出
      fireMassiveConfetti();

      // 🎯 UX：產出後自動捲動到摘要預覽區（等 React 渲染 summary 後再 scroll，故 600ms 延遲）
      setTimeout(() => {
        summaryPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setIsGeneratingSummary(false);
        setSummaryGenerationProgress(null);
      }, 600);
    } catch (error) {
      setIsGeneratingSummary(false);
      setSummaryGenerationProgress(null);
      toast({ title: '產生摘要失敗', description: '請稍後再試。', variant: 'destructive' });
    }
  }, [form, photos, toast]);

  // 模擬進度條動畫
  useEffect(() => {
    if (isGeneratingSummary && summaryGenerationProgress !== null && summaryGenerationProgress < 90) {
      const timer = setInterval(() => {
        setSummaryGenerationProgress(prev => (prev !== null && prev < 90 ? prev + 5 : prev));
      }, 500);
      return () => clearInterval(timer);
    }
  }, [isGeneratingSummary, summaryGenerationProgress]);

  const exportToWord = useCallback(async () => {
    if (!summary) return;
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();
    
    // 動態標題邏輯
    const dynamicTitle = meetingType === "其他" ? "教師會議研究報告" : `${meetingType}成果報告`;
    const displayTopic = meetingType === "其他" ? meetingTopic : `${meetingType} - ${meetingTopic}`;
    const memberList = communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== "");

    const dataUrlToUint8Array = (dataUrl: string) => {
      const base64 = dataUrl.split(',')[1];
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      return bytes;
    };

    const parseMarkdownToDocx = (text: string) => {
      const lines = text.split('\n');
      const elements: any[] = [];
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) { elements.push(new Paragraph({ children: [new TextRun("")] })); return; }
        if (trimmed.startsWith('### ')) {
          elements.push(new Paragraph({ children: [new TextRun({ text: trimmed.replace('### ', ''), bold: true, size: 28, color: "2c3e50" })], heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 150 } }));
          return;
        }
        if (trimmed.startsWith('## ')) {
          elements.push(new Paragraph({ children: [new TextRun({ text: trimmed.replace('## ', ''), bold: true, size: 32, color: "1a252f" })], heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));
          return;
        }
        const isOrderedList = /^\d+\.\s/.test(trimmed);
        const isUnorderedList = /^[*+-]\s/.test(trimmed);
        if (isOrderedList || isUnorderedList) {
          const content = trimmed.replace(/^(\d+\.|[*+-])\s/, '');
          const parts = content.split(/(\*\*.*?\*\*)/);
          const children = parts.map(part => part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
          elements.push(new Paragraph({ children: children, bullet: isUnorderedList ? { level: 0 } : undefined, indent: { left: 720 }, spacing: { before: 80, after: 80 } }));
          return;
        }
        const parts = trimmed.split(/(\*\*.*?\*\*)/);
        const children = parts.map(part => part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
        elements.push(new Paragraph({ children: children, spacing: { before: 120, after: 120 } }));
      });
      return elements;
    };

    const wordPhotoParagraphs: any[] = [];
    for (const photo of photos) {
      if (photo.dataUrl) {
        wordPhotoParagraphs.push(new Paragraph({ children: [new ImageRun({ data: dataUrlToUint8Array(photo.dataUrl), transformation: { width: 580, height: 320 } } as any)], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 100 } }));
      }
      wordPhotoParagraphs.push(new Paragraph({ children: [new TextRun({ text: `照片描述：`, bold: true, color: "666666" }), new TextRun({ text: photo.description || '無描述' })], spacing: { before: 100, after: 400 } }));
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          new Paragraph({ 
            text: `領域共備GO - ${dynamicTitle}`, 
            heading: HeadingLevel.TITLE, 
            alignment: AlignmentType.CENTER, 
            spacing: { after: 500 } 
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            rows: [
              new TableRow({ 
                children: [
                  new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, shading: { fill: "f8f9fa" }, children: [new Paragraph({ children: [new TextRun({ text: "教學領域", bold: true, color: "495057" })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, children: [new Paragraph({ text: teachingArea, alignment: AlignmentType.LEFT })] })
                ] 
              }),
              new TableRow({ 
                children: [
                  new TableCell({ shading: { fill: "f8f9fa" }, children: [new Paragraph({ children: [new TextRun({ text: "會議主題", bold: true, color: "495057" })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: displayTopic, alignment: AlignmentType.LEFT })] })
                ] 
              }),
              new TableRow({ 
                children: [
                  new TableCell({ shading: { fill: "f8f9fa" }, children: [new Paragraph({ children: [new TextRun({ text: "會議日期", bold: true, color: "495057" })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: format(meetingDate, "yyyy年MM月dd日"), alignment: AlignmentType.LEFT })] })
                ] 
              }),
              new TableRow({ 
                children: [
                  new TableCell({ shading: { fill: "f8f9fa" }, children: [new Paragraph({ children: [new TextRun({ text: "社群成員", bold: true, color: "495057" })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: communityMembers, alignment: AlignmentType.LEFT })] })
                ] 
              }),
            ]
          }),
          new Paragraph({ text: "與會人員簽到表", heading: HeadingLevel.HEADING_2, spacing: { before: 600, after: 300 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ 
                children: [
                  new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, shading: { fill: "e9ecef" }, children: [new Paragraph({ children: [new TextRun({ text: "姓名", bold: true, size: 28 })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "e9ecef" }, children: [new Paragraph({ children: [new TextRun({ text: "簽到", bold: true, size: 28 })], alignment: AlignmentType.CENTER })] }),
                  new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "e9ecef" }, children: [new Paragraph({ children: [new TextRun({ text: "簽退", bold: true, size: 28 })], alignment: AlignmentType.CENTER })] })
                ] 
              }),
              ...memberList.map(member => new TableRow({ 
                children: [
                  new TableCell({ 
                    verticalAlign: VerticalAlign.CENTER,
                    children: [new Paragraph({ 
                      children: [new TextRun({ text: member, size: 32, bold: true })], 
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 200, after: 200 }
                    })] 
                  }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 600, after: 600 } })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 600, after: 600 } })] })
                ] 
              }))
            ]
          }),
          new Paragraph({ text: "照片紀錄", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...wordPhotoParagraphs,
          new Paragraph({ text: "會議總結", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...parseMarkdownToDocx(summary)
        ]
      }]
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `會議報告_${displayTopic}_${format(new Date(), "yyyyMMdd")}.docx`);
    toast({ title: '匯出成功', description: '優化版 Word 檔案已開始下載。' });
  }, [summary, photos, form, toast]);

  const exportToPDF = useCallback(async () => {
    const reportElement = document.getElementById('printable-report');
    if (!reportElement) return;

    try {
      const html2pdf = (await import('html2pdf.js')).default;
      toast({ title: '正在產生 PDF', description: '正在優化分頁排版中，請稍候...' });

      // 🎯 真正的修法（v0.3.2，pypdf 實證後得出）
      //
      // 鐵證：使用者環境中 element offsetWidth = 703px（不是 inline 設的 900px）。
      // 推論：使用者瀏覽器視窗 < 900px（可能是 iPad / 縮小視窗 / DevTools 開著）。
      // 雖然 inline `width: 900px` 應該強制寬度，但在某些行動裝置 / 縮放情境下
      // viewport 會壓縮 element。
      //
      // 雙重保險:
      //   A) 用 setProperty('important') 強制 element 真的 900px 寬
      //   B) 顯式傳 html2canvas.width: 900 + windowWidth: 1100，
      //      讓 canvas 截圖區域與 viewport 都明確大於 element
      reportElement.style.display = 'block';
      reportElement.style.setProperty('width', '900px', 'important');
      reportElement.style.setProperty('min-width', '900px', 'important');
      reportElement.style.setProperty('max-width', '900px', 'important');

      // 等一個 frame 讓 layout flush
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );

      // Debug：log 實際寬度，方便日後診斷
      console.log(
        `[PDF] element.offsetWidth=${reportElement.offsetWidth}, ` +
        `window.innerWidth=${window.innerWidth}`
      );

      const displayTopic = form.getValues().meetingTopic || "領域會議";
      const opt = {
        margin: [15, 12, 15, 12],
        filename: `會議報告_${displayTopic}_${format(new Date(), "yyyyMMdd")}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: 900,           // ← 明確告訴 html2canvas 截圖寬度（不依賴 offsetWidth）
          windowWidth: 1100,    // ← viewport 至少 1100，留 200px 安全邊界
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        // avoid-all 主動嘗試避免所有元素被切割，配合 .photo-card / .pdf-section 的明確標記
        // v0.3.2 已用 width 雙重鎖固定 element 寬度，avoid-all 不會再影響置中
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          avoid: ['h1', 'h2', 'h3', 'h4', 'table', 'tr', 'img', '.pdf-section', '.photo-card', '.pdf-avoid'],
        },
      };

      await html2pdf().from(reportElement).set(opt).save();
      toast({ title: '匯出成功', description: 'PDF 檔案已下載。' });
    } catch (error) {
      console.error('PDF Export Error:', error);
      toast({ title: '匯出失敗', description: '產生 PDF 時發生錯誤。', variant: 'destructive' });
    } finally {
      // 清除 important 設定，還原 display: none
      reportElement.style.removeProperty('width');
      reportElement.style.removeProperty('min-width');
      reportElement.style.removeProperty('max-width');
      reportElement.style.display = 'none';
    }
  }, [form, toast]);

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-8 lg:p-12 bg-transparent min-h-screen pb-24" id="report-content">
        <header className="mb-10 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400 py-4 drop-shadow-lg">領域共備GO</h1>
          <p className="text-slate-300 text-lg mt-2">教師社群會議報告自動產出助手</p>
        </header>

        <Form {...form}>
          <form className="space-y-10">
            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-blue-500">
              <CardHeader><CardTitle className="flex items-center gap-3"><Info className="text-blue-400" /> 第一步：輸入會議資訊</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="teachingArea" render={({ field }) => (<FormItem id="field-teachingArea" className="rounded-lg p-1 -m-1 transition-shadow"><FormLabel>教學領域</FormLabel><FormControl><Input placeholder="國語、數學..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="meetingType" render={({ field }) => (
                  <FormItem id="field-meetingType" className="rounded-lg p-1 -m-1 transition-shadow">
                    <FormLabel>會議類別</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="選擇主題類型" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="備課會議">備課會議</SelectItem>
                        <SelectItem value="觀課紀錄">觀課紀錄</SelectItem>
                        <SelectItem value="議課總整理">議課總整理</SelectItem>
                        <SelectItem value="講座研討報告">講座研討報告</SelectItem>
                        <SelectItem value="社群會議紀錄">社群會議紀錄</SelectItem>
                        <SelectItem value="其他">其他 (自定義)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="meetingTopic" render={({ field }) => (<FormItem id="field-meetingTopic" className="rounded-lg p-1 -m-1 transition-shadow"><FormLabel>{form.watch("meetingType") === "其他" ? "自定義會議主題" : "會議詳細主題"}</FormLabel><FormControl><Input placeholder="例如：公開觀課教學現場紀錄..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="meetingDate" render={({ field }) => (
                  <FormItem id="field-meetingDate" className="flex flex-col rounded-lg p-1 -m-1 transition-shadow">
                    <FormLabel>會議日期</FormLabel>
                    <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                      <PopoverTrigger asChild><Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "yyyy年MM月dd日") : <span>選擇日期</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={(date) => { field.onChange(date); setIsDatePickerOpen(false); }} initialFocus /></PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="communityMembers" render={({ field }) => (<FormItem id="field-communityMembers" className="md:col-span-2 rounded-lg p-1 -m-1 transition-shadow"><FormLabel>社群成員</FormLabel><FormControl><Input placeholder="王老師, 李老師..." {...field} /></FormControl><FormMessage /></FormItem>)} />
              </CardContent>
            </Card>

            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-green-500">
              <CardHeader><CardTitle className="flex items-center gap-3"><ImageIcon className="text-green-400" /> 第二步：上傳會議照片</CardTitle></CardHeader>
              <CardContent>
                <label id="field-photos" htmlFor="photo-upload" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                  <UploadCloud className="w-10 h-10 mb-2 text-green-400" />
                  <p className="text-sm text-slate-300">點擊或拖曳照片 (最多 {MAX_PHOTOS} 張)</p>
                  <input id="photo-upload" type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  {photos.map((photo) => (
                    <div key={photo.id} ref={el => { photoRefs.current[photo.id] = el; }} className="relative border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
                      <div className="aspect-video relative overflow-hidden">
                        <NextImage src={photo.previewUrl} alt="Preview" fill className={cn("object-cover transition-all duration-700", (photo.isGenerating || !photo.description) ? "blur-md scale-110 grayscale-[0.3]" : "blur-0 scale-100 grayscale-0")} />
                        <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-7 w-7 z-10" onClick={() => handlePhotoRemove(photo.id)}><X /></Button>
                        {!photo.isGenerating && (<Button type="button" variant="secondary" size="icon" className="absolute bottom-1 right-1 h-7 w-7 z-10 bg-black/40 hover:bg-black/60 text-white border-none backdrop-blur-sm" onClick={() => handleGenerateSingleDescription(photo.id)}><RefreshCw className="h-3.5 w-3.5" /></Button>)}
                        {photo.isGenerating && (<div className="absolute inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-20"><Loader2 className="animate-spin text-white h-8 w-8" /></div>)}
                      </div>
                      <div className="p-2 text-xs text-center text-slate-200">{photo.description || '尚未產生描述'}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex flex-col items-center gap-3">
                  <Button type="button" ref={generateDescriptionsButtonRef} onClick={handleGenerateDescriptions} disabled={isGeneratingAllDescriptions || photos.length === 0} variant="secondary">{isGeneratingAllDescriptions ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 描述產生中... ({descriptionProgress}%)</> : '產生照片描述'}</Button>
                  {descriptionProgress !== null && <Progress value={descriptionProgress} className="w-full max-w-xs h-2" />}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-purple-500">
              <CardHeader><CardTitle className="flex items-center gap-3"><FileText className="text-purple-400" /> 第三步：產生會議摘要</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div ref={summaryProgressRef} className="space-y-4">
                  <Button type="button" onClick={handleGenerateSummary} disabled={isGeneratingSummary || photos.length === 0} variant="secondary">{isGeneratingSummary ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 摘要產生中...</> : '產生會議摘要'}</Button>
                  {summaryGenerationProgress !== null && <Progress value={summaryGenerationProgress} className="h-2" />}
                </div>
                {summary && (
                  <div ref={summaryPreviewRef} className="mt-4 p-6 rounded-xl bg-slate-900/60 border border-purple-500/30 shadow-2xl backdrop-blur-md transition-all duration-500">
                    <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/10">
                      <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                        <FileText size={18} />
                      </div>
                      <h3 className="text-sm font-bold text-slate-200 tracking-wider">會議紀錄摘要預覽</h3>
                    </div>
                    <div className="prose prose-invert prose-slate max-w-none 
                      prose-headings:text-purple-400 prose-headings:font-bold prose-headings:mt-8 prose-headings:mb-4
                      prose-strong:text-purple-300 prose-strong:font-bold
                      prose-p:text-slate-300 prose-p:leading-relaxed prose-p:mb-4
                      prose-li:text-slate-300 prose-li:my-2
                      prose-ul:list-disc prose-ol:list-decimal
                      leading-relaxed font-sans">
                      <ReactMarkdown>{summary}</ReactMarkdown>
                    </div>
                    <div className="mt-8 pt-4 border-t border-white/5 flex justify-end">
                      <span className="text-[10px] text-slate-500 uppercase tracking-tighter italic">AI Generated Professional Report • Confidential</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-orange-500 no-print">
              <CardHeader>
                <CardTitle className="flex items-center gap-3"><Download className="text-orange-400" /> 第四步：匯出報告</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-4">
                <Button type="button" disabled={!summary} onClick={exportToWord} className="flex-1 bg-sky-600 hover:bg-sky-500">
                  <Download className="mr-2 h-4 w-4" /> 匯出 Word (.docx)
                </Button>
                <Button type="button" disabled={!summary} onClick={exportToPDF} className="flex-1 bg-rose-600 hover:bg-rose-500">
                  <Printer className="mr-2 h-4 w-4" /> 匯出 PDF 快照
                </Button>
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>

      {/* Floating Buttons */}
      {/* Floating Buttons - Modern RWD Floating Action Group */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 no-print">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a 
                href="https://document-ai-companion-ipad4.replit.app" 
                target="_blank" 
                className="group flex items-center justify-center gap-0 md:gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 w-14 h-14 md:w-auto md:h-auto md:px-6 md:py-3.5 text-white shadow-lg shadow-purple-900/20 border border-white/10 hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              >
                <span className="text-xl shrink-0">🦄</span>
                <span className="hidden md:inline text-sm font-bold tracking-wide whitespace-nowrap">創建專屬助手</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="left" className="md:hidden"><p>創建專屬助手🦄</p></TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <a 
                href="https://line.me/R/ti/p/@733oiboa?oat_content=url&ts=05120012" 
                target="_blank" 
                className="group flex items-center justify-center gap-0 md:gap-2 rounded-full bg-gradient-to-r from-amber-500 to-rose-600 w-14 h-14 md:w-auto md:h-auto md:px-6 md:py-3.5 text-white shadow-lg shadow-orange-900/20 border border-white/10 hover:shadow-orange-500/40 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              >
                <span className="text-xl shrink-0">🐝</span>
                <span className="hidden md:inline text-sm font-bold tracking-wide whitespace-nowrap">點『石』成金 (評語優化)</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="left" className="md:hidden"><p>點『石』成金🐝 (評語優化)</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Toaster />

      {/* --- 列印專用隱藏範本 (專業文書白底版) --- */}
      <div id="printable-report" style={{ 
        display: 'none', 
        width: '900px', 
        backgroundColor: 'white', 
        color: 'black', 
        padding: '60px 80px', 
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        lineHeight: '1.6'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px', borderBottom: '3px solid #3b82f6', paddingBottom: '20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '900', marginBottom: '8px', color: '#1e3a8a', letterSpacing: '2px' }}>領 域 共 備 G O</h1>
          <div style={{ fontSize: '18px', color: '#64748b', fontWeight: '500' }}>教師專業社群協力發展成果報告</div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginBottom: '5px' }}>
            {form.getValues().meetingType === "其他" ? "教師會議研究報告" : `${form.getValues().meetingType}成果報告`}
          </h2>
          <div style={{ width: '60px', height: '4px', backgroundColor: '#3b82f6', margin: '15px auto' }}></div>
        </div>
        
        {/* 基本資訊區塊卡片 */}
        <div className="pdf-section" style={{ backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '25px', marginBottom: '40px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #3b82f6', paddingLeft: '15px' }}>基本資訊 Basic Information</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                { label: '教學領域', value: form.getValues().teachingArea },
                { label: '會議主題', value: form.getValues().meetingTopic },
                { label: '會議日期', value: form.getValues().meetingDate ? format(form.getValues().meetingDate, "yyyy 年 MM 月 dd 日") : "" },
                { label: '社群成員', value: form.getValues().communityMembers },
              ].map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '12px 10px', fontWeight: 'bold', width: '25%', color: '#475569', fontSize: '15px', verticalAlign: 'top' }}>{item.label}：</td>
                  <td style={{ padding: '12px 10px', color: '#1e293b', fontSize: '15px', lineHeight: '1.6' }}>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 簽到表區塊卡片 */}
        <div className="pdf-section" style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '25px', marginBottom: '40px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #10b981', paddingLeft: '15px' }}>與會人員簽到表 Attendance</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '30%', textAlign: 'center', color: '#475569' }}>姓名</th>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '35%', textAlign: 'center', color: '#475569' }}>簽到 Sign In</th>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '35%', textAlign: 'center', color: '#475569' }}>簽退 Sign Out</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const members = form.getValues().communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== "");
                return members.map((member, i) => (
                  <tr key={i}>
                    <td style={{ border: '1px solid #cbd5e1', padding: '20px 10px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#1e293b' }}>{member}</td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '35px' }}></td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '35px' }}></td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>

        {/* 照片紀錄區塊：每張 photo-card 自己強制 pageBreakBefore: always
            （含第一張），標題塞進第一張卡片內部，避免「整個區塊前留白頁」的副作用 */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '30px' }}>
            {photos.map((photo, i) => (
              <div
                key={i}
                className="photo-card"
                style={{
                  pageBreakInside: 'avoid',
                  breakInside: 'avoid',
                  // 每張照片都強制從新頁開始（含第一張），徹底擺脫頁尾擠壓
                  pageBreakBefore: 'always',
                  breakBefore: 'page',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '15px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                }}
              >
                {/* 把「活動照片記錄」標題塞進第一張卡片，避免標題單獨佔頁或與卡片分離 */}
                {i === 0 && (
                  <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '15px', borderLeft: '5px solid #f59e0b', paddingLeft: '15px', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
                    活動照片記錄 Field Gallery
                  </h3>
                )}
                {photo.dataUrl && <img src={photo.dataUrl} style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: '8px', marginBottom: '15px', display: 'block', pageBreakInside: 'avoid', breakInside: 'avoid' }} />}
                <div style={{ padding: '10px', borderTop: '1px solid #f1f5f9', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                  <p style={{ fontSize: '15px', lineHeight: '1.7', color: '#334155', margin: 0 }}>
                    <span style={{ fontWeight: 'bold', color: '#64748b', fontSize: '13px', display: 'block', marginBottom: '5px' }}>觀察描述 Snapshot Description:</span>
                    {photo.description || '無描述'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 會議總結區塊 —— 區塊本身可能超過一頁，因此改用內部段落級別 avoid（見 globals.css） */}
        <div className="pdf-summary-wrapper" style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '30px',
          marginBottom: '40px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
        }}>
          <h3 className="pdf-avoid" style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #8b5cf6', paddingLeft: '15px', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>會議深度總結 Meeting Synopsis</h3>
          <div style={{ fontSize: '16px', lineHeight: '1.8', color: '#1e293b' }} className="pdf-markdown-summary prose prose-slate max-w-none">
            {/* 用 components 對每個 Markdown 元素加 inline page-break-inside: avoid。
                這比 globals.css 的 class 規則可靠——html2pdf 對 inline style 解析最穩定。 */}
            <ReactMarkdown
              components={{
                p: ({ children }) => (
                  <p style={{ pageBreakInside: 'avoid', breakInside: 'avoid', orphans: 3, widows: 3, marginBottom: '12px' }}>{children}</p>
                ),
                li: ({ children }) => (
                  <li style={{ pageBreakInside: 'avoid', breakInside: 'avoid', orphans: 3, widows: 3, marginBottom: '6px' }}>{children}</li>
                ),
                h1: ({ children }) => (
                  <h1 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '20px', marginBottom: '12px' }}>{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '18px', marginBottom: '10px' }}>{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '16px', marginBottom: '8px' }}>{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '14px', marginBottom: '6px' }}>{children}</h4>
                ),
                blockquote: ({ children }) => (
                  <blockquote style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>{children}</blockquote>
                ),
              }}
            >{summary}</ReactMarkdown>
          </div>
        </div>

        {/* 頁尾 */}
        <div style={{ textAlign: 'center', marginTop: '60px', borderTop: '1px solid #f1f5f9', paddingTop: '20px', fontSize: '12px', color: '#94a3b8' }}>
          本報告由「領域共備GO」AI 助手自動生成 • 僅供教育研究與內部紀錄使用
        </div>
      </div>
    </TooltipProvider>
  );
}
