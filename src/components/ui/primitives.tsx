'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * 基础交互组件。
 * 全部组件遵循同一套过渡动画与焦点样式，保持简约平面化观感。
 */

export function Button({
  children,
  variant = 'default',
  size = 'md',
  icon,
  className,
  ...rest
}: {
  children?: ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : variant === 'danger'
          ? 'btn-danger'
          : '';
  return (
    <button
      type="button"
      className={clsx('btn', variantClass, size === 'sm' && 'px-2 py-1 text-xs', className)}
      {...rest}
    >
      {icon ? <i className={icon} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  title,
  className,
  ...rest
}: { icon: string; title: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-200 hover:bg-[var(--glass-bg-sunken)] hover:text-ink disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <i className={icon} aria-hidden />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-ink-muted">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs leading-relaxed text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('textarea', props.className)} />;
}

/**
 * 下拉选择。
 *
 * 原生 select 的展开列表由系统绘制，无法参与站内的玻璃与辉光体系，
 * 因此改用自定义实现，用法与原生保持一致。
 */
export { Select } from './Select';

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-[6px] px-1 py-1.5 text-left transition-colors duration-200 hover:bg-surface-soft"
    >
      <span
        className={clsx(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200',
          checked ? 'border-transparent bg-accent' : 'border-line bg-surface-sunken',
        )}
      >
        <span
          className={clsx(
            'h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.15rem]',
          )}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink text-soft">{label}</span>
        {hint ? <span className="text-xs leading-relaxed text-ink-faint">{hint}</span> : null}
      </span>
    </button>
  );
}

export function Chip({
  children,
  accent,
  onRemove,
}: {
  children: ReactNode;
  accent?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span className={clsx('chip', accent && 'chip-accent')}>
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 transition-opacity duration-200 hover:opacity-100"
          aria-label="移除"
        >
          <i className="fa-solid fa-xmark text-[0.7rem]" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  compact,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={clsx('card animate-rise', compact ? 'p-3' : 'p-5', className)}>
      {title || actions ? (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-soft">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({
  icon = 'fa-solid fa-feather-pointed',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-line px-6 py-12 text-center">
      <i className={clsx(icon, 'text-2xl text-ink-faint')} aria-hidden />
      <p className="text-sm font-medium text-ink text-soft">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <i className={clsx('fa-solid fa-spinner animate-spin', className)} aria-hidden />;
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function StatBlock({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="card card-hover px-4 py-3">
      <div className="flex items-center gap-2 text-ink-faint">
        {icon ? <i className={clsx(icon, 'text-xs')} aria-hidden /> : null}
        <span className="panel-title">{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-semibold text-soft">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-muted">{sub}</div> : null}
    </div>
  );
}
