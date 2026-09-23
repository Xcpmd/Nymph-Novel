'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Button } from '@/components/ui/primitives';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import type { SpeakerColor } from '@/lib/markdown/speakers';

/**
 * 沉浸式阅读。
 *
 * 整层覆盖视口，只保留正文与一条轻量工具条，把界面元素压到最低，
 * 让注意力落在文字上。正文宽度与字号沿用阅读设置，
 * 因此进出沉浸模式时排版不会跳变。
 *
 * 挂在 body 上而不是就地渲染：页面主体带有层叠上下文，
 * 就地渲染会被顶部导航盖住，固定定位也会被祖先的变换影响。
 *
 * 退出方式有两种：工具条按钮与 Esc 键，Esc 更符合阅读器的一般习惯。
 */
export function ImmersiveReader({
  title,
  content,
  speakers,
  onClose,
}: {
  title: string;
  content: string;
  speakers?: SpeakerColor;
  onClose: () => void;
}) {
  const { t, settings, update } = useSettings();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    // 覆盖层自己滚动，锁住底层页面滚动，避免两层互相干扰
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="immersive-shell" role="dialog" aria-modal="true" aria-label={title}>
      <div className="immersive-bar">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-soft">
          <i className="fa-solid fa-book-open-reader text-[0.8rem] text-ink-faint" aria-hidden />
          <span className="truncate">{title}</span>
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <i className="fa-solid fa-font text-[0.72rem]" aria-hidden />
            <input
              type="range"
              min={14}
              max={28}
              value={settings.readerFontSize}
              onChange={(event) => void update({ readerFontSize: Number(event.target.value) })}
              className="w-20"
              aria-label={t('settings.readerFontSize')}
            />
            <span className="w-6 shrink-0 font-mono text-[0.7rem]">
              {settings.readerFontSize}
            </span>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <i className="fa-solid fa-left-right text-[0.72rem]" aria-hidden />
            <input
              type="range"
              min={30}
              max={72}
              value={settings.readerWidth}
              onChange={(event) => void update({ readerWidth: Number(event.target.value) })}
              className="w-20"
              aria-label={t('settings.readerWidth')}
            />
            <span className="w-6 shrink-0 font-mono text-[0.7rem]">
              {settings.readerWidth}
            </span>
          </label>

          <Button
            size="sm"
            onClick={() => void update({ showSpeakerName: !settings.showSpeakerName })}
            aria-pressed={settings.showSpeakerName}
          >
            <i
              className={
                settings.showSpeakerName ? 'fa-solid fa-user-tag' : 'fa-solid fa-user-slash'
              }
              aria-hidden
            />
            <span className="hidden sm:inline">
              {settings.showSpeakerName
                ? t('chapters.hideSpeakerName')
                : t('chapters.showSpeakerName')}
            </span>
          </Button>

          <Button size="sm" onClick={onClose}>
            <i className="fa-solid fa-compress" aria-hidden />
            <span className="hidden sm:inline">{t('chapters.exitImmersive')}</span>
          </Button>
        </div>
      </div>

      <div className="immersive-body">
        <article className="immersive-page glass">
          <MarkdownView
            content={content}
            speakers={speakers}
            showSpeakerName={settings.showSpeakerName}
          />
        </article>
      </div>
    </div>,
    document.body,
  );
}
