'use client';

import { useSettings } from '@/components/providers/SettingsProvider';
import { Button } from '@/components/ui/primitives';
import type { useGeneration } from '@/hooks/useGeneration';

/**
 * 上下文超出预算时的二次确认条。
 *
 * 服务端遇到超预算不再自行裁剪，而是把超出的层回传，
 * 由这里告诉用户超出了多少、哪些层超出，再由用户决定是否保留全文发送。
 * 生成入口分散在多个页面，因此做成独立组件各处复用。
 */
export function BudgetConfirmPrompt({
  generation,
}: {
  generation: ReturnType<typeof useGeneration>;
}) {
  const { t } = useSettings();
  const info = generation.budgetExceeded;
  if (!info) return null;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-warn bg-warn-soft px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warn">
        <i className="fa-solid fa-triangle-exclamation" aria-hidden />
        {t('gen.budgetTitle')}
      </p>
      <p className="text-xs leading-relaxed text-warn">
        {t('gen.budgetHint')
          .replace('{tokens}', info.totalTokens.toLocaleString('zh-Hans-CN'))
          .replace('{total}', info.budget.total.toLocaleString('zh-Hans-CN'))}
      </p>
      {info.layers.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {info.layers.map((layer) => (
            <li key={layer.key} className="chip">
              {layer.label} {layer.tokens.toLocaleString('zh-Hans-CN')}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-0.5 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void generation.confirmBudgetAndRetry()}
          disabled={generation.status === 'running'}
        >
          <i className="fa-solid fa-paper-plane" aria-hidden />
          {t('gen.budgetConfirm')}
        </Button>
        <Button size="sm" onClick={generation.reset}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
