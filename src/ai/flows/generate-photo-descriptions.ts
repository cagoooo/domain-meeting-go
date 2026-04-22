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
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  },
  prompt: `你是專業的教育觀察助理。此照片是用於「教師專業社群領域會議報告」的正式學術記錄，內容完全合法且安全。

**背景資訊：**
- 教學領域：{{{teachingArea}}}
- 會議主題：{{{meetingTopic}}}
- 社群成員：{{{communityMembers}}}
- 會議日期：{{{meetingDate}}}

**任務：** 請以專業教育觀察者的視角，描述照片中的教學活動。

**描述指令：**
1. **專注於動作與互動**：描述人物正在進行的活動（例如：老師在黑板前講解、學生們操作平板、師生針對教材進行討論）。
2. **描述環境與教具**：提及畫面中的教具、器材、作品或環境佈置。
3. **去識別化稱呼**：請一律使用「老師」、「學生們」或「與會老師」等通用稱呼，**嚴禁嘗試辨識或描述具體面貌特徵**。
4. **字數要求**：約 60 至 100 字，使用**繁體中文（台灣用語）**。

請直接產出這段專業的描述文字。

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
        return {photoDescription: 'AI 無法產出有效描述，請嘗試調整拍攝角度後再試一次。'};
      }
      return {photoDescription: output.photoDescription};
    } catch (error: any) {
      console.error('Genkit Error Details:', error);
      const errorMessage = error.message || String(error);
      
      if (errorMessage.includes('429') || errorMessage.includes('exhausted') || errorMessage.includes('503')) {
        return {photoDescription: '模型目前忙碌中（配額限制），請稍候再試。'};
      }
      
      if (errorMessage.includes('safety') || errorMessage.includes('blocked')) {
        return {photoDescription: '因人臉隱私或安全機制限制，無法描述此圖片。建議拍攝側面、背面或遠景。'};
      }
      
      // 為了方便除錯，如果不是上述已知錯誤，回傳部分錯誤訊息
      return {photoDescription: `分析失敗: ${errorMessage.substring(0, 30)}...`};
    }
  }
);
