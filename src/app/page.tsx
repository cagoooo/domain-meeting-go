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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { generatePhotoDescriptions } from '@/ai/flows/generate-photo-descriptions';
import { generateMeetingSummary } from '@/ai/flows/generate-meeting-summary';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';

const MAX_PHOTOS = 4;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
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
};

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      teachingArea: '',
      meetingTopic: '',
      communityMembers: '',
    },
  });

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const newPhotos: Photo[] = [];
      let hasError = false;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const currentPhotoCount = photos.length + newPhotos.length;

        if (currentPhotoCount >= MAX_PHOTOS) {
           toast({
            title: '上傳錯誤',
            description: `最多只能上傳 ${MAX_PHOTOS} 張照片。`,
            variant: 'destructive',
          });
          hasError = true;
          break;
        }

        if (file.size > MAX_FILE_SIZE) {
          toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 過大，請選擇小於 5MB 的檔案。`,
            variant: 'destructive',
          });
          hasError = true;
          continue; // Skip this file
        }

        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
           toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 格式不支援，請選擇 JPG, PNG, 或 WEBP 格式。`,
            variant: 'destructive',
          });
          hasError = true;
          continue; // Skip this file
        }


        const photoId = `${file.name}-${Date.now()}`;
        newPhotos.push({
          id: photoId,
          file,
          previewUrl: URL.createObjectURL(file),
          description: '',
          isGenerating: false,
        });
      }

       if (newPhotos.length > 0) {
          setPhotos((prevPhotos) => [...prevPhotos, ...newPhotos]);
       }

      // Reset file input to allow uploading the same file again if needed
      if (event.target) {
        event.target.value = '';
      }
    },
    [photos.length, toast]
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos((prevPhotos) => {
      const photoToRemove = prevPhotos.find(p => p.id === id);
      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.previewUrl);
      }
      return prevPhotos.filter((photo) => photo.id !== id);
    });
     // Clear summary if a photo affecting it is removed
     setSummary('');
  }, []);

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleGenerateDescriptions = useCallback(async () => {
     const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
     if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers || photos.length === 0) {
       toast({
         title: '請先完成資訊輸入',
         description: '請確保所有欄位已填寫且至少上傳一張照片。',
         variant: 'destructive',
       });
       return;
     }
    if (photos.some(p => p.isGenerating)) return; // Prevent multiple calls

    const photosToProcess = photos.filter(p => !p.description);
    if (photosToProcess.length === 0) {
      toast({
        title: '提示',
        description: '所有照片描述都已產生。',
      });
      return;
    }

    setPhotos(prev => prev.map(p => photosToProcess.some(ptp => ptp.id === p.id) ? { ...p, isGenerating: true } : p));

    try {
      const descriptionPromises = photosToProcess.map(async (photo) => {
        try {
          const photoDataUri = await readFileAsDataURL(photo.file);
          const result = await generatePhotoDescriptions({
            teachingArea,
            meetingTopic,
            meetingDate: format(meetingDate, 'yyyy-MM-dd'),
            communityMembers,
            photoDataUri,
          });
          return { id: photo.id, description: result.photoDescription };
        } catch (error) {
          console.error(`Error generating description for ${photo.file.name}:`, error);
          // Ensure description is set even on error, possibly to the error message or a default
          const errorDescription = error instanceof Error ? error.message : '產生描述時發生未知錯誤。';
          const finalDescription = errorDescription.includes("safety") ? '無法描述此圖片（安全限制）。' : '無法描述此圖片。';
          return { id: photo.id, description: finalDescription };
        }
      });


      const descriptions = await Promise.all(descriptionPromises);

      setPhotos(prev => prev.map(p => {
        const descData = descriptions.find(d => d.id === p.id);
        // Fallback for potential undefined description, though the catch block should prevent this
        const newDescription = descData?.description ?? '描述遺失。';
        return descData ? { ...p, description: newDescription, isGenerating: false } : { ...p, isGenerating: false };
      }));


       toast({
         title: '成功',
         description: '照片描述產生完成！',
       });
       setSummary(''); // Clear summary as descriptions changed

    } catch (error) {
      console.error('Error in generating descriptions:', error);
       toast({
         title: '錯誤',
         description: '產生照片描述時發生錯誤。',
         variant: 'destructive',
       });
       // Reset generating state for all processed photos on overall error
       setPhotos(prev => prev.map(p => photosToProcess.some(ptp => ptp.id === p.id) ? { ...p, isGenerating: false } : p));
    }
  }, [form, photos, toast]);


 const handleGenerateSummary = useCallback(async () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(Boolean); // Filter out empty descriptions

    if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers) {
        toast({
            title: '請先完成資訊輸入',
            description: '請確保所有欄位已填寫。',
            variant: 'destructive',
        });
        return;
    }

    if (photos.length !== MAX_PHOTOS) {
      toast({
        title: '請上傳完整照片',
        description: `請上傳 ${MAX_PHOTOS} 張照片才能產生摘要。`,
        variant: 'destructive',
      });
      return;
    }

     // Check if any photo is still generating or failed generation
    if (photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述'))) {
        toast({
            title: '請先成功產生所有照片描述',
            description: '請確保所有照片描述都已成功產生，且沒有錯誤訊息。',
            variant: 'destructive',
        });
        return;
    }


    setIsGeneratingSummary(true);
    try {
      const result = await generateMeetingSummary({
        teachingArea,
        meetingTopic,
        meetingDate: format(meetingDate, 'yyyy-MM-dd'),
        communityMembers,
        photoDescriptions,
      });
      setSummary(result.summary);
      toast({
        title: '成功',
        description: '會議摘要產生完成！',
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      toast({
        title: '錯誤',
        description: '產生會議摘要時發生錯誤。',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [form, photos, toast]);


  // Generates HTML content formatted for Word
  const generateReportContent = () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    // Basic CSS for formatting in Word
    const styles = `
      body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
      h1 { color: #2E7D32; /* Dark Green */ text-align: center; border-bottom: 2px solid #C8E6C9; padding-bottom: 10px; }
      h2 { color: #FFAB40; /* Orange */ border-bottom: 1px solid #FFF9C4; padding-bottom: 5px; margin-top: 20px; }
      p { margin-bottom: 10px; }
      strong { color: #555; }
      ul { list-style-type: disc; margin-left: 20px; }
      li { margin-bottom: 5px; }
      .section { margin-bottom: 25px; padding: 15px; border: 1px solid #eee; border-radius: 5px; background-color: #f9f9f9;}
      .photo-section li { border-bottom: 1px dashed #ddd; padding-bottom: 5px; }
      .summary-section { white-space: pre-wrap; /* Preserve whitespace */ }
    `;

    let reportHtml = `
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <title>領域共學誌 會議報告</title>
        <style>${styles}</style>
      </head>
      <body>
        <h1>領域共學誌 會議報告</h1>

        <div class="section">
          <h2>基本資訊</h2>
          <p><strong>教學領域：</strong> ${teachingArea}</p>
          <p><strong>會議主題：</strong> ${meetingTopic}</p>
          <p><strong>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p><strong>社群成員：</strong> ${communityMembers}</p>
        </div>

        <div class="section photo-section">
          <h2>照片記錄</h2>
          <ul>
    `;

    photos.forEach((photo, index) => {
      reportHtml += `<li><strong>照片 ${index + 1} 描述：</strong> ${photo.description || '未產生描述'}</li>\n`;
      // Note: Images are not embedded in this version. You could add base64 encoded images if needed, but it significantly increases file size.
      // Example (requires readFileAsDataURL to be called again or store data URIs):
      // reportHtml += `<p><img src="${photoDataUri}" alt="照片 ${index + 1}" width="300"></p>\n`;
    });

    reportHtml += `
          </ul>
        </div>

        <div class="section summary-section">
          <h2>會議大綱摘要</h2>
          <p>${summary || '尚未產生摘要'}</p>
        </div>

      </body>
      </html>
    `;

    return reportHtml;
  };


  const handleExportReport = useCallback(() => {
     const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
     if (!teachingArea || !meetingTopic || !meetingDate || !communityMembers || photos.length !== MAX_PHOTOS || !summary) {
         toast({
            title: '無法匯出',
            description: '請先完成所有步驟（填寫資訊、上傳照片、產生描述、產生摘要）再匯出報告。',
            variant: 'destructive',
         });
         return;
     }
      // Check for failed descriptions before exporting
     if (photos.some(p => p.description.startsWith('無法描述'))) {
        toast({
            title: '無法匯出',
            description: '報告中包含無法描述的照片，請確認所有照片描述是否成功產生。',
            variant: 'destructive',
        });
        return;
    }

    const reportContent = generateReportContent();
     // Use 'application/msword' for .doc compatibility and proper encoding preamble
    const blob = new Blob([`\ufeff${reportContent}`], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
     // Change filename extension to .doc
    const fileName = `領域共學誌_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}.doc`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
     toast({
        title: '成功',
        description: `報告 ${fileName} 已匯出。`,
     });
  }, [form, photos, summary, toast]);


   // Effect to clear descriptions and summary when form fields change
   useEffect(() => {
      const subscription = form.watch((value, { name, type }) => {
         // Only reset if a form value actually changes, ignore initial load/watches
         if (type === 'change') {
           setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: false })));
           setSummary('');
         }
      });
      return () => subscription.unsubscribe();
   }, [form]);


  return (
    <>
    <div className="container mx-auto p-4 md:p-8 bg-background min-h-screen">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-primary-foreground bg-primary py-4 rounded-lg shadow-md">領域共學誌</h1>
        <p className="text-muted-foreground mt-2">國小教師社群領域會議報告協作產出平台</p>
      </header>

      <Form {...form}>
        {/* Removed onSubmit from form tag as individual buttons handle actions */}
        <form className="space-y-8">
          <Card className="shadow-lg rounded-xl overflow-hidden">
             <CardHeader className="bg-secondary">
                <CardTitle className="text-2xl text-secondary-foreground">第一步：輸入會議資訊</CardTitle>
                <CardDescription className="text-secondary-foreground/80">請填寫本次社群會議的基本資料</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="teachingArea"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-semibold">教學領域</FormLabel>
                      <FormControl>
                        <Input placeholder="例如：國語文、數學、自然科學..." {...field} className="text-base" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="meetingTopic"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-semibold">會議主題簡介</FormLabel>
                      <FormControl>
                        <Input placeholder="例如：討論新課綱教學策略..." {...field} className="text-base" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="meetingDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className="text-lg font-semibold mb-1">會議日期</FormLabel>
                       <Popover>
                          <PopoverTrigger asChild>
                          <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                "w-full pl-3 text-left font-normal justify-start text-base",
                                !field.value && "text-muted-foreground"
                                )}
                              >
                              {field.value ? (
                                  format(field.value, "yyyy年MM月dd日")
                              ) : (
                                  <span>選擇日期</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                          </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                              }
                              initialFocus
                          />
                          </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="communityMembers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-semibold">社群成員</FormLabel>
                      <FormControl>
                        <Input placeholder="請用逗號分隔姓名，例如：王老師, 李老師..." {...field} className="text-base" />
                      </FormControl>
                      <FormDescription>
                        請輸入所有參與會議的成員姓名。
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl overflow-hidden">
             <CardHeader className="bg-secondary">
              <CardTitle className="text-2xl text-secondary-foreground">第二步：上傳會議照片</CardTitle>
               <CardDescription className="text-secondary-foreground/80">請上傳 {MAX_PHOTOS} 張會議過程的照片 (JPG, PNG, WEBP, 小於5MB)</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="mb-6">
                <label
                  htmlFor="photo-upload"
                  className={cn(
                    "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted transition-colors",
                    photos.length >= MAX_PHOTOS ? "border-muted-foreground/50 cursor-not-allowed opacity-60" : "border-accent hover:border-primary"
                  )}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <UploadCloud className={cn("w-10 h-10 mb-3", photos.length >= MAX_PHOTOS ? "text-muted-foreground/50" : "text-accent-foreground")} />
                    <p className={cn("mb-2 text-sm ", photos.length >= MAX_PHOTOS ? "text-muted-foreground/50" : "text-muted-foreground")}>
                      <span className="font-semibold">點擊此處</span> 或拖曳照片至此
                    </p>
                    <p className={cn("text-xs", photos.length >= MAX_PHOTOS ? "text-muted-foreground/50" : "text-muted-foreground")}>
                      還可上傳 {Math.max(0, MAX_PHOTOS - photos.length)} 張照片
                    </p>
                  </div>
                  <input
                    id="photo-upload"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_IMAGE_TYPES.join(',')}
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={photos.length >= MAX_PHOTOS}
                  />
                </label>
              </div>

              {photos.length > 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4 mb-6">
                    {photos.map((photo) => (
                      <div key={photo.id} className="relative group border rounded-lg overflow-hidden shadow-sm aspect-video flex items-center justify-center bg-muted">
                         <Image
                            src={photo.previewUrl}
                            alt={`照片 ${photo.file.name}`}
                            layout="fill"
                            objectFit="contain" // Changed to contain to show whole image
                          />
                        <button
                          type="button"
                          onClick={() => handlePhotoRemove(photo.id)}
                          className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 z-10"
                          aria-label="移除照片"
                        >
                          <X className="h-4 w-4" />
                        </button>
                         {photo.isGenerating && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                              <Loader2 className="h-8 w-8 animate-spin text-primary-foreground" />
                            </div>
                          )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/50 to-transparent p-2 text-primary-foreground text-xs z-10">
                            <p className="truncate">{photo.description || '尚未產生描述'}</p>
                        </div>
                      </div>
                    ))}
                     {/* Placeholder divs if less than 4 photos */}
                     {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }).map((_, index) => (
                        <div key={`placeholder-${index}`} className="relative group border rounded-lg overflow-hidden shadow-sm aspect-video flex items-center justify-center bg-muted/50 text-muted-foreground text-sm">
                           照片 {photos.length + index + 1}
                        </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    onClick={handleGenerateDescriptions}
                     disabled={photos.some(p => p.isGenerating) || photos.length === 0 || photos.every(p => p.description && !p.isGenerating)} // Disable if all have description AND none are generating
                    className="w-full md:w-auto"
                    variant="secondary"
                  >
                     {photos.some(p => p.isGenerating) ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        描述產生中...
                      </>
                    ) : (
                       photos.length > 0 && photos.every(p => p.description) ? '重新產生描述' : '產生照片描述'
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl overflow-hidden">
             <CardHeader className="bg-secondary">
                <CardTitle className="text-2xl text-secondary-foreground">第三步：產生會議摘要</CardTitle>
                <CardDescription className="text-secondary-foreground/80">系統將整合上方資訊與照片描述，自動產生會議摘要</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
               <Button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={
                      isGeneratingSummary ||
                      photos.length !== MAX_PHOTOS ||
                      photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述'))
                  }
                  className="w-full md:w-auto"
                  variant="secondary"
                >
                  {isGeneratingSummary ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      摘要產生中...
                    </>
                  ) : (
                    '產生會議摘要'
                  )}
                </Button>
               {summary && (
                <div className="mt-4 p-4 border rounded-md bg-muted/50">
                  <h3 className="text-lg font-semibold mb-2">會議摘要：</h3>
                  <Textarea
                     value={summary}
                     readOnly
                     className="w-full h-48 bg-background text-base resize-none"
                     aria-label="會議摘要內容"
                  />
                </div>
              )}
            </CardContent>
          </Card>

           <Card className="shadow-lg rounded-xl overflow-hidden">
             <CardHeader className="bg-primary">
                <CardTitle className="text-2xl text-primary-foreground">第四步：匯出報告</CardTitle>
                <CardDescription className="text-primary-foreground/80">點擊下方按鈕，匯出排版好的 Word (.doc) 檔案</CardDescription>
             </CardHeader>
             <CardContent className="p-6">
                 <Button
                    type="button"
                    onClick={handleExportReport}
                    disabled={
                        !summary || // Summary must exist
                        photos.length !== MAX_PHOTOS || // Must have exactly MAX_PHOTOS
                        photos.some(p => !p.description || p.description.startsWith('無法描述')) // All descriptions must exist and not be errors
                    }
                    className="w-full md:w-auto bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6"
                  >
                    匯出會議報告 (.doc)
                 </Button>
            </CardContent>
          </Card>

        </form>
      </Form>
    </div>
     <Toaster />
    </>
  );
}
