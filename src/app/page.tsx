
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
import { generatePhotoDescriptions, type GeneratePhotoDescriptionsOutput } from '@/ai/flows/generate-photo-descriptions';
import { generateMeetingSummary } from '@/ai/flows/generate-meeting-summary';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

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
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false); // State for date picker popover
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
            description: `檔案 ${file.name} 過大，請選擇小於 ${MAX_FILE_SIZE / 1024 / 1024}MB 的檔案。`,
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
    [photos.length, toast]
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

    const readPromises = photosNeedDataUrlRead.map(async (photo) => {
        try {
            const dataUrl = await readFileAsDataURL(photo.file);
            return { id: photo.id, dataUrl };
        } catch (error) {
            console.error(`Error reading data URL for ${photo.file.name}:`, error);
            toast({
                title: '圖片讀取錯誤',
                description: `讀取檔案 ${photo.file.name} 時發生錯誤。`,
                variant: 'destructive',
            });
            return { id: photo.id, dataUrl: null };
        }
    });

    const readResults = await Promise.all(readPromises);

    let allDataUrlsReadSuccessfully = true;
    const updatedPhotos = photos.map(p => {
        const result = readResults.find(r => r.id === p.id);
        if (result) {
            if (result.dataUrl) {
                return { ...p, dataUrl: result.dataUrl };
            } else {
                allDataUrlsReadSuccessfully = false;
                return p;
            }
        }
        return p;
    });

    setPhotos(updatedPhotos);

    if (!allDataUrlsReadSuccessfully) {
        toast({
            title: '無法產生描述',
            description: '讀取部分圖片資料失敗，請檢查檔案或重新上傳。',
            variant: 'destructive',
        });
        return;
    }

    const currentPhotos = updatedPhotos;

    setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: true })));
    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0);
    let completedCount = 0;
    const totalToProcess = currentPhotos.length;

    try {
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
                let errorDescription = '產生描述時發生未知錯誤。';
                if (error instanceof Error) {
                    errorDescription = error.message;
                }
                
                const isModelOverloadedError = errorDescription.includes("overloaded") || errorDescription.includes("Service Unavailable") || errorDescription.includes("503");

                const finalDescription = isModelOverloadedError
                    ? '模型目前忙碌中，請稍後再試。'
                    : (errorDescription.includes("safety") || errorDescription.includes("SAFETY"))
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

        let failedCount = 0;
        let hasSuccess = false;
        let modelOverloadedDuringProcess = false;

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    hasSuccess = true;
                } else {
                    failedCount++;
                    if (result.value.description.includes('模型目前忙碌中')) {
                        modelOverloadedDuringProcess = true;
                    }
                }
            } else { // status === 'rejected'
                failedCount++;
            }
        });


        if (hasSuccess && failedCount === 0 && currentPhotos.length > 0) { 
          toast({
            title: '成功',
            description: '照片描述產生完成！',
          });
        } else if (modelOverloadedDuringProcess) {
             toast({
                title: '模型忙碌',
                description: '部分照片因模型忙碌無法產生描述，請稍後再試。',
                variant: 'destructive',
             });
        } else if (hasSuccess && failedCount > 0) {
           toast({
            title: '部分完成',
            description: `${failedCount} 張照片描述產生失敗，請檢查標示為「無法描述」的圖片。`,
            variant: 'destructive',
           });
        } else if (!hasSuccess && failedCount > 0 && currentPhotos.length > 0) { 
             toast({
                title: '產生失敗',
                description: `所有照片描述產生失敗，請檢查錯誤訊息或稍後重試。`,
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
       const processedPhotoIds = currentPhotos.map(p => p.id);
       setPhotos(prev => prev.map(p => processedPhotoIds.includes(p.id) ? { ...p, isGenerating: false, description: '產生失敗' } : p));

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
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.startsWith('無法描述') && !d.startsWith('模型目前忙碌中'));

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

    const descriptionsPending = photos.some(p => p.isGenerating);
     if (descriptionsPending) {
         toast({
            title: '請稍候',
            description: '照片描述仍在產生中，請完成後再產生摘要。',
            variant: 'default',
         });
         return;
     }

    const allDescriptionsGeneratedSuccessfully = photos.every(p => p.description && !p.description.startsWith('無法描述') && !p.description.startsWith('模型目前忙碌中'));
    if (!allDescriptionsGeneratedSuccessfully) {
         toast({
             title: '請先成功產生所有照片描述',
             description: '報告中包含無法描述、產生失敗或因模型忙碌未產生的照片描述。請點擊「重新產生描述」按鈕以重試，或移除問題照片。',
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


    const generateImageCellMSO = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
            content = `<p class="MsoNormal" align="center" style='text-align:center; margin-bottom:8pt;'>
                        <img src="${photo.dataUrl}" alt="${altText}" style="display:block; height:5cm; width:auto; max-width:100%; margin:0 auto; border-radius: 4px;">
                       </p>`;
        } else {
            content = `<p class="MsoNormal" align="center">[${altText} 無法載入]</p>`;
        }
        return `<td width="349" valign="top" class="PhotoCellStyle" style='width:9.23cm; border:solid #e0e0e0 .75pt; padding:10.0pt; background:#f8f9fa;'>${content}</td>`;
    };

    const generateDescriptionCellMSO = (photo: Photo | undefined): string => {
        const description = photo?.description || '未產生描述';
        return `<td width="349" valign="top" class="PhotoCellStyle" style='width:9.23cm; border:solid #e0e0e0 .75pt; padding:10.0pt; background:#f8f9fa;'>
                   <p class="PhotoDescriptionStyle" align="center">${description}</p>
                 </td>`;
    };

    const generateImageCellPrint = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
            content = `<img src="${photo.dataUrl}" alt="${altText}" style="display: block; margin: 0 auto 8pt auto; height: 5cm; width: auto; max-width: 100%; object-fit: contain; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">`;
        } else {
            content = `<p style="text-align: center;">[${altText} 無法載入]</p>`;
        }
        return `<td class="photo-table-cell">${content}</td>`;
    };

     const generateDescriptionCellPrint = (photo: Photo | undefined): string => {
        const description = photo?.description || '未產生描述';
        return `<td class="photo-table-cell"><p class="photo-description">${description}</p></td>`;
    };


  const generateReportContent = useCallback(async (forPrint = false): Promise<string> => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const membersArray = communityMembers.split(/[,，、]/).map(name => name.trim()).filter(name => name.length > 0);


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

     if (photosWithDataUrls.some(p => !p.dataUrl)) {
        throw new Error("無法讀取所有照片資料以進行匯出。");
     }


    let formattedSummary = summary || '尚未產生摘要';
    formattedSummary = formattedSummary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    formattedSummary = formattedSummary.replace(/\n/g, '<br>');

    let styles = `
      body {
        font-family: '標楷體', 'BiauKai', 'Times New Roman', serif;
        line-height: 1.6;
        color: #333333;
        font-size: 12pt;
        margin: 1.27cm;
        background-color: #ffffff;
      }
      .report-container {
        max-width: 18.46cm; /* A4 width - margins */
        margin: 0 auto;
        background-color: #ffffff;
        padding: ${forPrint ? '0' : '1.5cm'};
        border-radius: ${forPrint ? '0' : '8px'};
        box-shadow: ${forPrint ? 'none' : '0 4px 12px rgba(0,0,0,0.1)'};
      }
      h1 {
        color: #003f5c;
        text-align: left;
        font-size: 22pt;
        font-weight: bold;
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
        border-bottom: 2px solid #003f5c;
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
        text-align: left;
        page-break-after: avoid;
      }
      p {
        margin-bottom: 10pt;
        font-size: 12pt;
        text-align: left;
      }
      strong { font-weight: bold; color: #000000; }
      em { font-style: italic; color: #333333; }
      .section { margin-bottom: 30pt; page-break-inside: avoid; }
      
      .info-section {
        background-color: #f8f9fa;
        padding: 15pt;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
        margin-top: 15pt;
      }
      .info-section h2, .info-section .MsoHeading2 {
        margin-top: 0 !important; 
        padding-top: 0 !important;
        border-bottom: 1px solid #ced4da; 
        margin-bottom: 15pt !important;
        color: #0056b3;
        font-size: 16pt !important;
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important;
      }
      .info-section p {
        margin-bottom: 8pt;
        line-height: 1.5;
        text-align: left;
        font-size: 12pt; 
        font-family: '標楷體', 'BiauKai', serif;
      }
      .info-section p strong {
         display: inline-block;
         min-width: 110px;
         font-weight: bold;
         color: #212529;
         margin-right: 10px;
         font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
      }

      /* Sign-in Table Styles */
      .signin-table {
        width: 100%;
        max-width: 18.46cm; /* A4 width - margins */
        border-collapse: collapse;
        border-spacing: 0;
        margin: 20pt auto;
        page-break-inside: avoid;
        border: 1px solid #ababab; /* Outer border based on image */
        background-color: #ffffff;
      }
      .signin-table th, .signin-table td {
        border: 1px solid #cccccc; /* Inner borders */
        padding: 7pt; /* Adjusted padding */
        text-align: center;
        vertical-align: middle;
        font-size: 11pt;
        font-family: '標楷體', 'BiauKai', serif;
      }
      .signin-table th {
        font-weight: bold;
        background-color: #e9ecef; /* Lighter gray for header */
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
      }
      .signin-table td.name-cell {
        width: 25%;
      }
      .signin-table td.signature-cell {
        width: 25%;
        height: 2.2cm; /* Slightly adjusted height for signature */
      }


      .photo-table {
        width: 100%;
        max-width: 18.46cm; /* A4 width - margins */
        border-collapse: collapse;
        border-spacing: 0;
        margin: 20pt auto;
        page-break-inside: avoid;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        overflow: hidden; /* for border-radius on table */
        background-color: #f8f9fa;
      }
      .photo-table td, .photo-table-cell {
        border: 1px solid #e0e0e0;
        padding: 10pt;
        text-align: center;
        vertical-align: top;
        width: 50%; /* Two equal columns */
      }
      ${!forPrint ? `
      /* Rounded corners for DOC export table cells (visual only, not Word rendering) */
      .photo-table tr:first-child td:first-child { border-top-left-radius: 6px; }
      .photo-table tr:first-child td:last-child { border-top-right-radius: 6px; }
      .photo-table tr:nth-child(4) td:first-child { border-bottom-left-radius: 6px; } /* Assuming 2 rows of images + 2 rows of descriptions */
      .photo-table tr:nth-child(4) td:last-child { border-bottom-right-radius: 6px; }
      ` : ''}

      .photo-table img {
        display: block;
        margin: 0 auto 8pt auto; /* Center image and add space below */
        height: 5cm; /* Fixed height */
        width: auto;   /* Auto width to maintain aspect ratio */
        max-width: 100%; /* Ensure image doesn't overflow cell */
        object-fit: contain; /* Ensure image fits within bounds, maintaining aspect ratio */
        border-radius: 4px; /* Rounded corners for images */
        box-shadow: 0 2px 4px rgba(0,0,0,0.05); /* Subtle shadow for images */
      }
      .photo-description {
        font-size: 10pt;
        color: #495057;
        text-align: center;
        line-height: 1.4;
        margin-top: 5pt;
        font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      }
      .summary-section p {
        white-space: pre-wrap; /* Preserve line breaks from summary */
        font-size: 12pt;
        text-align: left;
        line-height: 1.7; /* Increased line height for readability */
        font-family: '標楷體', 'BiauKai', serif;
        padding: 15pt;
        background-color: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
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

      /* Print specific styles */
      @media print {
        @page { 
          size: A4 portrait; 
          margin: 1.27cm; /* Standard Word Narrow Margin */
        }
        body {
          background-color: #ffffff !important; /* Ensure white background for printing */
          -webkit-print-color-adjust: exact; /* Force print background colors in Chrome/Safari */
          print-color-adjust: exact; /* Standard way to force print background colors */
          margin: 0; /* Remove browser default margin for print */
        }
        .report-container {
          box-shadow: none !important;
          border-radius: 0;
          padding: 0 !important;
          max-width: none;
          margin: 0;
          border: none;
        }
        h1, h2 { page-break-after: avoid; color: #000000 !important; border-color: #000000 !important; text-align: left !important; }
        .section, .photo-table, .signin-table { page-break-inside: avoid; }
        .photo-table tr, .signin-table tr { page-break-inside: avoid; } /* Try to keep table rows together */
        strong, em { color: #000000 !important; }
        p { text-align: left !important; } /* Ensure paragraphs are left-aligned for print */
        .photo-table, .photo-table td, .photo-table-cell, .signin-table, .signin-table th, .signin-table td { border-color: #cccccc !important; background-color: #ffffff !important; border-radius: 0 !important;}
        .photo-table img { box-shadow: none !important; border-radius: 0 !important;}
        .photo-description { color: #333333 !important; text-align: center !important; }
        .signin-table th { background-color: #f0f0f0 !important; font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important; }
        .signin-table td { font-family: '標楷體', 'BiauKai', serif !important;}
        
        .info-section {
          background-color: #ffffff !important;
          border: 1px solid #cccccc !important;
          border-radius: 0 !important;
          padding: 10pt !important;
        }
        .info-section h2, .info-section .MsoHeading2 {
           color: #000000 !important;
           border-color: #000000 !important;
           font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important;
        }
        .info-section p strong {
           color: #000000 !important;
           font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important;
        }
         .info-section p {
            font-family: '標楷體', 'BiauKai', serif !important;
         }

        .summary-section p { background-color: #ffffff !important; border-color: #cccccc !important; border-radius: 0 !important; text-align: left !important; }
      }
    `;

    const msoPageSetupAndFonts = `
        <!--[if gte mso 9]><xml>
         <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:TrackMoves>false</w:TrackMoves>
          <w:TrackFormatting/>
          <w:PunctuationKerning/>
          <w:DrawingGridHorizontalSpacing>5.25 pt</w:DrawingGridHorizontalSpacing>
          <w:DrawingGridVerticalSpacing>7.5 pt</w:DrawingGridVerticalSpacing>
          <w:DisplayHorizontalDrawingGridEvery>0</w:DisplayHorizontalDrawingGridEvery>
          <w:DisplayVerticalDrawingGridEvery>2</w:DisplayVerticalDrawingGridEvery>
          <w:ValidateAgainstSchemas/>
          <w:SaveIfXMLInvalid>false</w:SaveIfXMLInvalid>
          <w:IgnoreMixedContent>false</w:IgnoreMixedContent>
          <w:AlwaysShowPlaceholderText>false</w:AlwaysShowPlaceholderText>
          <w:DoNotPromoteQF/>
          <w:LidThemeOther>EN-US</w:LidThemeOther>
          <w:LidThemeAsian>ZH-TW</w:LidThemeAsian>
          <w:LidThemeComplexScript>X-NONE</w:LidThemeComplexScript>
          <w:Compatibility>
           <w:BreakWrappedTables/>
           <w:SnapToGridInCell/>
           <w:WrapTextWithPunct/>
           <w:UseAsianBreakRules/>
           <w:DontGrowAutofit/>
           <w:SplitPgBreakAndParaMark/>
           <w:EnableOpenTypeKerning/>
           <w:DontFlipMirrorIndents/>
           <w:OverrideTableStyleHps/>
           <w:UseFELayout/>
          </w:Compatibility>
          <m:mathPr>
           <m:mathFont m:val="Cambria Math"/>
           <m:brkBin m:val="before"/>
           <m:brkBinSub m:val="&#45;-"/>
           <m:smallFrac m:val="off"/>
           <m:dispDef/>
           <m:lMargin m:val="0"/>
           <m:rMargin m:val="0"/>
           <m:defJc m:val="centerGroup"/>
           <m:wrapIndent m:val="1440"/>
           <m:intLim m:val="subSup"/>
           <m:naryLim m:val="undOvr"/>
          </m:mathPr>
          <w:BrowserLevel>MicrosoftInternetExplorer4</w:BrowserLevel>
          <w:SpellingState>Clean</w:SpellingState>
          <w:GrammarState>Clean</w:GrammarState>
         </w:WordDocument>
         <o:DocumentProperties>
           <o:Author>領域共備GO</o:Author>
           <o:Company>領域共備GO</o:Company>
           <o:Version>1.0</o:Version>
         </o:DocumentProperties>
         <w:LatentStyles DefLockedState="false" DefUnhideWhenUsed="false" DefSemiHidden="false" DefQFormat="false" DefPriority="99" LatentStyleCount="371">
         </w:LatentStyles>
        </xml><![endif]-->
         <!--[if gte mso 10]>
        <style>
         /* Style Definitions */
         table.MsoNormalTable {mso-style-name:"Table Normal"; mso-tstyle-rowband-size:0; mso-tstyle-colband-size:0; mso-style-noshow:yes; mso-style-priority:99; mso-style-parent:""; mso-padding-alt:0cm 5.4pt 0cm 5.4pt; mso-para-margin:0cm; mso-para-margin-bottom:.0001pt; mso-pagination:widow-orphan; font-size:12.0pt; font-family:"Calibri",sans-serif; mso-ascii-font-family:Calibri; mso-ascii-theme-font:minor-latin; mso-hansi-font-family:Calibri; mso-hansi-theme-font:minor-latin; mso-bidi-font-family:"Times New Roman"; mso-bidi-theme-font:minor-bidi; mso-fareast-language:EN-US;}

         /* Custom Photo Table Style for Word */
         table.PhotoTableStyle {
             mso-style-name:"Photo Table";
             mso-tstyle-rowband-size:0; mso-tstyle-colband-size:0; mso-style-priority:99; mso-style-unhide:no;
             mso-table-anchor-vertical:paragraph; mso-table-anchor-horizontal:margin;
             mso-table-left:center; mso-table-right:center;
             mso-table-bspace:0cm; mso-table-vspace:0cm;
             mso-table-top:20pt; mso-table-bottom:auto;
             mso-table-lspace:0cm; mso-table-rspace:0cm;
             mso-table-layout-alt:fixed; /* Fixed layout helps with consistency */
             mso-border-alt:solid #e0e0e0 .75pt;
             mso-padding-alt:0cm 0cm 0cm 0cm;
             mso-border-insideh:.75pt solid #e0e0e0;
             mso-border-insidev:.75pt solid #e0e0e0;
             mso-para-margin:0cm; mso-para-margin-bottom:.0001pt;
             mso-pagination:widow-orphan;
             font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
             background:#F8F9FA; mso-shading:white; mso-pattern:auto none;
         }
         td.PhotoCellStyle {
             mso-style-name:"Photo Cell"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"Photo Table";
             width: 9.23cm; /* Width of cell (approx half of A4 content width) */
             mso-border-alt:solid #e0e0e0 .75pt;
             padding:10.0pt 10.0pt 10.0pt 10.0pt;
             vertical-align:top;
             background:#F8F9FA; /* Cell background */
             text-align:center; /* Center align text in cell */
             mso-element:para-border-div; /* Important for Word rendering */
         }
         p.PhotoDescriptionStyle, li.PhotoDescriptionStyle, div.PhotoDescriptionStyle {
            mso-style-name:"Photo Description"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"";
            margin-top:5.0pt; margin-right:0cm; margin-bottom:0cm; margin-left:0cm;
            mso-para-margin-top:.5gd; mso-para-margin-right:0cm; mso-para-margin-bottom:0cm; mso-para-margin-left:0cm;
            text-align:center; /* Center description text */
            line-height:140%; mso-pagination:widow-orphan;
            font-size:10.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#495057;
         }

         /* Custom Sign-In Table Style for Word */
         table.SignInTableStyle {
             mso-style-name:"Sign-In Table";
             mso-tstyle-rowband-size:0; mso-tstyle-colband-size:0; mso-style-priority:99; mso-style-unhide:no;
             mso-table-lspace:0pt; mso-table-rspace:0pt; 
             /* Removed mso-table-anchor-vertical and mso-table-anchor-horizontal */
             margin-left:auto; margin-right:auto; /* Standard CSS for centering block elements */
             mso-table-left:center; /* MSO specific for centering */
             mso-table-right:center; /* MSO specific for centering */
             mso-table-bspace:0cm; mso-table-vspace:0cm;
             mso-table-top:20pt; mso-table-bottom:auto;
             mso-table-layout-alt:fixed;
             mso-border-alt:solid windowtext .75pt; 
             mso-padding-alt:0cm 5.4pt 0cm 5.4pt;
             mso-border-insideh:.5pt solid windowtext; 
             mso-border-insidev:.5pt solid windowtext; 
             mso-para-margin:0cm; mso-para-margin-bottom:.0001pt;
             mso-pagination:widow-orphan;
             font-size:11.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體";
             background:#FFFFFF;
         }
         td.SignInHeaderCellStyle {
             mso-style-name:"Sign-In Header Cell"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"SignInTableStyle";
             mso-border-alt:solid windowtext .75pt;
             padding:4.0pt 4.0pt 4.0pt 4.0pt; 
             text-align:center; vertical-align:middle;
             background:#E9ECEF; mso-shading:#E9ECEF;
             font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei"; font-weight:bold;
         }
         td.SignInNameCellStyle {
             mso-style-name:"Sign-In Name Cell"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"SignInTableStyle";
             width:4.615cm; 
             mso-border-alt:solid windowtext .5pt;
             padding:4.0pt 4.0pt 4.0pt 4.0pt; 
             text-align:center; vertical-align:middle;
         }
         td.SignInSignatureCellStyle {
             mso-style-name:"Sign-In Signature Cell"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"SignInTableStyle";
             width:4.615cm; 
             height:2.2cm; mso-height-rule:exactly;
             mso-border-alt:solid windowtext .5pt;
             padding:4.0pt 4.0pt 4.0pt 4.0pt; 
             text-align:center; vertical-align:middle;
         }


         /* Heading Styles for Word */
         p.MsoHeading1, li.MsoHeading1, div.MsoHeading1 {
            mso-style-priority:9; mso-style-unhide:no; mso-style-qformat:yes; mso-style-link:"Heading 1 Char";
            mso-margin-top-alt:auto; margin-right:0cm; mso-margin-bottom-alt:25.0pt; margin-left:0cm;
            line-height:normal; mso-pagination:widow-orphan lines-together; page-break-after:avoid; mso-outline-level:1;
            font-size:22.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#003F5C; font-weight:bold;
            border:none; mso-border-bottom-alt:solid #003F5C 2.0pt;
            padding:0cm; mso-padding-alt:0cm 0cm 10.0pt 0cm;
            text-align:left; 
         }
         p.MsoHeading2, li.MsoHeading2, div.MsoHeading2 {
            mso-style-priority:9; mso-style-unhide:no; mso-style-qformat:yes; mso-style-link:"Heading 2 Char";
            mso-margin-top-alt:25pt; margin-right:0cm; mso-margin-bottom-alt:15pt; margin-left:0cm;
            line-height:normal; mso-pagination:widow-orphan lines-together; page-break-after:avoid; mso-outline-level:2;
            font-size:16.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#0056B3; font-weight:bold;
            border:none; mso-border-bottom-alt:solid #DEE2E6 1.0pt;
            padding:0cm; mso-padding-alt:0cm 0cm 6.0pt 0cm;
            text-align:left; 
         }
         /* Normal Paragraph Style for Word */
         p.MsoNormal, li.MsoNormal, div.MsoNormal {
            mso-style-unhide:no; mso-style-qformat:yes; mso-style-parent:"";
            margin-top:0cm; margin-right:0cm; margin-bottom:8.0pt; margin-left:0cm; 
            line-height:150%; mso-pagination:widow-orphan;
            font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
            color:#333333;
            text-align:left; 
            mso-line-height-rule:exactly; 
         }
         /* Info Section Styles for Word */
         span.InfoLabelStyle { 
            mso-style-name:"Info Label"; mso-style-priority:99; mso-style-unhide:no;
            font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei";
            font-weight:bold; color:#212529;
            mso-ansi-font-size:12.0pt; mso-bidi-font-size:12.0pt;
         }
         div.InfoSectionBlock p.MsoNormal, li.InfoSectionBlock p.MsoNormal, div.InfoSectionBlock p.MsoNormal { 
             mso-margin-top-alt:0cm; mso-margin-bottom-alt:8.0pt; 
         }

         /* Summary Section Style for Word */
         p.SummaryStyle, li.SummaryStyle, div.SummaryStyle {
             mso-style-name:"Summary Text"; mso-style-priority:99; mso-style-unhide:no;
             margin:0cm; margin-bottom:.0001pt;
             text-align:left; 
             line-height:170%; mso-pagination:widow-orphan;
             mso-padding-alt:15.0pt 15.0pt 15.0pt 15.0pt; 
             mso-border-alt:solid #E0E0E0 .75pt; 
             font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
             background:#F8F9FA; 
             mso-line-height-rule:exactly;
         }
         /* Character Styles for Headings (Word specific) */
         span.Heading1Char {mso-style-name:"Heading 1 Char"; mso-style-priority:9; mso-style-unhide:no; mso-style-locked:yes; mso-style-link:"Heading 1"; font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; color:#003F5C; font-weight:bold;}
         span.Heading2Char {mso-style-name:"Heading 2 Char"; mso-style-priority:9; mso-style-unhide:no; mso-style-locked:yes; mso-style-link:"Heading 2"; font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; color:#0056B3; font-weight:bold;}
         /* Ensure strong and em tags are rendered correctly in Word for summary */
         strong {mso-style-name:""; font-weight:bold; color: #000000;}
         em {mso-style-name:""; font-style:italic; color: #333333;}
         .SummaryStyle strong {mso-style-name:""; font-weight:bold; color: #000000;}
         .SummaryStyle em {mso-style-name:""; font-style:italic; color: #333333;}
        </style>
        <![endif]-->
    `;

    const reportTitle = forPrint
      ? `領域共備GO_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}`
      : '領域共備GO 會議報告';

    let reportHtmlContent = `
      <!DOCTYPE html>
      <html lang="zh-TW" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${reportTitle}</title>
        ${!forPrint ? `
        <meta name=ProgId content=Word.Document>
        <meta name=Generator content="Microsoft Word 15">
        <meta name=Originator content="Microsoft Word 15">
        ${msoPageSetupAndFonts}` : ''}
        <style>
          ${styles}
          ${!forPrint ? `
          /* Word-specific page setup */
          @page Section1 {
            size: 21cm 29.7cm; /* A4 size */
            margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margins: 0.5 inch */
            mso-header-margin: .5in;
            mso-footer-margin: .5in;
            mso-paper-source: 0;
          }
          div.Section1 { page: Section1; }

          /* MSO specific overrides for text alignment */
          <!--[if gte mso 9]>
           p.MsoNormal, li.MsoNormal, div.MsoNormal,
           p.MsoHeading1, li.MsoHeading1, div.MsoHeading1,
           p.MsoHeading2, li.MsoHeading2, div.MsoHeading2,
           p.SummaryStyle, li.SummaryStyle, div.SummaryStyle {
              text-align: left !important; 
              mso-text-align-alt: left !important; 
           }
           p.PhotoDescriptionStyle, li.PhotoDescriptionStyle, div.PhotoDescriptionStyle {
              text-align: center !important; 
           }
           td.PhotoCellStyle, td.SignInHeaderCellStyle, td.SignInNameCellStyle, td.SignInSignatureCellStyle {
               text-align: center !important; 
               vertical-align: middle !important; 
           }
            td.PhotoCellStyle p.MsoNormal, 
            td.SignInHeaderCellStyle p.MsoNormal, 
            td.SignInNameCellStyle p.MsoNormal, 
            td.SignInSignatureCellStyle p.MsoNormal { 
              text-align: center !important; 
              margin-bottom: 0pt !important;
              mso-para-margin-bottom:0 !important;
           }
           /* Styling for the Info Section block in Word */
           div.InfoSectionBlock {
               mso-border-alt:solid #e0e0e0 .75pt; 
               mso-padding-alt:15.0pt 15.0pt 15.0pt 15.0pt; 
               background:#F8F9FA; 
               mso-shading:#F8F9FA; 
               mso-margin-top-alt:15pt; 
               margin-bottom:30pt; 
           }
           /* Styling for H2 within the Info Section block in Word */
           div.InfoSectionBlock p.MsoHeading2 {
               mso-margin-top-alt:0cm !important; 
               mso-margin-bottom-alt:15pt !important; 
               border:none; 
               mso-border-bottom-alt:solid #ced4da 1.0pt !important; 
               mso-padding-bottom-alt:6pt !important; 
           }
           /* Styling for paragraphs within the Info Section block in Word */
           div.InfoSectionBlock p.MsoNormal {
               margin-bottom:8.0pt !important; 
               line-height:150% !important; 
               font-family:"標楷體",serif !important; 
               mso-fareast-font-family:"標楷體" !important; 
           }
           /* Styling for labels (strong tags) within Info Section paragraphs in Word */
           div.InfoSectionBlock p.MsoNormal span.InfoLabelStyle {
              mso-spacerun:yes; 
              margin-right:7.5pt; 
           }

          <![endif]-->
          ` : ''}
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;background-color:#ffffff;'>
      <div class='${!forPrint ? 'Section1' : ''}'>
        <div class='report-container'>
    `;

    reportHtmlContent += `<${forPrint ? 'h1' : 'p class="MsoHeading1"'}>領域共備GO 會議報告</${forPrint ? 'h1' : 'p'}>`;

    // Basic Info Section
    reportHtmlContent += `
        <div class="section info-section ${!forPrint ? 'InfoSectionBlock' : ''}">
          <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>基本資訊</${forPrint ? 'h2' : 'p'}>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'class="InfoLabelStyle" style="mso-style-name: InfoLabelStyle;"' : ''}>教學領域：</strong> ${teachingArea}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'class="InfoLabelStyle" style="mso-style-name: InfoLabelStyle;"' : ''}>會議主題：</strong> ${meetingTopic}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'class="InfoLabelStyle" style="mso-style-name: InfoLabelStyle;"' : ''}>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'class="InfoLabelStyle" style="mso-style-name: InfoLabelStyle;"' : ''}>社群成員：</strong> ${communityMembers}</p>
        </div>
    `;

    // Sign-in Table Section
    reportHtmlContent += `
      <div class="section signin-section">
        <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>成員簽到表</${forPrint ? 'h2' : 'p'}>
        <table class="${forPrint ? 'signin-table' : 'SignInTableStyle'}" 
               ${!forPrint ? `border="1" cellspacing="0" cellpadding="0" width="699" style='width:18.46cm; mso-cellspacing:0cm; border:solid windowtext .75pt; mso-border-alt:solid windowtext .75pt; mso-table-layout-alt:fixed; margin-left:auto; margin-right:auto; mso-table-left:center; mso-table-right:center;'` : ''}
        >
          <thead>
            <tr ${!forPrint ? 'style="mso-yfti-irow:0; mso-yfti-firstrow:yes;"' : ''}>
              <${forPrint ? 'th' : 'td'} class="${forPrint ? '' : 'SignInHeaderCellStyle'}" ${!forPrint ? 'width="173"' : ''}>${forPrint ? '姓名' : '<p class=MsoNormal align=center style=\'text-align:center\'><b><span style=\'font-family:"Microsoft JhengHei",sans-serif\'>姓名</span></b></p>'}</${forPrint ? 'th' : 'td'}>
              <${forPrint ? 'th' : 'td'} class="${forPrint ? '' : 'SignInHeaderCellStyle'}" ${!forPrint ? 'width="173"' : ''}>${forPrint ? '簽到處 (需親簽)' : '<p class=MsoNormal align=center style=\'text-align:center\'><b><span style=\'font-family:"Microsoft JhengHei",sans-serif\'>簽到處 (需親簽)</span></b></p>'}</${forPrint ? 'th' : 'td'}>
              <${forPrint ? 'th' : 'td'} class="${forPrint ? '' : 'SignInHeaderCellStyle'}" ${!forPrint ? 'width="173"' : ''}>${forPrint ? '姓名' : '<p class=MsoNormal align=center style=\'text-align:center\'><b><span style=\'font-family:"Microsoft JhengHei",sans-serif\'>姓名</span></b></p>'}</${forPrint ? 'th' : 'td'}>
              <${forPrint ? 'th' : 'td'} class="${forPrint ? '' : 'SignInHeaderCellStyle'}" ${!forPrint ? 'width="173"' : ''}>${forPrint ? '簽到處 (需親簽)' : '<p class=MsoNormal align=center style=\'text-align:center\'><b><span style=\'font-family:"Microsoft JhengHei",sans-serif\'>簽到處 (需親簽)</span></b></p>'}</${forPrint ? 'th' : 'td'}>
            </tr>
          </thead>
          <tbody ${!forPrint ? "style='mso-yfti-irow:0; mso-yfti-firstrow:yes;'" : ""}>
            ${(() => {
              let rowsHtml = '';
              const numRows = Math.ceil(membersArray.length / 2);
              if (membersArray.length === 0 && forPrint) { 
                 rowsHtml += `<tr>
                               <td class="name-cell">&nbsp;</td>
                               <td class="signature-cell">&nbsp;</td>
                               <td class="name-cell">&nbsp;</td>
                               <td class="signature-cell">&nbsp;</td>
                             </tr>`;
              } else if (membersArray.length === 0 && !forPrint) { 
                 rowsHtml += `<tr style='mso-yfti-irow:1; mso-yfti-lastrow:yes;'>
                               <td class='SignInNameCellStyle'><p class=MsoNormal align=center style='text-align:center'>&nbsp;</p></td>
                               <td class='SignInSignatureCellStyle'><p class=MsoNormal align=center style='text-align:center'>&nbsp;</p></td>
                               <td class='SignInNameCellStyle'><p class=MsoNormal align=center style='text-align:center'>&nbsp;</p></td>
                               <td class='SignInSignatureCellStyle'><p class=MsoNormal align=center style='text-align:center'>&nbsp;</p></td>
                             </tr>`;
              }

              for (let i = 0; i < numRows; i++) {
                const member1 = membersArray[i * 2];
                const member2 = membersArray[i * 2 + 1];
                rowsHtml += `<tr ${!forPrint ? `style="mso-yfti-irow:${i + 1}; ${i === numRows -1 ? 'mso-yfti-lastrow:yes;' : ''}"` : ''}>`;
                
                if (forPrint) {
                  rowsHtml += `<td class="name-cell">${member1 || '&nbsp;'}</td>`;
                  rowsHtml += `<td class="signature-cell">&nbsp;</td>`;
                  rowsHtml += `<td class="name-cell">${member2 || '&nbsp;'}</td>`;
                  rowsHtml += `<td class="signature-cell">${member2 ? '&nbsp;' : '&nbsp;'}</td>`; 
                } else { 
                  rowsHtml += `<td class='SignInNameCellStyle'><p class=MsoNormal align=center style='text-align:center'>${member1 || '&nbsp;'}</p></td>`;
                  rowsHtml += `<td class='SignInSignatureCellStyle'><p class=MsoNormal align=center style='text-align:center'>&nbsp;</p></td>`;
                  rowsHtml += `<td class='SignInNameCellStyle'><p class=MsoNormal align=center style='text-align:center'>${member2 || '&nbsp;'}</p></td>`;
                  rowsHtml += `<td class='SignInSignatureCellStyle'><p class=MsoNormal align=center style='text-align:center'>${member2 ? '&nbsp;' : '&nbsp;'}</p></td>`;
                }
                rowsHtml += `</tr>`;
              }
              return rowsHtml;
            })()}
          </tbody>
        </table>
      </div>
    `;

    // Photo Record Section
    reportHtmlContent += `
        <div class="section photo-section">
           <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>照片記錄</${forPrint ? 'h2' : 'p'}>`;

    reportHtmlContent += `
        <table class="${forPrint ? 'photo-table' : 'photo-table PhotoTableStyle'}" 
               ${!forPrint ? `border="1" cellspacing="0" cellpadding="0" width="699" align="center" style='width:18.46cm; mso-cellspacing:0cm; border:solid #e0e0e0 .75pt; mso-border-alt:solid #e0e0e0 .75pt; mso-table-anchor-vertical:paragraph; mso-table-anchor-horizontal:margin; mso-table-left:center; mso-table-right:center; mso-table-layout-alt:fixed;'` : ''}
        >
         <tbody ${!forPrint ? "style='mso-yfti-irow:0; mso-yfti-firstrow:yes;'" : ""}>
    `;


    const generateImageCell = forPrint ? generateImageCellPrint : generateImageCellMSO;
    const generateDescriptionCell = forPrint ? generateDescriptionCellPrint : generateDescriptionCellMSO;

    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:0; mso-yfti-firstrow:yes;'" : ""}>`;
    reportHtmlContent += generateImageCell(photosWithDataUrls[0], '照片 1');
    reportHtmlContent += generateImageCell(photosWithDataUrls[1], '照片 2');
    reportHtmlContent += `</tr>`;

    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:1;'" : ""}>`;
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[0]);
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[1]);
    reportHtmlContent += `</tr>`;

    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:2;'" : ""}>`;
    reportHtmlContent += generateImageCell(photosWithDataUrls[2], '照片 3');
    reportHtmlContent += generateImageCell(photosWithDataUrls[3], '照片 4');
    reportHtmlContent += `</tr>`;

    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:3; mso-yfti-lastrow:yes;'" : ""}>`;
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[2]);
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[3]);
    reportHtmlContent += `</tr>`;

    reportHtmlContent += `
            </tbody>
          </table>
        </div>
    `;

    // Summary Section
    reportHtmlContent += `
        <div class="section summary-section">
           <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>會議大綱摘要</${forPrint ? 'h2' : 'p'}>
           <p class="${forPrint ? '' : 'SummaryStyle'}">${formattedSummary}</p>
        </div>

        </div>
      </div>
      </body>
      </html>
    `;

    return reportHtmlContent;
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
     if (photos.some(p => !p.description || p.description.startsWith('無法描述') || p.description.startsWith('模型目前忙碌中'))) {
        toast({
            title: '無法匯出',
            description: '報告中包含無法描述、產生失敗或因模型忙碌未產生的照片描述，請確認所有照片描述是否成功產生。',
            variant: 'destructive',
        });
        return;
    }
     if (photos.some(p => !p.dataUrl)) {
        toast({
            title: '圖片處理中',
            description: '圖片資料尚未完全載入，請稍候幾秒鐘再試。',
            variant: 'default',
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
         const errorMsg = error instanceof Error ? error.message : '匯出 DOC 報告時發生未知錯誤。';
         toast({
            title: '匯出錯誤',
            description: errorMsg,
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
        if (photos.some(p => !p.description || p.description.startsWith('無法描述') || p.description.startsWith('模型目前忙碌中'))) {
            toast({
                title: '無法匯出 PDF',
                description: '報告中包含無法描述、產生失敗或因模型忙碌未產生的照片描述，請確認所有照片描述是否成功產生。',
                variant: 'destructive',
            });
            return;
        }
        if (photos.some(p => !p.dataUrl)) {
            toast({
                title: '圖片處理中',
                description: '圖片資料尚未完全載入，請稍候幾秒鐘再試。',
                variant: 'default',
            });
            return;
        }

        setIsPreparingPdf(true);
        try {
            const reportContent = await generateReportContent(true);
            const { teachingArea, meetingDate } = form.getValues();
            const pdfFileName = `領域共備GO_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}.pdf`;


            if (printIframeRef.current) {
                const iframe = printIframeRef.current;
                iframe.srcdoc = reportContent;

                iframe.onload = () => {
                  setTimeout(() => {
                    try {
                        if (iframe.contentWindow?.document) {
                             iframe.contentWindow.document.title = pdfFileName;
                        }
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
             const errorMsg = error instanceof Error ? error.message : '準備 PDF 報告時發生未知錯誤。';
            toast({
                title: '匯出錯誤',
                description: errorMsg,
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
    photos.some(p => !p.description || p.description.startsWith('無法描述') || p.description.startsWith('模型目前忙碌中') || !p.dataUrl);

  const isGenerateDescriptionsDisabled =
      isGeneratingAllDescriptions ||
      photos.length === 0 ||
      photos.some(p => p.isGenerating);


  return (
    <TooltipProvider>
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

      <div className="container mx-auto p-4 md:p-8 lg:p-12 bg-transparent min-h-screen">
        <header className="mb-10 md:mb-12 text-center relative group">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-400 to-purple-400 py-4 rounded-lg transition-all duration-300 group-hover:scale-105 drop-shadow-lg">
            領域共備GO
          </h1>
          <p className="text-slate-300 text-base sm:text-lg mt-2 transition-opacity duration-300 opacity-90 group-hover:opacity-100 text-shadow">國小教師社群領域會議報告協作產出平台</p>
        </header>

        <Form {...form}>
          <form className="space-y-10">
            {/* Step 1: Meeting Information */}
            <Card className="card-step-1 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-1 p-6">
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                     <Info className="w-7 h-7 card-icon-step-1" />
                     第一步：輸入會議資訊
                  </CardTitle>
                  <CardDescription className="text-slate-300">請填寫本次社群會議的基本資料</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  <FormField
                    control={form.control}
                    name="teachingArea"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-medium text-slate-200">教學領域</FormLabel>
                        <FormControl>
                          <Input placeholder="例如：國語文、數學..." {...field} className="text-base py-2.5 bg-slate-700/50 border-slate-600 focus:bg-slate-700 focus:border-primary text-slate-100 placeholder:text-slate-400" />
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
                        <FormLabel className="text-lg font-medium text-slate-200">會議主題</FormLabel>
                        <FormControl>
                          <Input placeholder="例如：新課綱教學策略..." {...field} className="text-base py-2.5 bg-slate-700/50 border-slate-600 focus:bg-slate-700 focus:border-primary text-slate-100 placeholder:text-slate-400" />
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
                        <FormLabel className="text-lg font-medium mb-1 text-slate-200">會議日期</FormLabel>
                         <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                            <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                  "w-full pl-3 text-left font-normal justify-start text-base py-2.5",
                                  !field.value && "text-slate-400",
                                   field.value && "text-slate-100",
                                  "bg-slate-700/50 border-slate-600 hover:bg-slate-700/80"
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
                                onSelect={(date) => {
                                  field.onChange(date);
                                  setIsDatePickerOpen(false);
                                }}
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
                        <FormLabel className="text-lg font-medium text-slate-200">社群成員</FormLabel>
                        <FormControl>
                          <Input placeholder="王老師, 李老師..." {...field} className="text-base py-2.5 bg-slate-700/50 border-slate-600 focus:bg-slate-700 focus:border-primary text-slate-100 placeholder:text-slate-400" />
                        </FormControl>
                        <FormDescription className="text-sm text-slate-400">
                          請用半形逗號 (,)、全形逗號 (，) 或頓號 (、) 分隔姓名。
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Upload Photos */}
            <Card className="card-step-2 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-2 p-6">
                <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                    <ImageIcon className="w-7 h-7 card-icon-step-2" />
                    第二步：上傳會議照片
                </CardTitle>
                 <CardDescription className="text-slate-300">請上傳 {MAX_PHOTOS} 張照片 (JPG, PNG, WEBP, &lt; {MAX_FILE_SIZE / 1024 / 1024}MB)</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                <div className="mb-6">
                  <label
                    htmlFor="photo-upload"
                    className={cn(
                      "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 ease-in-out",
                      photos.length >= MAX_PHOTOS
                        ? "border-slate-600 bg-slate-800/30 cursor-not-allowed opacity-60"
                        : "border-accent hover:border-primary hover:bg-accent/20"
                    )}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <UploadCloud className={cn("w-10 h-10 mb-3", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-primary")} />
                      <p className={cn("mb-2 text-sm font-medium", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-slate-200")}>
                         點擊此處 或拖曳照片至此
                      </p>
                      <p className={cn("text-xs", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-slate-400")}>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                      {photos.map((photo) => (
                        <div key={photo.id} className="relative border border-slate-700 rounded-lg overflow-hidden shadow-md bg-slate-800/50 flex flex-col transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
                          <div className="aspect-video w-full relative flex items-center justify-center overflow-hidden">
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
                              className="absolute top-2 right-2 bg-destructive/80 text-destructive-foreground rounded-full p-1.5 transition-opacity focus:opacity-100 z-10 hover:bg-destructive"
                              aria-label="移除照片"
                            >
                              <X className="h-4 w-4" />
                            </button>
                             {photo.isGenerating && (
                                <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 backdrop-blur-sm rounded-t-lg">
                                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                              )}
                          </div>
                           <div className="p-3 bg-slate-700/80 border-t border-slate-600 min-h-[4.5em] flex items-center justify-center"> 
                             <p className="text-xs text-slate-200 text-center break-words text-shadow">
                                {photo.description || '尚未產生描述'}
                             </p>
                          </div>
                        </div>
                      ))}
                       
                       {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }).map((_, index) => (
                          <div key={`placeholder-${index}`} className="relative border border-dashed border-slate-600 rounded-lg overflow-hidden shadow-sm aspect-video flex items-center justify-center bg-slate-800/30 text-slate-500 text-sm">
                             照片 {photos.length + index + 1}
                          </div>
                      ))}
                    </div>
                     <div className="flex flex-col items-center gap-4">
                        <Button
                            type="button"
                            onClick={handleGenerateDescriptions}
                            disabled={isGenerateDescriptionsDisabled}
                            className="w-full md:w-auto min-w-[180px] transition-transform duration-200 hover:scale-105"
                            variant="secondary" 
                            size="lg"
                        >
                            {isGeneratingAllDescriptions ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                描述產生中...
                            </>
                            ) : (
                                photos.length > 0 && photos.some(p => p.description && !p.description.startsWith('無法描述') && !p.description.startsWith('模型目前忙碌中')) ? '重新產生描述' : '產生照片描述'
                            )}
                        </Button>
                        {descriptionProgress !== null && (
                            <div className="w-full max-w-md">
                                <Progress value={descriptionProgress} className="w-full h-2.5 bg-slate-700" />
                                <p className="text-sm text-slate-400 text-center mt-2">
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
            <Card className="card-step-3 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-3 p-6">
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                    <FileText className="w-7 h-7 card-icon-step-3" />
                    第三步：產生會議摘要
                  </CardTitle>
                  <CardDescription className="text-slate-300">整合會議資訊與照片描述，自動產生摘要</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                 <Button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={
                        isGeneratingSummary ||
                        photos.length !== MAX_PHOTOS || 
                        photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述') || p.description.startsWith('模型目前忙碌中')) 
                    }
                    className="w-full md:w-auto min-w-[180px] transition-transform duration-200 hover:scale-105"
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
                  <div className="mt-4 p-4 md:p-6 border border-slate-600 rounded-lg bg-slate-800/30 shadow-inner">
                    <h3 className="text-xl font-semibold mb-3 text-slate-200">會議摘要：</h3>
                    <Textarea
                       value={summary}
                       readOnly
                       className="w-full h-56 bg-slate-700/50 border-slate-600 text-base resize-y focus:border-primary transition-colors text-slate-100" 
                       aria-label="會議摘要內容"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 4: Export Report */}
             <Card className="card-step-4 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-4 p-6">
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                     <Download className="w-7 h-7 card-icon-step-4" />
                    第四步：匯出報告
                  </CardTitle>
                   <CardDescription className="text-slate-300">
                     點擊下方按鈕匯出 Word (.doc) 或 PDF 格式報告。
                   </CardDescription>
               </CardHeader>
               <CardContent className="p-6 md:p-8 flex flex-col sm:flex-row flex-wrap gap-4">
                   <Button
                      type="button"
                      onClick={handleExportReport}
                      disabled={isExportDisabled}
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105 shadow-md hover:shadow-lg"
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
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-secondary text-secondary-foreground hover:bg-secondary/80 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105 shadow-md hover:shadow-lg"
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
       <footer className="mt-16 py-8 text-center">
         <div className="container mx-auto px-4">
           <div className="bg-slate-800/70 backdrop-blur-sm rounded-lg p-6 border border-slate-700 shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-105">
             <p className="text-sm text-slate-300">
                &copy; 2025 <a href="https://www.smes.tyc.edu.tw/" target="_blank" rel="noopener noreferrer" className="hover:text-primary underline transition-colors duration-200">桃園市石門國小 資訊組 阿凱老師</a> 設計
             </p>
           </div>
         </div>
        </footer>
      </div>
       <Toaster /> 
      </TooltipProvider>
    );
}

