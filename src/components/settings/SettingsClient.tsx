'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { api, formatBytes } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  Button,
  Field,
  Panel,
  Select,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/primitives';
import { PROVIDER_PRESETS } from '@/lib/ai/presets';
import { LOCALES } from '@/lib/i18n';
import type { AppSettings } from '@/lib/repo/settings';
import type { ModelParams, Provider, TaskType } from '@/lib/types';

/** 设置模块共用的类型与标签页定义，供弹窗外壳与内容组件共享。 */

export interface EnvironmentInfo {
  dataDir: string;
  databaseSize: number;
  schemaVersion: number;
  nodeVersion: string;
  platform: string;
}

export interface PromptEntry {
  taskType: TaskType;
  label: string;
  description: string;
  outputFormat: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  placeholders: string[];
  effective: {
    systemPrompt: string;
    userPrompt: string;
    temperature: number | null;
  } | null;
}

export const SETTINGS_TABS = [
  { key: 'providers', labelKey: 'nav.providers', icon: 'fa-solid fa-plug' },
  { key: 'prompts', labelKey: 'nav.prompts', icon: 'fa-solid fa-file-code' },
  { key: 'appearance', labelKey: 'nav.appearance', icon: 'fa-solid fa-palette' },
  { key: 'environment', labelKey: 'nav.environment', icon: 'fa-solid fa-server' },
] as const;

export type TabKey = (typeof SETTINGS_TABS)[number]['key'];

