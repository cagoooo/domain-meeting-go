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
  { secrets: [geminiApiKey], cors: true, region: "asia-east1", timeoutSeconds: 120 },
  async (request: any) => {
    try {
      const ai = getAiInstance();
      const { meetingType } = request.data;
      
      // 根據會議類型調整提示導向
      let typeSpecificPrompt = "";
      switch (meetingType) {
        case "備課會議":
          typeSpecificPrompt = "請著重於「教學目標設定」、「教材選擇與編排」以及「教學流程設計」。分析與會老師如何針對課程內容進行專業對話。";
          break;
        case "觀課紀錄":
          typeSpecificPrompt = "請著重於「課堂氛圍觀察」、「學生學習反應」以及「教學策略的執行成效」。描述教學現場的實務脈動。";
          break;
        case "議課總整理":
          typeSpecificPrompt = "請著重於「建設性成果回饋」、「具體改善建議」以及「同儕共學紀錄」。總結與會者對該堂課的深度反思與洞察。";
          break;
        case "講座研討報告":
          typeSpecificPrompt = "請著重於「核心知能獲取」、「理論與實務的連結」以及「未來的應用規劃」。記錄專業發展的關鍵精華。";
          break;
        case "社群會議紀錄":
          typeSpecificPrompt = "請著重於「任務分工進度」、「行政事務協調」以及「社群成長動能」。總結社群運作的具體進度與共識。";
          break;
        default:
          typeSpecificPrompt = "請全面且深入地總結會議要點、討論亮點、達成共識以及未來決策事項。";
      }

      const prompt = ai.definePrompt({
        name: 'generateMeetingSummaryPrompt',
        input: {
          schema: z.object({
            meetingType: z.string(),
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
        prompt: `你是專業的教育行政與教學研究助手，你的任務是基於老師提供的資訊和一系列的照片觀察記錄，撰寫一份極具專業水準的「{{{meetingType}}}」正式報告。
        
        **寫作要求：**
        1. **字數要求**：請產出約 **600 至 1000 個繁體中文字**。內容應詳實、全面且具備深度，避免空洞的套話。
        2. **專業語氣**：使用正式的教育學術語彙（台灣用語）。
        3. **深度整合**：請將照片描述中的具體細節（如具體教具、師生互動行為）有機地織入總結內容中。
        4. **場景導向**：${typeSpecificPrompt}

        **報告背景資訊：**
        - 會議類型：{{{meetingType}}}
        - 教學領域：{{{teachingArea}}}
        - 會議主題：{{{meetingTopic}}}
        - 會議日期：{{{meetingDate}}}
        - 與會成員：{{{communityMembers}}}
        - 觀察細節 (照片描述)：
        {{#each photoDescriptions}}
          - {{this}}
        {{/each}}

        請直接開始撰寫這份內容詳盡、排版分明（可使用條列式輔助說明）的會議總結記錄。`, 
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
