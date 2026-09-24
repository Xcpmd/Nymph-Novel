'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 缓存键前缀，清理时按它批量扫。 */
const PREFIX = 'nymph:draft:';
/** 超过这个天数的草稿视为陈旧，读取时顺手丢掉。 */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

interface StoredDraft<T> {
  value: T;
  savedAt: number;
}

function readDraft<T>(storageKey: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.value;
  } catch {
    // 存储不可用或内容损坏时按没有草稿处理，不影响页面
    return null;
  }
}

function writeDraft<T>(storageKey: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // 超出配额或隐私模式下写入失败，静默跳过
  }
}

/**
 * 带本地缓存的表单状态。
 *
 * 客户端路由切换会卸载页面组件，未提交的输入随之丢失 ——
 * 填了一半去查设定，回来就白填了。这个 hook 把状态镜像到 localStorage，
 * 回到页面时自动恢复。
 *
 * 三点需要留意：
 * 一是 key 必须带上小说 id，否则换一本书会读到上一本的内容；
 * 二是写入要做防抖，正文编辑器每敲一个字都写一次会拖慢输入；
 * 三是提交成功后要调 clear，否则下次进来又冒出旧内容。
 *
 * 返回值第三项是清除函数，页面上「保存」或「取消」成功时调用。
 */
export function useDraftState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((previous: T) => T)) => void, () => void, (value: T) => void] {
  const storageKey = PREFIX + key;
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最新的值，供卸载补写与定时器读取。只在 effect 里更新。 */
  const latest = useRef<T>(initial);
  /**
   * 用户是否动过这一项。
   *
   * 用 state 而非 ref：初始值要从 localStorage 读，
   * 而渲染期间写 ref 在新版 React 里是禁止的。
   */
  const [touched, setTouched] = useState(() => readDraft<T>(storageKey) !== null);

  const [value, setValue] = useState<T>(() => readDraft<T>(storageKey) ?? initial);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  // 数据异步加载完成后回填；用户已经改过就不覆盖
  useEffect(() => {
    if (!touched) setValue(initial);
  }, [initial, touched]);

  /*
   * key 变化时重新读一遍。
   *
   * 把条目 id 编进 key 就能做到一条草稿对应一个条目，
   * 切换章节或事件时自然不会串。挂载时也会走一次，结果与初始化一致。
   */
  useEffect(() => {
    const cached = readDraft<T>(storageKey);
    setTouched(cached !== null);
    setValue(cached ?? initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const commit = useCallback(
    (next: T | ((previous: T) => T)) => {
      setTouched(true);
      setValue(next);
      // 防抖落盘，连续输入时只在停顿后写一次
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => writeDraft(storageKey, latest.current), 400);
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    setTouched(false);
    if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  /**
   * 数据加载完成后调用。
   *
   * 有草稿就以草稿为准，没有才用加载到的值填充 ——
   * 直接 setValue 会把用户的未保存内容冲掉。
   */
  const hydrate = useCallback(
    (loaded: T) => {
      const cached = readDraft<T>(storageKey);
      setTouched(cached !== null);
      setValue(cached ?? loaded);
    },
    [storageKey],
  );

  // 卸载时把还没落盘的内容补写一次，避免刚好落在防抖窗口里离开页面
  useEffect(
    () => () => {
      if (!writeTimer.current) return;
      clearTimeout(writeTimer.current);
      writeDraft(storageKey, latest.current);
    },
    [storageKey],
  );

  return [value, commit, clear, hydrate];
}

/**
 * 丢弃某部小说下的全部草稿。
 *
 * 删除小说时调用，免得那里留下的草稿在下次新建同名作品时冒出来。
 */
export function clearNovelDrafts(novelId: string): number {
  if (typeof window === 'undefined') return 0;
  const marker = `${PREFIX}${novelId}:`;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.startsWith(marker)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
  return keys.length;
}

/*
 * 下面两个是给弹窗类编辑用的。
 *
 * 弹窗不是独立组件，没法挂 hook，但编辑内容同样会因页面切换而丢失，
 * 因此在打开弹窗时先读一次草稿，编辑时写入，提交成功后清除。
 */
export function readDraftValue<T>(key: string): T | null {
  return readDraft<T>(PREFIX + key);
}

export function writeDraftValue<T>(key: string, value: T): void {
  writeDraft(PREFIX + key, value);
}

export function clearDraftValue(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PREFIX + key);
}
