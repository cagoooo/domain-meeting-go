
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
  const summaryTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  const handleGenerateDescriptions = useCallback(async () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers || photos.length === 0) {
      toast({ title: '請先完成資訊輸入', description: '請填寫所有欄位並上傳照片。', variant: 'destructive' });
      return;
    }

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
        const generateDescriptionsFn = httpsCallable<any, { photoDescription: string }>(functions, 'generatePhotoDescriptions');
        const response = await generateDescriptionsFn({
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

    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers) {
      toast({ title: '資訊未填寫', description: '請先填寫第一步的會議資訊。', variant: 'destructive' });
      return;
    }

    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isGenerating: true } : p));

    try {
      const generateDescriptionsFn = httpsCallable<any, { photoDescription: string }>(functions, 'generatePhotoDescriptions');
      const response = await generateDescriptionsFn({
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
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.includes('失敗') && !d.includes('忙碌') && !d.includes('無法描述'));

    if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers || photos.length === 0) {
      toast({ title: '條件未滿足', description: '請填寫資訊並上傳照片。', variant: 'destructive' });
      return;
    }

    setIsGeneratingSummary(true);
    setSummaryGenerationProgress(0);

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
      
      // 自動滾動到摘要內容
      setTimeout(() => {
        summaryTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setIsGeneratingSummary(false);
        setSummaryGenerationProgress(null);
      }, 500);
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

  // --- 匯出功能 -----------------------------------------
  
  const exportToWord = useCallback(async () => {
    if (!summary) return;
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();
    
    const displayTopic = meetingType === "其他" ? meetingTopic : `${meetingType} - ${meetingTopic}`;
    
    // 將成員字串轉為陣列（支援多種分隔符）
    const memberList = communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== "");

    try {
      // Helper: DataURL 轉 Uint8Array
      const dataUrlToUint8Array = (dataUrl: string) => {
        const base64 = dataUrl.split(',')[1];
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      };

      const children: any[] = [
        new Paragraph({
          text: "領域共備GO - 教師社群會議報告",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        // 基本資訊表格
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "教學領域", bold: true })] })] }),
                new TableCell({ width: { size: 80, type: WidthType.PERCENTAGE }, children: [new Paragraph(teachingArea)] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "會議主題", bold: true })] })] }),
                new TableCell({ children: [new Paragraph(displayTopic)] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "會議日期", bold: true })] })] }),
                new TableCell({ children: [new Paragraph(format(meetingDate, "yyyy年MM月dd日"))] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "社群成員", bold: true })] })] }),
                new TableCell({ children: [new Paragraph(communityMembers)] }),
              ],
            }),
          ],
        }),
        // 簽到表區塊
        new Paragraph({
          text: "與會人員簽到表",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            // 表頭
            new TableRow({
              children: [
                new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "姓名", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "f2f2f2" } }),
                new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "簽到", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "f2f2f2" } }),
                new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "簽退", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "f2f2f2" } }),
              ],
            }),
            // 成員列
            ...memberList.map(member => (
              new TableRow({
                children: [
                  new TableCell({ verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ text: member, alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 400, after: 400 } })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 400, after: 400 } })] }),
                ],
              })
            )),
          ],
        }),
        new Paragraph({
          text: "照片紀錄",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        }),
      ];

      // 迭代照片並插入（照片在上，描述在下）
      for (const photo of photos) {
        if (photo.dataUrl) {
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: dataUrlToUint8Array(photo.dataUrl),
                  transformation: {
                    width: 580, // A4 寬度大約 600pt，扣除邊距設為 580
                    height: 320, // 保持約 16:9 或 4:3 的比例
                  },
                } as any),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 200, after: 100 },
            })
          );
        }
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `照片描述：`, bold: true, color: "666666" }),
              new TextRun({ text: photo.description || '無描述' }),
            ],
            spacing: { before: 100, after: 400 },
          })
        );
      }

      // 會議總結
      children.push(
        new Paragraph({
          text: "會議總結",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: summary.split('\n').map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0 })),
          spacing: { after: 400 },
        })
      );

      const doc = new Document({
        sections: [{
          properties: {},
          children: children,
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `會議報告_${displayTopic}_${format(new Date(), "yyyyMMdd")}.docx`);
      toast({ title: '匯出成功', description: '優化版 Word 檔案已開始下載。' });
    } catch (error) {
      console.error(error);
      toast({ title: '匯出失敗', description: '產生優化 Word 檔案時發生錯誤。', variant: 'destructive' });
    }
  }, [summary, photos, form, toast]);

  const exportToPDF = useCallback(async () => {
    const reportElement = document.getElementById('printable-report');
    if (!reportElement) return;

    try {
      toast({ title: '準備中', description: '正在產生專業列印格式 PDF...' });
      
      // 暫時顯示它以便捕捉，但放在螢幕外
      reportElement.style.display = 'block';
      reportElement.style.position = 'absolute';
      reportElement.style.left = '-9999px';

      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      
      // 隱藏回去
      reportElement.style.display = 'none';

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`會議報告_${form.getValues().meetingTopic}_${format(new Date(), "yyyyMMdd")}.pdf`);
      toast({ title: '匯出成功', description: 'PDF 檔案已開始下載。' });
    } catch (error) {
      console.error(error);
      toast({ title: '匯出失敗', description: '產生 PDF 時發生錯誤。', variant: 'destructive' });
    }
  }, [form, toast]);

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-8 lg:p-12 bg-transparent min-h-screen pb-24" id="report-content">
        <header className="mb-10 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400 py-4 drop-shadow-lg">
            領域共備GO
          </h1>
          <p className="text-slate-300 text-lg mt-2">教師社群會議報告自動產出助手</p>
        </header>

        <Form {...form}>
          <form className="space-y-10">
            {/* Step 1 */}
            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-blue-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-3"><Info className="text-blue-400" /> 第一步：輸入會議資訊</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="teachingArea" render={({ field }) => (
                  <FormItem><FormLabel>教學領域</FormLabel><FormControl><Input placeholder="國語、數學..." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="meetingType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>會議類別</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="選擇主題類型" />
                        </SelectTrigger>
                      </FormControl>
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
                <FormField control={form.control} name="meetingTopic" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{form.watch("meetingType") === "其他" ? "自定義會議主題" : "會議詳細主題"}</FormLabel>
                    <FormControl>
                      <Input placeholder={form.watch("meetingType") === "其他" ? "請輸入您的會議主題..." : "例如：公開觀課教學現場紀錄..."} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="meetingDate" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>會議日期</FormLabel>
                    <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "yyyy年MM月dd日") : <span>選擇日期</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={(date) => { field.onChange(date); setIsDatePickerOpen(false); }} initialFocus />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="communityMembers" render={({ field }) => (
                  <FormItem className="md:col-span-2"><FormLabel>社群成員</FormLabel><FormControl><Input placeholder="王老師, 李老師..." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-green-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-3"><ImageIcon className="text-green-400" /> 第二步：上傳會議照片</CardTitle>
              </CardHeader>
              <CardContent>
                <label htmlFor="photo-upload" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                  <UploadCloud className="w-10 h-10 mb-2 text-green-400" />
                  <p className="text-sm text-slate-300">點擊或拖曳照片 (最多 {MAX_PHOTOS} 張)</p>
                  <input id="photo-upload" type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  {photos.map((photo) => (
                    <div key={photo.id} ref={el => { photoRefs.current[photo.id] = el; }} className="relative border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50 transition-all duration-500">
                      <div className="aspect-video relative overflow-hidden">
                        <NextImage 
                          src={photo.previewUrl} 
                          alt="Preview" 
                          fill 
                          className={cn(
                            "object-cover transition-all duration-700",
                            (photo.isGenerating || !photo.description) ? "blur-md scale-110 grayscale-[0.3]" : "blur-0 scale-100 grayscale-0"
                          )} 
                        />
                        <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-7 w-7 z-10" onClick={() => handlePhotoRemove(photo.id)}><X /></Button>
                        
                        {/* 單張重新產生按鈕 */}
                        {!photo.isGenerating && (
                          <Button 
                            type="button" 
                            variant="secondary" 
                            size="icon" 
                            className="absolute bottom-1 right-1 h-7 w-7 z-10 bg-black/40 hover:bg-black/60 text-white border-none backdrop-blur-sm" 
                            onClick={() => handleGenerateSingleDescription(photo.id)}
                            title="重新產生描述"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {photo.isGenerating && (
                          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-20">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="animate-spin text-white h-8 w-8" />
                              <span className="text-white text-xs font-bold drop-shadow-md">AI 分析中...</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className={cn("p-2 text-xs text-center min-h-[40px] flex items-center justify-center transition-colors duration-500", (photo.description.includes('忙碌') || photo.description.includes('錯誤') || photo.description.includes('機制') || photo.description.includes('無法描述')) ? "text-red-400 font-medium" : "text-slate-200")}>
                        {photo.description || '尚未產生描述'}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col items-center gap-3">
                  <Button type="button" ref={generateDescriptionsButtonRef} onClick={handleGenerateDescriptions} disabled={isGeneratingAllDescriptions || photos.length === 0} className="w-full md:w-auto" variant="secondary">
                    {isGeneratingAllDescriptions ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 描述產生中... ({descriptionProgress}%)</> : '產生照片描述'}
                  </Button>
                  {descriptionProgress !== null && <Progress value={descriptionProgress} className="w-full max-w-xs h-2" />}
                </div>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card className="bg-slate-800/70 backdrop-blur-sm border-l-4 border-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-3"><FileText className="text-purple-400" /> 第三步：產生會議摘要</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button type="button" onClick={handleGenerateSummary} disabled={isGeneratingSummary || photos.length === 0} className="w-full md:w-auto" variant="secondary">
                  {isGeneratingSummary ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 摘要產生中...</> : '產生會議摘要'}
                </Button>
                {summaryGenerationProgress !== null && <Progress value={summaryGenerationProgress} className="h-2" />}
                {summary && <Textarea ref={summaryTextareaRef} value={summary} readOnly className="h-48 bg-slate-900/50" />}
              </CardContent>
            </Card>

            {/* Step 4 */}
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
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <a href="https://document-ai-companion-ipad4.replit.app" target="_blank" className="flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-3 font-bold text-white shadow-xl hover:scale-105 transition-transform">
              <span>創建專屬助手🦄</span>
            </a>
          </TooltipTrigger>
          <TooltipContent side="left"><p>打造自己的 AI 小幫手</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a href="https://line.me/R/ti/p/@733oiboa?oat_content=url&ts=05120012" target="_blank" className="flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-red-500 px-5 py-3 font-bold text-white shadow-xl hover:scale-105 transition-transform">
              <span>點『石』成金🐝(評語優化)</span>
            </a>
          </TooltipTrigger>
          <TooltipContent side="left"><p>LINE 教學評語優化建議</p></TooltipContent>
        </Tooltip>
      </div>
      <Toaster />

      {/* --- 列印專用隱藏範本 (白底黑字正式版) --- */}
      <div id="printable-report" style={{ display: 'none', width: '800px', backgroundColor: 'white', color: 'black', padding: '40px', fontFamily: 'sans-serif' }}>
        <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>領域共備GO - 教師社群會議報告</h1>
        
        {/* 基本資訊表 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
          <tbody>
            <tr><td style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold', width: '25%' }}>教學領域</td><td style={{ border: '1px solid black', padding: '8px' }}>{form.getValues().teachingArea}</td></tr>
            <tr><td style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>會議類別</td><td style={{ border: '1px solid black', padding: '8px' }}>{form.getValues().meetingType}</td></tr>
            <tr><td style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>會議主題</td><td style={{ border: '1px solid black', padding: '8px' }}>{form.getValues().meetingTopic}</td></tr>
            <tr><td style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>會議日期</td><td style={{ border: '1px solid black', padding: '8px' }}>{form.getValues().meetingDate ? format(form.getValues().meetingDate, "yyyy年MM月dd日") : ""}</td></tr>
            <tr><td style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>社群成員</td><td style={{ border: '1px solid black', padding: '8px' }}>{form.getValues().communityMembers}</td></tr>
          </tbody>
        </table>

        {/* 簽到表 */}
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>與會人員簽到表</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <th style={{ border: '1px solid black', padding: '10px', width: '30%', textAlign: 'center' }}>姓名</th>
              <th style={{ border: '1px solid black', padding: '10px', width: '35%', textAlign: 'center' }}>簽到</th>
              <th style={{ border: '1px solid black', padding: '10px', width: '35%', textAlign: 'center' }}>簽退</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const members = form.getValues().communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== "");
              return members.map((member, i) => (
                <tr key={i}>
                  <td style={{ border: '1px solid black', padding: '10px', textAlign: 'center' }}>{member}</td>
                  <td style={{ border: '1px solid black', padding: '20px' }}></td>
                  <td style={{ border: '1px solid black', padding: '20px' }}></td>
                </tr>
              ));
            })()}
          </tbody>
        </table>

        {/* 照片紀錄 */}
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>照片紀錄</h2>
        {photos.map((photo, i) => (
          <div key={i} style={{ marginBottom: '30px', pageBreakInside: 'avoid' }}>
            {photo.dataUrl && <img src={photo.dataUrl} style={{ width: '100%', borderRadius: '5px', marginBottom: '10px' }} />}
            <p style={{ fontSize: '14px', lineHeight: '1.6' }}>
              <b style={{ color: '#555' }}>照片描述：</b>{photo.description || '無描述'}
            </p>
          </div>
        ))}

        {/* 會議總結 */}
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px', marginTop: '30px' }}>會議總結</h2>
        <div style={{ fontSize: '15px', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
          {summary}
        </div>
      </div>
    </TooltipProvider>
  );
}
