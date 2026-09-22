'use client';

import { useEffect, useState } from 'react';

/** 简易防抖钩子，用于检索输入等高频更新的场景。 */
export function useDebounced<T>(value: T, delay = 320): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
