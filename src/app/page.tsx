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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer, Info, Image as ImageIcon } from 'lucide-react'; // Added Info icon
import { cn } from '@/lib/utils';
import NextImage from 'next/image'; // Renamed to avoid conflict with ImageIcon
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { generatePhotoDescriptions, type GeneratePhotoDescriptionsOutput } from '@/ai/flows/generate-photo-descriptions';
import { generateMeetingSummary } from '@/ai/flows/generate-meeting-summary';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'; // Added Tooltip

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
  dataUrl?: string;
};

type DescriptionResult = {
    id: string;
    description: string;
    success: boolean;
};


export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isExportingDoc, setIsExportingDoc] = useState(false);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [descriptionProgress, setDescriptionProgress] = useState<number | null>(null);
  const [isGeneratingAllDescriptions, setIsGeneratingAllDescriptions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printIframeRef = useRef<HTMLIFrameElement>(null);
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
       if (!(file instanceof File)) {
           return reject(new Error("Input is not a File object"));
       }
      const reader = new FileReader();
      reader.onload = () => {
          if (typeof reader.result === 'string') {
             resolve(reader.result);
          } else {
             reject(new Error('FileReader result is not a string'));
          }
      };
      reader.onerror = (error) => reject(error);
       if (typeof reader.readAsDataURL === 'function') {
          reader.readAsDataURL(file);
       } else {
           console.error("readAsDataURL method not found on FileReader instance:", reader);
           reject(new Error('FileReader.readAsDataURL method not found'));
       }
    });
  };


  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const newPhotosPromises: Promise<Photo | null>[] = [];
      let currentPhotoCount = photos.length;
      let filesProcessedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (currentPhotoCount + filesProcessedCount >= MAX_PHOTOS) {
           toast({
            title: '上傳錯誤',
            description: `最多只能上傳 ${MAX_PHOTOS} 張照片。已忽略多餘檔案。`,
            variant: 'destructive',
          });
          break;
        }

        if (file.size > MAX_FILE_SIZE) {
          toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 過大，請選擇小於 5MB 的檔案。`,
            variant: 'destructive',
          });
          continue;
        }

        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
           toast({
            title: '上傳錯誤',
            description: `檔案 ${file.name} 格式不支援，請選擇 JPG, PNG, 或 WEBP 格式。`,
            variant: 'destructive',
          });
          continue;
        }

        filesProcessedCount++;

        const photoId = `${file.name}-${Date.now()}`;
        const previewUrl = URL.createObjectURL(file);

        const photoPromise = readFileAsDataURL(file)
            .then(dataUrl => ({
                id: photoId,
                file,
                previewUrl: previewUrl,
                description: '',
                isGenerating: false,
                dataUrl: dataUrl,
            }))
            .catch(error => {
                console.error(`Error reading file ${file.name}:`, error);
                toast({
                    title: '讀取錯誤',
                    description: `讀取檔案 ${file.name} 時發生錯誤: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    variant: 'destructive',
                });
                 URL.revokeObjectURL(previewUrl);
                return null;
            });

        newPhotosPromises.push(photoPromise);
      }

      const resolvedPhotos = await Promise.all(newPhotosPromises);
      const validNewPhotos = resolvedPhotos.filter((p): p is Photo => p !== null);


       if (validNewPhotos.length > 0) {
          setPhotos((prevPhotos) => {
             const combined = [...prevPhotos, ...validNewPhotos];
              setSummary('');
              setDescriptionProgress(null);
              setIsGeneratingAllDescriptions(false);
              return combined.slice(0, MAX_PHOTOS).map(p => ({ ...p, description: '', isGenerating: false }));
          });
       }

      if (event.target) {
        event.target.value = '';
      }
    },
    [photos, toast]
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos((prevPhotos) => {
      const photoToRemove = prevPhotos.find(p => p.id === id);
      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.previewUrl);
      }
       const remainingPhotos = prevPhotos.filter((photo) => photo.id !== id);
       if (remainingPhotos.length < prevPhotos.length) {
         setSummary('');
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
         return remainingPhotos.map(p => ({ ...p, description: '', isGenerating: false }));
       }
       return remainingPhotos;
    });
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
    if (isGeneratingAllDescriptions) return;

    const photosNeedDataUrlRead = photos.filter(p => !p.dataUrl);
    if (photosNeedDataUrlRead.length > 0) {
        try {
            const reads = photosNeedDataUrlRead.map(async (photo) => {
                const dataUrl = await readFileAsDataURL(photo.file);
                return { id: photo.id, dataUrl };
            });
            const results = await Promise.all(reads);
            setPhotos(prev => prev.map(p => {
                const found = results.find(r => r.id === p.id);
                return found ? { ...p, dataUrl: found.dataUrl } : p;
            }));
        } catch (error) {
            console.error('Error pre-reading data URLs:', error);
            toast({
                title: '圖片讀取錯誤',
                description: '產生描述前讀取圖片資料失敗。',
                variant: 'destructive',
            });
            return;
        }
    }


    const needsGeneration = photos.length > 0 && photos.some(p => !p.description || p.description.startsWith('無法描述'));


    setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: true })));
    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0);
    let completedCount = 0;
    const totalToProcess = photos.length;

    try {
        const currentPhotos = photos.map(p => {
             const photoFromState = photos.find(ps => ps.id === p.id);
             return { ...p, dataUrl: photoFromState?.dataUrl };
        });

        const descriptionPromises = currentPhotos.map(async (photo): Promise<DescriptionResult> => {
           let descriptionResult: DescriptionResult | undefined = undefined;
            try {
                 if (!photo.dataUrl) {
                     throw new Error(`Data URL missing for photo ${photo.id} even after pre-read.`);
                 }

                 const result: GeneratePhotoDescriptionsOutput = await generatePhotoDescriptions({
                    teachingArea,
                    meetingTopic,
                    meetingDate: format(meetingDate, 'yyyy-MM-dd'),
                    communityMembers,
                    photoDataUri: photo.dataUrl,
                });
                 const success = !!result.photoDescription && !result.photoDescription.startsWith('無法描述');
                 descriptionResult = { id: photo.id, description: result.photoDescription || '描述失敗', success: success };
            } catch (error) {
                console.error(`Error generating description for ${photo.file.name}:`, error);
                const errorDescription = error instanceof Error ? error.message : '產生描述時發生未知錯誤。';
                const finalDescription = (errorDescription.includes("safety") || errorDescription.includes("SAFETY"))
                    ? '無法描述此圖片（安全限制）。'
                    : '無法描述此圖片。';
                 descriptionResult = { id: photo.id, description: finalDescription, success: false };
            } finally {
                completedCount++;
                const newProgress = Math.round((completedCount / totalToProcess) * 100);
                 setDescriptionProgress(newProgress);

                 if (descriptionResult) {
                     setPhotos(prev => prev.map(p => p.id === descriptionResult!.id ? { ...p, description: descriptionResult!.description, isGenerating: false } : p));
                 } else {
                     setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: '更新錯誤', isGenerating: false } : p));
                 }
            }
            return descriptionResult || { id: photo.id, description: '未處理', success: false };
        });

        const results = await Promise.allSettled(descriptionPromises);

        let allSucceeded = true;
        let failedCount = 0;
        results.forEach(result => {
            if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
                allSucceeded = false;
                failedCount++;
            }
        });


        if (allSucceeded && failedCount === 0 && photos.length > 0) {
          toast({
            title: '成功',
            description: '照片描述產生完成！',
          });
        } else if (failedCount > 0) {
           toast({
            title: '部分完成',
            description: `${failedCount} 張照片描述產生失敗，請檢查標示為「無法描述」的圖片。`,
            variant: 'destructive',
           });
        }
       setSummary('');

    } catch (error) {
      console.error('Error in generating descriptions batch:', error);
       toast({
         title: '錯誤',
         description: '產生照片描述過程中發生嚴重錯誤。',
         variant: 'destructive',
       });
       setPhotos(prev => prev.map(p => photos.some(ptp => ptp.id === p.id) ? { ...p, isGenerating: false, description: '產生失敗' } : p));
    } finally {
      setDescriptionProgress(100);
       setTimeout(() => {
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
       }, 1000);
    }
  }, [form, photos, toast, isGeneratingAllDescriptions]);


 const handleGenerateSummary = useCallback(async () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.startsWith('無法描述'));

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

    const allDescriptionsGeneratedSuccessfully = photos.every(p => p.description && !p.description.startsWith('無法描述'));
    if (isGeneratingAllDescriptions || photos.some(p => p.isGenerating) || !allDescriptionsGeneratedSuccessfully) {
        if (!allDescriptionsGeneratedSuccessfully && !isGeneratingAllDescriptions && !photos.some(p=>p.isGenerating)) {
            toast({
                title: '請先成功產生所有照片描述',
                description: '請確保所有照片描述都已成功產生，且沒有錯誤訊息。點擊「重新產生描述」按鈕以重試。',
                variant: 'destructive',
            });
        }
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
  }, [form, photos, toast, isGeneratingAllDescriptions]);


  const generateReportContent = useCallback(async (forPrint = false): Promise<string> => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

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
                        description: `匯出時無法讀取照片 ${photo.file.name}。`,
                        variant: 'destructive',
                    });
                    return { ...photo, dataUrl: '' };
                }
            }
            return photo;
        })
    );

    let formattedSummary = summary || '尚未產生摘要';
    formattedSummary = formattedSummary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    formattedSummary = formattedSummary.replace(/\n/g, '<br>');

    // Refined styles for better visual appeal and Word/Print compatibility
    let styles = `
      body {
        font-family: '標楷體', 'BiauKai', 'Times New Roman', serif;
        line-height: 1.6;
        color: #333333; /* Dark gray for readability */
        font-size: 12pt;
        margin: 1.27cm; /* Narrow Margin */
        background-color: #ffffff;
      }
      .report-container {
        max-width: 18.46cm;
        margin: 0 auto;
        background-color: #ffffff;
        padding: ${forPrint ? '0' : '1.5cm'};
        border-radius: ${forPrint ? '0' : '8px'}; /* Slightly larger radius */
        box-shadow: ${forPrint ? 'none' : '0 4px 12px rgba(0,0,0,0.1)'}; /* Softer shadow */
      }
      h1 {
        color: #0056b3; /* Professional blue */
        text-align: left;
        font-size: 22pt;
        font-weight: bold;
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
        border-bottom: 2px solid #0056b3;
        padding-bottom: 10pt;
        margin-bottom: 25pt;
        page-break-after: avoid;
      }
      h2 {
        color: #0056b3;
        font-size: 16pt;
        font-weight: bold;
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
        border-bottom: 1px solid #dee2e6;
        padding-bottom: 6pt;
        margin-top: 25pt;
        margin-bottom: 15pt;
        page-break-after: avoid;
      }
      p {
        margin-bottom: 10pt;
        font-size: 12pt;
        text-align: left; /* Keep left alignment */
      }
      strong { font-weight: bold; color: #212529; } /* Slightly darker bold */
      em { font-style: italic; color: #495057; } /* Subtler italic */
      .section { margin-bottom: 30pt; page-break-inside: avoid; }
      .info-section p {
        margin-bottom: 6pt; /* Slightly more spacing */
        line-height: 1.4;
        text-align: left;
      }
      .info-section strong {
         display: inline-block;
         min-width: 90px; /* Adjusted width */
         color: #495057;
         font-weight: bold;
         margin-right: 8px; /* Slightly more space after label */
      }
      /* Photo Table Styling */
      .photo-table {
        width: 100%;
        max-width: 18.46cm;
        border-collapse: collapse;
        border-spacing: 0;
        margin: 20pt auto;
        page-break-inside: avoid;
        border: 1px solid #e0e0e0; /* Lighter border */
        border-radius: 6px; /* Rounded corners for the table */
        overflow: hidden; /* Ensures border-radius applies to content */
      }

      .photo-table td {
        border: 1px solid #e0e0e0;
        padding: 10pt; /* Increased padding */
        text-align: center;
        vertical-align: top;
        width: 50%;
        background-color: #f8f9fa; /* Very light background for cells */
      }
      .photo-table tr:first-child td:first-child { border-top-left-radius: 6px; }
      .photo-table tr:first-child td:last-child { border-top-right-radius: 6px; }
      .photo-table tr:last-child td:first-child { border-bottom-left-radius: 6px; }
      .photo-table tr:last-child td:last-child { border-bottom-right-radius: 6px; }


      /* Image style: Fixed height (5cm), auto width, centered */
      .photo-table img {
        display: block;
        margin: 0 auto 8pt auto; /* Increased bottom margin */
        height: 5cm !important;
        width: auto !important;
        max-width: 100% !important;
        object-fit: contain;
        border-radius: 4px; /* Rounded corners for images */
        box-shadow: 0 2px 4px rgba(0,0,0,0.05); /* Subtle shadow for images */
      }
      .photo-description {
        font-size: 10pt;
        color: #495057; /* Consistent muted color */
        text-align: center;
        line-height: 1.4;
        margin-top: 5pt;
        font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      }
      /* Summary Section Styling */
      .summary-section p {
        white-space: pre-wrap;
        font-size: 12pt;
        text-align: left;
        line-height: 1.7;
        font-family: '標楷體', 'BiauKai', serif;
        padding: 15pt; /* Add padding to summary box */
        background-color: #f8f9fa; /* Light background for summary */
        border-radius: 6px; /* Rounded corners */
        border: 1px solid #e0e0e0; /* Consistent border */
      }
      .summary-section strong {
         font-weight: bold;
         color: #000000;
      }
       .summary-section em {
         font-style: italic;
         color: #333333;
      }
      .page-break { page-break-before: always; }

      /* Print-specific overrides */
      @media print {
        @page { size: A4 portrait; margin: 1.27cm; }
        body {
          background-color: #ffffff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .report-container {
          box-shadow: none !important;
          border-radius: 0;
          padding: 0 !important;
          max-width: none;
          margin: 0;
        }
        h1, h2 { page-break-after: avoid; color: #000000 !important; border-color: #000000 !important; }
        .section, .photo-table { page-break-inside: avoid; }
        .photo-table tr { page-break-inside: avoid; }
        strong, em { color: #000000 !important; }
        p { text-align: left !important; }
        .photo-table, .photo-table td { border-color: #cccccc !important; background-color: #ffffff !important; border-radius: 0 !important;}
        .photo-table img { box-shadow: none !important; border-radius: 0 !important;}
        .photo-description { color: #333333 !important; }
        .info-section strong { color: #000000 !important; }
        .summary-section p { background-color: #ffffff !important; border-color: #cccccc !important; border-radius: 0 !important; }
      }
    `;

    // MSO styles for Word compatibility
    const msoPageSetupAndFonts = `
        <!--[if gte mso 9]><xml>
         <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
          {/* Other Word settings */}
         </w:WordDocument>
         <o:DocumentProperties>
           <o:Author>領域共備GO</o:Author>
           <o:Company>領域共備GO</o:Company>
           <o:Version>1.0</o:Version>
         </o:DocumentProperties>
         {/* Latent Styles */}
        </xml><![endif]-->
         <!--[if gte mso 10]>
        <style>
         /* Style Definitions */
         table.MsoNormalTable { /* ... */ }
         table.PhotoTableStyle {
             mso-style-name:"Photo Table";
             /* ... other styles ... */
             border:none; /* Remove MSO border, rely on cell borders */
             mso-border-alt:solid #e0e0e0 .5pt;
             mso-border-insideh:.5pt solid #e0e0e0;
             mso-border-insidev:.5pt solid #e0e0e0;
             background:#F8F9FA; /* Match cell background */
             /* Ensure table alignment */
             margin-left:auto;
             margin-right:auto;
         }
         td.PhotoCellStyle {
             mso-style-name:"Photo Cell";
             border:.5pt solid #e0e0e0;
             padding:10pt 10pt 10pt 10pt; /* Match CSS padding */
             text-align:center;
             vertical-align:top;
             background:#F8F9FA; /* Explicit background */
         }
         p.PhotoDescriptionStyle, li.PhotoDescriptionStyle, div.PhotoDescriptionStyle {
            mso-style-name:"Photo Description";
            /* ... other styles ... */
            font-size:10.0pt;
            font-family:"Microsoft JhengHei",sans-serif;
            color:#495057; /* Match CSS color */
         }
         p.MsoHeading1, li.MsoHeading1, div.MsoHeading1 { /* ... H1 styles ... */ text-align:left; }
         p.MsoHeading2, li.MsoHeading2, div.MsoHeading2 { /* ... H2 styles ... */ text-align:left; }
         p.MsoNormal, li.MsoNormal, div.MsoNormal { /* ... Normal paragraph styles ... */ text-align:left; }
         p.SummaryStyle, li.SummaryStyle, div.SummaryStyle {
             mso-style-name:"Summary Text";
             /* ... other summary styles ... */
             text-align:left;
             mso-padding-alt: 15pt 15pt 15pt 15pt; /* Add padding */
             mso-border-alt: solid #e0e0e0 .5pt; /* Add border */
             background:#F8F9FA; /* Add background */
         }
         strong {mso-style-name:""; font-weight:bold; color: #212529;} /* Match CSS */
         em {mso-style-name:""; font-style:italic; color: #495057;} /* Match CSS */
        </style>
        <![endif]-->
    `;

    const htmlStart = `
      <!DOCTYPE html>
      <html lang="zh-TW" ${!forPrint ? 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40"' : ''}>
      <head>
        <meta charset="utf-8">
        <title>領域共備GO 會議報告</title>
        ${!forPrint ? `<meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15"><meta name=Originator content="Microsoft Word 15">${msoPageSetupAndFonts}` : '<meta name="viewport" content="width=device-width, initial-scale=1.0">'}
        <style>
          @page Section1 {
            size: 21cm 29.7cm; /* A4 */
            margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margins */
            mso-header-margin: .5in;
            mso-footer-margin: .5in;
            mso-paper-source: 0;
          }
          div.Section1 { page: Section1; }
          ${styles} /* Embed refined CSS */
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;background-color:#ffffff;'>
      <div class='Section1'> <!-- Use Section1 for Word page settings -->
        <div class='report-container'> <!-- Add container for non-print styling -->
    `;

    let reportHtml = htmlStart;

    // Main title
    reportHtml += `<p class="MsoHeading1" style="text-align:left;">領域共備GO 會議報告</p>`; // Ensure left align via inline style too

    // Basic Info Section
    reportHtml += `
        <div class="section info-section">
          <p class="MsoHeading2" style="text-align:left;">基本資訊</p>
          <p class="MsoNormal" style="text-align:left;"><strong>教學領域：</strong> ${teachingArea}</p>
          <p class="MsoNormal" style="text-align:left;"><strong>會議主題：</strong> ${meetingTopic}</p>
          <p class="MsoNormal" style="text-align:left;"><strong>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p class="MsoNormal" style="text-align:left;"><strong>社群成員：</strong> ${communityMembers}</p>
        </div>
    `;

    // Photo Record Section
    reportHtml += `
        <div class="section photo-section">
           <p class="MsoHeading2" style="text-align:left;">照片記錄</p>
           <!--[if gte mso 9]>
            <table class="PhotoTableStyle" border="1" cellspacing="0" cellpadding="0" align="center" width="699" style='width:18.46cm; border-collapse:collapse; mso-table-lspace:9.0pt; mso-table-rspace:9.0pt; mso-table-anchor-vertical:paragraph; mso-table-anchor-horizontal:margin; mso-table-left:center; mso-table-top:.05pt; mso-padding-alt:0cm 0cm 0cm 0cm'>
           <![endif]-->
           <!--[if !mso]>
            <table class="photo-table" align="center">
           <![endif]-->
             <tbody style="mso-yfti-irow:0; mso-yfti-firstrow:yes; mso-yfti-lastfirstrow:yes;">
    `;

    const generateImageCell = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
              // Explicitly set height:5cm; width:auto; via inline style for Word
              content = `<p class="PhotoCellStyle" align="center" style="text-align:center; margin:0;"><img src="${photo.dataUrl}" alt="${altText}" style="display:block; height:5cm; width:auto; max-width:100%; margin:0 auto 8pt auto; border-radius: 4px;"></p>`; // Added border-radius
        } else {
             content = `<p class="PhotoCellStyle" align="center">[${altText} 無法載入]</p>`;
        }
        return `<td width="50%" valign="top" class="PhotoCellStyle" style='width:50.0%; border:.5pt solid #e0e0e0; padding:10pt 10pt 10pt 10pt; background:#F8F9FA;'>${content}</td>`; // Match CSS
    };

    const generateDescriptionCell = (photo: Photo | undefined): string => {
      const description = photo?.description || '未產生描述';
       return `<td width="50%" valign="top" class="PhotoCellStyle" style='width:50.0%; border:.5pt solid #e0e0e0; padding:10pt 10pt 10pt 10pt; background:#F8F9FA;'><p class="PhotoDescriptionStyle">${description}</p></td>`; // Match CSS
    }

    // Build the table content (2x4 structure)
    reportHtml += `<tr style='mso-yfti-irow:0;'>`;
    reportHtml += generateImageCell(photosWithDataUrls[0], '照片 1');
    reportHtml += generateImageCell(photosWithDataUrls[1], '照片 2');
    reportHtml += `</tr>`;
    reportHtml += `<tr style='mso-yfti-irow:1;'>`;
    reportHtml += generateDescriptionCell(photosWithDataUrls[0]);
    reportHtml += generateDescriptionCell(photosWithDataUrls[1]);
    reportHtml += `</tr>`;
    reportHtml += `<tr style='mso-yfti-irow:2;'>`;
    reportHtml += generateImageCell(photosWithDataUrls[2], '照片 3');
    reportHtml += generateImageCell(photosWithDataUrls[3], '照片 4');
    reportHtml += `</tr>`;
    reportHtml += `<tr style='mso-yfti-irow:3; mso-yfti-lastrow:yes;'>`;
    reportHtml += generateDescriptionCell(photosWithDataUrls[2]);
    reportHtml += generateDescriptionCell(photosWithDataUrls[3]);
    reportHtml += `</tr>`;

    reportHtml += `
            </tbody>
          </table>
        </div>
    `;

    // Summary Section
    reportHtml += `
        <div class="section summary-section">
           <p class="MsoHeading2" style="text-align:left;">會議大綱摘要</p>
           <p class="SummaryStyle" style="text-align:left; background:#F8F9FA; border:solid #e0e0e0 .5pt; padding:15pt;">${formattedSummary}</p> {/* Match CSS */}
        </div>

        </div> <!-- End report-container -->
      </div> <!-- End Section1 -->
      </body>
      </html>
    `;

    return reportHtml;
  }, [photos, summary, form, toast]);


  const handleExportReport = useCallback(async () => {
     const { teachingArea, meetingDate } = form.getValues();
     if (
       !form.getValues().teachingArea ||
       !form.getValues().meetingTopic ||
       !form.getValues().meetingDate ||
       !form.getValues().communityMembers ||
       photos.length !== MAX_PHOTOS ||
       !summary
      ) {
         toast({
            title: '無法匯出',
            description: '請先完成所有步驟（填寫資訊、上傳照片、產生描述、產生摘要）再匯出報告。',
            variant: 'destructive',
         });
         return;
     }
     if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
        toast({
            title: '無法匯出',
            description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
            variant: 'destructive',
        });
        return;
    }
    if (photos.some(p => !p.dataUrl)) {
        toast({
            title: '無法匯出',
            description: '部分圖片資料尚未完全載入，請稍候再試。',
            variant: 'destructive',
        });
        return;
    }

    setIsExportingDoc(true);
    try {
        const reportContent = await generateReportContent(false);
        const blob = new Blob([`\ufeff${reportContent}`], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const fileName = `領域共備GO_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}.doc`;
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
         console.error('Error exporting DOC report:', error);
         toast({
            title: '匯出錯誤',
            description: '匯出 DOC 報告時發生錯誤。',
            variant: 'destructive',
         });
    } finally {
        setIsExportingDoc(false);
    }
  }, [form, photos, summary, toast, generateReportContent]);


   const handleExportPdf = useCallback(async () => {
        if (
         !form.getValues().teachingArea ||
         !form.getValues().meetingTopic ||
         !form.getValues().meetingDate ||
         !form.getValues().communityMembers ||
         photos.length !== MAX_PHOTOS ||
         !summary
        ) {
            toast({
                title: '無法匯出 PDF',
                description: '請先完成所有步驟（填寫資訊、上傳照片、產生描述、產生摘要）再匯出 PDF。',
                variant: 'destructive',
            });
            return;
        }
        if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
            toast({
                title: '無法匯出 PDF',
                description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
                variant: 'destructive',
            });
            return;
        }
        if (photos.some(p => !p.dataUrl)) {
            toast({
                title: '無法匯出 PDF',
                description: '部分圖片資料尚未完全載入，請稍候再試。',
                variant: 'destructive',
            });
            return;
        }

        setIsPreparingPdf(true);
        try {
            const reportContent = await generateReportContent(true);

            if (printIframeRef.current) {
                const iframe = printIframeRef.current;
                iframe.srcdoc = reportContent;

                iframe.onload = () => {
                  setTimeout(() => {
                    try {
                        iframe.contentWindow?.print();
                         toast({
                            title: '準備列印',
                            description: '瀏覽器列印對話框已開啟，請選擇「另存為 PDF」。',
                         });
                    } catch (printError) {
                        console.error('Error triggering print:', printError);
                         toast({
                            title: '列印錯誤',
                            description: '無法自動開啟列印對話框，請嘗試手動列印。',
                            variant: 'destructive',
                        });
                    } finally {
                       setIsPreparingPdf(false);
                       iframe.onload = null;
                    }
                  }, 500);
                };
                 iframe.onerror = (error) => {
                    console.error('Error loading iframe content:', error);
                    toast({
                        title: '載入錯誤',
                        description: '無法載入預覽內容以供列印。',
                        variant: 'destructive',
                    });
                     setIsPreparingPdf(false);
                 };
            } else {
                throw new Error("Print iframe ref not found.");
            }
        } catch (error) {
            console.error('Error preparing PDF report:', error);
            toast({
                title: '匯出錯誤',
                description: '準備 PDF 報告時發生錯誤。',
                variant: 'destructive',
            });
            setIsPreparingPdf(false);
        }
    }, [form, photos, summary, toast, generateReportContent]);


   useEffect(() => {
      const subscription = form.watch((value, { name, type }) => {
         if (type === 'change' && name !== undefined) {
            setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: false })));
            setSummary('');
            setDescriptionProgress(null);
            setIsGeneratingAllDescriptions(false);
         }
      });
      return () => subscription.unsubscribe();
   }, [form]);


  const isExportDisabled =
    isExportingDoc ||
    isPreparingPdf ||
    !summary ||
    photos.length !== MAX_PHOTOS ||
    photos.some(p => !p.description || p.description.startsWith('無法描述') || !p.dataUrl);

  const isGenerateDescriptionsDisabled =
      isGeneratingAllDescriptions ||
      photos.length === 0 ||
      photos.some(p => p.isGenerating);


  return (
    <TooltipProvider> {/* Wrap with TooltipProvider */}
      {/* Hidden iframe for printing */}
      <iframe
          ref={printIframeRef}
          style={{
              position: 'absolute',
              width: '0',
              height: '0',
              border: '0',
              visibility: 'hidden',
          }}
          title="Print Content Frame"
      ></iframe>

      <div className="container mx-auto p-4 md:p-8 lg:p-12 bg-background min-h-screen">
        <header className="mb-10 md:mb-12 text-center relative group">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-500 to-teal-400 py-4 rounded-lg transition-all duration-300 group-hover:scale-105">
            領域共備GO
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg mt-2 transition-opacity duration-300 opacity-80 group-hover:opacity-100">國小教師社群領域會議報告協作產出平台</p>
        </header>

        <Form {...form}>
          <form className="space-y-10"> {/* Increased spacing */}
            {/* Step 1: Meeting Info */}
            <Card className="shadow-lg rounded-xl overflow-hidden border-l-4 border-primary transition-all duration-300 hover:shadow-xl hover:border-primary/80">
               <CardHeader className="bg-secondary/30 p-6"> {/* Lighter header bg */}
                  <CardTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
                     <Info className="w-6 h-6 text-primary" />
                     第一步：輸入會議資訊
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">請填寫本次社群會議的基本資料</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6"> {/* Adjusted gap */}
                  <FormField
                    control={form.control}
                    name="teachingArea"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-medium">教學領域</FormLabel>
                        <FormControl>
                          <Input placeholder="例如：國語文、數學..." {...field} className="text-base py-2.5" />
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
                        <FormLabel className="text-lg font-medium">會議主題</FormLabel>
                        <FormControl>
                          <Input placeholder="例如：新課綱教學策略..." {...field} className="text-base py-2.5" />
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
                        <FormLabel className="text-lg font-medium mb-1">會議日期</FormLabel>
                         <Popover>
                            <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                  "w-full pl-3 text-left font-normal justify-start text-base py-2.5", // Adjusted padding
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
                        <FormLabel className="text-lg font-medium">社群成員</FormLabel>
                        <FormControl>
                          <Input placeholder="王老師, 李老師..." {...field} className="text-base py-2.5" />
                        </FormControl>
                        <FormDescription className="text-sm">
                          請用逗號分隔姓名。
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Upload Photos */}
            <Card className="shadow-lg rounded-xl overflow-hidden border-l-4 border-green-500 transition-all duration-300 hover:shadow-xl hover:border-green-500/80">
               <CardHeader className="bg-green-100/30 dark:bg-green-900/20 p-6"> {/* Distinct header color */}
                <CardTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
                    <ImageIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
                    第二步：上傳會議照片
                </CardTitle>
                 <CardDescription className="text-muted-foreground">請上傳 {MAX_PHOTOS} 張照片 (JPG, PNG, WEBP, &lt; 5MB)</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                <div className="mb-6">
                  <label
                    htmlFor="photo-upload"
                    className={cn(
                      "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out",
                      photos.length >= MAX_PHOTOS
                        ? "border-muted-foreground/30 bg-muted/20 cursor-not-allowed opacity-60"
                        : "border-accent hover:border-primary hover:bg-accent/50 dark:hover:bg-accent/10"
                    )}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <UploadCloud className={cn("w-10 h-10 mb-3", photos.length >= MAX_PHOTOS ? "text-muted-foreground/50" : "text-primary")} />
                      <p className={cn("mb-2 text-sm font-medium", photos.length >= MAX_PHOTOS ? "text-muted-foreground/60" : "text-foreground")}>
                        點擊此處或拖曳照片
                      </p>
                      <p className={cn("text-xs", photos.length >= MAX_PHOTOS ? "text-muted-foreground/50" : "text-muted-foreground")}>
                        還可上傳 {Math.max(0, MAX_PHOTOS - photos.length)} 張
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6"> {/* Increased gap */}
                      {photos.map((photo) => (
                        <div key={photo.id} className="relative group border rounded-lg overflow-hidden shadow-md aspect-video flex items-center justify-center bg-muted/50 transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
                           <NextImage
                              src={photo.previewUrl}
                              alt={`照片 ${photo.file.name}`}
                              fill
                              style={{ objectFit: 'contain' }}
                              priority
                              className="transition-transform duration-300 group-hover:scale-105"
                            />
                          <button
                            type="button"
                            onClick={() => handlePhotoRemove(photo.id)}
                            className="absolute top-2 right-2 bg-destructive/80 text-destructive-foreground rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 z-10 hover:bg-destructive"
                            aria-label="移除照片"
                          >
                            <X className="h-4 w-4" />
                          </button>
                           {photo.isGenerating && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 backdrop-blur-sm">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                              </div>
                            )}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-3 text-primary-foreground text-xs z-10 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
                             {/* Added text shadow for readability */}
                              <p className="truncate font-medium text-shadow" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.7)' }}>
                                {photo.description || '尚未產生描述'}
                              </p>
                          </div>
                        </div>
                      ))}
                       {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }).map((_, index) => (
                          <div key={`placeholder-${index}`} className="relative group border border-dashed border-muted-foreground/30 rounded-lg overflow-hidden shadow-sm aspect-video flex items-center justify-center bg-muted/20 text-muted-foreground text-sm">
                             照片 {photos.length + index + 1}
                          </div>
                      ))}
                    </div>
                     <div className="flex flex-col items-center gap-4">
                        <Button
                            type="button"
                            onClick={handleGenerateDescriptions}
                            disabled={isGenerateDescriptionsDisabled}
                            className="w-full md:w-auto min-w-[180px]" // Set min-width
                            variant="secondary"
                            size="lg"
                        >
                            {isGeneratingAllDescriptions ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                描述產生中...
                            </>
                            ) : (
                                photos.length > 0 && photos.some(p => p.description && !p.description.startsWith('無法描述')) ? '重新產生描述' : '產生照片描述'
                            )}
                        </Button>
                        {/* Progress Bar */}
                        {descriptionProgress !== null && (
                            <div className="w-full max-w-md"> {/* Limit width */}
                                <Progress value={descriptionProgress} className="w-full h-2.5" /> {/* Adjusted height */}
                                <p className="text-sm text-muted-foreground text-center mt-2">
                                    {descriptionProgress < 100 ? `正在產生照片描述... ${descriptionProgress}%` : '描述產生完成！'}
                                </p>
                            </div>
                        )}
                     </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Generate Summary */}
            <Card className="shadow-lg rounded-xl overflow-hidden border-l-4 border-purple-500 transition-all duration-300 hover:shadow-xl hover:border-purple-500/80">
               <CardHeader className="bg-purple-100/30 dark:bg-purple-900/20 p-6">
                  <CardTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-text text-purple-600 dark:text-purple-400"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                    第三步：產生會議摘要
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">整合會議資訊與照片描述，自動產生摘要</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                 <Button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={
                        isGeneratingSummary ||
                        photos.length !== MAX_PHOTOS ||
                        photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述')) ||
                        isGeneratingAllDescriptions
                    }
                    className="w-full md:w-auto min-w-[180px]" // Set min-width
                    variant="secondary"
                    size="lg"
                  >
                    {isGeneratingSummary ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        摘要產生中...
                      </>
                    ) : (
                      '產生會議摘要'
                    )}
                  </Button>
                 {summary && (
                  <div className="mt-4 p-4 md:p-6 border rounded-lg bg-muted/30 shadow-inner">
                    <h3 className="text-xl font-semibold mb-3 text-foreground">會議摘要：</h3>
                    <Textarea
                       value={summary}
                       readOnly
                       className="w-full h-56 bg-background/80 text-base resize-y border-muted-foreground/30 focus:border-primary transition-colors" // Allow vertical resize
                       aria-label="會議摘要內容"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

             {/* Step 4: Export Report */}
             <Card className="shadow-lg rounded-xl overflow-hidden border-l-4 border-orange-500 transition-all duration-300 hover:shadow-xl hover:border-orange-500/80">
               <CardHeader className="bg-orange-100/30 dark:bg-orange-900/20 p-6">
                  <CardTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-download text-orange-600 dark:text-orange-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    第四步：匯出報告
                  </CardTitle>
                   <CardDescription className="text-muted-foreground">
                     點擊下方按鈕匯出 Word (.doc) 或 PDF 格式報告。
                   </CardDescription>
               </CardHeader>
               <CardContent className="p-6 md:p-8 flex flex-col sm:flex-row flex-wrap gap-4"> {/* Allow wrapping */}
                   <Button
                      type="button"
                      onClick={handleExportReport}
                      disabled={isExportDisabled}
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105" // Added hover effect
                    >
                      {isExportingDoc ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            匯出 DOC 中...
                          </>
                        ) : (
                         '匯出會議報告 (.doc)'
                        )
                      }
                   </Button>
                    <Button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={isExportDisabled}
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-secondary text-secondary-foreground hover:bg-secondary/80 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105" // Added hover effect
                      variant="outline"
                    >
                      {isPreparingPdf ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            準備 PDF 中...
                          </>
                        ) : (
                         <>
                          <Printer className="mr-2 h-5 w-5" />
                          匯出會議報告 (PDF)
                         </>
                        )
                      }
                   </Button>
              </CardContent>
            </Card>

          </form>
        </Form>
      </div>
       <Toaster />
      </TooltipProvider> // Close TooltipProvider
    );
}