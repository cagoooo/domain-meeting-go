
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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer, Info, Image as ImageIcon, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

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
  WidthType
} from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const MAX_PHOTOS = 4;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const formSchema = z.object({
  teachingArea: z.string().min(1, '教學領域不能為空'),
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

  const handleGenerateSummary = useCallback(async () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
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
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    
    try {
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: "領域共備GO - 教師社群會議報告",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "教學領域", bold: true })] })] }),
                    new TableCell({ children: [new Paragraph(teachingArea)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "會議主題", bold: true })] })] }),
                    new TableCell({ children: [new Paragraph(meetingTopic)] }),
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
            new Paragraph({
              text: "照片紀錄",
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
            }),
            ...photos.map(photo => [
              new Paragraph({
                text: `照片描述：${photo.description || '無描述'}`,
                spacing: { before: 200, after: 200 },
              }),
            ]).flat(),
            new Paragraph({
              text: "會議總結",
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
            }),
            new Paragraph({
              children: summary.split('\n').map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0 })),
            }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `會議報告_${meetingTopic}_${format(new Date(), "yyyyMMdd")}.docx`);
      toast({ title: '匯出成功', description: 'Word 檔案已開始下載。' });
    } catch (error) {
      console.error(error);
      toast({ title: '匯出失敗', description: '產生 Word 檔案時發生錯誤。', variant: 'destructive' });
    }
  }, [summary, photos, form, toast]);

  const exportToPDF = useCallback(async () => {
    const reportElement = document.getElementById('report-content');
    if (!reportElement) return;

    try {
      toast({ title: '準備中', description: '正在產生 PDF 快照...' });
      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0f172a', // 配合深色主題
      });
      
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
                <FormField control={form.control} name="meetingTopic" render={({ field }) => (
                  <FormItem><FormLabel>會議主題</FormLabel><FormControl><Input placeholder="教學策略分享..." {...field} /></FormControl><FormMessage /></FormItem>
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
                  <FormItem><FormLabel>社群成員</FormLabel><FormControl><Input placeholder="王老師, 李老師..." {...field} /></FormControl><FormMessage /></FormItem>
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
                    <div key={photo.id} ref={el => { photoRefs.current[photo.id] = el; }} className="relative border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
                      <div className="aspect-video relative">
                        <NextImage src={photo.previewUrl} alt="Preview" fill className="object-cover" />
                        <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => handlePhotoRemove(photo.id)}><X /></Button>
                        {photo.isGenerating && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Loader2 className="animate-spin text-white" /></div>}
                      </div>
                      <div className={cn("p-2 text-xs text-center min-h-[40px] flex items-center justify-center", (photo.description.includes('忙碌') || photo.description.includes('無法') || photo.description.includes('失敗')) ? "text-red-400 font-medium" : "text-slate-200")}>
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
    </TooltipProvider>
  );
}
