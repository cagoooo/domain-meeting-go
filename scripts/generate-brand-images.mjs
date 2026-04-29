#!/usr/bin/env node
/**
 * 產生領域共備GO 的品牌圖片：favicon + OG 社群分享預覽圖。
 *
 * 設計風格 (v0.5.0+ 編輯部期刊風)：
 *   - 配色：酒紅 (#6b1f29) × 牛皮米黃 (#f4ead6)
 *   - 字型：Microsoft JhengHei Bold（系統內建，視覺最接近 Noto Serif TC）
 *
 * 用法：
 *   node scripts/generate-brand-images.mjs
 *
 * 輸出：
 *   public/favicon.png       512×512 — 報紙頭版風縮圖
 *   public/og_preview.png    1200×630 — 期刊版型社群卡片
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 字型註冊：使用 Windows 內建 Microsoft JhengHei ──
GlobalFonts.registerFromPath('C:/Windows/Fonts/msjhbd.ttc', 'JhengHeiBold');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msjh.ttc',   'JhengHei');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msjhl.ttc',  'JhengHeiLight');

// ── 編輯部期刊配色 ──
const COLORS = {
  paper:       '#f4ead6',   // 牛皮米黃（主背景）
  paperDark:   '#ead9b8',   // 紙紋深色
  ink:         '#6b1f29',   // 酒紅墨色（主標題）
  inkSoft:     '#8a3640',   // 酒紅淺色（副標）
  inkDeep:     '#4a1119',   // 酒紅最深（rule）
  accent:      '#a07042',   // 暖橘（點綴）
  textMute:    '#7a6552',   // 灰咖（mono 標籤）
};

/* ============================================================
   OG Preview 1200 × 630
   ============================================================ */
function generateOG() {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景：牛皮米黃
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, W, H);

  // 紙紋：左右兩側 radial 漸層（模擬網站 body 的 ink-tint / accent-tint）
  const grad1 = ctx.createRadialGradient(0, -50, 0, 0, -50, 700);
  grad1.addColorStop(0, 'rgba(107, 31, 41, 0.08)');
  grad1.addColorStop(1, 'rgba(107, 31, 41, 0)');
  ctx.fillStyle = grad1;
  ctx.fillRect(0, 0, W, H);

  const grad2 = ctx.createRadialGradient(W, 0, 0, W, 0, 600);
  grad2.addColorStop(0, 'rgba(160, 112, 66, 0.10)');
  grad2.addColorStop(1, 'rgba(160, 112, 66, 0)');
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, W, H);

  // 邊框內距
  const PAD = 60;

  // 上方雙橫線（masthead style）
  ctx.fillStyle = COLORS.inkDeep;
  ctx.fillRect(PAD, 90, W - PAD * 2, 2);

  // 三欄 row：VOL · TITLE · 教師社群協力誌
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '500 22px "JhengHei", system-ui';
  ctx.textBaseline = 'middle';

  // 左：VOL. 04 / 2026
  ctx.textAlign = 'left';
  ctx.fillText('VOL. 04', PAD, 130);
  ctx.fillText('2026 — 04', PAD, 158);

  // 右：教師社群 / 協力誌
  ctx.textAlign = 'right';
  ctx.font = '700 22px "JhengHei", system-ui';
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText('教師社群', W - PAD, 130);
  ctx.fillText('協力誌', W - PAD, 158);

  // 中央大標題：領域共備GO
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = '900 134px "JhengHeiBold", system-ui';
  // 模擬 letter-spacing: 0.06em
  drawSpacedText(ctx, '領域共備GO', W / 2, 245, 0.06);

  // 副標 mono：DOMAIN · MEETING · GO
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '500 22px "JhengHei", system-ui';
  drawSpacedText(ctx, 'DOMAIN · MEETING · GO', W / 2, 318, 0.42);

  // 下方雙橫線
  ctx.fillStyle = COLORS.inkDeep;
  ctx.fillRect(PAD, 365, W - PAD * 2, 1);
  ctx.fillRect(PAD, 372, W - PAD * 2, 1);

  // 第一行 mono 副標：A NOTEBOOK FOR  · 共備觀課議課... · BUILT WITH GEMINI
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.accent;
  ctx.font = '700 30px "JhengHeiBold", system-ui';
  drawSpacedText(ctx, '共備 · 觀課 · 議課 · 講座 · 會議紀錄', W / 2, 410, 0.04);

  // 主 tagline（serif 大字）
  ctx.fillStyle = COLORS.ink;
  ctx.font = '900 42px "JhengHeiBold", system-ui';
  ctx.fillText('教師社群會議報告自動產出助手', W / 2, 470);

  // 副 tagline（細字）
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '400 24px "JhengHei", system-ui';
  ctx.fillText('用 AI 為每一次共備留下溫度與紀錄', W / 2, 514);

  // 底部署名 row（左：domain，右：作者 + 手繪愛心）
  ctx.fillStyle = COLORS.textMute;
  ctx.font = '500 18px "JhengHei", system-ui';
  ctx.textAlign = 'left';
  drawSpacedText(ctx, 'CAGOOOO.GITHUB.IO/DOMAIN-MEETING-GO', PAD, H - 40, 0.14);

  // 右側：Made with [♥] by 阿凱老師（愛心用 canvas 直接畫）
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.ink;
  ctx.font = '700 18px "JhengHeiBold", system-ui';
  const authorText = 'by 阿凱老師';
  const madeWithText = 'Made with ';
  const baseY = H - 40;
  const baseX = W - PAD;

  // 從右往左畫
  ctx.fillText(authorText, baseX, baseY);
  const authorW = ctx.measureText(authorText).width;
  const heartCenterX = baseX - authorW - 16;
  drawHeart(ctx, heartCenterX, baseY, 11, '#c63');
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(madeWithText, heartCenterX - 11, baseY);

  // 紙質紋理：細微點點（模擬網站 paper grain）
  ctx.fillStyle = 'rgba(107, 31, 41, 0.03)';
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const out = resolve(ROOT, 'public/og_preview.png');
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`✅ OG preview → ${out} (${(canvas.toBuffer('image/png').length / 1024).toFixed(1)} KB)`);
}

