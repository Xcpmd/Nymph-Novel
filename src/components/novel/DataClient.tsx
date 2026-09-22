'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, downloadFile, formatBytes, formatNumber, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Button, EmptyState, Panel, Spinner, StatBlock } from '@/components/ui/primitives';
import type { Novel } from '@/lib/types';

/** 导入导出与数据维护。全部操作在本机完成。 */

interface StatsPayload {
  novel: Novel | null;
  volumes: number;
  chapters: number;
  characters: number;
  relations: number;
  encyclopedia: number;
  events: number;
  branches: number;
  diskUsage: number;
  usage: { totalTokens: number; calls: number };
}

export function DataClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<StatsPayload>(novelResourcePath(novelId, 'stats'));
      setStats(result);
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

  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const result = await api.post<{ indexed: number }>(novelResourcePath(novelId, 'index'));
      toast.success(t('search.rebuildDone', { count: result.indexed }));
      setConfirmRebuild(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setRebuilding(false);
    }
  };

  const exportAs = (format: 'txt' | 'md' | 'json') => {
    downloadFile(`/api/novels/${novelId}/export?format=${format}`);
  };

  if (loading || !stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-semibold text-soft">{t('data.title')}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">{t('data.hint')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          label={t('overview.totalChapters')}
          value={formatNumber(stats.chapters)}
          sub={`${stats.volumes} ${t('shelf.volumesCount')}`}
          icon="fa-solid fa-list-ol"
        />
        <StatBlock
          label={t('data.databaseSize')}
          value={formatBytes(stats.diskUsage)}
          sub="novel 目录"
          icon="fa-solid fa-hard-drive"
        />
        <StatBlock
          label={t('overview.tokenUsage')}
          value={formatNumber(stats.usage.totalTokens)}
          sub={`${stats.usage.calls} 次调用`}
          icon="fa-solid fa-coins"
        />
        <StatBlock
          label={t('overview.encyclopediaCount')}
          value={formatNumber(stats.encyclopedia)}
          sub={`${stats.characters} 角色 · ${stats.relations} 关系`}
          icon="fa-solid fa-book-atlas"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('data.exportTitle')} description={t('data.exportJsonHint')}>
          <ul className="flex flex-col gap-3">
            {(
              [
                ['txt', 'fa-solid fa-file-lines', 'data.exportTxt', 'data.exportTxtHint'],
                ['md', 'fa-solid fa-file-code', 'data.exportMd', 'data.exportMdHint'],
                ['json', 'fa-solid fa-box-archive', 'data.exportJson', 'data.exportJsonHint'],
              ] as const
            ).map(([format, icon, labelKey, hintKey]) => (
              <li key={format} className="flex items-start gap-3">
                <i className={`${icon} mt-1 w-4 text-center text-ink-faint`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-soft">{t(labelKey)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{t(hintKey)}</p>
                </div>
                <Button size="sm" onClick={() => exportAs(format)}>
                  <i className="fa-solid fa-download" aria-hidden />
                  {t('common.export')}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('data.importTitle')} description={t('data.importHint')}>
          <p className="text-xs leading-relaxed text-ink-muted">
            导入入口位于书架页，支持粘贴纯文本或结构化归档内容。导入会新建一部小说，不会覆盖当前作品。
          </p>
          <Link href="/" className="btn mt-3">
            <i className="fa-solid fa-book-open" aria-hidden />
            {t('nav.shelf')}
          </Link>
        </Panel>
      </div>

      <Panel title={t('data.dangerTitle')}>
        <ul className="flex flex-col gap-3">
          <li className="flex flex-wrap items-start gap-3">
            <i className="fa-solid fa-arrows-rotate mt-1 w-4 text-center text-ink-faint" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-soft">{t('data.rebuildIndex')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                {t('data.rebuildIndexHint')}
              </p>
            </div>
            <Button size="sm" onClick={() => setConfirmRebuild(true)} disabled={rebuilding}>
              {rebuilding ? <Spinner /> : null}
              {t('common.confirm')}
            </Button>
          </li>
        </ul>
      </Panel>

      <Panel title={t('data.storageTitle')}>
        <ul className="flex flex-col gap-2.5 text-xs leading-relaxed text-ink-muted">
          <li className="flex gap-2">
            <i className="fa-solid fa-database mt-0.5 text-ink-faint" aria-hidden />
            {t('data.storageDatabase')}
          </li>
          <li className="flex gap-2">
            <i className="fa-solid fa-file-lines mt-0.5 text-ink-faint" aria-hidden />
            {t('data.storageFiles')}
          </li>
          <li className="flex gap-2">
            <i className="fa-solid fa-lock mt-0.5 text-ink-faint" aria-hidden />
            {t('data.storageKey')}
          </li>
        </ul>
        <p className="mt-3 rounded-[6px] bg-surface-soft px-3 py-2 font-mono text-[0.68rem] text-ink-muted">
          {t('data.dataDirHint')}
        </p>
      </Panel>

      {stats.chapters === 0 ? (
        <Panel>
          <EmptyState title={t('chapters.emptyHint')} />
        </Panel>
      ) : null}

      <ConfirmDialog
        open={confirmRebuild}
        title={t('data.rebuildIndex')}
        message={t('search.rebuildConfirm')}
        onCancel={() => setConfirmRebuild(false)}
        onConfirm={rebuildIndex}
      />
    </div>
  );
}
