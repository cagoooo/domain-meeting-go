"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMeetingSummary = exports.generatePhotoDescriptions = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const notify_line_1 = require("./notify-line");
// 宣告使用 Secret Manager 中的 API Key
const geminiApiKey = (0, params_1.defineSecret)("GEMINI_API_KEY");
// LINE 管理員通知（單一接收者模式：所有事件都推到管理員一個 LINE 帳號）
// secrets 由 firebase functions:secrets:set 設定，未設定時通知會 noop
const lineChannelAccessToken = (0, params_1.defineSecret)("LINE_CHANNEL_ACCESS_TOKEN");
const lineAdminUserId = (0, params_1.defineSecret)("LINE_ADMIN_USER_ID");
let _aiInstance = null;
function getAiInstance() {
    if (!_aiInstance) {
        _aiInstance = (0, genkit_1.genkit)({
            plugins: [(0, google_genai_1.googleAI)({ apiKey: geminiApiKey.value() })],
            model: 'googleai/gemini-2.5-flash-lite',
        });
    }
    return _aiInstance;
}
// ------------------------------------
// 1. 生成照片描述 (generatePhotoDescriptions)
// ------------------------------------
exports.generatePhotoDescriptions = (0, https_1.onCall)({
    secrets: [geminiApiKey, lineChannelAccessToken, lineAdminUserId],
    cors: true,
    region: "asia-east1",
    timeoutSeconds: 120,
}, async (request) => {
    const startedAt = Date.now();
    try {
        const ai = getAiInstance();
        const prompt = ai.definePrompt({
            name: 'generatePhotoDescriptionsPrompt',
            input: {
                schema: genkit_1.z.object({
                    teachingArea: genkit_1.z.string(),
                    meetingTopic: genkit_1.z.string(),
                    communityMembers: genkit_1.z.string(),
                    meetingDate: genkit_1.z.string(),
                    photoDataUri: genkit_1.z.string(),
                }),
            },
            output: {
                schema: genkit_1.z.object({
                    photoDescription: genkit_1.z.string(),
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
        const elapsedMs = Date.now() - startedAt;
        if (!output || !output.photoDescription) {
            (0, notify_line_1.notifyAdminCard)({
                status: 'warning',
                title: '照片描述產出空白',
                appName: '領域共備GO',
                fields: (0, notify_line_1.meetingFields)(request.data),
                footerNote: `⏱️ ${elapsedMs}ms`,
            }, lineChannelAccessToken.value(), lineAdminUserId.value());
            return { photoDescription: 'AI 無法產出有效描述，請嘗試調整拍攝角度後再試一次。' };
        }
        // 成功時不每張都通知（避免訊息轟炸），僅 log
        return { photoDescription: output.photoDescription };
    }
    catch (error) {
        console.error('Genkit Error Details:', error);
        const errorMessage = error.message || String(error);
        const elapsedMs = Date.now() - startedAt;
        let userFacing;
        let alertCategory;
        if (errorMessage.includes('429') || errorMessage.includes('exhausted') || errorMessage.includes('503')) {
            userFacing = '模型目前忙碌中（配額限制），請稍候再試。';
            alertCategory = '🚦 配額限制 (429/503)';
        }
        else if (errorMessage.includes('safety') || errorMessage.includes('blocked')) {
            userFacing = '因人臉隱私或安全機制限制，無法描述此圖片。建議拍攝側面、背面或遠景。';
            alertCategory = '🛡️ Safety Block';
        }
        else {
            userFacing = `分析失敗: ${errorMessage.substring(0, 30)}...`;
            alertCategory = '❓ 其他錯誤';
        }
        (0, notify_line_1.notifyAdminCard)({
            status: 'failed',
            title: '照片描述失敗',
            appName: '領域共備GO',
            fields: [
                ...(0, notify_line_1.meetingFields)(request.data),
                { icon: '🏷️', label: '類型', value: alertCategory },
                { icon: '💬', label: '訊息', value: errorMessage.substring(0, 200) },
            ],
            footerNote: `⏱️ ${elapsedMs}ms`,
        }, lineChannelAccessToken.value(), lineAdminUserId.value());
        return { photoDescription: userFacing };
    }
});
// ------------------------------------
// 2. 生成會議摘要 (generateMeetingSummary)
// ------------------------------------
exports.generateMeetingSummary = (0, https_1.onCall)({
    secrets: [geminiApiKey, lineChannelAccessToken, lineAdminUserId],
    cors: true,
    region: "asia-east1",
    timeoutSeconds: 120,
}, async (request) => {
    const startedAt = Date.now();
    const photoCount = Array.isArray(request.data?.photoDescriptions)
        ? request.data.photoDescriptions.length
        : 0;
    // 開始通知（一份報告只發一次）
    (0, notify_line_1.notifyAdminCard)({
        status: 'started',
        title: '開始產生會議摘要',
        appName: '領域共備GO',
        fields: [
            ...(0, notify_line_1.meetingFields)(request.data),
            { icon: '📷', label: '照片', value: `${photoCount} 張` },
        ],
    }, lineChannelAccessToken.value(), lineAdminUserId.value());
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
                schema: genkit_1.z.object({
                    meetingType: genkit_1.z.string(),
                    teachingArea: genkit_1.z.string(),
                    meetingTopic: genkit_1.z.string(),
                    meetingDate: genkit_1.z.string(),
                    communityMembers: genkit_1.z.string(),
                    photoDescriptions: genkit_1.z.array(genkit_1.z.string()),
                }),
            },
            output: {
                schema: genkit_1.z.object({
                    summary: genkit_1.z.string(),
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
        const elapsedMs = Date.now() - startedAt;
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        if (!output || !output.summary) {
            (0, notify_line_1.notifyAdminCard)({
                status: 'warning',
                title: '會議摘要產出空白',
                appName: '領域共備GO',
                fields: (0, notify_line_1.meetingFields)(request.data),
                footerNote: `⏱️ ${elapsedSec}s`,
            }, lineChannelAccessToken.value(), lineAdminUserId.value());
            throw new https_1.HttpsError('internal', 'Failed to generate summary');
        }
        // 成功通知（含摘要長度與耗時）
        (0, notify_line_1.notifyAdminCard)({
            status: 'success',
            title: '會議摘要產出成功',
            appName: '領域共備GO',
            fields: [
                ...(0, notify_line_1.meetingFields)(request.data),
                { icon: '📝', label: '字數', value: `${output.summary.length}` },
                { icon: '⏱️', label: '耗時', value: `${elapsedSec}s` },
            ],
        }, lineChannelAccessToken.value(), lineAdminUserId.value());
        return { summary: output.summary };
    }
    catch (error) {
        console.error('generateMeetingSummary failed:', error);
        const elapsedMs = Date.now() - startedAt;
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        const errorMessage = error?.message || String(error);
        (0, notify_line_1.notifyAdminCard)({
            status: 'failed',
            title: '會議摘要失敗',
            appName: '領域共備GO',
            fields: [
                ...(0, notify_line_1.meetingFields)(request.data),
                { icon: '💬', label: '錯誤', value: errorMessage.substring(0, 250) },
            ],
            footerNote: `⏱️ ${elapsedSec}s`,
        }, lineChannelAccessToken.value(), lineAdminUserId.value());
        throw new https_1.HttpsError('internal', errorMessage || 'Summary generation failed');
    }
});
//# sourceMappingURL=index.js.map