'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime, formatNumber, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { Panel, ProgressBar, Spinner, StatBlock } from '@/components/ui/primitives';
import { TASK_LABELS } from '@/lib/ai/prompts';
import type { UsageLog } from '@/lib/types';

/** 用量统计。按任务类型与模型维度展示 token 消耗。 */

interface UsagePayload {
  logs: UsageLog[];
  summary: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    calls: number;
    byTask: Array<{ taskType: string; tokens: number; calls: number }>;
    byModel: Array<{ model: string; tokens: number; calls: number }>;
  };
}

export function UsageClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<UsagePayload>(`${novelResourcePath(novelId, 'usage')}?limit=200`);
      setData(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setLoading(false);
    }
  }, [novelId, t, toast]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  const { summary, logs } = data;
  const taskLabel = (taskType: string) =>
    (TASK_LABELS as Record<string, string>)[taskType] ?? taskType;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-semibold text-soft">{t('overview.tokenUsage')}</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          调用模型时统计的 token 用量。接口返回真实用量时以真实值为准，否则使用本地估算并在明细中标注。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          label={t('common.total')}
          value={formatNumber(summary.totalTokens)}
          sub={`${summary.calls} 次调用`}
          icon="fa-solid fa-coins"
        />
        <StatBlock
          label="输入"
          value={formatNumber(summary.promptTokens)}
          icon="fa-solid fa-arrow-right-to-bracket"
        />
        <StatBlock
          label="输出"
          value={formatNumber(summary.completionTokens)}
          icon="fa-solid fa-arrow-right-from-bracket"
        />
        <StatBlock
          label="平均每次"
          value={formatNumber(
            summary.calls > 0 ? Math.round(summary.totalTokens / summary.calls) : 0,
          )}
          icon="fa-solid fa-chart-line"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="按任务类型">
          {summary.byTask.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('common.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.byTask.map((item) => (
                <li key={item.taskType} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 truncate text-ink-muted">
                    {taskLabel(item.taskType)}
                  </span>
                  <ProgressBar
                    value={item.tokens}
                    max={Math.max(1, summary.totalTokens)}
                    className="flex-1"
                  />
                  <span className="w-20 shrink-0 text-right font-mono text-ink-faint">
                    {formatNumber(item.tokens)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-ink-faint">{item.calls}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="按模型">
          {summary.byModel.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('common.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.byModel.map((item) => (
                <li key={item.model} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 truncate font-mono text-ink-muted">
                    {item.model}
                  </span>
                  <ProgressBar
                    value={item.tokens}
                    max={Math.max(1, summary.totalTokens)}
                    className="flex-1"
                  />
                  <span className="w-20 shrink-0 text-right font-mono text-ink-faint">
                    {formatNumber(item.tokens)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-ink-faint">{item.calls}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t('common.detail')}>
        {logs.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('common.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">任务</th>
                  <th className="py-2 pr-3 font-medium">模型</th>
                  <th className="py-2 pr-3 text-right font-medium">输入</th>
                  <th className="py-2 pr-3 text-right font-medium">输出</th>
                  <th className="py-2 pr-3 text-right font-medium">合计</th>
                  <th className="py-2 text-right font-medium">耗时</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-muted">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {taskLabel(log.taskType)}
                      {log.estimated ? (
                        <span className="ml-1 text-[0.62rem] text-ink-faint">估算</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-ink-muted">{log.model}</td>
                    <td className="py-2 pr-3 text-right font-mono text-ink-faint">
                      {formatNumber(log.promptTokens)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-ink-faint">
                      {formatNumber(log.completionTokens)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {formatNumber(log.totalTokens)}
                    </td>
                    <td className="py-2 text-right font-mono text-ink-faint">
                      {(log.durationMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
