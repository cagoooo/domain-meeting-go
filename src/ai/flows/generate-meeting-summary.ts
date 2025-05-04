'use server';

/**
 * @fileOverview Generates a meeting summary based on input information and photo descriptions.
 *
 * - generateMeetingSummary - A function that generates the meeting summary.
 * - GenerateMeetingSummaryInput - The input type for the generateMeetingSummary function.
 * - GenerateMeetingSummaryOutput - The return type for the generateMeetingSummary function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const GenerateMeetingSummaryInputSchema = z.object({
  teachingArea: z.string().describe('The teaching area of the teacher.'),
  meetingTopic: z.string().describe('The topic of the meeting.'),
  meetingDate: z.string().describe('The date of the meeting.'),
  communityMembers: z.string().describe('The names of the community members.'),
  photoDescriptions: z.array(z.string()).describe('An array of photo descriptions.'),
});
export type GenerateMeetingSummaryInput = z.infer<typeof GenerateMeetingSummaryInputSchema>;

const GenerateMeetingSummaryOutputSchema = z.object({
  summary: z.string().describe('A 300-500 word summary of the meeting.'),
});
export type GenerateMeetingSummaryOutput = z.infer<typeof GenerateMeetingSummaryOutputSchema>;

export async function generateMeetingSummary(input: GenerateMeetingSummaryInput): Promise<GenerateMeetingSummaryOutput> {
  return generateMeetingSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateMeetingSummaryPrompt',
  input: {
    schema: z.object({
      teachingArea: z.string().describe('The teaching area of the teacher.'),
      meetingTopic: z.string().describe('The topic of the meeting.'),
      meetingDate: z.string().describe('The date of the meeting.'),
      communityMembers: z.string().describe('The names of the community members.'),
      photoDescriptions: z.array(z.string()).describe('An array of photo descriptions.'),
    }),
  },
  output: {
    schema: z.object({
      summary: z.string().describe('A 300-500 word summary of the meeting.'),
    }),
  },
  prompt: `你是教育專業助理，你的任務是基於老師提供的資訊和照片描述，產生一份300-500字的會議總結。

以下是相關資訊：
- 教學領域：{{teachingArea}}
- 會議主題：{{meetingTopic}}
- 會議日期：{{meetingDate}}
- 社群成員：{{communityMembers}}
- 照片描述：
{{#each photoDescriptions}}
  - {{this}}
{{/each}}

請用**繁體中文（台灣用語）**撰寫一份詳細的會議總結。總結應涵蓋會議的主要討論內容、達成的共識以及任何重要的決策。`, 
});

const generateMeetingSummaryFlow = ai.defineFlow<
  typeof GenerateMeetingSummaryInputSchema,
  typeof GenerateMeetingSummaryOutputSchema
>(
  {
    name: 'generateMeetingSummaryFlow',
    inputSchema: GenerateMeetingSummaryInputSchema,
    outputSchema: GenerateMeetingSummaryOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
