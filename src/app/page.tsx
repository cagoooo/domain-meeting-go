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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer, Info, Image as ImageIcon, FileText, Download } from 'lucide-react'; // Added Info, FileText, Download icons
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
            description: `檔案 ${file.name} 過大，請選擇小於 20MB 的檔案。`,
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

      // Reset file input value to allow uploading the same file again
      if (event.target) {
        event.target.value = '';
      }
    },
    [photos.length, toast] // Ensure dependency includes photos.length
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos((prevPhotos) => {
      const photoToRemove = prevPhotos.find(p => p.id === id);
      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.previewUrl);
      }
       const remainingPhotos = prevPhotos.filter((photo) => photo.id !== id);
       // Reset summary and description states only if a photo was actually removed
       if (remainingPhotos.length < prevPhotos.length) {
         setSummary('');
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
         // Reset descriptions of remaining photos
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

    // Filter photos that need data URL read (or re-read)
    const photosNeedDataUrlRead = photos.filter(p => !p.dataUrl);

    // Start reading data URLs concurrently
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
            return { id: photo.id, dataUrl: null }; // Indicate failure
        }
    });

    // Wait for all reads to complete
    const readResults = await Promise.all(readPromises);

    // Update photo state with read data URLs or handle failures
    let allDataUrlsReadSuccessfully = true;
    const updatedPhotos = photos.map(p => {
        const result = readResults.find(r => r.id === p.id);
        if (result) { // If this photo needed reading
            if (result.dataUrl) {
                return { ...p, dataUrl: result.dataUrl };
            } else {
                allDataUrlsReadSuccessfully = false; // Mark failure
                return p; // Keep original photo state (without dataUrl)
            }
        }
        return p; // Return photos that didn't need reading
    });

    // Update state with newly read data URLs
    setPhotos(updatedPhotos);

    // If any data URL read failed, stop generation
    if (!allDataUrlsReadSuccessfully) {
        toast({
            title: '無法產生描述',
            description: '讀取部分圖片資料失敗，請檢查檔案或重新上傳。',
            variant: 'destructive',
        });
        return;
    }

    // Proceed with description generation if all data URLs are available
    const currentPhotos = updatedPhotos; // Use the state with potentially updated dataUrls

    // Check if generation is needed (at least one photo without a valid description)
    // const needsGeneration = currentPhotos.length > 0 && currentPhotos.some(p => !p.description || p.description.startsWith('無法描述'));

    // Reset descriptions and set generating state for all photos (simplifies logic)
    setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: true })));
    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0);
    let completedCount = 0;
    const totalToProcess = currentPhotos.length; // Process all photos

    try {
        const descriptionPromises = currentPhotos.map(async (photo): Promise<DescriptionResult> => {
           let descriptionResult: DescriptionResult | undefined = undefined;
            try {
                 if (!photo.dataUrl) {
                     // Should not happen after the check above, but as a safeguard
                     throw new Error(`Data URL missing for photo ${photo.id} even after pre-read.`);
                 }

                 const result: GeneratePhotoDescriptionsOutput = await generatePhotoDescriptions({
                    teachingArea,
                    meetingTopic,
                    meetingDate: format(meetingDate, 'yyyy-MM-dd'),
                    communityMembers,
                    photoDataUri: photo.dataUrl,
                });
                 // Determine success based on non-empty and not starting with "無法描述"
                 const success = !!result.photoDescription && !result.photoDescription.startsWith('無法描述');
                 descriptionResult = { id: photo.id, description: result.photoDescription || '描述失敗', success: success };
            } catch (error) {
                console.error(`Error generating description for ${photo.file.name}:`, error);
                const errorDescription = error instanceof Error ? error.message : '產生描述時發生未知錯誤。';
                // Handle specific safety error message from GenAI
                const finalDescription = (errorDescription.includes("safety") || errorDescription.includes("SAFETY"))
                    ? '無法描述此圖片（安全限制）。'
                    : '無法描述此圖片。'; // Generic failure message
                 descriptionResult = { id: photo.id, description: finalDescription, success: false };
            } finally {
                completedCount++;
                const newProgress = Math.round((completedCount / totalToProcess) * 100);
                 // Update progress immediately after each completion
                 setDescriptionProgress(newProgress);

                 // Update individual photo state immediately
                 if (descriptionResult) {
                     setPhotos(prev => prev.map(p => p.id === descriptionResult!.id ? { ...p, description: descriptionResult!.description, isGenerating: false } : p));
                 } else {
                      // Should ideally not happen with the try/catch/finally, but as a fallback
                     setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: '更新錯誤', isGenerating: false } : p));
                 }
            }
            // Ensure a result is always returned
            return descriptionResult || { id: photo.id, description: '未處理', success: false };
        });

        const results = await Promise.allSettled(descriptionPromises);

        // Process results after all promises settle
        let allSucceeded = true;
        let failedCount = 0;
        let hasSuccess = false; // Track if at least one description succeeded

        results.forEach(result => {
            // Check the success flag we set in the DescriptionResult
            if (result.status === 'fulfilled' && result.value.success) {
                hasSuccess = true;
            } else {
                allSucceeded = false;
                failedCount++;
            }
        });


        // Provide consolidated feedback based on overall outcome
        if (hasSuccess && failedCount === 0 && photos.length > 0) {
          toast({
            title: '成功',
            description: '照片描述產生完成！',
          });
        } else if (hasSuccess && failedCount > 0) {
           toast({
            title: '部分完成',
            description: `${failedCount} 張照片描述產生失敗，請檢查標示為「無法描述」的圖片。`,
            variant: 'destructive', // Use destructive variant for partial failure
           });
        } else if (!hasSuccess && failedCount > 0) { // All failed
             toast({
                title: '產生失敗',
                description: `所有照片描述產生失敗，請檢查錯誤訊息或稍後重試。`,
                variant: 'destructive',
             });
        }
       setSummary(''); // Reset summary after generating descriptions

    } catch (error) {
      console.error('Error in generating descriptions batch:', error);
       toast({
         title: '錯誤',
         description: '產生照片描述過程中發生嚴重錯誤。',
         variant: 'destructive',
       });
       // Ensure loading state is cleared on error for relevant photos
       // Find the IDs of photos that were supposed to be processed in this batch
       const processedPhotoIds = currentPhotos.map(p => p.id);
       setPhotos(prev => prev.map(p => processedPhotoIds.includes(p.id) ? { ...p, isGenerating: false, description: '產生失敗' } : p));

    } finally {
      // Ensure progress reaches 100% and loading state is fully cleared
      setDescriptionProgress(100);
       setTimeout(() => { // Delay hiding progress bar for better UX
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
       }, 1000); // Wait 1 second before hiding
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

    // Check if descriptions are still being generated
    const descriptionsPending = photos.some(p => p.isGenerating);
     if (descriptionsPending) {
         toast({
            title: '請稍候',
            description: '照片描述仍在產生中，請完成後再產生摘要。',
            variant: 'default', // Use default variant, not destructive
         });
         return;
     }

    // Check if ALL descriptions were generated successfully
    const allDescriptionsGeneratedSuccessfully = photos.every(p => p.description && !p.description.startsWith('無法描述'));
    if (!allDescriptionsGeneratedSuccessfully) {
         toast({
             title: '請先成功產生所有照片描述',
             description: '報告中包含無法描述或產生失敗的照片描述，請點擊「重新產生描述」按鈕以重試，或移除問題照片。',
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
        photoDescriptions, // Only send valid descriptions
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


  // Helper function to generate a table cell for an image for DOC export (MSO styles)
    const generateImageCellMSO = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
            // MSO requires wrapping the image in a paragraph for alignment and spacing.
            // Set fixed height (5cm) and auto width via inline style.
            content = `<p class="MsoNormal" align="center" style='text-align:center; margin-bottom:8pt;'>
                        <img src="${photo.dataUrl}" alt="${altText}" style="display:block; height:5cm; width:auto; max-width:100%; margin:0 auto; border-radius: 4px;">
                       </p>`;
        } else {
            content = `<p class="MsoNormal" align="center">[${altText} 無法載入]</p>`;
        }
        // Apply PhotoCellStyle class to TD for MSO styling and dimensions.
        return `<td width="349" valign="top" class="PhotoCellStyle" style='width:9.23cm; border:solid #e0e0e0 .75pt; padding:10.0pt; background:#f8f9fa;'>${content}</td>`;
    };

    // Helper function to generate a table cell for a description for DOC export (MSO styles)
    const generateDescriptionCellMSO = (photo: Photo | undefined): string => {
        const description = photo?.description || '未產生描述';
        // Apply PhotoCellStyle and PhotoDescriptionStyle classes for MSO styling.
        return `<td width="349" valign="top" class="PhotoCellStyle" style='width:9.23cm; border:solid #e0e0e0 .75pt; padding:10.0pt; background:#f8f9fa;'>
                   <p class="PhotoDescriptionStyle" align="center">${description}</p>
                 </td>`;
    };

    // Helper function to generate a table cell for an image for PDF/Print export (standard HTML/CSS)
    const generateImageCellPrint = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
            // Use standard HTML/CSS with inline styles for fixed height and auto width.
            content = `<img src="${photo.dataUrl}" alt="${altText}" style="display: block; margin: 0 auto 8pt auto; height: 5cm; width: auto; max-width: 100%; object-fit: contain; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">`;
        } else {
            content = `<p style="text-align: center;">[${altText} 無法載入]</p>`;
        }
        // Use standard td with class for CSS styling.
        return `<td class="photo-table-cell">${content}</td>`;
    };

     // Helper function to generate a table cell for a description for PDF/Print export (standard HTML/CSS)
     const generateDescriptionCellPrint = (photo: Photo | undefined): string => {
        const description = photo?.description || '未產生描述';
        // Use standard p with class for CSS styling.
        return `<td class="photo-table-cell"><p class="photo-description">${description}</p></td>`;
    };


  const generateReportContent = useCallback(async (forPrint = false): Promise<string> => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    // Ensure photos have data URLs before proceeding
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
                    return { ...photo, dataUrl: '' }; // Mark as failed
                }
            }
            return photo;
        })
    );

    // Check if any photo failed to load dataUrl
     if (photosWithDataUrls.some(p => !p.dataUrl)) {
        throw new Error("無法讀取所有照片資料以進行匯出。");
     }


    // Format summary: Replace Markdown bold/italic with HTML tags, and newlines with <br>
    let formattedSummary = summary || '尚未產生摘要';
    formattedSummary = formattedSummary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
      .replace(/\*(.*?)\*/g, '<em>$1</em>');             // Italic
    formattedSummary = formattedSummary.replace(/\n/g, '<br>');         // Newlines

    // Define CSS styles for the report (consistent for both DOC and PDF generation)
    let styles = `
      body {
        font-family: '標楷體', 'BiauKai', 'Times New Roman', serif;
        line-height: 1.6;
        color: #333333;
        font-size: 12pt;
        margin: 1.27cm; /* Narrow Margin for A4 */
        background-color: #ffffff;
      }
      .report-container {
        max-width: 18.46cm; /* Approx width within narrow margins */
        margin: 0 auto;
        background-color: #ffffff;
        padding: ${forPrint ? '0' : '1.5cm'}; /* No padding for actual print */
        border-radius: ${forPrint ? '0' : '8px'};
        box-shadow: ${forPrint ? 'none' : '0 4px 12px rgba(0,0,0,0.1)'};
      }
      h1 {
        color: #003f5c;
        text-align: left; /* Force left alignment */
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
        text-align: left; /* Force left alignment */
        page-break-after: avoid;
      }
      p {
        margin-bottom: 10pt;
        font-size: 12pt;
        text-align: left; /* Force left alignment */
      }
      strong { font-weight: bold; color: #000000; } /* Black bold for emphasis */
      em { font-style: italic; color: #333333; } /* Dark gray italic */
      .section { margin-bottom: 30pt; page-break-inside: avoid; }
      
      .info-section {
        background-color: #f8f9fa; /* Light background */
        padding: 15pt;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
        margin-top: 15pt; /* Space above the section */
      }
      .info-section h2, .info-section .MsoHeading2 { /* Targeting MSO class too for consistency */
        margin-top: 0 !important; 
        padding-top: 0 !important;
        border-bottom: 1px solid #ced4da; 
        margin-bottom: 15pt !important; /* Ensure consistent bottom margin */
        color: #0056b3; /* Consistent with other h2 */
        font-size: 16pt !important; /* Ensure consistent font size */
        font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important;
      }
      .info-section p {
        margin-bottom: 8pt;
        line-height: 1.5;
        text-align: left;
        font-size: 12pt; 
        font-family: '標楷體', 'BiauKai', serif;
      }
      .info-section p strong { /* Styles for the label part "教學領域：" */
         display: inline-block; /* Allows min-width to work */
         min-width: 110px; /* Adjust as needed for alignment */
         font-weight: bold;
         color: #212529; /* Darker label color */
         margin-right: 10px;
         font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif; /* Different font for labels */
      }

      /* Photo Table Styling */
      .photo-table {
        width: 100%;
        max-width: 18.46cm;
        border-collapse: collapse;
        border-spacing: 0;
        margin: 20pt auto; /* Center table */
        page-break-inside: avoid;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        overflow: hidden;
        background-color: #f8f9fa; /* Apply background to table itself */
      }
      .photo-table td, .photo-table-cell /* Add class for print */ {
        border: 1px solid #e0e0e0;
        padding: 10pt;
        text-align: center; /* Center cell content (image and text) */
        vertical-align: top;
        width: 50%; /* Ensure two equal columns */
        /* Background moved to .photo-table */
      }
      /* Style only first/last rows/cells for border radius (if not printing) */
      ${!forPrint ? `
      .photo-table tr:first-child td:first-child { border-top-left-radius: 6px; }
      .photo-table tr:first-child td:last-child { border-top-right-radius: 6px; }
      /* Apply bottom radius to cells in the *last* row (description row of last image pair) */
      .photo-table tr:nth-child(4) td:first-child { border-bottom-left-radius: 6px; }
      .photo-table tr:nth-child(4) td:last-child { border-bottom-right-radius: 6px; }
      ` : ''}

      /* Image style: Fixed height (5cm), auto width, centered */
      .photo-table img {
        display: block;
        margin: 0 auto 8pt auto; /* Center image horizontally, add space below */
        height: 5cm; /* Fixed height */
        width: auto; /* Auto width to maintain aspect ratio */
        max-width: 100%; /* Prevent overflow */
        object-fit: contain; /* Ensure image fits within bounds without distortion */
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }
      .photo-description {
        font-size: 10pt;
        color: #495057;
        text-align: center; /* Center description text */
        line-height: 1.4;
        margin-top: 5pt;
        font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      }
      /* Summary Section Styling */
      .summary-section p {
        white-space: pre-wrap; /* Preserve line breaks from input */
        font-size: 12pt;
        text-align: left; /* Keep summary text left-aligned */
        line-height: 1.7;
        font-family: '標楷體', 'BiauKai', serif;
        padding: 15pt;
        background-color: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
      }
       /* Summary specific formatting */
       .summary-section strong {
         font-weight: bold;
         color: #000000; /* Black bold */
      }
       .summary-section em {
         font-style: italic;
         color: #333333; /* Dark gray italic */
      }
      .page-break { page-break-before: always; }

      /* Print-specific overrides */
      @media print {
        @page { size: A4 portrait; margin: 1.27cm; } /* Ensure A4 Portrait with narrow margins */
        body {
          background-color: #ffffff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0; /* Remove body margin for print */
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
        .section, .photo-table { page-break-inside: avoid; }
        .photo-table tr { page-break-inside: avoid; }
        strong, em { color: #000000 !important; } /* Ensure black text for print */
        p { text-align: left !important; }
        .photo-table, .photo-table td, .photo-table-cell { border-color: #cccccc !important; background-color: #ffffff !important; border-radius: 0 !important;}
        .photo-table img { box-shadow: none !important; border-radius: 0 !important;}
        .photo-description { color: #333333 !important; text-align: center !important; }
        
        .info-section {
          background-color: #ffffff !important;
          border: 1px solid #cccccc !important; /* Ensure border for print */
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
           font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif !important; /* Ensure label font for print */
        }
         .info-section p {
            font-family: '標楷體', 'BiauKai', serif !important; /* Ensure value font for print */
         }

        .summary-section p { background-color: #ffffff !important; border-color: #cccccc !important; border-radius: 0 !important; text-align: left !important; }
      }
    `;

    // MSO (Microsoft Office) specific styles for Word compatibility
    // These styles attempt to mimic the CSS styles for Word's rendering engine.
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
            {/* Common Latent Styles */}
         </w:LatentStyles>
        </xml><![endif]-->
         <!--[if gte mso 10]>
        <style>
         /* Style Definitions */
         table.MsoNormalTable {mso-style-name:"Table Normal"; mso-tstyle-rowband-size:0; mso-tstyle-colband-size:0; mso-style-noshow:yes; mso-style-priority:99; mso-style-parent:""; mso-padding-alt:0cm 5.4pt 0cm 5.4pt; mso-para-margin:0cm; mso-para-margin-bottom:.0001pt; mso-pagination:widow-orphan; font-size:12.0pt; font-family:"Calibri",sans-serif; mso-ascii-font-family:Calibri; mso-ascii-theme-font:minor-latin; mso-hansi-font-family:Calibri; mso-hansi-theme-font:minor-latin; mso-bidi-font-family:"Times New Roman"; mso-bidi-theme-font:minor-bidi; mso-fareast-language:EN-US;}

         /* Photo Table Specific Styles for MSO */
         table.PhotoTableStyle {
             mso-style-name:"Photo Table";
             mso-tstyle-rowband-size:0; mso-tstyle-colband-size:0; mso-style-priority:99; mso-style-unhide:no;
             mso-table-anchor-vertical:paragraph; mso-table-anchor-horizontal:margin; /* Anchor to margin */
             mso-table-left:center; /* Center align table relative to margins */
             mso-table-right:center;
             mso-table-bspace:0cm; mso-table-vspace:0cm;
             mso-table-top:20pt; mso-table-bottom:auto;
             mso-table-lspace:0cm; mso-table-rspace:0cm;
             mso-table-layout-alt:fixed; /* Use fixed layout for better control */
             mso-border-alt:solid #e0e0e0 .75pt; /* Match CSS border */
             mso-padding-alt:0cm 0cm 0cm 0cm;
             mso-border-insideh:.75pt solid #e0e0e0;
             mso-border-insidev:.75pt solid #e0e0e0;
             mso-para-margin:0cm; mso-para-margin-bottom:.0001pt;
             mso-pagination:widow-orphan;
             font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
             background:#F8F9FA; mso-shading:white; mso-pattern:auto none;
         }
         /* Photo Cell Style */
         td.PhotoCellStyle {
             mso-style-name:"Photo Cell"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"Photo Table";
             width: 9.23cm; /* Approximately half of 18.46cm */
             mso-border-alt:solid #e0e0e0 .75pt;
             padding:10.0pt 10.0pt 10.0pt 10.0pt; /* Match CSS padding */
             vertical-align:top;
             background:#F8F9FA;
             text-align:center; /* Center align cell content */
             mso-element:para-border-div;
         }
         /* Photo Description Paragraph Style */
         p.PhotoDescriptionStyle, li.PhotoDescriptionStyle, div.PhotoDescriptionStyle {
            mso-style-name:"Photo Description"; mso-style-priority:99; mso-style-unhide:no; mso-style-parent:"";
            margin-top:5.0pt; margin-right:0cm; margin-bottom:0cm; margin-left:0cm;
            mso-para-margin-top:.5gd; mso-para-margin-right:0cm; mso-para-margin-bottom:0cm; mso-para-margin-left:0cm;
            text-align:center; /* Center align text */
            line-height:140%; mso-pagination:widow-orphan;
            font-size:10.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#495057; /* Match CSS color */
         }
         /* Heading Styles */
         p.MsoHeading1, li.MsoHeading1, div.MsoHeading1 {
            mso-style-priority:9; mso-style-unhide:no; mso-style-qformat:yes; mso-style-link:"Heading 1 Char";
            mso-margin-top-alt:auto; margin-right:0cm; mso-margin-bottom-alt:25.0pt; margin-left:0cm; /* Adjusted bottom margin */
            line-height:normal; mso-pagination:widow-orphan lines-together; page-break-after:avoid; mso-outline-level:1;
            font-size:22.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#003F5C; font-weight:bold;
            border:none; mso-border-bottom-alt:solid #003F5C 2.0pt; /* Match CSS border */
            padding:0cm; mso-padding-alt:0cm 0cm 10.0pt 0cm; /* Match CSS padding */
            text-align:left; /* Force left align */
         }
         p.MsoHeading2, li.MsoHeading2, div.MsoHeading2 {
            mso-style-priority:9; mso-style-unhide:no; mso-style-qformat:yes; mso-style-link:"Heading 2 Char";
            mso-margin-top-alt:25pt; margin-right:0cm; mso-margin-bottom-alt:15pt; margin-left:0cm; /* Match CSS margins */
            line-height:normal; mso-pagination:widow-orphan lines-together; page-break-after:avoid; mso-outline-level:2;
            font-size:16.0pt; font-family:"Microsoft JhengHei",sans-serif; mso-fareast-font-family:"Microsoft JhengHei";
            color:#0056B3; font-weight:bold;
            border:none; mso-border-bottom-alt:solid #DEE2E6 1.0pt; /* Match CSS border */
            padding:0cm; mso-padding-alt:0cm 0cm 6.0pt 0cm; /* Match CSS padding */
            text-align:left; /* Force left align */
         }
         /* Normal Paragraph Style (for general text, including info items) */
         p.MsoNormal, li.MsoNormal, div.MsoNormal {
            mso-style-unhide:no; mso-style-qformat:yes; mso-style-parent:"";
            margin-top:0cm; margin-right:0cm; margin-bottom:8.0pt; margin-left:0cm; /* Match .info-section p CSS margin */
            line-height:150%; mso-pagination:widow-orphan;
            font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
            color:#333333;
            text-align:left; /* Force left align */
            mso-line-height-rule:exactly; /* Control line height precisely */
         }
         /* MSO specific style for info section strong (label) */
         span.InfoLabelStyle {
            mso-style-name:"Info Label"; mso-style-priority:99; mso-style-unhide:no;
            font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei";
            font-weight:bold; color:#212529;
            mso-ansi-font-size:12.0pt; mso-bidi-font-size:12.0pt; /* Ensure size matches surrounding text */
         }
         /* MSO specific for the info section paragraphs that might be wrapped in a div or other block */
         div.InfoSectionBlock p.MsoNormal, li.InfoSectionBlock p.MsoNormal, div.InfoSectionBlock p.MsoNormal {
             mso-margin-top-alt:0cm; mso-margin-bottom-alt:8.0pt; /* Consistent margin */
             /* Background and border are applied to the containing div.InfoSectionBlock */
         }

         /* Summary Paragraph Style */
         p.SummaryStyle, li.SummaryStyle, div.SummaryStyle {
             mso-style-name:"Summary Text"; mso-style-priority:99; mso-style-unhide:no;
             margin:0cm; margin-bottom:.0001pt; /* Minimal bottom margin */
             text-align:left; /* Force left align */
             line-height:170%; mso-pagination:widow-orphan;
             mso-padding-alt:15.0pt 15.0pt 15.0pt 15.0pt; /* Match CSS padding */
             mso-border-alt:solid #E0E0E0 .75pt; /* Match CSS border */
             font-size:12.0pt; font-family:"標楷體",serif; mso-fareast-font-family:"標楷體"; mso-bidi-font-family:"Times New Roman";
             background:#F8F9FA;
             mso-line-height-rule:exactly;
         }
          /* Character Styles */
         span.Heading1Char {mso-style-name:"Heading 1 Char"; mso-style-priority:9; mso-style-unhide:no; mso-style-locked:yes; mso-style-link:"Heading 1"; font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; color:#003F5C; font-weight:bold;}
         span.Heading2Char {mso-style-name:"Heading 2 Char"; mso-style-priority:9; mso-style-unhide:no; mso-style-locked:yes; mso-style-link:"Heading 2"; font-family:"Microsoft JhengHei",sans-serif; mso-ascii-font-family:"Microsoft JhengHei"; mso-fareast-font-family:"Microsoft JhengHei"; mso-hansi-font-family:"Microsoft JhengHei"; color:#0056B3; font-weight:bold;}
         /* Bold/Italic Styles within normal text */
         strong {mso-style-name:""; font-weight:bold; color: #000000;} /* Black bold */
         em {mso-style-name:""; font-style:italic; color: #333333;} /* Dark gray italic */
         /* Bold/Italic Styles specific to Summary */
         .SummaryStyle strong {mso-style-name:""; font-weight:bold; color: #000000;}
         .SummaryStyle em {mso-style-name:""; font-style:italic; color: #333333;}
        </style>
        <![endif]-->
    `;

    // Start constructing the HTML content
    // Use teachingArea and meetingDate to generate a dynamic title for PDF if forPrint is true
    const reportTitle = forPrint
      ? `領域共備GO_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}`
      : '領域共備GO 會議報告';

    const htmlStart = `
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
          /* Embed base CSS */
          ${styles}

          /* Page Setup for Word (only if not for print) */
          ${!forPrint ? `
          @page Section1 {
            size: 21cm 29.7cm; /* A4 Portrait */
            margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margins: 0.5 inch */
            mso-header-margin: .5in;
            mso-footer-margin: .5in;
            mso-paper-source: 0;
          }
          div.Section1 { page: Section1; }

          /* MSO Specific Overrides - Force left alignment and info section specific styling */
          <!--[if gte mso 9]>
           p.MsoNormal, li.MsoNormal, div.MsoNormal,
           p.MsoHeading1, li.MsoHeading1, div.MsoHeading1,
           p.MsoHeading2, li.MsoHeading2, div.MsoHeading2,
           p.SummaryStyle, li.SummaryStyle, div.SummaryStyle {
              text-align: left !important;
              mso-text-align-alt: left !important; /* Ensure left align */
           }
           p.PhotoDescriptionStyle, li.PhotoDescriptionStyle, div.PhotoDescriptionStyle {
              text-align: center !important; /* Keep description centered */
           }
           /* Center content within table cells */
           td.PhotoCellStyle {
               text-align: center !important;
               vertical-align: top !important; /* Align content top */
           }
           /* Paragraphs containing images need centering for MSO */
           td.PhotoCellStyle p.MsoNormal {
              text-align: center !important;
              margin-bottom: 8pt !important; /* Match CSS margin below image */
           }
           /* Specific MSO styling for info section background/border */
           div.InfoSectionBlock {
               mso-border-alt:solid #e0e0e0 .75pt; /* Match CSS border */
               mso-padding-alt:15.0pt 15.0pt 15.0pt 15.0pt; /* Match CSS padding */
               background:#F8F9FA;
               mso-shading:#F8F9FA; /* MSO background color */
               mso-margin-top-alt:15pt; /* Space above the section */
               margin-bottom:30pt; /* Consistent with .section */
           }
           /* Make sure H2 inside InfoSectionBlock has correct MSO class and spacing */
           div.InfoSectionBlock p.MsoHeading2 {
               mso-margin-top-alt:0cm !important; /* Remove top margin for H2 in this block */
               mso-margin-bottom-alt:15pt !important;
               border:none;
               mso-border-bottom-alt:solid #ced4da 1.0pt !important; /* Bottom border */
               mso-padding-bottom-alt:6pt !important;
           }
           /* Ensure info items within the block use MsoNormal with appropriate spacing */
           div.InfoSectionBlock p.MsoNormal {
               margin-bottom:8.0pt !important;
               line-height:150% !important;
               font-family:"標楷體",serif !important;
               mso-fareast-font-family:"標楷體" !important;
           }
           /* MSO specific: Need to ensure min-width for label is somewhat respected or use fixed width.
              Since MSO doesn't directly support min-width on inline-block for spans,
              we can simulate it by using a small table for each info item or manually space.
              For simplicity here, we'll rely on the span styling and hope Word renders it reasonably.
              A more robust solution for MSO would be a 2-column table for the info section.
           */
           div.InfoSectionBlock p.MsoNormal span.InfoLabelStyle {
              /* Min-width is tricky, Word might ignore it. Consider a table or fixed spaces if crucial. */
              mso-spacerun:yes; /* Helps with spacing for some Word versions */
              margin-right:7.5pt; /* Approx 10px */
           }

          <![endif]-->
          ` : ''}
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;background-color:#ffffff;'>
      <div class='${!forPrint ? 'Section1' : ''}'> <!-- Use Section1 for Word page settings only for DOC export -->
        <div class='report-container'> <!-- Container for structure -->
    `;

    let reportHtmlContent = htmlStart;

    // Main title - Use H1 for print/PDF, MsoHeading1 for DOC
    reportHtmlContent += `<${forPrint ? 'h1' : 'p class="MsoHeading1"'}>領域共備GO 會議報告</${forPrint ? 'h1' : 'p'}>`;

    // Basic Info Section - Use H2 and P for print/PDF, MsoHeading2 and MsoNormal for DOC
    // Wrap in InfoSectionBlock for MSO-specific background/border if not for print
    reportHtmlContent += `
        <div class="section info-section ${!forPrint ? 'InfoSectionBlock' : ''}">
          <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>基本資訊</${forPrint ? 'h2' : 'p'}>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'style="mso-style-name: InfoLabelStyle;"' : ''}>教學領域：</strong> ${teachingArea}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'style="mso-style-name: InfoLabelStyle;"' : ''}>會議主題：</strong> ${meetingTopic}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'style="mso-style-name: InfoLabelStyle;"' : ''}>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p ${!forPrint ? 'class="MsoNormal"' : ''}><strong ${!forPrint ? 'style="mso-style-name: InfoLabelStyle;"' : ''}>社群成員：</strong> ${communityMembers}</p>
        </div>
    `;

    // Photo Record Section - Use H2 for print/PDF, MsoHeading2 for DOC
    reportHtmlContent += `
        <div class="section photo-section">
           <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>照片記錄</${forPrint ? 'h2' : 'p'}>`;

    // Conditionally render table start based on export type
    if (!forPrint) { // DOC export with MSO styles
        reportHtmlContent += `
           <!--[if gte mso 9]>
            <table class="PhotoTableStyle" border="1" cellspacing="0" cellpadding="0" width="699" align="center" style='width:18.46cm; mso-cellspacing:0cm; border:solid #e0e0e0 .75pt; mso-border-alt:solid #e0e0e0 .75pt; mso-table-anchor-vertical:paragraph; mso-table-anchor-horizontal:margin; mso-table-left:center; mso-table-right:center; mso-table-layout-alt:fixed;'>
           <![endif]-->
           <!--[if !mso]>
            <table class="photo-table" align="center">
           <![endif]-->
             <tbody style="mso-yfti-irow:0; mso-yfti-firstrow:yes;">
        `;
    } else { // PDF/Print export with standard HTML/CSS
        reportHtmlContent += `<table class="photo-table"><tbody>`;
    }


    // Build the table rows: 2 columns, 4 rows total (Image, Desc, Image, Desc)
    // Use the appropriate cell generation function based on forPrint flag
    const generateImageCell = forPrint ? generateImageCellPrint : generateImageCellMSO;
    const generateDescriptionCell = forPrint ? generateDescriptionCellPrint : generateDescriptionCellMSO;

    // Row 1: Images 1 & 2
    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:0; mso-yfti-firstrow:yes;'" : ""}>`;
    reportHtmlContent += generateImageCell(photosWithDataUrls[0], '照片 1');
    reportHtmlContent += generateImageCell(photosWithDataUrls[1], '照片 2');
    reportHtmlContent += `</tr>`;

    // Row 2: Descriptions for 1 & 2
    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:1;'" : ""}>`;
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[0]);
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[1]);
    reportHtmlContent += `</tr>`;

    // Row 3: Images 3 & 4
    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:2;'" : ""}>`;
    reportHtmlContent += generateImageCell(photosWithDataUrls[2], '照片 3');
    reportHtmlContent += generateImageCell(photosWithDataUrls[3], '照片 4');
    reportHtmlContent += `</tr>`;

    // Row 4: Descriptions for 3 & 4
    reportHtmlContent += `<tr ${!forPrint ? "style='mso-yfti-irow:3; mso-yfti-lastrow:yes;'" : ""}>`;
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[2]);
    reportHtmlContent += generateDescriptionCell(photosWithDataUrls[3]);
    reportHtmlContent += `</tr>`;

    // Close table
    reportHtmlContent += `
            </tbody>
          </table>
        </div>
    `;

    // Summary Section - Use H2/P for print/PDF, MsoHeading2/SummaryStyle for DOC
    reportHtmlContent += `
        <div class="section summary-section">
           <${forPrint ? 'h2' : 'p class="MsoHeading2"'}>會議大綱摘要</${forPrint ? 'h2' : 'p'}>
           <p class="${forPrint ? '' : 'SummaryStyle'}">${formattedSummary}</p> <!-- Apply SummaryStyle class only for DOC -->
        </div>

        </div> <!-- End report-container -->
      </div> <!-- End Section1 (or div for print) -->
      </body>
      </html>
    `;

    // Log the final HTML for debugging if needed
    // console.log("Generated Report HTML:", reportHtmlContent);

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
     if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
        toast({
            title: '無法匯出',
            description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
            variant: 'destructive',
        });
        return;
    }
     // Ensure all photos have dataUrls before exporting
     if (photos.some(p => !p.dataUrl)) {
        toast({
            title: '圖片處理中',
            description: '圖片資料尚未完全載入，請稍候幾秒鐘再試。',
            variant: 'default', // Informational, not an error yet
        });
         // Optionally trigger a re-read here if necessary, or rely on generateReportContent's internal check
        return;
    }

    setIsExportingDoc(true);
    try {
        // Generate content specifically for DOC (forPrint=false enables MSO styles)
        const reportContent = await generateReportContent(false);

        // Create Blob with UTF-8 BOM for better Word compatibility
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
        if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
            toast({
                title: '無法匯出 PDF',
                description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
                variant: 'destructive',
            });
            return;
        }
        // Ensure all photos have dataUrls before exporting
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
            // Generate content specifically for PDF/Print (forPrint=true uses print styles)
            const reportContent = await generateReportContent(true);
            const { teachingArea, meetingDate } = form.getValues();
            const pdfFileName = `領域共備GO_${teachingArea}_${format(meetingDate, 'yyyyMMdd')}.pdf`;


            if (printIframeRef.current) {
                const iframe = printIframeRef.current;
                iframe.srcdoc = reportContent; // Load the generated HTML into the iframe

                // Wait for the iframe to load the content
                iframe.onload = () => {
                  // Add a small delay to ensure rendering is complete before printing
                  setTimeout(() => {
                    try {
                        // Set the document title which some browsers use as default filename
                        if (iframe.contentWindow?.document) {
                             iframe.contentWindow.document.title = pdfFileName;
                        }
                        // Trigger the browser's print dialog
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
                       // Clean up and reset state regardless of print success/failure
                       setIsPreparingPdf(false);
                       iframe.onload = null; // Prevent potential multiple calls
                    }
                  }, 500); // 500ms delay, adjust if needed
                };
                 // Handle potential errors during iframe content loading
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


   // Effect to watch form changes and reset dependent states
   useEffect(() => {
      const subscription = form.watch((value, { name, type }) => {
         // If any form field changes, reset descriptions, summary, and progress
         if (type === 'change' && name !== undefined) {
             // Clear descriptions and stop generation state for all photos
            setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: false })));
            setSummary('');
            setDescriptionProgress(null);
            setIsGeneratingAllDescriptions(false);
         }
      });
      // Clean up the subscription on component unmount
      return () => subscription.unsubscribe();
   }, [form]); // Dependency array includes the form object itself


  // Determine if export buttons should be disabled
  const isExportDisabled =
    isExportingDoc || // Disable if exporting DOC
    isPreparingPdf || // Disable if preparing PDF
    !summary || // Disable if no summary generated
    photos.length !== MAX_PHOTOS || // Disable if not exactly MAX_PHOTOS are uploaded
    photos.some(p => !p.description || p.description.startsWith('無法描述') || !p.dataUrl); // Disable if any photo lacks a valid description or dataUrl

  // Determine if "Generate Descriptions" button should be disabled
  const isGenerateDescriptionsDisabled =
      isGeneratingAllDescriptions || // Disable if already generating all
      photos.length === 0 || // Disable if no photos uploaded
      photos.some(p => p.isGenerating); // Disable if any single photo is currently generating (unlikely with current logic but safe check)


  return (
    <TooltipProvider> {/* Required for Tooltip components */}
      {/* Hidden iframe used for triggering the print dialog for PDF export */}
      <iframe
          ref={printIframeRef}
          style={{
              position: 'absolute',
              width: '0',
              height: '0',
              border: '0',
              visibility: 'hidden', // Hide the iframe visually
          }}
          title="Print Content Frame" // Accessibility title
      ></iframe>

      <div className="container mx-auto p-4 md:p-8 lg:p-12 bg-transparent min-h-screen"> {/* Main container */}
        {/* Header Section */}
        <header className="mb-10 md:mb-12 text-center relative group">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-400 to-purple-400 py-4 rounded-lg transition-all duration-300 group-hover:scale-105 drop-shadow-lg">
            領域共備GO {/* Updated Title */}
          </h1>
          <p className="text-slate-300 text-base sm:text-lg mt-2 transition-opacity duration-300 opacity-90 group-hover:opacity-100 text-shadow">國小教師社群領域會議報告協作產出平台</p>
        </header>

        {/* Main Form */}
        <Form {...form}>
          <form className="space-y-10"> {/* Add spacing between cards */}
            {/* Step 1: Meeting Info Card */}
            <Card className="card-step-1 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-1 p-6"> {/* Step-specific styling */}
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                     <Info className="w-7 h-7 card-icon-step-1" /> {/* Step-specific icon */}
                     第一步：輸入會議資訊
                  </CardTitle>
                  <CardDescription className="text-slate-300">請填寫本次社群會議的基本資料</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                {/* Grid layout for form fields */}
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
                        <FormMessage /> {/* Displays validation errors */}
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
                         <Popover> {/* Popover for calendar */}
                            <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                  "w-full pl-3 text-left font-normal justify-start text-base py-2.5",
                                  !field.value && "text-slate-400", // Style differently if no date selected
                                   field.value && "text-slate-100",
                                  "bg-slate-700/50 border-slate-600 hover:bg-slate-700/80" // Custom styles
                                  )}
                                >
                                {field.value ? (
                                    format(field.value, "yyyy年MM月dd日") // Format selected date
                                ) : (
                                    <span>選擇日期</span> // Placeholder text
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" /> {/* Calendar icon */}
                                </Button>
                            </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start"> {/* Calendar popover content */}
                            <Calendar
                                mode="single" // Allow selecting only one date
                                selected={field.value}
                                onSelect={field.onChange} // Update form value on select
                                disabled={(date) => // Disable future dates and dates before 1900
                                date > new Date() || date < new Date("1900-01-01")
                                }
                                initialFocus // Focus the calendar when opened
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
                          請用逗號分隔姓名。
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Upload Photos Card */}
            <Card className="card-step-2 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-2 p-6"> {/* Step-specific styling */}
                <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                    <ImageIcon className="w-7 h-7 card-icon-step-2" /> {/* Step-specific icon */}
                    第二步：上傳會議照片
                </CardTitle>
                 <CardDescription className="text-slate-300">請上傳 {MAX_PHOTOS} 張照片 (JPG, PNG, WEBP, &lt; 20MB)</CardDescription> {/* Updated size limit */}
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                 {/* File Upload Area */}
                <div className="mb-6">
                  <label
                    htmlFor="photo-upload"
                    className={cn(
                      "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 ease-in-out",
                      photos.length >= MAX_PHOTOS
                        ? "border-slate-600 bg-slate-800/30 cursor-not-allowed opacity-60" // Disabled state
                        : "border-accent hover:border-primary hover:bg-accent/20" // Active state
                    )}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <UploadCloud className={cn("w-10 h-10 mb-3", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-primary")} />
                      <p className={cn("mb-2 text-sm font-medium", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-slate-200")}>
                         點擊此處 或拖曳照片至此
                      </p>
                      <p className={cn("text-xs", photos.length >= MAX_PHOTOS ? "text-slate-500" : "text-slate-400")}>
                        還可上傳 {Math.max(0, MAX_PHOTOS - photos.length)} 張 {/* Show remaining count */}
                      </p>
                    </div>
                    {/* Hidden file input */}
                    <input
                      id="photo-upload"
                      ref={fileInputRef}
                      type="file"
                      multiple // Allow multiple file selection
                      accept={ACCEPTED_IMAGE_TYPES.join(',')} // Set accepted file types
                      className="hidden"
                      onChange={handleFileChange} // Handle file selection
                      disabled={photos.length >= MAX_PHOTOS} // Disable if max photos reached
                    />
                  </label>
                </div>

                {/* Display Uploaded Photos and Placeholders */}
                {photos.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8"> {/* Grid for photo previews */}
                      {/* Render uploaded photos */}
                      {photos.map((photo) => (
                        <div key={photo.id} className="relative border border-slate-700 rounded-lg overflow-hidden shadow-md bg-slate-800/50 flex flex-col transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
                          {/* Image Preview Container */}
                          <div className="aspect-video w-full relative flex items-center justify-center overflow-hidden">
                             <NextImage
                                src={photo.previewUrl} // Use object URL for preview
                                alt={`照片 ${photo.file.name}`}
                                fill // Fill the container
                                style={{ objectFit: 'contain' }} // Ensure image fits without cropping
                                priority // Prioritize loading visible images
                                className="transition-transform duration-300 group-hover:scale-105"
                              />
                             {/* Remove Button */}
                            <button
                              type="button"
                              onClick={() => handlePhotoRemove(photo.id)}
                              className="absolute top-2 right-2 bg-destructive/80 text-destructive-foreground rounded-full p-1.5 transition-opacity focus:opacity-100 z-10 hover:bg-destructive"
                              aria-label="移除照片"
                            >
                              <X className="h-4 w-4" />
                            </button>
                             {/* Loading Spinner */}
                             {photo.isGenerating && (
                                <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 backdrop-blur-sm rounded-t-lg">
                                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                              )}
                          </div>
                           {/* Description Section - Always Visible */}
                           <div className="p-3 bg-slate-700/80 border-t border-slate-600 min-h-[4.5em] flex items-center justify-center"> {/* Ensure minimum height */}
                             <p className="text-xs text-slate-200 text-center break-words text-shadow">
                                {photo.description || '尚未產生描述'}
                             </p>
                          </div>
                        </div>
                      ))}
                       {/* Render placeholders for remaining slots */}
                       {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }).map((_, index) => (
                          <div key={`placeholder-${index}`} className="relative border border-dashed border-slate-600 rounded-lg overflow-hidden shadow-sm aspect-video flex items-center justify-center bg-slate-800/30 text-slate-500 text-sm">
                             照片 {photos.length + index + 1}
                          </div>
                      ))}
                    </div>
                     {/* Generate Descriptions Button and Progress Bar */}
                     <div className="flex flex-col items-center gap-4">
                        <Button
                            type="button"
                            onClick={handleGenerateDescriptions}
                            disabled={isGenerateDescriptionsDisabled} // Control button state
                            className="w-full md:w-auto min-w-[180px] transition-transform duration-200 hover:scale-105" // Button styles
                            variant="secondary"
                            size="lg"
                        >
                            {isGeneratingAllDescriptions ? ( // Show loading state
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                描述產生中...
                            </>
                            ) : ( // Show appropriate text based on state
                                photos.length > 0 && photos.some(p => p.description && !p.description.startsWith('無法描述')) ? '重新產生描述' : '產生照片描述'
                            )}
                        </Button>
                        {/* Progress Bar - Visible when generating descriptions */}
                        {descriptionProgress !== null && (
                            <div className="w-full max-w-md"> {/* Constrain width */}
                                <Progress value={descriptionProgress} className="w-full h-2.5 bg-slate-700" /> {/* Progress bar component */}
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

            {/* Step 3: Generate Summary Card */}
            <Card className="card-step-3 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-3 p-6"> {/* Step-specific styling */}
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                    <FileText className="w-7 h-7 card-icon-step-3" /> {/* Step-specific icon */}
                    第三步：產生會議摘要
                  </CardTitle>
                  <CardDescription className="text-slate-300">整合會議資訊與照片描述，自動產生摘要</CardDescription>
              </CardHeader>
              <CardContent className="p-6 md:p-8 space-y-6">
                 {/* Generate Summary Button */}
                 <Button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={ // Control button state
                        isGeneratingSummary ||
                        photos.length !== MAX_PHOTOS ||
                        photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述'))
                    }
                    className="w-full md:w-auto min-w-[180px] transition-transform duration-200 hover:scale-105" // Button styles
                    variant="secondary"
                    size="lg"
                  >
                    {isGeneratingSummary ? ( // Loading state
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        摘要產生中...
                      </>
                    ) : ( // Default text
                      '產生會議摘要'
                    )}
                  </Button>
                 {/* Display Generated Summary */}
                 {summary && (
                  <div className="mt-4 p-4 md:p-6 border border-slate-600 rounded-lg bg-slate-800/30 shadow-inner">
                    <h3 className="text-xl font-semibold mb-3 text-slate-200">會議摘要：</h3>
                    {/* Use Textarea for display, allows easy copying */}
                    <Textarea
                       value={summary}
                       readOnly // Make it non-editable
                       className="w-full h-56 bg-slate-700/50 border-slate-600 text-base resize-y focus:border-primary transition-colors text-slate-100" // Styling
                       aria-label="會議摘要內容"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

             {/* Step 4: Export Report Card */}
             <Card className="card-step-4 shadow-lg rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-slate-800/70 backdrop-blur-sm">
               <CardHeader className="card-header-step-4 p-6"> {/* Step-specific styling */}
                  <CardTitle className="text-2xl font-semibold text-slate-100 flex items-center gap-3">
                     <Download className="w-7 h-7 card-icon-step-4" /> {/* Step-specific icon */}
                    第四步：匯出報告
                  </CardTitle>
                   <CardDescription className="text-slate-300">
                     點擊下方按鈕匯出 Word (.doc) 或 PDF 格式報告。
                   </CardDescription>
               </CardHeader>
               <CardContent className="p-6 md:p-8 flex flex-col sm:flex-row flex-wrap gap-4"> {/* Button container */}
                   {/* Export DOC Button */}
                   <Button
                      type="button"
                      onClick={handleExportReport}
                      disabled={isExportDisabled} // Control button state
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105 shadow-md hover:shadow-lg" // Button styles
                    >
                      {isExportingDoc ? ( // Loading state
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            匯出 DOC 中...
                          </>
                        ) : ( // Default text
                         '匯出會議報告 (.doc)'
                        )
                      }
                   </Button>
                    {/* Export PDF Button */}
                    <Button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={isExportDisabled} // Control button state
                      className="w-full sm:flex-1 sm:min-w-[200px] bg-secondary text-secondary-foreground hover:bg-secondary/80 text-lg py-3 px-6 transition-transform duration-200 hover:scale-105 shadow-md hover:shadow-lg" // Button styles
                      variant="outline" // Use outline variant for visual distinction
                    >
                      {isPreparingPdf ? ( // Loading state
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            準備 PDF 中...
                          </>
                        ) : ( // Default text with icon
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
       <Toaster /> {/* Renders toast notifications */}
      </TooltipProvider> // Close TooltipProvider
    );
}

