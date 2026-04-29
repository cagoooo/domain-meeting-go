
'use client';

import type { ChangeEvent, ReactNode } from 'react';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import {
  Calendar as CalendarIcon,
  Loader2,
  UploadCloud,
  X,
  Printer,
  Info,
  Image as ImageIcon,
  FileText,
  Download,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Toaster } from '@/components/ui/toaster';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import confetti from 'canvas-confetti';
import ReactMarkdown from 'react-markdown';

// 匯出套件
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
} from 'docx';
import { saveAs } from 'file-saver';

const MAX_PHOTOS = 4;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const formSchema = z.object({
  teachingArea: z.string().min(1, '教學領域不能為空'),
  meetingType: z.string().min(1, '請選擇會議類別'),
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
  dataUrl?: string;
};

const fireMassiveConfetti = () => {
  const colors = ['#a855f7', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

  confetti({ particleCount: 200, spread: 100, origin: { x: 0.5, y: 0.5 }, colors, startVelocity: 50, scalar: 1.5, ticks: 250 });

  setTimeout(() => {
    confetti({ particleCount: 150, angle: 60, spread: 70, origin: { x: 0, y: 0.65 }, colors, startVelocity: 60, scalar: 1.2 });
    confetti({ particleCount: 150, angle: 120, spread: 70, origin: { x: 1, y: 0.65 }, colors, startVelocity: 60, scalar: 1.2 });
  }, 250);

  setTimeout(() => {
    confetti({ particleCount: 100, angle: 270, spread: 180, origin: { x: 0.5, y: 0 }, colors, startVelocity: 40, scalar: 1.3, gravity: 0.8, ticks: 300 });
  }, 500);

  const end = Date.now() + 3000;
  const flutter = setInterval(() => {
    if (Date.now() > end) { clearInterval(flutter); return; }
    confetti({ particleCount: 30, startVelocity: 30, spread: 360, ticks: 150, origin: { x: Math.random(), y: Math.random() * 0.5 }, colors, scalar: 0.8 + Math.random() * 0.6 });
  }, 200);
};

/* ==========================================================================
   Editorial layout primitives
   ========================================================================== */

const EditorialHeader = () => {
  const [today, setToday] = useState('');
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`);
  }, []);

  return (
    <header className="dmg-header">
      <div className="dmg-masthead">
        <div className="dmg-masthead__rule" />
        <div className="dmg-masthead__row">
          <div className="dmg-masthead__date">
            <div>VOL. 04</div>
            <div suppressHydrationWarning>{today || ' '}</div>
          </div>
          <div className="dmg-masthead__title">
            <div className="dmg-masthead__cn">領域共備GO</div>
            <div className="dmg-masthead__en">DOMAIN · MEETING · GO</div>
          </div>
          <div className="dmg-masthead__price">
            <div>教師社群</div>
            <div>協力誌</div>
          </div>
        </div>
        <div className="dmg-masthead__rule dmg-masthead__rule--double" />
        <div className="dmg-masthead__tag">
          <span>A NOTEBOOK FOR</span>
          <strong>共備 · 觀課 · 議課 · 講座 · 會議紀錄</strong>
          <span>BUILT WITH GEMINI</span>
        </div>
      </div>
    </header>
  );
};

type StepCardProps = {
  index: number;
  accent: 'ink' | 'accent';
  icon: ReactNode;
  kicker: string;
  title: string;
  status?: ReactNode;
  children: ReactNode;
  id?: string;
};

const StepCard = ({ index, accent, icon, kicker, title, status, children, id }: StepCardProps) => (
  <section id={id} className={`dmg-step dmg-step--${accent}`}>
    <div className="dmg-step__rail" aria-hidden="true">
      <div className="dmg-step__num">{String(index).padStart(2, '0')}</div>
      <div className="dmg-step__line" />
      <div className="dmg-step__icon">{icon}</div>
    </div>
    <div className="dmg-step__body">
      <header className="dmg-step__head">
        <div>
          <div className="dmg-step__kicker">{kicker}</div>
          <h2 className="dmg-step__title">{title}</h2>
        </div>
        {status}
      </header>
      <div>{children}</div>
    </div>
  </section>
);

type FieldLabelProps = { label: string; hint?: string; htmlFor?: string };
const FieldLabel = ({ label, hint, htmlFor }: FieldLabelProps) => (
  <label className="dmg-field__label" htmlFor={htmlFor}>
    <span>{label}</span>
    {hint && <span className="dmg-field__hint">{hint}</span>}
  </label>
);

/* ==========================================================================
   Editorial Summary (journal layout)
   ========================================================================== */

type Block =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'li-num'; text: string }
  | { kind: 'p'; text: string };

const parseSummary = (markdown: string): Block[] => {
  const out: Block[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { out.push({ kind: 'p', text: buf.join(' ') }); buf = []; } };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); out.push({ kind: 'h2', text: line.slice(3) }); }
    else if (line.startsWith('### ')) { flush(); out.push({ kind: 'h3', text: line.slice(4) }); }
    else if (/^\d+\.\s/.test(line)) { flush(); out.push({ kind: 'li-num', text: line.replace(/^\d+\.\s/, '') }); }
    else if (/^[*-]\s/.test(line)) { flush(); out.push({ kind: 'li', text: line.replace(/^[*-]\s/, '') }); }
    else buf.push(line);
  }
  flush();
  return out;
};

const renderInline = (t: string) => {
  const parts = t.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
};

type SummaryInfo = {
  area: string;
  type: string;
  topic: string;
  date: string;
  members: string;
};

const EditorialSummary = ({ markdown, info }: { markdown: string; info: SummaryInfo }) => {
  const blocks = useMemo(() => parseSummary(markdown), [markdown]);
  const ledeArea = info.area || '本領域';
  const ledeTopic = info.topic || '本次會議主題';

  return (
    <article className="dmg-journal">
      <div className="dmg-journal__masthead">
        <div className="dmg-journal__row">
          <div>{info.date || ''}</div>
          <div className="dmg-journal__brand">領域共備 GO · 期刊版</div>
          <div>AI Synopsis</div>
        </div>
        <h1 className="dmg-journal__h1">{ledeTopic}</h1>
        <div className="dmg-journal__byline">
          <span>領域 / <strong>{ledeArea}</strong></span>
          <span>類別 / <strong>{info.type || '—'}</strong></span>
          <span>協作 / <strong>{info.members || '—'}</strong></span>
        </div>
      </div>
      <div className="dmg-journal__lede">
        <span className="dmg-journal__dropcap">本</span>
        次社群會議以「{ledeTopic}」為核心主題，由 {ledeArea} 領域教師共同備課，討論面向涵蓋課程設計、教學策略與後續評量規劃；以下為由 AI 整理之專業會議紀錄。
      </div>
      <div className="dmg-journal__cols">
        {blocks.map((b, i) => {
          if (b.kind === 'h2') return <h2 key={i} className="dmg-journal__h2">{b.text}</h2>;
          if (b.kind === 'h3') return <h3 key={i} className="dmg-journal__h3">{b.text}</h3>;
          if (b.kind === 'li') return <li key={i} className="dmg-journal__li">{renderInline(b.text)}</li>;
          if (b.kind === 'li-num') return <li key={i} className="dmg-journal__li dmg-journal__li--num">{renderInline(b.text)}</li>;
          return <p key={i} className="dmg-journal__p">{renderInline(b.text)}</p>;
        })}
      </div>
      <div className="dmg-journal__foot">
        <span>— END —</span>
        <span>由 Gemini 2.5 Flash Lite 整理 · 教師複校</span>
      </div>
    </article>
  );
};

/* ==========================================================================
   Main page
   ========================================================================== */

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationProgress, setSummaryGenerationProgress] = useState<number | null>(null);
  const [descriptionProgress, setDescriptionProgress] = useState<number | null>(null);
  const [isGeneratingAllDescriptions, setIsGeneratingAllDescriptions] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const generateDescriptionsButtonRef = useRef<HTMLButtonElement>(null);
  const summaryPreviewRef = useRef<HTMLDivElement>(null);
  const summaryProgressRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      teachingArea: '',
      meetingType: '社群會議紀錄',
      meetingTopic: '',
      communityMembers: '',
    },
  });

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const newPhotosPromises: Promise<Photo | null>[] = [];
      let currentPhotoCount = photos.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (currentPhotoCount + i >= MAX_PHOTOS) break;
        if (file.size > MAX_FILE_SIZE) continue;
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;

        const photoId = `${file.name}-${Date.now()}`;
        const previewUrl = URL.createObjectURL(file);

        newPhotosPromises.push(
          readFileAsDataURL(file).then(dataUrl => ({
            id: photoId,
            file,
            previewUrl,
            description: '',
            isGenerating: false,
            dataUrl,
          }))
        );
      }

      const validNewPhotos = (await Promise.all(newPhotosPromises)).filter((p): p is Photo => p !== null);

      if (validNewPhotos.length > 0) {
        setPhotos(prev => [...prev, ...validNewPhotos].slice(0, MAX_PHOTOS));
        setTimeout(() => {
          generateDescriptionsButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }

      if (event.target) event.target.value = '';
    },
    [photos.length]
  );

  const handlePhotoRemove = useCallback((id: string) => {
    setPhotos(prev => {
      const photoToRemove = prev.find(p => p.id === id);
      if (photoToRemove) URL.revokeObjectURL(photoToRemove.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const callWithRetry = async (fnName: string, data: unknown, maxRetries = 2) => {
    let lastError: unknown;
    const callableFn = httpsCallable<unknown, { photoDescription: string }>(functions, fnName);

    for (let i = 0; i <= maxRetries; i++) {
      try {
        const result = await callableFn(data);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`Function ${fnName} failed (attempt ${i + 1}/${maxRetries + 1}). Retrying...`, error);
        if (i < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
        }
      }
    }
    throw lastError;
  };

  const validateAndFocusFirstMissing = useCallback((): boolean => {
    const values = form.getValues();
    let target: { id: string; name?: 'teachingArea' | 'meetingType' | 'meetingTopic' | 'meetingDate' | 'communityMembers'; label: string } | null = null;

    if (!values.teachingArea) target = { id: 'field-teachingArea', name: 'teachingArea', label: '教學領域' };
    else if (!values.meetingType) target = { id: 'field-meetingType', name: 'meetingType', label: '會議類別' };
    else if (!values.meetingTopic) target = { id: 'field-meetingTopic', name: 'meetingTopic', label: '會議主題' };
    else if (!values.meetingDate) target = { id: 'field-meetingDate', name: 'meetingDate', label: '會議日期' };
    else if (!values.communityMembers) target = { id: 'field-communityMembers', name: 'communityMembers', label: '社群成員' };
    else if (photos.length === 0) target = { id: 'field-photos', label: '會議照片' };

    if (!target) return true;

    const el = document.getElementById(target.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('animate-field-highlight');
      setTimeout(() => el.classList.remove('animate-field-highlight'), 2500);
      if (target.name) {
        form.setError(target.name, { type: 'manual', message: `請輸入${target.label}` });
        setTimeout(() => {
          const focusable = el.querySelector('input, textarea, select, button[role="combobox"], button[type="button"]') as HTMLElement | null;
          focusable?.focus();
        }, 600);
      }
    }

    toast({
      title: `尚未填寫：${target.label}`,
      description: '已自動捲動到該欄位，請補齊後再試。',
      variant: 'destructive',
    });
    return false;
  }, [form, photos, toast]);

  const handleGenerateDescriptions = useCallback(async () => {
    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    setIsGeneratingAllDescriptions(true);
    setDescriptionProgress(0);

    if (photos.length > 0) {
      setTimeout(() => {
        const firstPhotoId = photos[0].id;
        const element = photoRefs.current[firstPhotoId];
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }

    let index = 0;
    for (const photo of photos) {
      index++;
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, isGenerating: true } : p));
      photoRefs.current[photo.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      try {
        const response = await callWithRetry('generatePhotoDescriptions', {
          teachingArea,
          meetingTopic,
          communityMembers,
          meetingDate: format(meetingDate, 'yyyy-MM-dd'),
          photoDataUri: photo.dataUrl!,
        });
        const result = response.data;

        const isError = result.photoDescription.includes('忙碌') || result.photoDescription.includes('錯誤') || result.photoDescription.includes('機制') || result.photoDescription.includes('無法描述');

        setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: result.photoDescription, isGenerating: false } : p));

        if (!isError) {
          const element = photoRefs.current[photo.id];
          if (element) {
            const rect = element.getBoundingClientRect();
            confetti({
              particleCount: 100,
              spread: 70,
              origin: {
                x: (rect.left + rect.width / 2) / window.innerWidth,
                y: (rect.top + rect.height / 2) / window.innerHeight,
              },
            });
          }
        }

        if (isError) {
          toast({ title: '處理異常', description: `照片 ${index}：${result.photoDescription}`, variant: 'destructive' });
        }
      } catch (error) {
        setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, description: '產出失敗', isGenerating: false } : p));
      }

      setDescriptionProgress(Math.round((index / photos.length) * 100));

      if (index < photos.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setIsGeneratingAllDescriptions(false);
    toast({ title: '照片描述處理完畢', description: '所有圖片已處理完成。' });
  }, [form, photos, toast, validateAndFocusFirstMissing]);

  const handleGenerateSingleDescription = useCallback(async (photoId: string) => {
    const photo = photos.find(p => p.id === photoId);
    if (!photo || photo.isGenerating) return;

    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();

    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isGenerating: true } : p));

    try {
      const response = await callWithRetry('generatePhotoDescriptions', {
        teachingArea,
        meetingTopic,
        communityMembers,
        meetingDate: format(meetingDate, 'yyyy-MM-dd'),
        photoDataUri: photo.dataUrl!,
      });
      const result = response.data;

      const isError = result.photoDescription.includes('忙碌') || result.photoDescription.includes('錯誤') || result.photoDescription.includes('機制') || result.photoDescription.includes('無法描述');

      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, description: result.photoDescription, isGenerating: false } : p));

      if (!isError) {
        const element = photoRefs.current[photoId];
        if (element) {
          const rect = element.getBoundingClientRect();
          confetti({
            particleCount: 100,
            spread: 70,
            origin: {
              x: (rect.left + rect.width / 2) / window.innerWidth,
              y: (rect.top + rect.height / 2) / window.innerHeight,
            },
          });
        }
      } else {
        toast({ title: '處理異常', description: result.photoDescription, variant: 'destructive' });
      }
    } catch (error) {
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, description: '產出失敗', isGenerating: false } : p));
      toast({ title: '系統錯誤', description: '呼叫分析函式時發生錯誤。', variant: 'destructive' });
    }
  }, [form, photos, toast, validateAndFocusFirstMissing]);

  const handleGenerateSummary = useCallback(async () => {
    if (!validateAndFocusFirstMissing()) return;
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();
    const photoDescriptions = photos.map(p => p.description).filter(d => d && !d.includes('失敗') && !d.includes('忙碌') && !d.includes('無法描述'));

    setIsGeneratingSummary(true);
    setSummaryGenerationProgress(0);

    setTimeout(() => {
      summaryProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    try {
      const generateSummaryFn = httpsCallable<unknown, { summary: string }>(functions, 'generateMeetingSummary');
      const response = await generateSummaryFn({
        meetingType,
        teachingArea,
        meetingTopic,
        meetingDate: format(meetingDate, 'yyyy-MM-dd'),
        communityMembers,
        photoDescriptions,
      });
      setSummary(response.data.summary);
      setSummaryGenerationProgress(100);

      fireMassiveConfetti();

      setTimeout(() => {
        summaryPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setIsGeneratingSummary(false);
        setSummaryGenerationProgress(null);
      }, 600);
    } catch (error) {
      setIsGeneratingSummary(false);
      setSummaryGenerationProgress(null);
      toast({ title: '產生摘要失敗', description: '請稍後再試。', variant: 'destructive' });
    }
  }, [form, photos, toast, validateAndFocusFirstMissing]);

  useEffect(() => {
    if (isGeneratingSummary && summaryGenerationProgress !== null && summaryGenerationProgress < 90) {
      const timer = setInterval(() => {
        setSummaryGenerationProgress(prev => (prev !== null && prev < 90 ? prev + 5 : prev));
      }, 500);
      return () => clearInterval(timer);
    }
  }, [isGeneratingSummary, summaryGenerationProgress]);

  const exportToWord = useCallback(async () => {
    if (!summary) return;
    const { teachingArea, meetingType, meetingTopic, meetingDate, communityMembers } = form.getValues();

    const dynamicTitle = meetingType === '其他' ? '教師會議研究報告' : `${meetingType}成果報告`;
    const displayTopic = meetingType === '其他' ? meetingTopic : `${meetingType} - ${meetingTopic}`;
    const memberList = communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== '');

    const dataUrlToUint8Array = (dataUrl: string) => {
      const base64 = dataUrl.split(',')[1];
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      return bytes;
    };

    const parseMarkdownToDocx = (text: string) => {
      const lines = text.split('\n');
      const elements: Paragraph[] = [];
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) { elements.push(new Paragraph({ children: [new TextRun('')] })); return; }
        if (trimmed.startsWith('### ')) {
          elements.push(new Paragraph({ children: [new TextRun({ text: trimmed.replace('### ', ''), bold: true, size: 28, color: '2c3e50' })], heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 150 } }));
          return;
        }
        if (trimmed.startsWith('## ')) {
          elements.push(new Paragraph({ children: [new TextRun({ text: trimmed.replace('## ', ''), bold: true, size: 32, color: '1a252f' })], heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));
          return;
        }
        const isOrderedList = /^\d+\.\s/.test(trimmed);
        const isUnorderedList = /^[*+-]\s/.test(trimmed);
        if (isOrderedList || isUnorderedList) {
          const content = trimmed.replace(/^(\d+\.|[*+-])\s/, '');
          const parts = content.split(/(\*\*.*?\*\*)/);
          const children = parts.map(part => part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
          elements.push(new Paragraph({ children, bullet: isUnorderedList ? { level: 0 } : undefined, indent: { left: 720 }, spacing: { before: 80, after: 80 } }));
          return;
        }
        const parts = trimmed.split(/(\*\*.*?\*\*)/);
        const children = parts.map(part => part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part));
        elements.push(new Paragraph({ children, spacing: { before: 120, after: 120 } }));
      });
      return elements;
    };

    /* ─────────────────────────────────────────────────────────
     * 照片紀錄 — 2×2 表格版型（v0.5.3）
     *   ┌──────────────┬──────────────┐
     *   │   Photo A    │   Photo B    │   ← 圖片列
     *   ├──────────────┼──────────────┤
     *   │ 說明: descA  │ 說明: descB  │   ← 說明列
     *   ├──────────────┼──────────────┤
     *   │   Photo C    │   Photo D    │
     *   ├──────────────┼──────────────┤
     *   │ 說明: descC  │ 說明: descD  │
     *   └──────────────┴──────────────┘
     * ───────────────────────────────────────────────────────── */
    const makePhotoCell = (photo: Photo | undefined) => {
      if (photo?.dataUrl) {
        return new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
          children: [new Paragraph({
            children: [new ImageRun({
              data: dataUrlToUint8Array(photo.dataUrl),
              transformation: { width: 280, height: 180 },
            } as any)],
            alignment: AlignmentType.CENTER,
          })],
        });
      }
      return new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun('')] })],
      });
    };

    const makeDescCell = (photo: Photo | undefined) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: 'f8f9fa' },
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: '說明：', bold: true, color: '495057' }),
          new TextRun({ text: photo?.description || '' }),
        ],
        spacing: { before: 60, after: 60 },
      })],
    });

    const photoTableRows: TableRow[] = [];
    for (let i = 0; i < photos.length; i += 2) {
      const photoA = photos[i];
      const photoB = photos[i + 1];
      // 照片列
      photoTableRows.push(new TableRow({
        children: [makePhotoCell(photoA), makePhotoCell(photoB)],
      }));
      // 說明列
      photoTableRows.push(new TableRow({
        children: [makeDescCell(photoA), makeDescCell(photoB)],
      }));
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          new Paragraph({ text: `領域共備GO - ${dynamicTitle}`, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 500 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            rows: [
              new TableRow({ children: [
                new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, shading: { fill: 'f8f9fa' }, children: [new Paragraph({ children: [new TextRun({ text: '教學領域', bold: true, color: '495057' })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, children: [new Paragraph({ text: teachingArea, alignment: AlignmentType.LEFT })] }),
              ] }),
              new TableRow({ children: [
                new TableCell({ shading: { fill: 'f8f9fa' }, children: [new Paragraph({ children: [new TextRun({ text: '會議主題', bold: true, color: '495057' })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [new Paragraph({ text: displayTopic, alignment: AlignmentType.LEFT })] }),
              ] }),
              new TableRow({ children: [
                new TableCell({ shading: { fill: 'f8f9fa' }, children: [new Paragraph({ children: [new TextRun({ text: '會議日期', bold: true, color: '495057' })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [new Paragraph({ text: format(meetingDate, 'yyyy年MM月dd日'), alignment: AlignmentType.LEFT })] }),
              ] }),
              new TableRow({ children: [
                new TableCell({ shading: { fill: 'f8f9fa' }, children: [new Paragraph({ children: [new TextRun({ text: '社群成員', bold: true, color: '495057' })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [new Paragraph({ text: communityMembers, alignment: AlignmentType.LEFT })] }),
              ] }),
            ],
          }),
          new Paragraph({ text: '與會人員簽到表', heading: HeadingLevel.HEADING_2, spacing: { before: 600, after: 300 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [
                new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, shading: { fill: 'e9ecef' }, children: [new Paragraph({ children: [new TextRun({ text: '姓名', bold: true, size: 28 })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: 'e9ecef' }, children: [new Paragraph({ children: [new TextRun({ text: '簽到', bold: true, size: 28 })], alignment: AlignmentType.CENTER })] }),
                new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: 'e9ecef' }, children: [new Paragraph({ children: [new TextRun({ text: '簽退', bold: true, size: 28 })], alignment: AlignmentType.CENTER })] }),
              ] }),
              ...memberList.map(member => new TableRow({ children: [
                new TableCell({
                  verticalAlign: VerticalAlign.CENTER,
                  children: [new Paragraph({ children: [new TextRun({ text: member, size: 32, bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 } })],
                }),
                new TableCell({ children: [new Paragraph({ spacing: { before: 600, after: 600 } })] }),
                new TableCell({ children: [new Paragraph({ spacing: { before: 600, after: 600 } })] }),
              ] })),
            ],
          }),
          new Paragraph({ text: '照片紀錄', heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...(photoTableRows.length > 0 ? [new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: photoTableRows,
          })] : []),
          new Paragraph({ text: '會議總結', heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...parseMarkdownToDocx(summary),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `會議報告_${displayTopic}_${format(new Date(), 'yyyyMMdd')}.docx`);
    toast({ title: '匯出成功', description: '優化版 Word 檔案已開始下載。' });

    httpsCallable(functions, 'notifyExport')({
      exportType: 'word',
      teachingArea,
      meetingTopic,
      meetingDate: format(meetingDate, 'yyyy-MM-dd'),
      communityMembers,
    }).catch(() => { /* 通知失敗忽略 */ });
  }, [summary, photos, form, toast]);

  const exportToPDF = useCallback(() => {
    if (!summary) return;
    toast({
      title: '🖨️ 即將開啟列印對話框',
      description: '請在對話框中選擇「另存為 PDF」並按下儲存即可下載報告。',
    });

    const { teachingArea, meetingTopic, meetingDate, communityMembers } = form.getValues();
    httpsCallable(functions, 'notifyExport')({
      exportType: 'pdf',
      teachingArea,
      meetingTopic,
      meetingDate: meetingDate ? format(meetingDate, 'yyyy-MM-dd') : '',
      communityMembers,
    }).catch(() => { /* 通知失敗忽略 */ });

    setTimeout(() => window.print(), 400);
  }, [summary, form, toast]);

  const allDescribed = photos.length > 0 && photos.every(p => !!p.description && !p.isGenerating);
  const canSummarize = allDescribed;
  const doneCount = photos.filter(p => !!p.description && !p.isGenerating).length;

  return (
    <TooltipProvider>
      <div className="dmg-shell" id="report-content">
        <EditorialHeader />

        <Form {...form}>
          <main className="dmg-main">
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
              {/* Step 1 — 會議資訊 */}
              <StepCard
                index={1}
                accent="ink"
                icon={<Info size={22} />}
                kicker="STEP 01 · BASIC INFO"
                title="輸入會議資訊"
                status={<span className="dmg-pill dmg-pill--ink">5 個欄位</span>}
              >
                <div className="dmg-grid--info">
                  <FormField control={form.control} name="teachingArea" render={({ field }) => (
                    <FormItem id="field-teachingArea" className="dmg-field">
                      <FieldLabel label="教學領域" hint="REQUIRED" htmlFor="teaching-area" />
                      <FormControl>
                        <input id="teaching-area" className="dmg-input" placeholder="國語、數學、社會…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="meetingType" render={({ field }) => (
                    <FormItem id="field-meetingType" className="dmg-field">
                      <FieldLabel label="會議類別" htmlFor="meeting-type" />
                      <FormControl>
                        <div className="dmg-select">
                          <select id="meeting-type" {...field}>
                            <option value="備課會議">備課會議</option>
                            <option value="觀課紀錄">觀課紀錄</option>
                            <option value="議課總整理">議課總整理</option>
                            <option value="講座研討報告">講座研討報告</option>
                            <option value="社群會議紀錄">社群會議紀錄</option>
                            <option value="其他">其他 (自定義)</option>
                          </select>
                          <ChevronDown size={14} className="dmg-select__chev" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="meetingTopic" render={({ field }) => (
                    <FormItem id="field-meetingTopic" className="dmg-field dmg-field--full">
                      <FieldLabel
                        label={form.watch('meetingType') === '其他' ? '自定義會議主題' : '會議詳細主題'}
                        hint="REQUIRED"
                        htmlFor="meeting-topic"
                      />
                      <FormControl>
                        <input id="meeting-topic" className="dmg-input" placeholder="例如：公開觀課教學現場紀錄…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="meetingDate" render={({ field }) => (
                    <FormItem id="field-meetingDate" className="dmg-field">
                      <FieldLabel label="會議日期" htmlFor="meeting-date" />
                      <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                        <PopoverTrigger asChild>
                          <button
                            id="meeting-date"
                            type="button"
                            className={cn('dmg-date__btn', !field.value && 'dmg-date__btn--placeholder')}
                          >
                            {field.value ? format(field.value, 'yyyy 年 MM 月 dd 日') : '選擇日期'}
                            <CalendarIcon size={16} className="dmg-date__icon" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={(date) => { field.onChange(date); setIsDatePickerOpen(false); }} initialFocus />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="communityMembers" render={({ field }) => (
                    <FormItem id="field-communityMembers" className="dmg-field">
                      <FieldLabel label="社群成員" hint="以、或，分隔" htmlFor="community-members" />
                      <FormControl>
                        <input id="community-members" className="dmg-input" placeholder="王老師、李老師…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </StepCard>

              {/* Step 2 — 上傳會議照片 */}
              <StepCard
                index={2}
                accent="accent"
                icon={<ImageIcon size={22} />}
                kicker="STEP 02 · GALLERY"
                title="上傳會議照片"
                status={<span className="dmg-pill dmg-pill--accent">{photos.length} / {MAX_PHOTOS}</span>}
              >
                <label
                  id="field-photos"
                  htmlFor="photo-upload"
                  className="dmg-upload"
                >
                  <div className="dmg-upload__icon"><UploadCloud size={28} /></div>
                  <div>
                    <div className="dmg-upload__title">點擊或拖曳上傳照片</div>
                    <div className="dmg-upload__sub">JPG / PNG / WEBP · 單檔 ≤ 20 MB · 最多 {MAX_PHOTOS} 張</div>
                  </div>
                  <div className="dmg-upload__cta">選擇檔案</div>
                  <input
                    id="photo-upload"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>

                {photos.length > 0 && (
                  <div className="dmg-gallery">
                    {photos.map((photo) => {
                      const isFailed = !!photo.description && /失敗|忙碌|錯誤|機制|無法描述|配額|安全/.test(photo.description);
                      const hasDescription = !!photo.description;
                      const isPending = !photo.isGenerating && !hasDescription;

                      return (
                        <div
                          key={photo.id}
                          ref={el => { photoRefs.current[photo.id] = el; }}
                          className={cn(
                            'dmg-photo',
                            photo.isGenerating && 'is-processing',
                            isPending && 'is-pending',
                            isFailed && 'is-failed animate-card-shake',
                          )}
                        >
                          <div className="dmg-photo__frame">
                            <NextImage
                              src={photo.previewUrl}
                              alt=""
                              fill
                              sizes="(max-width: 720px) 50vw, 25vw"
                              style={{ objectFit: 'cover' }}
                              unoptimized
                            />
                            <button type="button" className="dmg-photo__x" onClick={() => handlePhotoRemove(photo.id)} aria-label="移除">
                              <X size={14} />
                            </button>
                            {!photo.isGenerating && hasDescription && !isFailed && (
                              <button
                                type="button"
                                className="dmg-photo__regen"
                                onClick={() => handleGenerateSingleDescription(photo.id)}
                                title="重新產生描述"
                              >
                                <RefreshCw size={13} />
                              </button>
                            )}
                            {photo.isGenerating && (
                              <div className="dmg-photo__veil">
                                <div className="dmg-photo__spinner" />
                                <div className="dmg-photo__veiltxt">AI 觀察中…</div>
                              </div>
                            )}
                            {isFailed && (
                              <button
                                type="button"
                                className="dmg-photo__retry"
                                onClick={() => handleGenerateSingleDescription(photo.id)}
                              >
                                <RefreshCw size={14} className="animate-spin-slow" />
                                再試一次
                              </button>
                            )}
                          </div>
                          <div className="dmg-photo__caption">
                            <div className="dmg-photo__caplabel">
                              {isFailed ? '⚠ 處理異常' : '觀察 · OBSERVATION'}
                            </div>
                            <p className="dmg-photo__captext">
                              {photo.description || '尚未產生描述 — 請按下『產生照片描述』開始分析'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="dmg-actionbar">
                  <button
                    type="button"
                    ref={generateDescriptionsButtonRef}
                    onClick={handleGenerateDescriptions}
                    disabled={isGeneratingAllDescriptions || photos.length === 0}
                    className="dmg-btn dmg-btn--primary"
                  >
                    {isGeneratingAllDescriptions
                      ? <><Loader2 size={16} className="animate-spin" /> <span>描述產生中…</span></>
                      : <><Sparkles size={16} /> <span>產生照片描述</span></>}
                  </button>
                  <div className={cn('dmg-progress', descriptionProgress !== null && 'is-on')}>
                    <div className="dmg-progress__bar" style={{ width: `${descriptionProgress ?? 0}%` }} />
                    <div className="dmg-progress__txt">
                      {descriptionProgress !== null ? `${descriptionProgress}%` : '尚未開始'}
                    </div>
                  </div>
                </div>
              </StepCard>

              {/* Step 3 — 產生會議摘要 */}
              <StepCard
                index={3}
                accent="ink"
                icon={<FileText size={22} />}
                kicker="STEP 03 · AI SYNTHESIS"
                title="產生會議摘要"
                status={
                  <span className={cn('dmg-pill', canSummarize ? 'dmg-pill--ink' : 'dmg-pill--mute')}>
                    {canSummarize ? '可開始產出' : '請先完成描述'}
                  </span>
                }
              >
                <div className="dmg-summary-meta">
                  <div>
                    <div className="dmg-summary-meta__k">資料來源</div>
                    <div className="dmg-summary-meta__v">基本資訊 · {doneCount} 張照片描述</div>
                  </div>
                  <div>
                    <div className="dmg-summary-meta__k">產出長度</div>
                    <div className="dmg-summary-meta__v">300 – 500 字 · 期刊版型</div>
                  </div>
                  <div>
                    <div className="dmg-summary-meta__k">使用模型</div>
                    <div className="dmg-summary-meta__v">Gemini 2.5 Flash Lite</div>
                  </div>
                </div>

                <div className="dmg-actionbar" ref={summaryProgressRef}>
                  <button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={isGeneratingSummary || photos.length === 0}
                    className="dmg-btn dmg-btn--ink"
                  >
                    {isGeneratingSummary
                      ? <><Loader2 size={16} className="animate-spin" /> <span>正在編輯…</span></>
                      : <><Sparkles size={16} /> <span>產生會議摘要</span></>}
                  </button>
                  {summaryGenerationProgress !== null && (
                    <div className="dmg-progress is-on">
                      <div className="dmg-progress__bar" style={{ width: `${summaryGenerationProgress}%` }} />
                      <div className="dmg-progress__txt">{summaryGenerationProgress}%</div>
                    </div>
                  )}
                </div>

                {summary && (
                  <div ref={summaryPreviewRef} className="dmg-summary-wrap">
                    <EditorialSummary
                      markdown={summary}
                      info={{
                        area: form.getValues().teachingArea,
                        type: form.getValues().meetingType,
                        topic: form.getValues().meetingTopic,
                        date: form.getValues().meetingDate ? format(form.getValues().meetingDate, 'yyyy-MM-dd') : '',
                        members: form.getValues().communityMembers,
                      }}
                    />
                  </div>
                )}
              </StepCard>

              {/* Step 4 — 匯出報告 */}
              <StepCard
                index={4}
                accent="accent"
                icon={<Download size={22} />}
                kicker="STEP 04 · EXPORT"
                title="匯出報告"
                status={
                  <span className={cn('dmg-pill', summary ? 'dmg-pill--accent' : 'dmg-pill--mute')}>
                    {summary ? '可匯出' : '尚未產出摘要'}
                  </span>
                }
              >
                <div className="dmg-export no-print">
                  <button
                    type="button"
                    className="dmg-export-card"
                    disabled={!summary}
                    onClick={exportToWord}
                  >
                    <div className="dmg-export-card__icon"><Download size={22} /></div>
                    <div>
                      <div className="dmg-export-card__t">Word 文件</div>
                      <div className="dmg-export-card__s">.docx · 含簽到表 · {photos.length} 張照片 · 摘要全文</div>
                    </div>
                    <div className="dmg-export-card__chev"><ChevronRight size={16} /></div>
                  </button>
                  <button
                    type="button"
                    className="dmg-export-card dmg-export-card--accent"
                    disabled={!summary}
                    onClick={exportToPDF}
                  >
                    <div className="dmg-export-card__icon"><Printer size={22} /></div>
                    <div>
                      <div className="dmg-export-card__t">列印 / 儲存為 PDF</div>
                      <div className="dmg-export-card__s">A4 · 期刊版型 · 中文字型完美</div>
                    </div>
                    <div className="dmg-export-card__chev"><ChevronRight size={16} /></div>
                  </button>
                </div>
              </StepCard>
            </form>

            <footer className="dmg-foot no-print">
              <div className="dmg-foot__rule" />
              <div className="dmg-foot__row">
                <span>領域共備GO · 教師專業社群協力誌</span>
                <span>由 Gemini 提供 AI 能力</span>
                <span>
                  Made with <span aria-label="愛心" className="dmg-foot__heart">❤️</span> by{' '}
                  <a
                    href="https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dmg-foot__author"
                  >
                    阿凱老師
                  </a>
                </span>
              </div>
            </footer>
          </main>
        </Form>
      </div>

      {/* Floating Buttons */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 no-print">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://document-ai-companion-ipad4.replit.app"
                target="_blank"
                className="group flex items-center justify-center gap-0 md:gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 w-14 h-14 md:w-auto md:h-auto md:px-6 md:py-3.5 text-white shadow-lg shadow-purple-900/20 border border-white/10 hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              >
                <span className="text-xl shrink-0">🦄</span>
                <span className="hidden md:inline text-sm font-bold tracking-wide whitespace-nowrap">創建專屬助手</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="left" className="md:hidden"><p>創建專屬助手🦄</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://line.me/R/ti/p/@733oiboa?oat_content=url&ts=05120012"
                target="_blank"
                className="group flex items-center justify-center gap-0 md:gap-2 rounded-full bg-gradient-to-r from-amber-500 to-rose-600 w-14 h-14 md:w-auto md:h-auto md:px-6 md:py-3.5 text-white shadow-lg shadow-orange-900/20 border border-white/10 hover:shadow-orange-500/40 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              >
                <span className="text-xl shrink-0">🐝</span>
                <span className="hidden md:inline text-sm font-bold tracking-wide whitespace-nowrap">點『石』成金 (評語優化)</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="left" className="md:hidden"><p>點『石』成金🐝 (評語優化)</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Toaster />

      {/* --- 列印專用隱藏範本 (專業文書白底版) --- */}
      <div id="printable-report" style={{
        display: 'none',
        width: '900px',
        backgroundColor: 'white',
        color: 'black',
        padding: '60px 80px',
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        lineHeight: '1.6',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px', borderBottom: '3px solid #3b82f6', paddingBottom: '20px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 900, marginBottom: '8px', color: '#1e3a8a', letterSpacing: '2px' }}>領 域 共 備 G O</h1>
          <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 500 }}>教師專業社群協力發展成果報告</div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginBottom: '5px' }}>
            {form.getValues().meetingType === '其他' ? '教師會議研究報告' : `${form.getValues().meetingType}成果報告`}
          </h2>
          <div style={{ width: '60px', height: '4px', backgroundColor: '#3b82f6', margin: '15px auto' }}></div>
        </div>

        <div className="pdf-section" style={{ backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '25px', marginBottom: '40px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #3b82f6', paddingLeft: '15px' }}>基本資訊 Basic Information</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                { label: '教學領域', value: form.getValues().teachingArea },
                { label: '會議主題', value: form.getValues().meetingTopic },
                { label: '會議日期', value: form.getValues().meetingDate ? format(form.getValues().meetingDate, 'yyyy 年 MM 月 dd 日') : '' },
                { label: '社群成員', value: form.getValues().communityMembers },
              ].map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '12px 10px', fontWeight: 'bold', width: '25%', color: '#475569', fontSize: '15px', verticalAlign: 'top' }}>{item.label}：</td>
                  <td style={{ padding: '12px 10px', color: '#1e293b', fontSize: '15px', lineHeight: '1.6' }}>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pdf-section" style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '25px', marginBottom: '40px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #10b981', paddingLeft: '15px' }}>與會人員簽到表 Attendance</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '30%', textAlign: 'center', color: '#475569' }}>姓名</th>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '35%', textAlign: 'center', color: '#475569' }}>簽到 Sign In</th>
                <th style={{ border: '1px solid #cbd5e1', padding: '12px', width: '35%', textAlign: 'center', color: '#475569' }}>簽退 Sign Out</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const members = form.getValues().communityMembers.split(/[，,、\s]+/).filter(m => m.trim() !== '');
                return members.map((member, i) => (
                  <tr key={i}>
                    <td style={{ border: '1px solid #cbd5e1', padding: '20px 10px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#1e293b' }}>{member}</td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '35px' }}></td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '35px' }}></td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>

        {photos.length > 0 && (
          <div style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '15px', borderLeft: '5px solid #f59e0b', paddingLeft: '15px', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>
              活動照片記錄 Field Gallery
            </h3>
            <table className="photo-grid-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <tbody>
                {Array.from({ length: Math.ceil(photos.length / 2) }).map((_, rowIdx) => {
                  const photoA = photos[rowIdx * 2];
                  const photoB = photos[rowIdx * 2 + 1];
                  return (
                    <React.Fragment key={rowIdx}>
                      <tr className="photo-row" style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td style={{ width: '50%', border: '1px solid #cbd5e1', padding: '12px', textAlign: 'center', verticalAlign: 'middle', height: '230px', backgroundColor: 'white' }}>
                          {photoA?.dataUrl && <img src={photoA.dataUrl} style={{ maxWidth: '100%', maxHeight: '210px', display: 'block', margin: '0 auto', objectFit: 'contain' }} />}
                        </td>
                        <td style={{ width: '50%', border: '1px solid #cbd5e1', padding: '12px', textAlign: 'center', verticalAlign: 'middle', height: '230px', backgroundColor: 'white' }}>
                          {photoB?.dataUrl && <img src={photoB.dataUrl} style={{ maxWidth: '100%', maxHeight: '210px', display: 'block', margin: '0 auto', objectFit: 'contain' }} />}
                        </td>
                      </tr>
                      <tr className="desc-row" style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td style={{ border: '1px solid #cbd5e1', padding: '10px 14px', verticalAlign: 'top', backgroundColor: '#f8fafc', fontSize: '13px', lineHeight: 1.6, color: '#334155' }}>
                          {photoA && (<><strong style={{ color: '#475569', marginRight: '4px' }}>說明：</strong>{photoA.description || ''}</>)}
                        </td>
                        <td style={{ border: '1px solid #cbd5e1', padding: '10px 14px', verticalAlign: 'top', backgroundColor: '#f8fafc', fontSize: '13px', lineHeight: 1.6, color: '#334155' }}>
                          {photoB && (<><strong style={{ color: '#475569', marginRight: '4px' }}>說明：</strong>{photoB.description || ''}</>)}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pdf-summary-wrapper" style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '30px',
          marginBottom: '40px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
        }}>
          <h3 className="pdf-avoid" style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', marginBottom: '20px', borderLeft: '5px solid #8b5cf6', paddingLeft: '15px', pageBreakAfter: 'avoid', breakAfter: 'avoid' }}>會議深度總結 Meeting Synopsis</h3>
          <div style={{ fontSize: '16px', lineHeight: '1.8', color: '#1e293b' }} className="pdf-markdown-summary prose prose-slate max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => (<p style={{ pageBreakInside: 'avoid', breakInside: 'avoid', orphans: 3, widows: 3, marginBottom: '12px' }}>{children}</p>),
                li: ({ children }) => (<li style={{ pageBreakInside: 'avoid', breakInside: 'avoid', orphans: 3, widows: 3, marginBottom: '6px' }}>{children}</li>),
                h1: ({ children }) => (<h1 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '20px', marginBottom: '12px' }}>{children}</h1>),
                h2: ({ children }) => (<h2 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '18px', marginBottom: '10px' }}>{children}</h2>),
                h3: ({ children }) => (<h3 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '16px', marginBottom: '8px' }}>{children}</h3>),
                h4: ({ children }) => (<h4 style={{ pageBreakInside: 'avoid', breakInside: 'avoid', pageBreakAfter: 'avoid', breakAfter: 'avoid', marginTop: '14px', marginBottom: '6px' }}>{children}</h4>),
                blockquote: ({ children }) => (<blockquote style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>{children}</blockquote>),
              }}
            >{summary}</ReactMarkdown>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '50px', borderTop: '1px solid #e2e8f0', paddingTop: '20px', fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif' }}>
          {/* 主署名 — 教師個人品牌（professional designer credit）*/}
          <div style={{ fontSize: '14px', color: '#1e293b', marginBottom: '8px', letterSpacing: '0.02em' }}>
            Made with{' '}
            <span style={{ color: '#dc2626', fontSize: '16px', display: 'inline-block', transform: 'translateY(2px)', margin: '0 1px' }}>♥</span>{' '}
            by{' '}
            <a
              href="https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1e293b', fontWeight: 700, textDecoration: 'none', borderBottom: '1px dotted #64748b', paddingBottom: '1px' }}
            >
              阿凱老師
            </a>
          </div>
          {/* 副標 — domain + 原本的免責聲明 */}
          <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.08em', marginBottom: '4px' }}>
            CAGOOOO.GITHUB.IO / DOMAIN-MEETING-GO
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.02em' }}>
            本報告由「領域共備GO」AI 助手自動生成 · 僅供教育研究與內部紀錄使用
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
