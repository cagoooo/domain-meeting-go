import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

// 宣告使用 Secret Manager 中的 API Key
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// 為避免 cold start 時取不到 Secret，我們利用函式封裝 Genkit 的實例化
function getAiInstance() {
  return genkit({
    plugins: [googleAI({ apiKey: geminiApiKey.value() })],
    model: 'googleai/gemini-2.5-flash-lite',
  });
}

// ------------------------------------
// 1. 生成照片描述 (generatePhotoDescriptions)
// ------------------------------------
export const generatePhotoDescriptions = onCall(
  { secrets: [geminiApiKey], cors: true, region: "asia-east1" },
  async (request: any) => {
    try {
      const ai = getAiInstance();
      const prompt = ai.definePrompt({
        name: 'generatePhotoDescriptionsPrompt',
        input: {
          schema: z.object({
            teachingArea: z.string(),
            meetingTopic: z.string(),
            communityMembers: z.string(),
            meetingDate: z.string(),
            photoDataUri: z.string(),
          }),
        },
        output: {
          schema: z.object({
            photoDescription: z.string(),
          }),
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

      const { output } = await prompt(request.data);
      if (!output || !output.photoDescription) {
        return { photoDescription: 'AI 無法產出有效描述，請嘗試調整拍攝角度後再試一次。' };
      }
      return { photoDescription: output.photoDescription };
    } catch (error: any) {
      console.error('Genkit Error Details:', error);
      const errorMessage = error.message || String(error);
      
      if (errorMessage.includes('429') || errorMessage.includes('exhausted') || errorMessage.includes('503')) {
        return { photoDescription: '模型目前忙碌中（配額限制），請稍候再試。' };
      }
      if (errorMessage.includes('safety') || errorMessage.includes('blocked')) {
        return { photoDescription: '因人臉隱私或安全機制限制，無法描述此圖片。建議拍攝側面、背面或遠景。' };
      }
      return { photoDescription: `分析失敗: ${errorMessage.substring(0, 30)}...` };
    }
  }
);


// ------------------------------------
// 2. 生成會議摘要 (generateMeetingSummary)
// ------------------------------------
export const generateMeetingSummary = onCall(
  { secrets: [geminiApiKey], cors: true, region: "asia-east1", timeoutSeconds: 60 },
  async (request: any) => {
    try {
      const ai = getAiInstance();
      const prompt = ai.definePrompt({
        name: 'generateMeetingSummaryPrompt',
        input: {
          schema: z.object({
            teachingArea: z.string(),
            meetingTopic: z.string(),
            meetingDate: z.string(),
            communityMembers: z.string(),
            photoDescriptions: z.array(z.string()),
          }),
        },
        output: {
          schema: z.object({
            summary: z.string(),
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

      const { output } = await prompt(request.data);
      if (!output || !output.summary) {
        throw new HttpsError('internal', 'Failed to generate summary');
      }
      return { summary: output.summary };
    } catch (error: any) {
      console.error('generateMeetingSummary failed:', error);
      throw new HttpsError('internal', error.message || 'Summary generation failed');
    }
  }
);
