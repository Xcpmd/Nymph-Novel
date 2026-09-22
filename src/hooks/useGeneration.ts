'use client';

import { useCallback, useRef, useState } from 'react';
import type { StoryEventStep } from '@/lib/types';

/**
 * 流式生成钩子。
 * 直接消费服务端的 Server-Sent Events，做到逐字显示与随时暂停。
 * 暂停时服务端会把已生成内容写入生成任务记录，携带 runId 即可继续。
 */

export interface GenerationLayer {
  key: string;
  label: string;
  tokens: number;
  trimmed: boolean;
  always: boolean;
}

/** 事件流程状态，界面据此决定展示方向选项、大纲确认还是正文工作台。 */
export interface GenerationFlow {
  isFirstChapter: boolean;
  needsDirection: boolean;
  event: {
    id: string;
    title: string;
    novelTime: string;
    progress: number;
    stepCount: number;
    status: string;
  } | null;
}

export interface GenerationMeta {
  runId: string;
  providerId: string;
  providerName: string;
  model: string;
  taskType: string;
  taskLabel: string;
  contextTokens: number;
  layers: GenerationLayer[];
  citations: Array<{ kind: string; id: string; label: string; tokens: number }>;
  trimmed: boolean;
  flow?: GenerationFlow;
}

export interface GenerationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  durationMs: number;
}

/** 事件大纲产出，落库后的完整事件记录。 */
export interface EventOutlineResult {
  eventId: string;
  mode: 'created' | 'revised';
  title: string;
  outline: string;
  novelTime: string;
  steps: StoryEventStep[];
  progress: number;
  timelineEventId?: string | null;
}

/** 事件进度推进结果。 */
export interface AdvanceResult {
  eventId: string;
  progress: number;
  stepCount: number;
  status: string;
  completed: boolean;
  needsDirection: boolean;
  /** 本步只完成一部分时的剩余说明 */
  partial?: string;
}

/** 新设定整理结果。 */
export interface ExtractedResult {
  entries: number;
  characters: number;
  names: string[];
}

/** 模型提出的设定查询请求。 */
export interface QueryRequest {
  id: string;
  keyword: string;
  filled: boolean;
}

/** 模型提出的往期事件调阅请求。 */
export interface RecallRequestItem {
  id: string;
  eventId: string;
  eventTitle: string;
  reason: string;
}

export interface GenerationRequest {
  novelId: string;
  chapterId?: string | null;
  taskType: string;
  providerId?: string | null;
  model?: string | null;
  instruction?: string;
  direction?: string;
  optionCount?: number;
  existingContent?: string;
  revisionMode?: string;
  pinnedChapterIds?: string[];
  /** 当前工作的事件，缺省时由服务端取正在推进的事件 */
  eventId?: string | null;
  /** 用户为本次事件选定的方向 */
  userChoice?: string | null;
  overrideSystem?: string;
  overrideUser?: string;
  saveToChapter?: boolean;
  autoAdvanceEvent?: boolean;
  autoExtractSettings?: boolean;
  resumeFrom?: string;
  resumeRunId?: string;
  maxTokens?: number;
}

export function useGeneration() {
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'done' | 'error'>('idle');
  const [text, setText] = useState('');
  const [meta, setMeta] = useState<GenerationMeta | null>(null);
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  const [eventOutline, setEventOutline] = useState<EventOutlineResult | null>(null);
  const [advance, setAdvance] = useState<AdvanceResult | null>(null);
  const [extracted, setExtracted] = useState<ExtractedResult | null>(null);
  const [queries, setQueries] = useState<QueryRequest[]>([]);
  const [recalls, setRecalls] = useState<RecallRequestItem[]>([]);
  const [structured, setStructured] = useState<unknown>(null);
  const [saved, setSaved] = useState<{ chapterId: string; wordCount: number } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<GenerationRequest | null>(null);
  const bufferRef = useRef('');

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    bufferRef.current = '';
    setStatus('idle');
    setText('');
    setMeta(null);
    setUsage(null);
    setEventOutline(null);
    setAdvance(null);
    setExtracted(null);
    setQueries([]);
    setRecalls([]);
    setStructured(null);
    setSaved(null);
    setMessage('');
    setError(null);
  }, []);

  const start = useCallback(async (payload: GenerationRequest, keepExisting = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    lastRequestRef.current = payload;
    if (!keepExisting) {
      bufferRef.current = '';
      setText('');
      setMeta(null);
      setUsage(null);
      setEventOutline(null);
      setAdvance(null);
      setExtracted(null);
      setQueries([]);
      setRecalls([]);
      setStructured(null);
      setSaved(null);
    }
    setError(null);
    setMessage('');
    setStatus('running');

    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        let parsedMessage = `生成请求失败，状态码 ${response.status}`;
        try {
          const parsed = JSON.parse(detail) as { error?: string };
          if (parsed.error) parsedMessage = parsed.error;
        } catch {
          if (detail.trim()) parsedMessage = detail.slice(0, 300);
        }
        setStatus('error');
        setError(parsedMessage);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let pending = '';

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });

        const frames = pending.split('\n\n');
        pending = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          let eventName = 'message';
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;

          let data: unknown = null;
          try {
            data = JSON.parse(dataLine);
          } catch {
            continue;
          }

          switch (eventName) {
            case 'meta':
              setMeta(data as GenerationMeta);
              break;
            case 'delta': {
              const piece = (data as { text: string }).text;
              bufferRef.current += piece;
              setText(bufferRef.current);
              break;
            }
            case 'usage':
              setUsage(data as GenerationUsage);
              break;
            case 'event-outline':
              setEventOutline(data as EventOutlineResult);
              break;
            case 'advanced':
              setAdvance(data as AdvanceResult);
              break;
            case 'extracted':
              setExtracted(data as ExtractedResult);
              break;
            case 'queries':
              setQueries((data as { queries: QueryRequest[] }).queries);
              break;
            case 'recalls':
              setRecalls((data as { requests: RecallRequestItem[] }).requests);
              break;
            case 'json':
              setStructured((data as { data: unknown }).data);
              break;
            case 'saved':
              setSaved(data as { chapterId: string; wordCount: number });
              break;
            case 'stage':
              setMessage((data as { message: string }).message);
              break;
            case 'paused':
              setStatus('paused');
              setMessage('');
              break;
            case 'error':
              setError((data as { message: string }).message);
              break;
            case 'done':
              setMessage('');
              break;
            default:
              break;
          }
        }
      }

      if (controller.signal.aborted) {
        setStatus('paused');
      } else {
        setStatus((current) => (current === 'error' ? 'error' : 'done'));
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setStatus('paused');
      } else {
        setStatus('error');
        setError(caught instanceof Error ? caught.message : '生成失败');
      }
    }
  }, []);

  /** 暂停当前生成。服务端会把已生成内容写入任务记录，便于续接。 */
  const pause = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus('paused');
  }, []);

  /** 从断点继续。 */
  const resume = useCallback(async () => {
    const last = lastRequestRef.current;
    if (!last) return;
    await start(
      {
        ...last,
        resumeFrom: bufferRef.current,
        resumeRunId: meta?.runId ?? undefined,
      },
      true,
    );
  }, [meta?.runId, start]);

  return {
    status,
    text,
    meta,
    usage,
    eventOutline,
    advance,
    extracted,
    queries,
    recalls,
    structured,
    saved,
    message,
    error,
    start,
    pause,
    resume,
    reset,
    setText,
    lastRequest: lastRequestRef,
  };
}
