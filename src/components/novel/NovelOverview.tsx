'use client';

import Link from 'next/link';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Panel, ProgressBar, StatBlock } from '@/components/ui/primitives';
import { formatBytes, formatNumber } from '@/lib/client/api';
import type { ChapterWithVolume, Novel, UsageLog } from '@/lib/types';

/** 作品概览面板。展示创作进度、数据规模与建议的下一步。 */

interface OverviewStats {
  volumes: number;
  chapters: number;
  generated: number;
  totalWords: number;
  averageWords: number;
  characters: number;
  relations: number;
  encyclopedia: number;
  events: number;
  diskUsage: number;
  usage: {
    totalTokens: number;
    calls: number;
    byTask: Array<{ taskType: string; tokens: number; calls: number }>;
    byModel: Array<{ model: string; tokens: number; calls: number }>;
  };
  lastUsage?: UsageLog;
}

export function NovelOverview({
  novel,
  stats,
  recentChapters,
}: {
  novel: Novel;
  stats: OverviewStats;
  recentChapters: ChapterWithVolume[];
  hasWorldview?: boolean;
}) {
  const { t } = useSettings();
  const base = `/novels/${novel.id}`;

  const planned = stats.chapters - stats.generated;
  const progress = stats.chapters > 0 ? Math.round((stats.generated / stats.chapters) * 100) : 0;

  const nextStepKey =
    stats.chapters === 0
      ? 'overview.nextStepSetup'
      : stats.characters === 0
        ? 'overview.nextStepCharacters'
        : stats.events === 0
          ? 'overview.nextStepOutline'
          : stats.generated === 0
            ? 'overview.nextStepChapter'
            : 'overview.nextStepContinue';

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('overview.progress')}
        description={novel.summary || undefined}
        actions={
          <>
            <Link href={`${base}/outline`} className="btn">
              <i className="fa-solid fa-diagram-project" aria-hidden />
              {t('nav.outline')}
            </Link>
            <Link href={`${base}/workbench`} className="btn btn-primary">
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
              {t('nav.workbench')}
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between text-xs text-ink-muted">
            <span>
              {t('overview.generatedChapters')} {stats.generated} / {stats.chapters}
            </span>
            <span className="font-semibold text-accent-strong">{progress}%</span>
          </div>
          <ProgressBar value={stats.generated} max={Math.max(1, stats.chapters)} />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          label={t('overview.totalChapters')}
          value={formatNumber(stats.chapters)}
          sub={`${stats.volumes} ${t('shelf.volumesCount')} · ${t('overview.plannedChapters')} ${planned}`}
          icon="fa-solid fa-list-ol"
        />
        <StatBlock
          label={t('overview.totalWords')}
          value={formatNumber(stats.totalWords)}
          sub={`${t('overview.averageWords')} ${formatNumber(stats.averageWords)}`}
          icon="fa-solid fa-pen-nib"
        />
        <StatBlock
          label={t('overview.characterCount')}
          value={formatNumber(stats.characters)}
          sub={`${t('overview.relationsCount')} ${stats.relations}`}
          icon="fa-solid fa-users"
        />
        <StatBlock
          label={t('overview.encyclopediaCount')}
          value={formatNumber(stats.encyclopedia)}
          sub={`${t('overview.timelineEvents')} ${stats.events}`}
          icon="fa-solid fa-book-atlas"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('overview.nextStep')} className="lg:col-span-1">
          <p className="text-sm leading-relaxed text-ink-muted">{t(nextStepKey)}</p>
          <div className="mt-4 grid gap-2">
            <Link href={`${base}/setup`} className="btn justify-start">
              <i className="fa-solid fa-scroll w-4 text-center" aria-hidden />
              {t('nav.setup')}
            </Link>
            <Link href={`${base}/characters`} className="btn justify-start">
              <i className="fa-solid fa-users w-4 text-center" aria-hidden />
              {t('nav.characters')}
            </Link>
            <Link href={`${base}/timeline`} className="btn justify-start">
              <i className="fa-solid fa-timeline w-4 text-center" aria-hidden />
              {t('nav.timeline')}
            </Link>
          </div>
        </Panel>

        <Panel title={t('overview.recentChapters')} className="lg:col-span-2">
          {recentChapters.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('chapters.emptyHint')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {recentChapters.map((chapter) => (
                <li key={chapter.id}>
                  <Link
                    href={`${base}/chapters/${chapter.id}`}
                    className="flex items-center gap-3 py-2.5 transition-colors duration-200 hover:text-accent-strong"
                  >
                    <span className="chip shrink-0">{t(`chapters.status.${chapter.status}`)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-soft">
                      {chapter.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {formatNumber(chapter.wordCount)} {t('common.words')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('overview.tokenUsage')} className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatBlock
              label="Token"
              value={formatNumber(stats.usage.totalTokens)}
              sub={`${stats.usage.calls} 次调用`}
              icon="fa-solid fa-coins"
            />
            <StatBlock
              label={t('data.databaseSize')}
              value={formatBytes(stats.diskUsage)}
              sub="novel 目录"
              icon="fa-solid fa-hard-drive"
            />
            <StatBlock
              label={t('overview.totalWords')}
              value={formatNumber(stats.totalWords)}
              sub={`${formatNumber(stats.averageWords)} / 章`}
              icon="fa-solid fa-chart-simple"
            />
          </div>
          {stats.usage.byTask.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {stats.usage.byTask.slice(0, 6).map((item) => (
                <li key={item.taskType} className="flex items-center gap-3 text-xs">
                  <span className="w-40 shrink-0 truncate text-ink-muted">{item.taskType}</span>
                  <ProgressBar
                    value={item.tokens}
                    max={Math.max(1, stats.usage.totalTokens)}
                    className="flex-1"
                  />
                  <span className="w-20 shrink-0 text-right text-ink-faint">
                    {formatNumber(item.tokens)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={t('overview.quickActions')}>
          <div className="grid gap-2">
            <Link href={`${base}/data`} className="btn justify-start">
              <i className="fa-solid fa-right-left w-4 text-center" aria-hidden />
              {t('nav.data')}
            </Link>
            <Link href={`${base}/search`} className="btn justify-start">
              <i className="fa-solid fa-magnifying-glass w-4 text-center" aria-hidden />
              {t('nav.search')}
            </Link>
            <Link href={`${base}/relations`} className="btn justify-start">
              <i className="fa-solid fa-share-nodes w-4 text-center" aria-hidden />
              {t('nav.relations')}
            </Link>
            <Link href={`${base}/usage`} className="btn justify-start">
              <i className="fa-solid fa-chart-simple w-4 text-center" aria-hidden />
              {t('nav.usage')}
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