/* ============================================================
   Favicon 512 × 512
   設計：報紙頭版縮影 — 上下橫線 + 中央「GO」serif + 下方副標
   ============================================================ */
function generateFavicon() {
  const SIZE = 512;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // 背景：酒紅實心（小尺寸辨識度需要強對比）
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 內部紙質區塊（模擬報紙）
  const inset = 40;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(inset, inset, SIZE - inset * 2, SIZE - inset * 2);

  // 上方雙橫線
  ctx.fillStyle = COLORS.ink;
  const ruleY1 = 110;
  ctx.fillRect(70, ruleY1, SIZE - 140, 6);
  ctx.fillRect(70, ruleY1 + 14, SIZE - 140, 2);

  // 中央 大字「GO」
  ctx.fillStyle = COLORS.ink;
  ctx.font = '900 240px "JhengHeiBold", system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GO', SIZE / 2, SIZE / 2 + 10);

  // 上方小字「領域共備」
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '700 38px "JhengHeiBold", system-ui';
  drawSpacedText(ctx, '領域共備', SIZE / 2, 165, 0.08);

  // 下方雙橫線
  const ruleY2 = SIZE - ruleY1;
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(70, ruleY2 - 14, SIZE - 140, 2);
  ctx.fillRect(70, ruleY2, SIZE - 140, 6);

  // 下方迷你標 DOMAIN MEETING GO（過小不放，留 VOL · 04）
  ctx.fillStyle = COLORS.accent;
  ctx.font = '500 28px "JhengHei", system-ui';
  drawSpacedText(ctx, 'VOL · 04', SIZE / 2, SIZE - 70, 0.32);

  const out = resolve(ROOT, 'public/favicon.png');
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`✅ Favicon → ${out} (${(canvas.toBuffer('image/png').length / 1024).toFixed(1)} KB)`);
}

/**
 * 用 canvas path 直接畫一顆愛心（避免字型不支援 ❤ emoji 的問題）
 *  centerX, centerY = 中心點；size = 半寬；color = fill 色
 */
function drawHeart(ctx, centerX, centerY, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const x = centerX - size;
  const y = centerY - size * 0.7;
  ctx.moveTo(centerX, y + size * 0.4);
  // 左半圓
  ctx.bezierCurveTo(x, y - size * 0.2, x - size * 0.2, y + size * 0.6, centerX, y + size * 1.4);
  // 右半圓
  ctx.bezierCurveTo(centerX + size * 1.2, y + size * 0.6, centerX + size, y - size * 0.2, centerX, y + size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 模擬 CSS letter-spacing 的 canvas 繪製方式 —
 * 因為 canvas 沒有原生 letter-spacing 屬性，所以一字一字畫並補偏移。
 */
function drawSpacedText(ctx, text, x, y, emSpacing) {
  const fontSize = parseInt(ctx.font.match(/(\d+)px/)[1], 10);
  const spacing = fontSize * emSpacing;

  // 先量總寬度才能對齊
  let totalWidth = 0;
  const widths = [];
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    totalWidth += w + spacing;
  }
  totalWidth -= spacing; // 最後一個字後面不加

  // 起始 X 依 textAlign 決定
  let cursor = x;
  if (ctx.textAlign === 'center') cursor = x - totalWidth / 2;
  else if (ctx.textAlign === 'right') cursor = x - totalWidth;
  // left: 不調整

  const savedAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + spacing;
  }
  ctx.textAlign = savedAlign;
}

// ── Run ──
generateFavicon();
generateOG();
console.log('\n🎨 完成。請 commit public/favicon.png 與 public/og_preview.png\n');
