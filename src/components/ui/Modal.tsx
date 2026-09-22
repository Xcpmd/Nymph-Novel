'use client';

import clsx from 'clsx';
import { useEffect, type ReactNode } from 'react';
import { Button } from './primitives';

/** 通用弹窗。遮罩压暗并模糊身后的页面，弹窗本体沿用站内的玻璃质感。 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const width =
    size === 'sm'
      ? 'max-w-md'
      : size === 'lg'
        ? 'max-w-3xl'
        : size === 'xl'
          ? 'max-w-5xl'
          : size === 'full'
            ? 'max-w-6xl'
            : 'max-w-xl';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8 backdrop-blur-md">
      <div
        className={clsx(
          'card animate-rise w-full bg-[var(--glass-bg-strong)] shadow-[var(--glass-highlight),var(--shadow-raised),var(--glow-accent)]',
          width,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--glass-border)] px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-soft text-glow">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-[6px] p-1.5 text-ink-faint transition-colors duration-200 hover:bg-[var(--glass-bg-sunken)] hover:text-ink"
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        </header>
        <div className="max-h-[74vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--glass-border)] px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** 二次确认弹窗，用于不可撤销操作。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? '确认'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
    </Modal>
  );
}
