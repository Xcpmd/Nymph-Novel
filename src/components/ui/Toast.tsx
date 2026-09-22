'use client';

import clsx from 'clsx';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** 轻量提示条，用于操作结果反馈。 */

export interface ToastItem {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastItem['kind'], message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, kind, message }]);
    const timeout = kind === 'error' ? 7000 : 3600;
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, timeout);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              'card animate-rise pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 text-sm leading-relaxed',
              item.kind === 'error' && 'border-danger/40 bg-danger-soft text-danger',
              item.kind === 'success' && 'border-ok/40 bg-ok-soft text-ok',
            )}
          >
            <i
              className={clsx(
                'mt-0.5',
                item.kind === 'error'
                  ? 'fa-solid fa-circle-exclamation'
                  : item.kind === 'success'
                    ? 'fa-solid fa-circle-check'
                    : 'fa-solid fa-circle-info',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">{item.message}</span>
            <button
              type="button"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              className="opacity-50 transition-opacity duration-200 hover:opacity-100"
              aria-label="关闭提示"
            >
              <i className="fa-solid fa-xmark text-xs" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 取得提示条接口。未包裹 Provider 时返回空实现，避免组件报错。 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context) return context;
  return {
    push: () => undefined,
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
  };
}
