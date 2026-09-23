'use client';

import clsx from 'clsx';
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * 下拉选择。
 *
 * 原生 select 的展开列表由操作系统绘制，不参与站内的玻璃与辉光体系，
 * 下拉一展开就显得割裂。这里改为按钮加浮层的实现，浮层沿用同一套质感。
 *
 * 对外保持原生 select 的用法：接收 option 子元素，onChange 收到的对象带
 * target.value，因此既有调用点无需改动。
 */

interface OptionItem {
  value: string;
  label: string;
  disabled: boolean;
}

/** 递归取出选项的显示文本。 */
function toLabel(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(toLabel).join('');
  if (isValidElement(node)) return toLabel((node.props as { children?: ReactNode }).children);
  return '';
}

/** 从 option 子元素解析出选项列表。 */
function parseOptions(children: ReactNode): OptionItem[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child) || child.type !== 'option') return [];
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };
    return [
      {
        value: String(props.value ?? ''),
        label: toLabel(props.children),
        disabled: Boolean(props.disabled),
      },
    ];
  });
}

export function Select({
  children,
  className,
  value,
  onChange,
  disabled,
  name,
  id,
  title,
  'aria-label': ariaLabel,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = useMemo(() => parseOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = String(value ?? '');
  const selected = options.find((item) => item.value === current) ?? options[0];

  const close = useCallback(() => {
    setOpen(false);
    setFocusIndex(-1);
  }, []);

  /**
   * 派发变更。
   *
   * 构造的对象只需带 target.value，就足以让既有的
   * `onChange={(event) => setX(event.target.value)}` 继续工作。
   */
  const commit = useCallback(
    (next: string) => {
      onChange?.({
        target: { value: next },
        currentTarget: { value: next },
      } as unknown as React.ChangeEvent<HTMLSelectElement>);
      close();
    },
    [onChange, close],
  );

  // 点击组件之外收起
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, close]);

  // 展开时把高亮落在当前选中项上
  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((item) => item.value === current);
    setFocusIndex(index >= 0 ? index : 0);
  }, [open, options, current]);

  /** 在可选项目之间移动高亮，跳过禁用项。 */
  const moveFocus = (step: 1 | -1) => {
    if (options.length === 0) return;
    setFocusIndex((index) => {
      let next = index;
      for (let attempt = 0; attempt < options.length; attempt += 1) {
        next = (next + step + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === 'Escape') {
      if (open) event.stopPropagation();
      close();
      return;
    }

    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = options[focusIndex];
      if (item && !item.disabled) commit(item.value);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={clsx(
          'select focus-glow flex cursor-pointer items-center justify-between gap-2 text-left',
          className,
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? ''}</span>
        <i
          className={clsx(
            'fa-solid fa-chevron-down shrink-0 text-[0.62rem] opacity-60 transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {/* 参与表单提交时保留原生字段名 */}
      {name ? <input type="hidden" name={name} value={current} /> : null}

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="dropdown-panel animate-rise absolute top-[calc(100%+0.35rem)] left-0 z-50 max-h-64 min-w-full overflow-y-auto p-1.5"
        >
          {options.map((item, index) => (
            <button
              key={`${item.value}-${index}`}
              type="button"
              role="option"
              aria-selected={item.value === current}
              disabled={item.disabled}
              data-selected={item.value === current}
              data-focus={index === focusIndex}
              onMouseEnter={() => setFocusIndex(index)}
              onClick={() => commit(item.value)}
              className="dropdown-item"
            >
              <span className="min-w-0 truncate">{item.label}</span>
              {item.value === current ? (
                <i className="fa-solid fa-check shrink-0 text-[0.68rem]" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
