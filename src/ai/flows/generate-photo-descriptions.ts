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
    .describe('A detailed 60-100 character description of the photo in Traditional Chinese (Taiwan), highlighting key elements, activities, people, and the scene.'),
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
    schema: z.object({
      teachingArea: z.string().describe('The teaching area of the teacher.'),
      meetingTopic: z.string().describe('The topic of the meeting.'),
      communityMembers: z.string().describe('The names of the community members.'),
      meetingDate: z.string().describe('The date of the meeting.'),
      photoDataUri: z
        .string()
        .describe(
          "A photo related to the meeting, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
        ),
    }),
  },
  output: {
    schema: z.object({
      photoDescription: z
        .string()
        .describe('A detailed 60-100 character description of the photo in Traditional Chinese (Taiwan), highlighting key elements, activities, people, and the scene.'),
    }),
  },
  prompt: `你是教育專業助理，任務是為老師分析照片。
照片相關資訊：
- 教學領域：{{{teachingArea}}}
- 會議主題：{{{meetingTopic}}}
- 社群成員：{{{communityMembers}}}
- 會議日期：{{{meetingDate}}}

**任務：** 請仔細觀察以下提供的照片，並用**繁體中文（台灣用語）**寫一段詳細描述照片的文字，長度約60至100字。描述應涵蓋照片中的主要人物、他們的活動、場景佈置，以及任何值得注意的細節。

**輸出要求：**
1. 你的回應**必須**只包含這句繁體中文描述，不要有任何其他文字、標籤或格式。
2. 如果因任何原因（例如：圖片無法辨識、安全限制等）你無法產生描述，請**只**回傳文字：「無法描述此圖片。」

{{media url=photoDataUri}}`,
});

const generatePhotoDescriptionsFlow = ai.defineFlow<
  typeof GeneratePhotoDescriptionsInputSchema,
  typeof GeneratePhotoDescriptionsOutputSchema
>(
  {
    name: 'generatePhotoDescriptionsFlow',
    inputSchema: GeneratePhotoDescriptionsInputSchema,
    outputSchema: GeneratePhotoDescriptionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return {photoDescription: output!.photoDescription!};
  }
);
