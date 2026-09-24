'use client';

import clsx from 'clsx';
import { useSettings } from '@/components/providers/SettingsProvider';
import { ProgressBar } from '@/components/ui/primitives';
import type { GenerationMeta } from '@/hooks/useGeneration';
import { formatNumber } from '@/lib/client/api';

/**
 * 上下文检查器。
 *
 * 上半部分是选择区：勾选哪些层随提示词发送，并调整它们的先后。
 * 顺序并非装饰——拼接型变量按层序取内容，排在前面的层更容易被模型当成主线来读。
 *
 * 下半部分是上一次生成的实际用量，用于核对各层占了多少篇幅。
 *
 * 选择结果存进小说偏好。空数组表示不设限，即全部层都发送。
 */

interface LayerOption {
  key: string;
  label: string;
  note: string;
}

export function ContextInspector({
  meta,
  catalog,
  selected,
  onChange,
}: {
  meta: GenerationMeta | null;
  catalog: LayerOption[];
  /** 选中的层，顺序即注入顺序。为空表示不设限 */
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const { t } = useSettings();

  // 未设限时按清单顺序全部视为已选
  const activeKeys = selected.length > 0 ? selected : catalog.map((item) => item.key);
  const activeSet = new Set(activeKeys);
  const active = activeKeys
    .map((key) => catalog.find((item) => item.key === key))
    .filter((item): item is LayerOption => Boolean(item));
  const inactive = catalog.filter((item) => !activeSet.has(item.key));

  /** 各层的实际 token，来自上一次生成 */
  const tokensOf = (key: string) => meta?.layers.find((layer) => layer.key === key)?.tokens ?? 0;
  const trimmedOf = (key: string) =>
    meta?.layers.find((layer) => layer.key === key)?.trimmed ?? false;

  const move = (index: number, delta: number) => {
    const next = [...activeKeys];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggle = (key: string) => {
    if (activeSet.has(key)) {
      // 至少保留一层，否则提示词里只剩空壳
      if (activeKeys.length <= 1) return;
      onChange(activeKeys.filter((item) => item !== key));
      return;
    }
    onChange([...activeKeys, key]);
  };

  const total = Math.max(1, meta?.contextTokens ?? 1);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="panel-title mb-1">{t('workbench.layerPick')}</p>
        <p className="mb-2 text-[0.7rem] leading-relaxed text-ink-faint">
          {t('workbench.layerPickHint')}
        </p>

        <ul className="flex flex-col gap-1.5">
          {active.map((item, index) => (
            <li
              key={item.key}
              className="flex items-start gap-1.5 rounded-[6px] bg-accent-soft px-2 py-1.5"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked
                aria-label={t('workbench.layerUnpick')}
                onClick={() => toggle(item.key)}
                disabled={activeKeys.length <= 1}
                className="mt-0.5 shrink-0 text-[0.72rem] text-accent-strong disabled:opacity-40"
              >
                <i className="fa-solid fa-square-check" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-xs font-medium">{item.label}</span>
                  {tokensOf(item.key) > 0 ? (
                    <span
                      className={clsx(
                        'font-mono text-[0.66rem]',
                        trimmedOf(item.key) ? 'text-warn' : 'text-ink-faint',
                      )}
                    >
                      {formatNumber(tokensOf(item.key))}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[0.66rem] leading-relaxed text-ink-faint">{item.note}</p>
              </div>
              <div className="mt-0.5 flex shrink-0 gap-0.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="btn btn-ghost px-1 py-0.5 text-[0.62rem] disabled:opacity-30"
                  aria-label={t('workbench.layerMoveUp')}
                >
                  <i className="fa-solid fa-arrow-up" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === active.length - 1}
                  className="btn btn-ghost px-1 py-0.5 text-[0.62rem] disabled:opacity-30"
                  aria-label={t('workbench.layerMoveDown')}
                >
                  <i className="fa-solid fa-arrow-down" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {inactive.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {inactive.map((item) => (
              <li
                key={item.key}
                className="flex items-start gap-1.5 rounded-[6px] border border-line-soft px-2 py-1.5 opacity-70"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={false}
                  aria-label={t('workbench.layerPickAction')}
                  onClick={() => toggle(item.key)}
                  className="mt-0.5 shrink-0 text-[0.72rem] text-ink-faint"
                >
                  <i className="fa-regular fa-square" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <span className="text-xs">{item.label}</span>
                  <p className="mt-0.5 text-[0.66rem] leading-relaxed text-ink-faint">{item.note}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <p className="panel-title mb-2">{t('workbench.lastRun')}</p>
        {!meta ? (
          <p className="text-xs text-ink-faint">{t('workbench.contextHint')}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-soft">
                {formatNumber(meta.contextTokens)} token
              </span>
              <span className="text-xs text-ink-faint">
                {meta.providerName} · {meta.model}
              </span>
              {meta.trimmed ? (
                <span className="chip text-warn ml-auto">{t('workbench.contextTrimmed')}</span>
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {meta.layers.map((layer) => (
                <li key={layer.key} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate',
                        layer.trimmed ? 'text-warn' : 'text-ink-muted',
                      )}
                    >
                      {layer.label}
                    </span>
                    {layer.trimmed ? (
                      <span className="chip text-warn" title={t('workbench.contextTrimmed')}>
                        <i className="fa-solid fa-scissors text-[0.6rem]" aria-hidden />
                      </span>
                    ) : null}
                    <span className="w-16 shrink-0 text-right font-mono text-ink-faint">
                      {formatNumber(layer.tokens)}
                    </span>
                  </div>
                  <ProgressBar value={layer.tokens} max={total} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <p className="panel-title mb-2">{t('workbench.citations')}</p>
        {!meta || meta.citations.length === 0 ? (
          <p className="text-xs text-ink-faint">{t('workbench.noCitations')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {meta.citations.slice(0, 20).map((citation) => (
              <li key={`${citation.kind}-${citation.id}`} className="flex items-center gap-2 text-xs">
                <span className="chip">{citation.kind}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{citation.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
