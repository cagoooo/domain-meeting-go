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
import { Calendar as CalendarIcon, Loader2, UploadCloud, X, Printer } from 'lucide-react'; // Added Printer icon
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress'; // Import Progress component
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
    [photos.length, toast]
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
            description: '請確保所有照片描述都已成功產生，且沒有錯誤訊息。點擊「重新產生描述」按鈕以重試。',
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

    // Base CSS for both Word and Print - Using Narrow Margins (1.27cm)
    let styles = `
      body { font-family: 'PMingLiU', '新細明體', 'Times New Roman', serif; line-height: 1.6; color: #000000; font-size: 12pt; margin: 1.27cm; } /* Narrow Margin */
      h1 { color: #000000; text-align: left; font-size: 20pt; font-weight: bold; border-bottom: 2px solid #000000; padding-bottom: 10pt; margin-bottom: 20pt;}
      h2 { color: #000000; font-size: 16pt; font-weight: bold; border-bottom: 1px solid #000000; padding-bottom: 5pt; margin-top: 20pt; margin-bottom: 15pt; }
      p { margin-bottom: 10pt; font-size: 12pt; }
      strong { font-weight: bold; }
      em { font-style: italic; }
      .section { margin-bottom: 25pt; page-break-inside: avoid; }
      /* Table Styling: Centered, max-width for A4 narrow margin */
      .photo-table { width: 100%; max-width: 18.46cm; border-collapse: collapse; margin-bottom: 15pt; page-break-inside: avoid; border: 1px solid #cccccc; margin-left: auto; margin-right: auto; }
      .photo-table td { border: 1px solid #cccccc; padding: 5pt; text-align: center; vertical-align: top; width: 50%; }
      /* Image style: Fixed height (5cm = 141.73pt approx 142pt), auto width, max-width 100% of cell, centered */
      .photo-table img { display: block; margin: 5pt auto; height: 141.73pt; /* 5cm FIXED HEIGHT */ width: auto; /* AUTO WIDTH */ max-width: 100%; object-fit: contain; }
      .photo-description { font-size: 10pt; color: #333333; text-align: center; line-height: 1.3; margin-top: 5pt; }
      .summary-section p { white-space: normal; font-size: 12pt; text-align: justify; }
    `;

    // Add print-specific styles if needed
    if (forPrint) {
        styles += `
          @media print {
            @page { size: A4 portrait; margin: 1.27cm; } /* Narrow Margin for print */
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h1, h2 { page-break-after: avoid; }
            .section, .photo-table { page-break-inside: avoid; }
            .photo-table tr { page-break-inside: avoid; }
            strong { font-weight: bold !important; }
            em { font-style: italic !important; }
          }
        `;
    }

    // MSO styles for Word compatibility (only add if not for printing) - Using Narrow Margins (1.27cm)
    const msoStyles = !forPrint ? `
        /* General Word Styles */
        @page Section1 {
          size: 21cm 29.7cm; /* A4 size */
          margin: 1.27cm 1.27cm 1.27cm 1.27cm; /* Narrow margins: 0.5 inch approx */
          mso-header-margin: .5in;
          mso-footer-margin: .5in;
          mso-paper-source: 0;
        }
        div.Section1 { page: Section1; }
        /* Paragraph Styles */
        p.MsoNormal, li.MsoNormal, div.MsoNormal { margin: 0cm; margin-bottom: .0001pt; font-size: 12.0pt; font-family: "Times New Roman", serif; mso-fareast-font-family: "新細明體";}
        h1 { mso-style-link: "標題 1 字元"; margin-top: 12.0pt; margin-right: 0cm; margin-bottom: 20pt; margin-left: 0cm; text-align: left; page-break-after: avoid; font-size: 20.0pt; font-family: "Arial", sans-serif; color: black; font-weight: bold; border: none; border-bottom: solid windowtext 2.0pt; padding: 0cm; padding-bottom: 10pt; mso-border-bottom-alt: solid windowtext 2.0pt; }
        h2 { mso-style-link: "標題 2 字元"; margin-top: 20pt; margin-right: 0cm; margin-bottom: 15pt; margin-left: 0cm; page-break-after: avoid; font-size: 16.0pt; font-family: "Arial", sans-serif; color: black; font-weight: bold; border: none; border-bottom: solid windowtext 1.0pt; padding: 0cm; padding-bottom: 5pt; mso-border-bottom-alt: solid windowtext 1.0pt; }
        p.InfoParagraph { margin-bottom: 10pt; font-size: 12.0pt; font-family: "新細明體", serif; }
        /* Table Styles - Center the table within the available width */
        table.MsoNormalTable { margin-left: auto !important; margin-right: auto !important; width: 100%; max-width: 18.46cm; /* Max width for narrow margins (21 - 1.27*2) */ border-collapse: collapse; border: solid #cccccc 1.0pt; mso-border-alt: solid #cccccc .75pt; mso-padding-alt: 5.0pt 5.0pt 5.0pt 5.0pt; mso-border-insideh: solid #cccccc .75pt; mso-border-insidev: solid #cccccc .75pt; mso-para-margin: 0cm; }
        td.MsoNormal { padding: 5.0pt; border: solid #cccccc 1.0pt; mso-border-alt: solid #cccccc .75pt; text-align: center !important; vertical-align: top; width: 50%; }
        /* Image Paragraph Style - Centers content */
        p.ImageParagraph { text-align: center; margin: 5pt 0; }
        /* Image Style - Fixed height (141.73pt ≈ 5cm), auto width */
        img.PhotoStyle { display: block; margin: auto; height: 141.73pt; /* FIXED HEIGHT 5cm */ width: auto; /* AUTO WIDTH */ max-width: 100%; mso-position-horizontal: center; }
        /* Description Style */
        p.DescriptionStyle { font-size: 10.0pt; font-family: 'PMingLiU', '新細明體', serif; text-align: center; margin: 5pt 0; line-height: 1.3; }
        /* Summary Paragraph Style */
        p.SummaryParagraph { margin-bottom: 10pt; font-size: 12.0pt; font-family: "新細明體", serif; text-align: justify; mso-line-break-override: none; }
        strong { mso-bidi-font-weight: normal; font-weight: bold; }
        em { mso-bidi-font-style: normal; font-style: italic; }
    ` : '';

     // Use Word XML structure for DOC, standard HTML for Print
    const htmlStart = !forPrint ? `
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
        <title>領域共備GO 會議報告</title>
        <!--[if gte mso 9]><xml>
         <o:DocumentProperties>
          <o:Author>領域共備GO</o:Author>
         </o:DocumentProperties>
         <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
          <w:DrawingGridVerticalSpacing>10 pt</w:DrawingGridVerticalSpacing>
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
            <w:TrackMoves>false</w:TrackMoves>
            <w:TrackFormatting/>
            <w:PunctuationKerning/>
            <w:DrawingGridHorizontalSpacing>5.25 pt</w:DrawingGridHorizontalSpacing>
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
        </xml><![endif]-->
        <style>
        <!--
         /* Font Definitions */
         @font-face
            {font-family:PMingLiU; panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:新細明體; panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:"Cambria Math"; panose-1:2 4 5 3 5 4 6 3 2 4;}
         @font-face
            {font-family:"\@PMingLiU"; panose-1:2 2 5 0 0 0 0 0 0 0;}
         @font-face
            {font-family:"\@新細明體"; panose-1:2 2 5 0 0 0 0 0 0 0;}
         /* Style Definitions */
         ${styles}
         ${msoStyles}
        -->
        </style>
      </head>
      <body lang=ZH-TW style='tab-interval:21.0pt;word-wrap:break-word;'>
      <div class=${forPrint ? '' : 'Section1'}>
    ` : `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>領域共備GO 會議報告 (預覽)</title>
        <style>
          ${styles}
        </style>
    </head>
    <body>
    <div>
    `;

    // Initialize reportHtml with the starting HTML structure
    let reportHtml = htmlStart;

    // Main title - Apply class for potential Word styling, ensure left alignment
    reportHtml += `<h1 class="${forPrint ? '' : 'Title'}" style="text-align:left;">領域共備GO 會議報告</h1>`;

    // Basic Info Section
    reportHtml += `
        <div class="section">
          <h2>基本資訊</h2>
          <p class="${forPrint ? '' : 'InfoParagraph'}"><strong>教學領域：</strong> ${teachingArea}</p>
          <p class="${forPrint ? '' : 'InfoParagraph'}"><strong>會議主題：</strong> ${meetingTopic}</p>
          <p class="${forPrint ? '' : 'InfoParagraph'}"><strong>會議日期：</strong> ${format(meetingDate, 'yyyy年MM月dd日')}</p>
          <p class="${forPrint ? '' : 'InfoParagraph'}"><strong>社群成員：</strong> ${communityMembers}</p>
        </div>
    `;

    // Photo Record Section - Center the table
    reportHtml += `
        <div class="section photo-section">
          <h2>照片記錄</h2>
           <!-- Use MsoNormalTable for Word styling, ensure centering -->
          <table class="${forPrint ? 'photo-table' : 'MsoNormalTable'}" border=1 cellspacing=0 cellpadding=0 align=center style="margin-left:auto; margin-right:auto;">
             <tbody>
    `;


    // Helper function to generate table cell content for images
    const generateImageCell = (photo: Photo | undefined, altText: string): string => {
        let content = '';
        if (photo?.dataUrl) {
             const paragraphClass = forPrint ? 'photo-paragraph' : 'ImageParagraph';
             // Apply PhotoStyle class with fixed height and auto width for Word
             const imgStyle = !forPrint ? `class="PhotoStyle"` : '';
             // Apply inline styles for standard HTML/Print (fixed height, auto width)
             const inlineImgStyle = forPrint ? 'style="height: 141.73pt; width: auto; max-width: 100%; display: block; margin: auto;"' : '';

             content = `<p class="${paragraphClass}" align=center style='text-align:center;'><img ${imgStyle} ${inlineImgStyle} src="${photo.dataUrl}" alt="${altText}"></p>`;
        } else {
             content = `<p class="${forPrint ? '' : 'MsoNormal'}" align=center style='text-align:center'>[${altText} 無法載入]</p>`;
        }
         // Use MsoNormal class for Word cell styling
        return `<td class="${forPrint ? '' : 'MsoNormal'}">${content}</td>`;
    };

    // Helper function to generate table cell content for descriptions
    const generateDescriptionCell = (photo: Photo | undefined): string => {
      const description = photo?.description || '未產生描述';
       const paragraphClass = forPrint ? 'photo-description' : 'DescriptionStyle';
       // Use MsoNormal class for Word cell styling
       return `<td class="${forPrint ? '' : 'MsoNormal'}"><p class="${paragraphClass}">${description}</p></td>`;
    }

    // Build the table content (2x4: two columns, four rows total)
     // Row 1: Images 1 & 2
    reportHtml += `<tr ${!forPrint ? 'style="mso-yfti-irow:0;mso-yfti-firstrow:yes"' : ''}>`;
    reportHtml += generateImageCell(photosWithDataUrls[0], '照片 1');
    reportHtml += generateImageCell(photosWithDataUrls[1], '照片 2');
    reportHtml += `</tr>`;

    // Row 2: Descriptions 1 & 2
    reportHtml += `<tr ${!forPrint ? 'style="mso-yfti-irow:1"' : ''}>`;
    reportHtml += generateDescriptionCell(photosWithDataUrls[0]);
    reportHtml += generateDescriptionCell(photosWithDataUrls[1]);
    reportHtml += `</tr>`;

    // Row 3: Images 3 & 4
    reportHtml += `<tr ${!forPrint ? 'style="mso-yfti-irow:2"' : ''}>`;
    reportHtml += generateImageCell(photosWithDataUrls[2], '照片 3');
    reportHtml += generateImageCell(photosWithDataUrls[3], '照片 4');
    reportHtml += `</tr>`;

    // Row 4: Descriptions 3 & 4
    reportHtml += `<tr ${!forPrint ? 'style="mso-yfti-irow:3;mso-yfti-lastrow:yes"' : ''}>`;
    reportHtml += generateDescriptionCell(photosWithDataUrls[2]);
    reportHtml += generateDescriptionCell(photosWithDataUrls[3]);
    reportHtml += `</tr>`;

    reportHtml += `
            </tbody>
          </table>
        </div>
    `;

    // Summary Section - Use SummaryParagraph for Word formatting
    reportHtml += `
        <div class="section summary-section">
          <h2>會議大綱摘要</h2>
           <p class="${forPrint ? '' : 'SummaryParagraph'}">${formattedSummary}</p>
        </div>

      </div> <!-- End Section / Section1 -->
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
