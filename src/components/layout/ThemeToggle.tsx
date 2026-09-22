'use client';

import clsx from 'clsx';
import { useSettings } from '@/components/providers/SettingsProvider';
import type { ThemeMode } from '@/lib/types';

/**
 * 主题切换控件。
 * 在明亮、暗色、跟随系统三种模式间循环切换，当前模式由图标反映。
 */

const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

const ICONS: Record<ThemeMode, string> = {
  light: 'fa-solid fa-sun',
  dark: 'fa-solid fa-moon',
  system: 'fa-solid fa-circle-half-stroke',
};

export function ThemeToggle() {
  const { t, settings, update } = useSettings();
  const mode = settings.themeMode;

  const label = {
    light: t('settings.themeLight'),
    dark: t('settings.themeDark'),
    system: t('settings.themeSystem'),
  }[mode];

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    void update({ themeMode: next });
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${t('settings.themeToggle')}：${label}`}
      aria-label={`${t('settings.themeToggle')}：${label}`}
      className={clsx(
        'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[0.82rem] transition-colors duration-200',
        'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
      )}
    >
      <i className={clsx(ICONS[mode], 'text-[0.82rem]')} aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
