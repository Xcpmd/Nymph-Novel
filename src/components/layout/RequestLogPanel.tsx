'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Button, Spinner } from '@/components/ui/primitives';
import { TASK_LABELS } from '@/lib/ai/prompts';

/**
 * 请求日志面板。
 *
 * 每次调用模型都会在服务端留下一条记录，含实际发出的消息全文、
 * 模型输出、用量与失败原因。这里把它们列出来，
 * 便于回答「刚才到底发了什么」「这次为什么失败」这类问题。
 *
 * 面板挂在右下角，收起时只是一枚小圆钮，不占用正文空间。
 */

/** 服务端返回的记录，字段与 generation_runs 表对应。 */
interface RunLogEntry {
  id: string;
  taskType: string;
  model: string;
  providerId: string | null;
  status: string;
  promptText: string;
  partialText: string;
  usageJson: string;
  error: string;
  createdAt: string;
}

interface UsageDetail {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  estimated?: boolean;
}

/** 状态对应的中文说明与配色。 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: '进行中', className: 'chip-accent' },
  done: { label: '已完成', className: 'text-ok' },
  failed: { label: '失败', className: 'text-danger' },
  paused: { label: '已暂停', className: '' },
  cancelled: { label: '已取消', className: '' },
};

function parseUsage(raw: string): UsageDetail | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UsageDetail;
  } catch {
    return null;
  }
}

/** 取任务类型的中文名，未知类型原样显示。 */
function taskLabel(taskType: string): string {
  return (TASK_LABELS as Record<string, string>)[taskType] ?? taskType;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function RequestLogPanel({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ runs: RunLogEntry[] }>(
        `${novelResourcePath(novelId, 'generation-runs')}?limit=40`,
      );
      setRuns(result.runs ?? []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('logs.open')}
        title={t('logs.open')}
        className={clsx(
          'glass focus-glow fixed right-5 bottom-5 z-50 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted shadow-[var(--glass-highlight),var(--shadow-raised),var(--glow-accent)] transition-all duration-200 hover:text-accent-strong',
          open && 'text-accent-strong',
        )}
      >
        <i className={open ? 'fa-solid fa-xmark' : 'fa-solid fa-scroll'} aria-hidden />
      </button>

      {open ? (
        <div className="dropdown-panel animate-rise fixed right-5 bottom-20 z-50 flex max-h-[min(80vh,44rem)] w-[min(92vw,42rem)] flex-col">
          <header className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4 py-2.5">
            <i className="fa-solid fa-scroll text-[0.8rem] text-ink-faint" aria-hidden />
            <h2 className="text-sm font-semibold text-soft">{t('logs.title')}</h2>
            <span className="chip">{runs.length}</span>
            <Button size="sm" className="ml-auto" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner /> : <i className="fa-solid fa-rotate" aria-hidden />}
              {t('common.refresh')}
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {runs.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-ink-faint">
                {loading ? t('common.loading') : t('logs.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {runs.map((run) => {
                  const usage = parseUsage(run.usageJson);
                  const status = STATUS_META[run.status] ?? { label: run.status, className: '' };
                  const isOpen = expanded === run.id;
                  return (
                    <li
                      key={run.id}
                      className="rounded-[8px] border border-[var(--glass-border)] bg-[var(--glass-bg-sunken)]"
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : run.id)}
                        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
                      >
                        <span className={clsx('chip', status.className)}>{status.label}</span>
                        <span className="text-[0.78rem] font-medium">
                          {taskLabel(run.taskType)}
                        </span>
                        <span className="text-[0.7rem] text-ink-faint">{run.model}</span>
                        {usage?.totalTokens ? (
                          <span className="chip">
                            {usage.totalTokens} token
                          </span>
                        ) : null}
                        <span className="ml-auto text-[0.68rem] text-ink-faint">
                          {formatTime(run.createdAt)}
                        </span>
                        <i
                          className={clsx(
                            'fa-solid fa-chevron-down text-[0.62rem] text-ink-faint transition-transform duration-200',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </button>

                      {isOpen ? (
                        <div className="flex flex-col gap-2.5 border-t border-[var(--glass-border)] px-3 py-2.5">
                          {run.error ? (
                            <div className="rounded-[6px] bg-danger-soft px-2.5 py-2">
                              <p className="text-[0.68rem] font-semibold text-danger">
                                {t('logs.error')}
                              </p>
                              <p className="mt-0.5 text-[0.72rem] leading-relaxed whitespace-pre-wrap text-danger">
                                {run.error}
                              </p>
                            </div>
                          ) : null}

                          {usage ? (
                            <div className="flex flex-wrap gap-1.5">
                              <span className="chip">
                                {t('logs.promptTokens')} {usage.promptTokens ?? 0}
                              </span>
                              <span className="chip">
                                {t('logs.completionTokens')} {usage.completionTokens ?? 0}
                              </span>
                              <span className="chip">
                                {t('logs.totalTokens')} {usage.totalTokens ?? 0}
                              </span>
                              {usage.durationMs ? (
                                <span className="chip">
                                  {(usage.durationMs / 1000).toFixed(1)}s
                                </span>
                              ) : null}
                              {usage.estimated ? <span className="chip">{t('logs.estimated')}</span> : null}
                            </div>
                          ) : null}

                          <div>
                            <p className="panel-title">{t('logs.request')}</p>
                            <pre className="mt-1 max-h-52 overflow-y-auto rounded-[6px] bg-[var(--glass-bg)] px-2.5 py-2 text-[0.68rem] leading-relaxed whitespace-pre-wrap">
                              {run.promptText || t('logs.noContent')}
                            </pre>
                          </div>

                          <div>
                            <p className="panel-title">{t('logs.response')}</p>
                            <pre className="mt-1 max-h-52 overflow-y-auto rounded-[6px] bg-[var(--glass-bg)] px-2.5 py-2 text-[0.68rem] leading-relaxed whitespace-pre-wrap">
                              {run.partialText || t('logs.noContent')}
                            </pre>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
