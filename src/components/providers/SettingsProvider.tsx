'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/client/api';
import { createTranslator, type Translator } from '@/lib/i18n';
import type { AppSettings } from '@/lib/repo/settings';
import type { ContextBudget } from '@/lib/types';

/**
 * 全局设置上下文。
 * 负责把主题色相、阅读字号、界面密度等偏好写到文档根节点上，
 * 使全站样式通过 CSS 变量即时响应，无需刷新页面。
 */

interface SettingsContextValue {
  settings: AppSettings;
  t: Translator;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  saving: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  initialSettings,
  children,
}: {
  initialSettings: AppSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [saving, setSaving] = useState(false);

  // 把偏好投射到根节点的 CSS 变量上
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent-hue', String(settings.accentHue));
    root.style.setProperty('--reader-font-size', `${settings.readerFontSize}px`);
    root.style.setProperty('--reader-width', `${settings.readerWidth}rem`);
    root.dataset.density = settings.density;
    root.lang = settings.locale === 'zh' ? 'zh-Hans' : settings.locale;
  }, [settings.accentHue, settings.readerFontSize, settings.readerWidth, settings.density, settings.locale]);

  /*
   * 主题模式：system 时跟随系统偏好，其余直接取设定值。
   * 结果写到 html 的 data-theme，暗色样式表据此生效。
   */
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved =
        settings.themeMode === 'system' ? (media.matches ? 'dark' : 'light') : settings.themeMode;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };

    apply();
    if (settings.themeMode !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.themeMode]);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSaving(true);
    try {
      const result = await api.patch<{ settings: AppSettings }>('/api/settings', patch);
      setSettings(result.settings);
    } finally {
      setSaving(false);
    }
  }, []);

  const t = useMemo(() => createTranslator(settings.locale), [settings.locale]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, t, update, saving }),
    [settings, t, update, saving],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** 取得全局设置。未包裹 Provider 时给出安全默认值。 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    const fallback: AppSettings = {
      accentHue: 265,
      themeMode: 'system',
      locale: 'zh',
      activeProviderId: null,
      budget: { total: 72000, always: 20000, recalled: 20000, outlines: 26000, reserved: 6000 },
      density: 'comfortable',
      readerFontSize: 17,
      readerWidth: 46,
      showStreamingRaw: false,
      showSpeakerName: true,
    };
    return {
      settings: fallback,
      t: createTranslator('zh'),
      update: async () => undefined,
      saving: false,
    };
  }
  return context;
}

/** 便捷读取上下文预算。 */
export function useBudget(): ContextBudget {
  return useSettings().settings.budget;
}
