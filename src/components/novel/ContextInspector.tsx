'use client';

import clsx from 'clsx';
import { useSettings } from '@/components/providers/SettingsProvider';
import { ProgressBar } from '@/components/ui/primitives';
import type { GenerationMeta } from '@/hooks/useGeneration';
import { formatNumber } from '@/lib/client/api';

/** 上下文检查器。展示本次生成实际注入了哪些层、各占多少 token、哪些被裁剪。 */
export function ContextInspector({ meta }: { meta: GenerationMeta | null }) {
  const { t } = useSettings();

  if (!meta) {
    return <p className="text-xs text-ink-faint">{t('workbench.contextHint')}</p>;
  }

  const always = meta.layers.filter((layer) => layer.always);
  const conditional = meta.layers.filter((layer) => !layer.always);
  const total = Math.max(1, meta.contextTokens);

  const renderLayer = (layer: GenerationMeta['layers'][number]) => (
    <li key={layer.key} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={clsx('min-w-0 flex-1 truncate', layer.trimmed ? 'text-warn' : 'text-ink-muted')}>
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
  );

  return (
    <div className="flex flex-col gap-4">
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

      <div>
        <p className="panel-title mb-2">{t('workbench.layerAlways')}</p>
        <ul className="flex flex-col gap-2.5">{always.map(renderLayer)}</ul>
      </div>

      {conditional.length > 0 ? (
        <div>
          <p className="panel-title mb-2">{t('workbench.layerConditional')}</p>
          <ul className="flex flex-col gap-2.5">{conditional.map(renderLayer)}</ul>
        </div>
      ) : null}

      <div>
        <p className="panel-title mb-2">{t('workbench.citations')}</p>
        {meta.citations.length === 0 ? (
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
