'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { MarkdownView } from './MarkdownView';
import { Button } from '@/components/ui/primitives';
import { useSettings } from '@/components/providers/SettingsProvider';
import type { SpeakerColor } from '@/lib/markdown/speakers';

/**
 * Markdown 编辑区。
 * 提供编辑、预览、对照三种模式，便于边写边看排版效果。
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 18,
  onSelectionChange,
  actions,
  speakers,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  onSelectionChange?: (text: string) => void;
  actions?: React.ReactNode;
  /** 角色发言配色表，预览时按它给对白染色 */
  speakers?: SpeakerColor;
}) {
  const { t, settings } = useSettings();
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit');

  const handleSelect = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!onSelectionChange) return;
    const target = event.currentTarget;
    const selected = target.value.slice(target.selectionStart, target.selectionEnd).trim();
    onSelectionChange(selected);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-[6px] border border-line">
          {(['edit', 'split', 'preview'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={clsx(
                'px-3 py-1.5 text-xs transition-colors duration-200',
                mode === item
                  ? 'bg-accent-soft font-semibold text-accent-strong'
                  : 'bg-surface-raised text-ink-muted hover:bg-surface-soft hover:text-ink',
              )}
            >
              {item === 'edit'
                ? t('common.editMode')
                : item === 'split'
                  ? t('common.splitMode')
                  : t('common.previewMode')}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      <div
        className={clsx(
          'grid gap-3',
          mode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {mode !== 'preview' ? (
          <textarea
            value={value}
            rows={rows}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onSelect={handleSelect}
            onBlur={handleSelect}
            className="textarea font-mono text-[0.84rem] leading-relaxed"
          />
        ) : null}

        {mode !== 'edit' ? (
          <div className="card max-h-[36rem] overflow-y-auto px-5 py-4">
            <MarkdownView
              content={value}
              speakers={speakers}
              showSpeakerName={settings.showSpeakerName}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { Button };
