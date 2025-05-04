
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
  dataUrl?: string; // Add dataUrl to store base64 representation
};

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Consider renaming or using a specific state for export loading
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

   const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };


  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => { // Make async to read data URL immediately
      const files = event.target.files;
      if (!files) return;

      const newPhotosPromises: Promise<Photo | null>[] = [];
      let currentPhotoCount = photos.length;
      let filesProcessedCount = 0; // Track processed files to avoid exceeding limit

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (currentPhotoCount + filesProcessedCount >= MAX_PHOTOS) {
           toast({
            title: '上傳錯誤',
            description: `最多只能上傳 ${MAX_PHOTOS} 張照片。已忽略多餘檔案。`,
            variant: 'destructive',
          });
          break; // Stop processing more files
        }

        if (file.size > MAX_FILE_SIZE) {
          toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 過大，請選擇小於 5MB 的檔案。`,
            variant: 'destructive',
          });
          continue; // Skip this file
        }

        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
           toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 格式不支援，請選擇 JPG, PNG, 或 WEBP 格式。`,
            variant: 'destructive',
          });
          continue; // Skip this file
        }

        filesProcessedCount++; // Increment count for valid files within limit

        const photoId = `${file.name}-${Date.now()}`;
        const previewUrl = URL.createObjectURL(file);

        // Read file as data URL immediately upon selection
        const photoPromise = readFileAsDataURL(file)
            .then(dataUrl => ({
                id: photoId,
                file,
                previewUrl: previewUrl,
                description: '',
                isGenerating: false,
                dataUrl: dataUrl, // Store data URL
            }))
            .catch(error => {
                console.error(`Error reading file ${file.name}:`, error);
                toast({
                    title: '讀取錯誤',
                    description: `讀取檔案 ${file.name} 時發生錯誤。`,
                    variant: 'destructive',
                });
                 URL.revokeObjectURL(previewUrl); // Clean up preview URL if reading fails
                return null; // Indicate failure
            });

        newPhotosPromises.push(photoPromise);
      }

      const resolvedPhotos = await Promise.all(newPhotosPromises);
      const validNewPhotos = resolvedPhotos.filter((p): p is Photo => p !== null); // Filter out nulls (failed reads)


       if (validNewPhotos.length > 0) {
          setPhotos((prevPhotos) => {
             // Ensure not to exceed MAX_PHOTOS even with concurrent uploads
             const combined = [...prevPhotos, ...validNewPhotos];
             return combined.slice(0, MAX_PHOTOS);
          });
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
          // Use stored dataUrl if available, otherwise read again (fallback)
          const photoDataUri = photo.dataUrl ?? await readFileAsDataURL(photo.file);
           // If dataUrl wasn't stored initially, store it now
          if (!photo.dataUrl) {
            setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, dataUrl: photoDataUri } : p));
          }

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


  // Generates HTML content formatted for Word, including embedded images
  const generateReportContent = async (): Promise<string> => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    // Ensure all photos have data URLs (redundant if handleFileChange works, but safe)
    const photosWithDataUrls = await Promise.all(
        photos.map(async (photo) => {
            if (!photo.dataUrl) {
                console.warn(`Photo ${photo.id} missing dataUrl, attempting to read again.`);
                try {
                    return { ...photo, dataUrl: await readFileAsDataURL(photo.file) };
                } catch (error) {
                    console.error(`Failed to read dataUrl for ${photo.id} during export:`, error);
                    toast({
                        title: '圖片讀取錯誤',
                        description: `匯出時無法讀取照片 ${photo.file.name}。報告將不包含此圖片。`,
                        variant: 'destructive',
                    });
                    return { ...photo, dataUrl: '' }; // Mark as empty to skip embedding
                }
            }
            return photo;
        })
    );


    // Basic CSS for formatting in Word
    const styles = `
      @page Section1 {
        size: 8.5in 11.0in; /* Letter size */
        margin: 1.0in 1.0in 1.0in 1.0in;
        mso-header-margin: .5in;
        mso-footer-margin: .5in;
        mso-paper-source: 0;
      }
      div.Section1 {
        page: Section1;
      }
      body { font-family: 'PMingLiU', '新細明體', serif; line-height: 1.6; color: #000000; } /* Common Traditional Chinese fonts */
      h1 { color: #000000; /* Black */ text-align: center; font-size: 20pt; font-weight: bold; border-bottom: 2px solid #000000; padding-bottom: 10px; margin-bottom: 20px;}
      h2 { color: #000000; /* Black */ font-size: 16pt; font-weight: bold; border-bottom: 1px solid #000000; padding-bottom: 5px; margin-top: 20px; margin-bottom: 15px; }
      p { margin-bottom: 10px; font-size: 12pt; }
      strong { font-weight: bold; }
      .section { margin-bottom: 25px; }
      .photo-grid { display: table; width: 100%; border-collapse: collapse; margin-bottom: 15px; }
      .photo-row { display: table-row; }
      .photo-cell { display: table-cell; width: 50%; padding: 10px; text-align: center; vertical-align: top; border: 1px solid #cccccc; }
      .photo-cell img { max-width: 90%; height: auto; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto; }
      .photo-description { font-size: 11pt; color: #333333; text-align: center; }
      .summary-section p { white-space: pre-wrap; /* Preserve whitespace */ font-size: 12pt; text-align: justify; }
      /* MSO specific styles for Word compatibility */
      p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0cm; margin-bottom:.0001pt; font-size:12.0pt; font-family:"Times New Roman","serif";}
      h1 {mso-style-link:"標題 1 字元"; margin-top:12.0pt; margin-right:0cm; margin-bottom:3.0pt; margin-left:0cm; text-align:center; page-break-after:avoid; font-size:20.0pt; font-family:"Arial","sans-serif"; color:black; font-weight:bold;}
      h2 {mso-style-link:"標題 2 字元"; margin-top:12.0pt; margin-right:0cm; margin-bottom:3.0pt; margin-left:0cm; page-break-after:avoid; font-size:16.0pt; font-family:"Arial","sans-serif"; color:black; font-weight:bold;}
      /* Add more MSO styles if needed */
    `;

     // Use Word XML structure for better compatibility
    let reportHtml = `
      <html xmlns:v="urn:schemas-microsoft-com:vml"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <meta name=ProgId content=Word.Document>
        <meta name=Generator content="Microsoft Word 15">
        <meta name=Originator content="Microsoft Word 15">
        <title>領域共學誌 會議報告</title>
        <!--[if gte mso 9]><xml>
         <o:DocumentProperties>
          <o:Author>領域共學誌</o:Author>
         </o:DocumentProperties>
         <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
         </w:WordDocument>
        </xml><![endif]-->
        <style>
        <!--
         /* Font Definitions */
         @font-face
            {font-family:PMingLiU;
            panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:新細明體;
            panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:"\@PMingLiU";
            panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:"\@新細明體";
            panose-1:2 2 5 0 0 0 0 0 0 0;}
         /* Style Definitions */
         ${styles}
        -->
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;'>
      <div class=Section1>

        <h1>領域共學誌 會議報告</h1>

        <div class="section">
          <h2>基本資訊</h2>
          <p class=MsoNormal><strong>教學領域：</strong> ${teachingArea}</p>
          <p class=MsoNormal><strong>會議主題：</strong> ${meetingTopic}</p>
          <p class=MsoNormal><strong>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p class=MsoNormal><strong>社群成員：</strong> ${communityMembers}</p>
        </div>

        <div class="section photo-section">
          <h2>照片記錄</h2>
          <table class=MsoNormalTable border=1 cellspacing=0 cellpadding=0 width="100%" style='width:100.0%;border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;mso-padding-alt:0cm 5.4pt 0cm 5.4pt;mso-border-insideh:.5pt solid windowtext;mso-border-insidev:.5pt solid windowtext;'>
            <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes;height:150.0pt'>
    `;

    // Loop through photos in pairs for 2x2 grid
    for (let i = 0; i < MAX_PHOTOS; i += 2) {
      if (i > 0) { // Add row start for the second row
         reportHtml += `<tr style='mso-yfti-irow:${Math.floor(i/2)};height:150.0pt${i + 2 >= MAX_PHOTOS ? ';mso-yfti-lastrow:yes' : ''}'>\n`;
      }

      // Cell for photo i
      const photo1 = photosWithDataUrls[i];
      reportHtml += `<td width="50%" valign=top style='width:50.0%;border:solid windowtext 1.0pt;mso-border-alt:solid windowtext .5pt;padding:5.0pt 5.0pt 5.0pt 5.0pt;height:150.0pt'>
          <p class=MsoNormal align=center style='text-align:center'>`;
      if (photo1?.dataUrl) {
        // Embed image using VML for Word compatibility
        // You might need to adjust width/height based on actual image dimensions or desired size
        reportHtml += `<!--[if gte vml 1]><v:shape id="Picture_${i+1}" o:spid="_x0000_i102${i+1}" type="#_x0000_t75" style='width:200pt;height:150pt;visibility:visible;mso-wrap-style:square'><v:imagedata src="${photo1.dataUrl}" o:title=""/></v:shape><![endif]--><![if !vml]><img width=267 height=200 src="${photo1.dataUrl}" v:shapes="Picture_${i+1}"><![endif]>`;
      } else {
        reportHtml += `[圖片 ${i + 1} 無法載入]`;
      }
      reportHtml += `<span style='font-size:11.0pt;font-family:"PMingLiU","serif";'><br clear=all> ${photo1?.description || '未產生描述'}</span></p>
          </td>\n`;

      // Cell for photo i+1
      const photo2 = photosWithDataUrls[i + 1];
      reportHtml += `<td width="50%" valign=top style='width:50.0%;border:solid windowtext 1.0pt;border-left:none;mso-border-left-alt:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:5.0pt 5.0pt 5.0pt 5.0pt;height:150.0pt'>
           <p class=MsoNormal align=center style='text-align:center'>`;
      if (photo2?.dataUrl) {
          reportHtml += `<!--[if gte vml 1]><v:shape id="Picture_${i+2}" o:spid="_x0000_i102${i+2}" type="#_x0000_t75" style='width:200pt;height:150pt;visibility:visible;mso-wrap-style:square'><v:imagedata src="${photo2.dataUrl}" o:title=""/></v:shape><![endif]--><![if !vml]><img width=267 height=200 src="${photo2.dataUrl}" v:shapes="Picture_${i+2}"><![endif]>`;
      } else {
        reportHtml += `[圖片 ${i + 2} 無法載入]`;
      }
       reportHtml += `<span style='font-size:11.0pt;font-family:"PMingLiU","serif";'><br clear=all> ${photo2?.description || '未產生描述'}</span></p>
          </td>\n`;

      reportHtml += `</tr>\n`; // End row
    }


    reportHtml += `
          </table>
        </div>

        <div class="section summary-section">
          <h2>會議大綱摘要</h2>
          <p class=MsoNormal>${summary || '尚未產生摘要'}</p>
        </div>

      </div> <!-- End Section1 -->
      </body>
      </html>
    `;

    return reportHtml;
  };


  const handleExportReport = useCallback(async () => { // Make async
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
     if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
        toast({
            title: '無法匯出',
            description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
            variant: 'destructive',
        });
        return;
    }
    // Check if all photos have dataUrls for embedding
    if (photos.some(p => !p.dataUrl)) {
        toast({
            title: '無法匯出',
            description: '部分圖片資料尚未完全載入，請稍候再試。',
            variant: 'destructive',
        });
        // Optional: attempt to load missing dataUrls here if needed
        return;
    }

    setIsSubmitting(true); // Indicate loading state for export
    try {
        const reportContent = await generateReportContent(); // Await the async generation
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
    } catch (error) {
         console.error('Error exporting report:', error);
         toast({
            title: '匯出錯誤',
            description: '匯出報告時發生錯誤。',
            variant: 'destructive',
         });
    } finally {
        setIsSubmitting(false); // End loading state
    }
  }, [form, photos, summary, toast]); // Added generateReportContent to dependencies


   // Effect to clear descriptions and summary when form fields change
   useEffect(() => {
      const subscription = form.watch((value, { name, type }) => {
         // Only reset if a form value actually changes, ignore initial load/watches
         if (type === 'change' && name !== undefined) { // Ensure name is defined
           // When form changes, descriptions/summary are no longer valid for the new input
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
                 <CardDescription className="text-primary-foreground/80">
                   請按照上方產出的逐條格式內容，輸出成一個完整漂亮排版過的的doc檔案供使用者下載
                 </CardDescription>
             </CardHeader>
             <CardContent className="p-6">
                 <Button
                    type="button"
                    onClick={handleExportReport}
                    disabled={
                        isSubmitting || // Disable while exporting
                        !summary || // Summary must exist
                        photos.length !== MAX_PHOTOS || // Must have exactly MAX_PHOTOS
                        photos.some(p => !p.description || p.description.startsWith('無法描述') || !p.dataUrl) // All descriptions must exist, not be errors, and have dataUrl
                    }
                    className="w-full md:w-auto bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6"
                  >
                    {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          匯出中...
                        </>
                      ) : (
                       '匯出會議報告 (.doc)' // Change text back or adjust as needed
                      )
                    }
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

    