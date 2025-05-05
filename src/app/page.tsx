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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { generatePhotoDescriptions, type GeneratePhotoDescriptionsOutput } from '@/ai/flows/generate-photo-descriptions';
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

// Define a type for the result of individual description generation
type DescriptionResult = {
    id: string;
    description: string;
    success: boolean;
};


export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isExportingDoc, setIsExportingDoc] = useState(false); // Specific state for DOC export
  const [isPreparingPdf, setIsPreparingPdf] = useState(false); // Specific state for PDF preparation
  const [descriptionProgress, setDescriptionProgress] = useState<number | null>(null); // State for progress bar
  const [isGeneratingAllDescriptions, setIsGeneratingAllDescriptions] = useState(false); // State for overall description generation status
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printIframeRef = useRef<HTMLIFrameElement>(null); // Ref for the print iframe
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
      // Use the correct method name: readAsDataURL
       if (typeof reader.readAsDataURL === 'function') {
          reader.readAsDataURL(file);
       } else {
           console.error("readAsDataURL method not found on FileReader instance:", reader);
           reject(new Error('FileReader.readAsDataURL method not found'));
       }
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
                    description: `讀取檔案 ${file.name} 時發生錯誤: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
              // Clear descriptions and progress if new photos are added
              setSummary('');
              setDescriptionProgress(null);
              setIsGeneratingAllDescriptions(false);
              return combined.slice(0, MAX_PHOTOS).map(p => ({ ...p, description: '', isGenerating: false })); // Reset descriptions for all photos
          });
       }

      // Reset file input to allow uploading the same file again if needed
      if (event.target) {
        event.target.value = '';
      }
    },
    [photos, toast] // Updated dependency array
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos((prevPhotos) => {
      const photoToRemove = prevPhotos.find(p => p.id === id);
      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.previewUrl);
      }
       const remainingPhotos = prevPhotos.filter((photo) => photo.id !== id);
       // If removing a photo, reset descriptions and progress
       if (remainingPhotos.length < prevPhotos.length) {
         setSummary('');
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
         // Reset descriptions only if generating was in progress or completed
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
    if (isGeneratingAllDescriptions) return; // Prevent multiple overall calls

    // Check if all photos already have successful descriptions or if generation failed previously
    const needsGeneration = photos.length > 0 && photos.some(p => !p.description || p.description.startsWith('無法描述'));

    // If all descriptions exist and were successful, confirm regeneration
    if (!needsGeneration && photos.length > 0) {
        // Optional: Add confirmation step here if needed
        // console.log("Descriptions already exist. Re-generating...");
    }

    // Reset descriptions for ALL photos and set generating state
    setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: true })));
    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0); // Start progress
    let completedCount = 0;
    // Use photos.length for total count as we are resetting all
    const totalToProcess = photos.length;

    try {
        // Map ALL photos to promises that resolve with DescriptionResult
        const descriptionPromises = photos.map(async (photo): Promise<DescriptionResult> => {
           let descriptionResult: DescriptionResult | undefined = undefined; // Initialize to undefined
            try {
                const photoDataUri = photo.dataUrl ?? await readFileAsDataURL(photo.file);
                if (!photo.dataUrl) {
                    // Update state immutably if dataUrl was missing
                     setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, dataUrl: photoDataUri } : p));
                }

                 const result: GeneratePhotoDescriptionsOutput = await generatePhotoDescriptions({
                    teachingArea,
                    meetingTopic,
                    meetingDate: format(meetingDate, 'yyyy-MM-dd'),
                    communityMembers,
                    photoDataUri,
                });
                 // Ensure description is not null/undefined and doesn't start with failure message
                 const success = !!result.photoDescription && !result.photoDescription.startsWith('無法描述');
                 descriptionResult = { id: photo.id, description: result.photoDescription || '描述失敗', success: success };
            } catch (error) {
                console.error(`Error generating description for ${photo.file.name}:`, error);
                const errorDescription = error instanceof Error ? error.message : '產生描述時發生未知錯誤。';
                // Specific handling for safety issues from the API response
                const finalDescription = (errorDescription.includes("safety") || errorDescription.includes("SAFETY"))
                    ? '無法描述此圖片（安全限制）。'
                    : '無法描述此圖片。';
                 descriptionResult = { id: photo.id, description: finalDescription, success: false };
            } finally {
               // Update state and progress after each description finishes
                completedCount++;
                const newProgress = Math.round((completedCount / totalToProcess) * 100);
                 setDescriptionProgress(newProgress);

                 // Update the specific photo's state - ensure descriptionResult is defined before accessing it
                 if (descriptionResult) {
                     setPhotos(prev => prev.map(p => p.id === descriptionResult!.id ? { ...p, description: descriptionResult!.description, isGenerating: false } : p));
                 } else {
                     // Handle the case where descriptionResult might still be undefined (though unlikely with the try/catch/finally structure)
                     setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: '更新錯誤', isGenerating: false } : p));
                 }
            }
            // Ensure a valid DescriptionResult is always returned
            return descriptionResult || { id: photo.id, description: '未處理', success: false };
        });

        // Wait for all promises to settle and get their results
        const results = await Promise.allSettled(descriptionPromises);

       // Check the results directly from the settled promises
        let allSucceeded = true;
        let failedCount = 0;
        results.forEach(result => {
            // Check if the promise was rejected OR if it fulfilled but the generation was not successful
            if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
                allSucceeded = false;
                failedCount++;
            }
        });


        if (allSucceeded && failedCount === 0 && photos.length > 0) { // Only show success if all succeeded AND there were photos
          toast({
            title: '成功',
            description: '照片描述產生完成！',
          });
        } else if (failedCount > 0) { // Show partial if any failed
           toast({
            title: '部分完成',
            description: `${failedCount} 張照片描述產生失敗，請檢查標示為「無法描述」的圖片。`,
            variant: 'destructive', // Keep as destructive for clarity
           });
        }
       setSummary(''); // Clear summary as descriptions changed

    } catch (error) { // Catch any unexpected overarching errors
      console.error('Error in generating descriptions batch:', error);
       toast({
         title: '錯誤',
         description: '產生照片描述過程中發生嚴重錯誤。',
         variant: 'destructive',
       });
       // Reset generating state for all initially processed photos on overall error
       setPhotos(prev => prev.map(p => photos.some(ptp => ptp.id === p.id) ? { ...p, isGenerating: false, description: '產生失敗' } : p));
    } finally {
      // Ensure progress is 100% and generating state is false after completion/error
      setDescriptionProgress(100);
       // Delay hiding progress slightly to show 100%
       setTimeout(() => {
         setDescriptionProgress(null);
         setIsGeneratingAllDescriptions(false);
       }, 1000);
    }
  }, [form, photos, toast, isGeneratingAllDescriptions]);


 const handleGenerateSummary = useCallback(async () => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.startsWith('無法描述')); // Filter out empty/failed descriptions

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
        // Only show toast if generation wasn't started or failed, not if descriptions just exist
        if (!photos.every(p => p.description && !p.description.startsWith('無法描述'))) {
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
  }, [form, photos, toast]);


  // Generates HTML content formatted for Word or Print
  const generateReportContent = useCallback(async (forPrint = false): Promise<string> => {
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    // Ensure all photos have data URLs
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
                    return { ...photo, dataUrl: '' }; // Mark as empty to skip embedding
                }
            }
            return photo;
        })
    );

    // Format summary: Handle Markdown-like syntax and newlines
    let formattedSummary = summary || '尚未產生摘要';
    // Convert **text** to <strong>text</strong> and *text* to <em>text</em>
    formattedSummary = formattedSummary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Replace newline characters with <br> tags for HTML display
    formattedSummary = formattedSummary.replace(/\n/g, '<br>');

    // Consistent CSS for both Word and Print - Using Narrow Margins (1.27cm) and modern styles
    let styles = `
      body {
        font-family: '標楷體', 'BiauKai', 'Times New Roman', serif;
        line-height: 1.6;
        color: #333333;
        font-size: 12pt;
        margin: 1.27cm; /* Narrow Margin */
        background-color: #ffffff; /* Always white for document */
      }
      .report-container {
        max-width: 18.46cm; /* A4 width - narrow margins */
        margin: 0 auto; /* Center container */
        background-color: #ffffff; /* White paper effect */
        padding: 1.5cm;
        border-radius: 5px;
        box-shadow: ${forPrint ? 'none' : '0 2px 8px rgba(0,0,0,0.1)'}; /* Shadow only for non-print */
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
      }
      p {
        margin-bottom: 10pt;
        font-size: 12pt;
        text-align: justify;
      }
      strong { font-weight: bold; color: #343a40; }
      em { font-style: italic; color: #555555; }
      .section { margin-bottom: 30pt; page-break-inside: avoid; }
      .info-section p {
        margin-bottom: 5pt;
        line-height: 1.4;
      }
      .info-section strong {
         display: inline-block;
         width: 100px;
         color: #495057;
      }
      .photo-table {
        width: 100%;
        max-width: 18.46cm;
        border-collapse: separate;
        border-spacing: 0;
        margin: 20pt auto;
        page-break-inside: avoid;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        overflow: hidden;
      }
       .photo-table tr:first-child td:first-child { border-top-left-radius: 7px; }
       .photo-table tr:first-child td:last-child { border-top-right-radius: 7px; }
       .photo-table tr:last-child td:first-child { border-bottom-left-radius: 7px; }
       .photo-table tr:last-child td:last-child { border-bottom-right-radius: 7px; }

      .photo-table td {
        border: none;
        border-bottom: 1px solid #dee2e6;
        border-right: 1px solid #dee2e6;
        padding: 10pt;
        text-align: center;
        vertical-align: top;
        width: 50%;
        background-color: #ffffff;
      }
       .photo-table td:last-child { border-right: none; }
       .photo-table tr:last-child td { border-bottom: none; }

      /* Image style: Fixed height (5cm), auto width, centered */
      .photo-table img {
        display: block;
        margin: 5pt auto;
        height: 5cm; /* FIXED HEIGHT 5cm */
        width: auto; /* AUTO WIDTH */
        max-width: 100%;
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .photo-description {
        font-size: 10pt;
        color: #6c757d;
        text-align: center;
        line-height: 1.4;
        margin-top: 8pt;
        font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      }
      .summary-section p {
        white-space: pre-wrap; /* Preserve line breaks from AI */
        font-size: 12pt;
        text-align: justify;
        line-height: 1.7;
      }
      .page-break { page-break-before: always; }

      /* Print-specific overrides */
      @media print {
        @page { size: A4 portrait; margin: 1.27cm; } /* Narrow Margin for print */
        body {
          background-color: #ffffff !important; /* Ensure white background for printing */
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .report-container {
          box-shadow: none !important; /* Remove shadow for print */
          border-radius: 0;
          padding: 0 !important; /* Remove container padding for print */
          max-width: none; /* Remove width limit for print */
          margin: 0;
        }
        h1, h2 { page-break-after: avoid; color: #000000 !important; border-color: #000000 !important; } /* Black headings for print */
        .section, .photo-table { page-break-inside: avoid; }
        .photo-table tr { page-break-inside: avoid; }
        strong { font-weight: bold !important; color: #000000 !important; } /* Ensure black for print */
        em { font-style: italic !important; color: #000000 !important; }
        .photo-table, .photo-table td { border-color: #cccccc !important; } /* Standard gray borders for print */
        .photo-description { color: #333333 !important; }
        .info-section strong { color: #000000 !important; }
      }
    `;

    // MSO styles for Word compatibility - ONLY Page Setup for narrow margins
    const msoPageSetup = `
        <!--[if gte mso 9]><xml>
         <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
          <w:TrackMoves>false</w:TrackMoves>
          <w:TrackFormatting/>
          <w:PunctuationKerning/>
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
          </m:mathPr></w:WordDocument>
         <o:DocumentProperties>
          <o:Author>領域共備GO</o:Author>
         </o:DocumentProperties>
        </xml><![endif]-->
        <!--[if gte mso 9]><xml>
         <w:LatentStyles DefLockedState="false" DefUnhideWhenUsed="true" DefSemiHidden="true" DefQFormat="false" DefPriority="99" LatentStyleCount="276">
           <w:LsdException Locked="false" Priority="0" SemiHidden="false" UnhideWhenUsed="false" QFormat="true" Name="Normal"/>
           <w:LsdException Locked="false" Priority="9" SemiHidden="false" UnhideWhenUsed="false" QFormat="true" Name="heading 1"/>
           <w:LsdException Locked="false" Priority="9" QFormat="true" Name="heading 2"/>
         </w:LatentStyles>
        </xml><![endif]-->
    `;

    // Use standard HTML structure for both Print and Word, applying MSO page setup for Word
    const htmlStart = `
      <!DOCTYPE html>
      <html lang="zh-TW" ${!forPrint ? 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40"' : ''}>
      <head>
        <meta charset="utf-8">
        <title>領域共備GO 會議報告</title>
        ${!forPrint ? `<meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15"><meta name=Originator content="Microsoft Word 15">${msoPageSetup}` : '<meta name="viewport" content="width=device-width, initial-scale=1.0">'}
        <style>
          /* Page Setup for Word */
          @page Section1 {
            size: 21cm 29.7cm; /* A4 size */
            margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margins: 0.5 inch approx */
            mso-header-margin: .5in;
            mso-footer-margin: .5in;
            mso-paper-source: 0;
          }
          div.Section1 { page: Section1; }

          /* Font Definitions for Word (subset) */
          @font-face { font-family: "標楷體"; /* ... BiauKai definition ... */ }
          @font-face { font-family: "Microsoft JhengHei"; /* ... MS JhengHei definition ... */ }
          @font-face { font-family: "Times New Roman"; /* ... Times New Roman definition ... */ }
          @font-face { font-family: Arial; /* ... Arial definition ... */ }

          /* Combined Styles */
          ${styles}
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;'>
      <div class='${!forPrint ? 'Section1 report-container' : 'report-container'}'>
    `;

    // Initialize reportHtml with the starting HTML structure
    let reportHtml = htmlStart;

    // Main title
    reportHtml += `<h1>領域共備GO 會議報告</h1>`;

    // Basic Info Section
    reportHtml += `
        <div class="section info-section">
          <h2>基本資訊</h2>
          <p><strong>教學領域：</strong> ${teachingArea}</p>
          <p><strong>會議主題：</strong> ${meetingTopic}</p>
          <p><strong>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p><strong>社群成員：</strong> ${communityMembers}</p>
        </div>
    `;

    // Photo Record Section - Use standard HTML table, styling controls layout
    reportHtml += `
        <div class="section photo-section">
          <h2>照片記錄</h2>
          <table class="photo-table" align="center">
             <tbody>
    `;

    // Helper function to generate table cell content for images
    const generateImageCell = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
             // Apply class and inline style for fixed height (5cm) and auto width
             content = `<p style="text-align:center; margin: 5pt 0;"><img class="photo-image" src="${photo.dataUrl}" alt="${altText}" style="height:5cm; width:auto; max-width:100%; display: block; margin: auto; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);"></p>`;
        } else {
             content = `<p style="text-align:center;">[${altText} 無法載入]</p>`;
        }
         return `<td>${content}</td>`;
    };

    // Helper function to generate table cell content for descriptions
    const generateDescriptionCell = (photo: Photo | undefined): string => {
      const description = photo?.description || '未產生描述';
      return `<td><p class="photo-description">${description}</p></td>`;
    }

    // Build the table content (2x4: two columns, four rows total)

     // Row 1: Images 1 & 2
    reportHtml += `<tr>`;
    reportHtml += generateImageCell(photosWithDataUrls[0], '照片 1');
    reportHtml += generateImageCell(photosWithDataUrls[1], '照片 2');
    reportHtml += `</tr>`;

    // Row 2: Descriptions 1 & 2
    reportHtml += `<tr>`;
    reportHtml += generateDescriptionCell(photosWithDataUrls[0]);
    reportHtml += generateDescriptionCell(photosWithDataUrls[1]);
    reportHtml += `</tr>`;

    // Row 3: Images 3 & 4
    reportHtml += `<tr>`;
    reportHtml += generateImageCell(photosWithDataUrls[2], '照片 3');
    reportHtml += generateImageCell(photosWithDataUrls[3], '照片 4');
    reportHtml += `</tr>`;

    // Row 4: Descriptions 3 & 4
    reportHtml += `<tr>`;
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
          <h2>會議大綱摘要</h2>
           <p>${formattedSummary}</p>
        </div>

      </div> <!-- End report-container / Section1 -->
      </body>
      </html>
    `;

    return reportHtml;
  }, [photos, summary, form, toast]); // Add dependencies


  const handleExportReport = useCallback(async () => { // Make async
     const { teachingArea, meetingDate } = form.getValues(); // Removed unused members
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
        return;
    }

    setIsExportingDoc(true); // Indicate loading state for DOC export
    try {
        const reportContent = await generateReportContent(false); // Generate content for Word
        // Use 'application/msword' for .doc compatibility and proper encoding preamble
        const blob = new Blob([`\ufeff${reportContent}`], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Change filename extension to .doc
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
        setIsExportingDoc(false); // End loading state for DOC export
    }
  }, [form, photos, summary, toast, generateReportContent]); // Added generateReportContent


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
        // Check for failed descriptions before exporting
        if (photos.some(p => !p.description || p.description.startsWith('無法描述'))) {
            toast({
                title: '無法匯出 PDF',
                description: '報告中包含無法描述或產生失敗的照片描述，請確認所有照片描述是否成功產生。',
                variant: 'destructive',
            });
            return;
        }
        // Check if all photos have dataUrls for embedding
        if (photos.some(p => !p.dataUrl)) {
            toast({
                title: '無法匯出 PDF',
                description: '部分圖片資料尚未完全載入，請稍候再試。',
                variant: 'destructive',
            });
            return;
        }

        setIsPreparingPdf(true); // Indicate loading state for PDF preparation
        try {
            const reportContent = await generateReportContent(true); // Generate content optimized for printing

            if (printIframeRef.current) {
                const iframe = printIframeRef.current;
                iframe.srcdoc = reportContent;

                // Wait for the iframe content to load before printing
                iframe.onload = () => {
                  // Slight delay to ensure rendering completes in the iframe
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
                       setIsPreparingPdf(false); // End loading state after print attempt
                       iframe.onload = null; // Clean up onload handler
                    }
                  }, 500); // Adjust delay if needed
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
            setIsPreparingPdf(false); // End loading state on error
        }
    }, [form, photos, summary, toast, generateReportContent]); // Added generateReportContent



   // Effect to clear descriptions and summary when form fields change
   useEffect(() => {
      const subscription = form.watch((value, { name, type }) => {
         // Only reset if a form value actually changes, ignore initial load/watches
         if (type === 'change' && name !== undefined) { // Ensure name is defined
           // When form changes, descriptions/summary are no longer valid for the new input
            setPhotos(prev => prev.map(p => ({ ...p, description: '', isGenerating: false })));
            setSummary('');
            setDescriptionProgress(null); // Reset progress
            setIsGeneratingAllDescriptions(false); // Reset overall generation status
         }
      });
      return () => subscription.unsubscribe();
   }, [form]);


  // Common check for export button disabling logic
  const isExportDisabled =
    isExportingDoc ||
    isPreparingPdf ||
    !summary ||
    photos.length !== MAX_PHOTOS ||
    photos.some(p => !p.description || p.description.startsWith('無法描述') || !p.dataUrl);

  // Determine if the "Generate Descriptions" button should be disabled
  const isGenerateDescriptionsDisabled =
      isGeneratingAllDescriptions || // Disable if currently generating
      photos.length === 0 || // Disable if no photos
      photos.some(p => p.isGenerating); // Disable if any photo is currently generating (individual or all)
      // Allow clicking even if descriptions exist, to regenerate


  return (
    <>
    {/* Hidden iframe for printing */}
    <iframe
        ref={printIframeRef}
        style={{
            position: 'absolute',
            width: '0',
            height: '0',
            border: '0',
            visibility: 'hidden', // Keep it out of sight and flow
        }}
        title="Print Content Frame"
    ></iframe>

    <div className="container mx-auto p-4 md:p-8 bg-background min-h-screen">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-primary-foreground bg-primary py-4 rounded-lg shadow-md">領域共備GO</h1>
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
                            fill // Use fill to cover the container
                            style={{ objectFit: 'contain' }} // Use contain to show the whole image within aspect ratio
                            priority // Prioritize loading visible images
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
                      disabled={isGenerateDescriptionsDisabled}
                      className="w-full md:w-auto"
                      variant="secondary"
                    >
                      {isGeneratingAllDescriptions ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          描述產生中... ({descriptionProgress !== null ? `${descriptionProgress}%` : ''})
                        </>
                      ) : (
                         // Change text based on whether descriptions exist
                         photos.length > 0 && photos.some(p => p.description && !p.description.startsWith('無法描述')) ? '重新產生描述' : '產生照片描述'
                      )}
                    </Button>
                    {/* Progress Bar */}
                    {descriptionProgress !== null && (
                        <div className="mt-4">
                            <Progress value={descriptionProgress} className="w-full" />
                            <p className="text-sm text-muted-foreground text-center mt-1">
                                {descriptionProgress < 100 ? `正在產生照片描述... ${descriptionProgress}%` : '描述產生完成！'}
                            </p>
                        </div>
                    )}
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
                      photos.some(p => p.isGenerating || !p.description || p.description.startsWith('無法描述')) ||
                      isGeneratingAllDescriptions // Disable if descriptions are being generated
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
                   點擊下方按鈕匯出 Word (.doc) 或 PDF 格式的報告檔案。
                 </CardDescription>
             </CardHeader>
             <CardContent className="p-6 flex flex-col sm:flex-row gap-4">
                 <Button
                    type="button"
                    onClick={handleExportReport}
                    disabled={isExportDisabled}
                    className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-3 px-6"
                  >
                    {isExportingDoc ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
                    className="w-full sm:w-auto bg-secondary text-secondary-foreground hover:bg-secondary/80 text-lg py-3 px-6"
                    variant="outline"
                  >
                    {isPreparingPdf ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
    </>
  );
}

