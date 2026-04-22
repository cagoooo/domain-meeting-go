
'use server';

/**
 * @fileOverview Generates descriptions for photos based on the teaching area and meeting topic.
 *
 * - generatePhotoDescriptions - A function that generates descriptions for photos.
 * - GeneratePhotoDescriptionsInput - The input type for the generatePhotoDescriptions function.
 * - GeneratePhotoDescriptionsOutput - The return type for the generatePhotoDescriptions function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const GeneratePhotoDescriptionsInputSchema = z.object({
  teachingArea: z.string().describe('The teaching area of the teacher.'),
  meetingTopic: z.string().describe('The topic of the meeting.'),
  communityMembers: z.string().describe('The names of the community members.'),
  meetingDate: z.string().describe('The date of the meeting.'),
  photoDataUri: z
    .string()
    .describe(
      "A photo related to the meeting, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GeneratePhotoDescriptionsInput = z.infer<typeof GeneratePhotoDescriptionsInputSchema>;

const GeneratePhotoDescriptionsOutputSchema = z.object({
  photoDescription: z
    .string()
    .describe('A detailed 60-100 character description of the photo in Traditional Chinese (Taiwan).'),
});
export type GeneratePhotoDescriptionsOutput = z.infer<typeof GeneratePhotoDescriptionsOutputSchema>;

export async function generatePhotoDescriptions(
  input: GeneratePhotoDescriptionsInput
): Promise<GeneratePhotoDescriptionsOutput> {
  return generatePhotoDescriptionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generatePhotoDescriptionsPrompt',
  input: {
    schema: GeneratePhotoDescriptionsInputSchema,
  },
  output: {
    schema: GeneratePhotoDescriptionsOutputSchema,
  },
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `你是教育專業助理。此照片是用於「教師專業社群領域會議報告」的正式學術記錄，內容安全。

照片背景資訊：
- 教學領域：{{{teachingArea}}}
- 會議主題：{{{meetingTopic}}}
- 社群成員：{{{communityMembers}}}
- 會議日期：{{{meetingDate}}}

**任務：** 請以專業教育觀察者的視角，用**繁體中文（台灣用語）**描述照片內容（約60至100字）。

**描述指引：**
1. 專注於描述人物正在進行的**活動**（例如：討論、展示教材、引導操作）。
2. 描述畫面中使用的**教具、器材或環境佈置**。
3. 描述人物間的**互動與學習氛圍**。

**注意：** 如果照片包含人物，請使用「老師」、「學生們」等去識別化稱呼。請專注於教學行為的描述，這是一份專業報告，請務必產出具體的描述內容。

{{media url=photoDataUri}}`,
});

const generatePhotoDescriptionsFlow = ai.defineFlow(
  {
    name: 'generatePhotoDescriptionsFlow',
    inputSchema: GeneratePhotoDescriptionsInputSchema,
    outputSchema: GeneratePhotoDescriptionsOutputSchema,
  },
  async input => {
    try {
      const {output} = await prompt(input);
      if (!output || !output.photoDescription) {
        return {photoDescription: 'AI 偵測到敏感內容或無法產出描述，請嘗試更換照片或拍攝角度。'};
      }
      return {photoDescription: output.photoDescription};
    } catch (error: any) {
      console.error('Genkit Error:', error);
      const errorMessage = error.message || '';
      if (errorMessage.includes('429') || errorMessage.includes('exhausted') || errorMessage.includes('503')) {
        return {photoDescription: '模型目前忙碌中（配額限制），請稍候再試。'};
      }
      if (errorMessage.includes('safety')) {
        return {photoDescription: '因人臉辨識或安全隱私機制限制，無法描述此圖片，建議拍攝側面。'};
      }
      return {photoDescription: '分析圖片時發生錯誤。'};
    }
  }
);