/** 设置内容。模型接入、提示词模板、外观与语言、运行环境四个部分，由弹窗外壳承载。 */
export function SettingsClient() {
  const { t, settings, update } = useSettings();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Provider | null>(null);
  const [promptEditing, setPromptEditing] = useState<PromptEntry | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  /** 表单状态，创建与编辑共用 */
  const [form, setForm] = useState({
    name: '',
    presetId: 'custom',
    baseUrl: '',
    apiKey: '',
    defaultModel: '',
    modelsText: '',
    temperature: 1,
    topP: 0.95,
    maxTokens: 8192,
    stream: true,
    maxRetries: 2,
    enabled: true,
  });

  const [promptForm, setPromptForm] = useState({
    systemPrompt: '',
    userPrompt: '',
    temperature: 1,
  });

  const loadProviders = useCallback(async () => {
    const result = await api.get<{ providers: Provider[] }>('/api/providers');
    setProviders(result.providers);
  }, []);

  const loadPrompts = useCallback(async () => {
    const result = await api.get<{ builtin: PromptEntry[] }>('/api/prompts');
    setPrompts(result.builtin);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const result = await api.get<{ environment: EnvironmentInfo }>('/api/settings');
        setEnvironment(result.environment);
        await Promise.all([loadProviders(), loadPrompts()]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.networkError'));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProviders, loadPrompts, t, toast]);

  const openCreate = () => {
    const preset = PROVIDER_PRESETS[0]!;
    setForm({
      name: preset.name,
      presetId: preset.id,
      baseUrl: preset.baseUrl,
      apiKey: '',
      defaultModel: preset.defaultModel,
      modelsText: preset.models.join('\n'),
      temperature: preset.params.temperature ?? 1,
      topP: preset.params.topP ?? 0.95,
      maxTokens: preset.params.maxTokens ?? 8192,
      stream: true,
      maxRetries: 2,
      enabled: true,
    });
    setCreating(true);
  };

  const openEdit = (provider: Provider) => {
    setForm({
      name: provider.name,
      presetId: provider.presetId,
      baseUrl: provider.baseUrl,
      apiKey: '',
      defaultModel: provider.defaultModel,
      modelsText: provider.models.join('\n'),
      temperature: provider.params.temperature ?? 1,
      topP: provider.params.topP ?? 0.95,
      maxTokens: provider.params.maxTokens ?? 8192,
      stream: provider.stream,
      maxRetries: provider.maxRetries,
      enabled: provider.enabled,
    });
    setEditing(provider);
  };

  const applyPreset = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      setForm((current) => ({ ...current, presetId }));
      return;
    }
    setForm((current) => ({
      ...current,
      presetId,
      name: preset.name,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      modelsText: preset.models.join('\n'),
      temperature: preset.params.temperature ?? current.temperature,
      topP: preset.params.topP ?? current.topP,
      maxTokens: preset.params.maxTokens ?? current.maxTokens,
    }));
  };

  const submitProvider = async () => {
    const params: ModelParams = {
      temperature: form.temperature,
      topP: form.topP,
      maxTokens: form.maxTokens,
    };
    const payload = {
      name: form.name,
      presetId: form.presetId,
      baseUrl: form.baseUrl,
      defaultModel: form.defaultModel,
      models: form.modelsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      params,
      stream: form.stream,
      maxRetries: form.maxRetries,
      enabled: form.enabled,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
    };

    try {
      if (editing) {
        await api.patch(`/api/providers/${editing.id}`, payload);
      } else {
        await api.post('/api/providers', payload);
      }
      toast.success(t('common.saved'));
      setEditing(null);
      setCreating(false);
      await loadProviders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const activateProvider = async (provider: Provider) => {
    try {
      await api.post(`/api/providers/${provider.id}`, { action: 'activate' });
      await loadProviders();
      toast.success(`${provider.name} ${t('settings.activeNow')}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const refreshModels = async (provider: Provider) => {
    try {
      await api.post(`/api/providers/${provider.id}`, { action: 'refreshModels' });
      await loadProviders();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const testProvider = async (provider: Provider) => {
    setTesting(provider.id);
    try {
      const result = await api.post<{ text: string }>('/api/ai/models', {
        providerId: provider.id,
        action: 'test',
      });
      toast.success(t('settings.testSuccess', { text: result.text.slice(0, 60) }));
    } catch (error) {
      toast.error(
        t('settings.testFailed', {
          message: error instanceof Error ? error.message : t('common.generateFailed'),
        }),
      );
    } finally {
      setTesting(null);
    }
  };

  const removeProvider = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(`/api/providers/${pendingDelete.id}`);
      setPendingDelete(null);
      await loadProviders();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const openPromptEditor = (entry: PromptEntry) => {
    setPromptForm({
      systemPrompt: entry.effective?.systemPrompt ?? entry.systemPrompt,
      userPrompt: entry.effective?.userPrompt ?? entry.userPrompt,
      temperature: entry.effective?.temperature ?? entry.temperature,
    });
    setPromptEditing(entry);
  };

  const savePrompt = async () => {
    if (!promptEditing) return;
    try {
      await api.post('/api/prompts', {
        taskType: promptEditing.taskType,
        providerId: null,
        systemPrompt: promptForm.systemPrompt,
        userPrompt: promptForm.userPrompt,
        temperature: promptForm.temperature,
      });
      toast.success(t('common.saved'));
      setPromptEditing(null);
      await loadPrompts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const revertPrompt = async (taskType: TaskType) => {
    try {
      await api.delete(`/api/prompts?taskType=${taskType}`);
      await loadPrompts();
      toast.success(t('common.reset'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[0.82rem] transition-colors duration-200',
              tab === item.key
                ? 'bg-accent-soft font-semibold text-accent-strong'
                : 'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
            )}
          >
            <i className={item.icon} aria-hidden />
            {t(item.labelKey)}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('common.loading')}
        </div>
      ) : null}

      {tab === 'providers' ? (
        <Panel
          title={t('settings.providersTitle')}
          description={t('settings.providersHint')}
          actions={
            <Button variant="primary" icon="fa-solid fa-plus" onClick={openCreate}>
              {t('settings.addProvider')}
            </Button>
          }
        >
          <ul className="flex flex-col gap-3">
            {providers.map((provider) => (
              <li
                key={provider.id}
                className={clsx(
                  'card animate-rise flex flex-col gap-3 p-4',
                  provider.isActive && 'border-accent-border',
                )}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-semibold text-soft">{provider.name}</span>
                  {provider.isActive ? (
                    <span className="chip chip-accent">
                      <i className="fa-solid fa-circle-check" aria-hidden />
                      {t('settings.activeNow')}
                    </span>
                  ) : null}
                  {!provider.enabled ? <span className="chip">{t('common.no')}</span> : null}
                  {provider.hasApiKey ? (
                    <span className="chip font-mono text-[0.68rem]">{provider.apiKeyMasked}</span>
                  ) : (
                    <span className="chip text-warn">{t('errors.apiKeyMissing')}</span>
                  )}
                </div>

                <dl className="grid gap-x-6 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-ink-faint">{t('settings.baseUrl')}</dt>
                    <dd className="min-w-0 truncate font-mono">{provider.baseUrl}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-ink-faint">{t('settings.defaultModel')}</dt>
                    <dd className="min-w-0 truncate font-mono">{provider.defaultModel || '-'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-ink-faint">{t('settings.temperature')}</dt>
                    <dd>{provider.params.temperature ?? '-'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-ink-faint">{t('settings.maxRetries')}</dt>
                    <dd>{provider.maxRetries}</dd>
                  </div>
                </dl>

                <div className="flex flex-wrap items-center gap-2">
                  {!provider.isActive ? (
                    <Button size="sm" variant="primary" onClick={() => activateProvider(provider)}>
                      {t('settings.activate')}
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => openEdit(provider)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" onClick={() => refreshModels(provider)}>
                    {t('settings.refreshModels')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => testProvider(provider)}
                    disabled={testing === provider.id}
                  >
                    {testing === provider.id ? <Spinner /> : null}
                    {t('settings.testConnection')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    onClick={() => setPendingDelete(provider)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tab === 'prompts' ? (
        <Panel title={t('settings.promptsTitle')} description={t('settings.promptsHint')}>
          <ul className="flex flex-col divide-y divide-line">
            {prompts.map((entry) => (
              <li key={entry.taskType} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-soft">{entry.label}</span>
                    {entry.effective ? (
                      <span className="chip chip-accent">{t('settings.overrideExists')}</span>
                    ) : (
                      <span className="chip">{t('settings.useBuiltin')}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {entry.description}
                  </p>
                  <p className="mt-1 font-mono text-[0.68rem] text-ink-faint">
                    {entry.placeholders.slice(0, 8).join(' ')}
                    {entry.placeholders.length > 8 ? ' …' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => openPromptEditor(entry)}>
                    {t('common.edit')}
                  </Button>
                  {entry.effective ? (
                    <Button size="sm" variant="danger" onClick={() => revertPrompt(entry.taskType)}>
                      {t('settings.revertToBuiltin')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tab === 'appearance' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('settings.appearanceTitle')} description={t('common.preview')}>
            <div className="flex flex-col gap-4">
              <Field label={t('settings.themeMode')} hint={t('settings.themeModeHint')}>
                <Select
                  value={settings.themeMode}
                  onChange={(event) =>
                    void update({ themeMode: event.target.value as AppSettings['themeMode'] })
                  }
                >
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                  <option value="system">{t('settings.themeSystem')}</option>
                </Select>
              </Field>

              <Field label={t('settings.accentHue')} hint={t('settings.accentHueHint')}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={settings.accentHue}
                    onChange={(event) => void update({ accentHue: Number(event.target.value) })}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-sunken accent-[var(--accent)]"
                    style={{
                      background: `linear-gradient(to right, hsl(0 62% 46%), hsl(60 62% 46%), hsl(120 62% 46%), hsl(180 62% 46%), hsl(240 62% 46%), hsl(300 62% 46%), hsl(360 62% 46%))`,
                    }}
                  />
                  <span className="w-12 shrink-0 text-right text-xs font-mono text-ink-muted">
                    {settings.accentHue}
                  </span>
                </div>
              </Field>

              <Field label={t('settings.density')}>
                <Select
                  value={settings.density}
                  onChange={(event) =>
                    void update({ density: event.target.value as AppSettings['density'] })
                  }
                >
                  <option value="comfortable">{t('settings.densityComfortable')}</option>
                  <option value="compact">{t('settings.densityCompact')}</option>
                </Select>
              </Field>

              <Field label={`${t('settings.readerFontSize')} ${settings.readerFontSize}px`}>
                <input
                  type="range"
                  min={13}
                  max={26}
                  value={settings.readerFontSize}
                  onChange={(event) => void update({ readerFontSize: Number(event.target.value) })}
                  className="w-full cursor-pointer accent-[var(--accent)]"
                />
              </Field>

              <Field label={`${t('settings.readerWidth')} ${settings.readerWidth}rem`}>
                <input
                  type="range"
                  min={30}
                  max={90}
                  value={settings.readerWidth}
                  onChange={(event) => void update({ readerWidth: Number(event.target.value) })}
                  className="w-full cursor-pointer accent-[var(--accent)]"
                />
              </Field>

              <Toggle
                checked={settings.showStreamingRaw}
                onChange={(value) => void update({ showStreamingRaw: value })}
                label={t('settings.showStreamingRaw')}
                hint={t('settings.showStreamingRawHint')}
              />

              <Toggle
                checked={settings.showSpeakerName}
                onChange={(value) => void update({ showSpeakerName: value })}
                label={t('settings.showSpeakerName')}
                hint={t('settings.showSpeakerNameHint')}
              />

              <Field label={t('settings.locale')} hint={t('settings.localeHint')}>
                <Select
                  value={settings.locale}
                  onChange={(event) => void update({ locale: event.target.value })}
                >
                  {LOCALES.map((locale) => (
                    <option key={locale.code} value={locale.code}>
                      {locale.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Panel>

          <Panel title={t('common.preview')}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">主要按钮</Button>
                <Button>普通按钮</Button>
                <Button variant="ghost">弱化按钮</Button>
                <Button variant="danger">危险操作</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="chip">默认标签</span>
                <span className="chip chip-accent">主题标签</span>
                <span className="chip text-ok">已完成</span>
              </div>
              <div className="card p-4">
                <p className="panel-title">面板标题</p>
                <p className="mt-1.5 text-sm text-soft">
                  正文示例。文字带柔和阴影，整体以黑白灰为主，仅使用少量主题色点缀。
                </p>
              </div>
              <div className="prose-novel card px-5 py-4">
                <p>
                  山道尽头是一间半塌的茶棚，檐下挂着的灯笼早就褪成了灰白色。少年把斗笠压低，走进那片阴影里。
                </p>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === 'environment' && environment ? (
        <Panel title={t('settings.environmentTitle')} description={t('data.storageTitle')}>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="panel-title">{t('settings.dataDir')}</dt>
              <dd className="mt-1 break-all font-mono text-xs">{environment.dataDir}</dd>
            </div>
            <div>
              <dt className="panel-title">{t('settings.schemaVersion')}</dt>
              <dd className="mt-1 font-mono text-xs">v{environment.schemaVersion}</dd>
            </div>
            <div>
              <dt className="panel-title">{t('settings.databaseSize')}</dt>
              <dd className="mt-1 text-xs">{formatBytes(environment.databaseSize)}</dd>
            </div>
            <div>
              <dt className="panel-title">{t('settings.nodeVersion')}</dt>
              <dd className="mt-1 font-mono text-xs">{environment.nodeVersion}</dd>
            </div>
            <div>
              <dt className="panel-title">{t('settings.platform')}</dt>
              <dd className="mt-1 font-mono text-xs">{environment.platform}</dd>
            </div>
          </dl>
          <ul className="mt-5 flex flex-col gap-2 text-xs leading-relaxed text-ink-muted">
            <li className="flex gap-2">
              <i className="fa-solid fa-database mt-0.5 text-ink-faint" aria-hidden />
              {t('data.storageDatabase')}
            </li>
            <li className="flex gap-2">
              <i className="fa-solid fa-file-lines mt-0.5 text-ink-faint" aria-hidden />
              {t('data.storageFiles')}
            </li>
            <li className="flex gap-2">
              <i className="fa-solid fa-lock mt-0.5 text-ink-faint" aria-hidden />
              {t('data.storageKey')}
            </li>
          </ul>
        </Panel>
      ) : null}

      <Modal
        open={creating || editing !== null}
        title={editing ? t('common.edit') : t('settings.addProvider')}
        description={t('settings.providersHint')}
        size="lg"
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submitProvider}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('settings.preset')}>
            <Select value={form.presetId} onChange={(event) => applyPreset(event.target.value)}>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </Select>
          </Field>
          {PROVIDER_PRESETS.find((preset) => preset.id === form.presetId)?.note ? (
            <p className="rounded-[6px] bg-surface-soft px-3 py-2 text-xs leading-relaxed text-ink-muted">
              {PROVIDER_PRESETS.find((preset) => preset.id === form.presetId)?.note}
            </p>
          ) : null}

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('settings.providerName')} required>
              <TextInput
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={t('settings.baseUrl')} hint={t('settings.baseUrlHint')} required>
              <TextInput
                value={form.baseUrl}
                className="font-mono text-xs"
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
            </Field>
          </div>

          <Field
            label={t('settings.apiKey')}
            hint={editing ? t('settings.apiKeyHint') : undefined}
          >
            <TextInput
              type="password"
              autoComplete="off"
              className="font-mono text-xs"
              value={form.apiKey}
              placeholder={
                editing ? t('settings.apiKeyPlaceholderKeep') : t('settings.apiKeyPlaceholderEmpty')
              }
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('settings.defaultModel')}>
              <TextInput
                value={form.defaultModel}
                className="font-mono text-xs"
                onChange={(event) => setForm({ ...form, defaultModel: event.target.value })}
              />
            </Field>
            <Field label={t('settings.maxRetries')}>
              <TextInput
                type="number"
                min={0}
                max={5}
                value={form.maxRetries}
                onChange={(event) => setForm({ ...form, maxRetries: Number(event.target.value) })}
              />
            </Field>
          </div>

          <Field label={t('settings.models')} hint={t('settings.modelsHint')}>
            <TextArea
              rows={5}
              className="font-mono text-xs"
              value={form.modelsText}
              onChange={(event) => setForm({ ...form, modelsText: event.target.value })}
            />
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label={t('settings.temperature')}>
              <TextInput
                type="number"
                step={0.05}
                min={0}
                max={2}
                value={form.temperature}
                onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('settings.topP')}>
              <TextInput
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={form.topP}
                onChange={(event) => setForm({ ...form, topP: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('settings.maxTokens')}>
              <TextInput
                type="number"
                min={256}
                max={131072}
                value={form.maxTokens}
                onChange={(event) => setForm({ ...form, maxTokens: Number(event.target.value) })}
              />
            </Field>
          </div>

          <Toggle
            checked={form.stream}
            onChange={(value) => setForm({ ...form, stream: value })}
            label={t('settings.stream')}
            hint={t('settings.streamHint')}
          />
          <Toggle
            checked={form.enabled}
            onChange={(value) => setForm({ ...form, enabled: value })}
            label={t('settings.enabled')}
          />
        </div>
      </Modal>

      <Modal
        open={promptEditing !== null}
        title={promptEditing?.label ?? ''}
        description={t('settings.promptsHint')}
        size="xl"
        onClose={() => setPromptEditing(null)}
        footer={
          <>
            <Button onClick={() => setPromptEditing(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={savePrompt}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {promptEditing ? (
          <div className="grid gap-3.5">
            <p className="rounded-[6px] bg-surface-soft px-3 py-2 font-mono text-[0.68rem] leading-relaxed text-ink-muted">
              {t('settings.placeholders')}：{promptEditing.placeholders.join('  ')}
            </p>
            <Field label={t('settings.systemPrompt')}>
              <TextArea
                rows={10}
                className="font-mono text-xs"
                value={promptForm.systemPrompt}
                onChange={(event) =>
                  setPromptForm({ ...promptForm, systemPrompt: event.target.value })
                }
              />
            </Field>
            <Field label={t('settings.userPrompt')}>
              <TextArea
                rows={14}
                className="font-mono text-xs"
                value={promptForm.userPrompt}
                onChange={(event) => setPromptForm({ ...promptForm, userPrompt: event.target.value })}
              />
            </Field>
            <Field label={t('settings.temperature')}>
              <TextInput
                type="number"
                step={0.05}
                min={0}
                max={2}
                value={promptForm.temperature}
                onChange={(event) =>
                  setPromptForm({ ...promptForm, temperature: Number(event.target.value) })
                }
              />
            </Field>
            <div className="flex justify-end">
              <Button
                variant="danger"
                onClick={() => {
                  void revertPrompt(promptEditing.taskType);
                  setPromptEditing(null);
                }}
              >
                {t('settings.revertToBuiltin')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('settings.deleteProviderConfirm')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={removeProvider}
      />
    </div>
  );
}
