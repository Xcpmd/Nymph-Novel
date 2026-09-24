'use client';

import { useEffect, useRef } from 'react';
import { clearDraftValue, readDraftValue, writeDraftValue } from './useDraftState';

/**
 * 弹窗表单的草稿管理。
 *
 * 各页面的编辑弹窗结构一致：一个 form 状态、一个编辑对象、一个提交函数。
 * 逐个给每个输入框挂缓存既啰嗦又容易漏，这里换一种做法 ——
 * 打开弹窗时记下草稿键并尝试恢复，表单随后每一次变化都落一遍草稿，
 * 提交成功时清除。
 *
 * 需要页面向这个 hook 提供三样信息：
 * 弹窗是否打开、当前编辑对象的标识、以及表单的当前值。
 * 标识为 null 表示新建，各页面可以据此决定草稿键。
 */
export function useFormDraft<T>(options: {
  /** 草稿键前缀，通常形如 `${novelId}:chapters` */
  scope: string;
  /** 当前编辑对象的 id，新建时为 null */
  targetId: string | null;
  /** 弹窗是否打开。关着的时候不写草稿 */
  open: boolean;
  /** 表单当前值 */
  value: T;
}): {
  /** 打开弹窗时调用，取回该对象的草稿，没有则返回 null */
  restore: (targetKey: string) => T | null;
  /** 提交成功后调用 */
  clear: () => void;
} {
  const { scope, open, value } = options;
  /** 当前生效的草稿键，由 restore 确定 */
  const activeKey = useRef<string | null>(null);

  const restore = (targetKey: string): T | null => {
    const key = `${scope}:${targetKey}`;
    activeKey.current = key;
    return readDraftValue<T>(key);
  };

  const clear = () => {
    if (activeKey.current) clearDraftValue(activeKey.current);
    activeKey.current = null;
  };

  /*
   * 表单变化即落草稿。
   *
   * 用 effect 而不是包装 setForm，是为了不改动页面上已有的每处 onChange ——
   * 那些调用点太多，逐个替换只会引入遗漏。
   */
  useEffect(() => {
    if (!open || !activeKey.current) return;
    writeDraftValue(activeKey.current, value);
  }, [open, value]);

  return { restore, clear };
}
