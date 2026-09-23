'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import {
  Button,
  Field,
  Panel,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/primitives';
import { useGeneration } from '@/hooks/useGeneration';
import { BudgetConfirmPrompt } from './BudgetConfirmPrompt';
import type { ContextBudget, GenerationRules, NovelPreferences } from '@/lib/types';

/** 设定与生成规则。这两部分属于始终注入层，会随每次生成一起发送给模型。 */

interface PreferencesPayload {
  preferences: NovelPreferences;
  texts: {
    worldview: string;
    setting: string;
    outlineOverview: string;
    endingPlan: string;
    styleSample: string;
  };
}

const EMPTY_TEXTS: PreferencesPayload['texts'] = {
  worldview: '',
  setting: '',
  outlineOverview: '',
  endingPlan: '',
  styleSample: '',
};

/** 上下文预算的可编辑字段，键名与 ContextBudget 保持一致。 */
const BUDGET_FIELDS: Array<[keyof ContextBudget, string]> = [
  ['total', 'setup.budgetTotal'],
  ['always', 'setup.budgetAlways'],
  ['recalled', 'setup.budgetRecalled'],
  ['outlines', 'setup.budgetOutlines'],
  ['reserved', 'setup.budgetReserved'],
];

export function SetupClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  /** 整本书大纲的 AI 修改弹窗 */
  const [overviewAiOpen, setOverviewAiOpen] = useState(false);
  /** 交给模型的修改要求 */
  const [overviewAsk, setOverviewAsk] = useState('');

  const generation = useGeneration();

  const [texts, setTexts] = useState(EMPTY_TEXTS);
  const [preferences, setPreferences] = useState<NovelPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 刚完成一次保存，用于在保存条上给出短暂反馈 */
  const [justSaved, setJustSaved] = useState(false);
  const [forbiddenText, setForbiddenText] = useState('');
  const [extraText, setExtraText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<PreferencesPayload>(novelResourcePath(novelId, 'preferences'));
      setTexts({ ...EMPTY_TEXTS, ...result.texts });
      setPreferences(result.preferences);
      setForbiddenText(result.preferences.rules.forbidden.join('\n'));
      setExtraText(result.preferences.rules.extra.join('\n'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setLoading(false);
    }
  }, [novelId, t, toast]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  /**
   * 设定与规则页面采用实时保存。
   *
   * 输入停顿一段时间后再落库，避免逐字符请求；同时保存最新的文本与规则状态，
   * 因此这里用 ref 持有最新值，防止防抖闭包读到过期快照。
   * ref 在副作用中更新，不在渲染期间写入。
   */
  const liveRef = useRef({ texts, preferences, forbiddenText, extraText });

  useEffect(() => {
    liveRef.current = { texts, preferences, forbiddenText, extraText };
  }, [texts, preferences, forbiddenText, extraText]);

  /**
   * 保存设定与规则。
   *
   * silent 为真时不弹出提示，供实时保存使用。
   *
   * 保存成功后不回写服务端返回值：本地状态就是用户正在编辑的那一份，
   * 用它覆盖会让输入框里的内容与光标位置发生跳变，观感上像是页面被刷新了一遍。
   * 服务端可能对数值做了归一，那些差异在下次进入页面时自然同步。
   */
  const save = useCallback(
    async (silent = false) => {
      const current = liveRef.current;
      if (!current.preferences) return;
      setSaving(true);
      try {
        const rules: GenerationRules = {
          ...current.preferences.rules,
          forbidden: current.forbiddenText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          extra: current.extraText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        };
        // 文本字段必须放在展开之后。
        //
        // 服务端读取配置时会把 novel_settings 整张表的键都装进 preferences 对象，
        // 其中就包含 worldview、setting 等文本键的空串默认值。若把它展开在 texts 之后，
        // 这些空串会覆盖掉用户真正输入的内容，表现为「保存后刷新即消失」。
        await api.patch<PreferencesPayload>(novelResourcePath(novelId, 'preferences'), {
          ...current.preferences,
          rules,
          ...current.texts,
        });
        setJustSaved(true);
        if (!silent) toast.success(t('setup.savedHint'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
      } finally {
        setSaving(false);
      }
    },
    [novelId, t, toast],
  );

  const hydratedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLiveSave = useCallback(() => {
    if (!hydratedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save(true);
    }, 900);
  }, [save]);

  // 首屏加载完成后才允许实时保存，避免初始状态被误写回
  useEffect(() => {
    if (!loading && preferences) hydratedRef.current = true;
  }, [loading, preferences]);

  // 保存反馈只停留一小会儿，随后回到常驻提示，避免状态文案长时间占位
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2400);
    return () => clearTimeout(timer);
  }, [justSaved]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /*
   * 整本书大纲的 AI 修改。
   *
   * 结果先展示在弹窗里，确认后才写入大纲总纲：
   * 模型的输出未必一次到位，直接覆盖会丢掉用户原有的内容。
   */
  const runOverviewAi = async () => {
    if (!overviewAsk.trim()) {
      toast.error(t('common.required'));
      return;
    }
    await generation.start({
      novelId,
      taskType: 'outline_overview_revise',
      instruction: overviewAsk,
    });
  };

  const applyOverviewResult = async () => {
    const text = generation.text.trim();
    if (!text) return;
    // 同时更新 ref 与 state：保存逻辑读的是 ref，晚一步就会写回旧内容
    const nextTexts = { ...liveRef.current.texts, outlineOverview: text };
    liveRef.current = { ...liveRef.current, texts: nextTexts };
    setTexts(nextTexts);
    setOverviewAiOpen(false);
    setOverviewAsk('');
    await save();
  };

  const patchRules = (patch: Partial<GenerationRules>) => {
    setPreferences((current) => (current ? { ...current, rules: { ...current.rules, ...patch } } : current));
  };

  const patchBudget = (patch: Partial<ContextBudget>) => {
    setPreferences((current) => (current ? { ...current, budget: { ...current.budget, ...patch } } : current));
  };

  if (loading || !preferences) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  const budgetSum =
    preferences.budget.always +
    preferences.budget.recalled +
    preferences.budget.outlines +
    preferences.budget.reserved;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <header>
        <h1 className="text-lg font-semibold text-soft text-glow">{t('setup.title')}</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t('setup.autoSaveHint')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('setup.worldview')} description={t('setup.worldviewHint')}>
          <TextArea
            rows={16}
            value={texts.worldview}
            placeholder={t('setup.worldviewPlaceholder')}
            onChange={(event) => {
              setTexts({ ...texts, worldview: event.target.value });
              scheduleLiveSave();
            }}
          />
        </Panel>

        <Panel title={t('setup.setting')} description={t('setup.settingHint')}>
          <TextArea
            rows={16}
            value={texts.setting}
            placeholder={t('setup.settingPlaceholder')}
            onChange={(event) => {
              setTexts({ ...texts, setting: event.target.value });
              scheduleLiveSave();
            }}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('setup.calendar')} description={t('setup.calendarHint')}>
          <TextArea
            rows={6}
            value={preferences.calendar}
            placeholder={t('setup.calendarPlaceholder')}
            onChange={(event) => {
              setPreferences({ ...preferences, calendar: event.target.value });
              scheduleLiveSave();
            }}
          />
        </Panel>

        <Panel
          title={t('setup.outlineOverview')}
          description={t('setup.outlineOverviewHint')}
          actions={
            <Button size="sm" onClick={() => setOverviewAiOpen(true)}>
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
              {t('setup.outlineOverviewAi')}
            </Button>
          }
        >
          <TextArea
            rows={6}
            value={texts.outlineOverview}
            onChange={(event) => {
              setTexts({ ...texts, outlineOverview: event.target.value });
              scheduleLiveSave();
            }}
          />
        </Panel>

        <Panel title={t('setup.endingPlan')} description={t('setup.endingPlanHint')}>
          <TextArea
            rows={6}
            value={texts.endingPlan}
            onChange={(event) => {
              setTexts({ ...texts, endingPlan: event.target.value });
              scheduleLiveSave();
            }}
          />
        </Panel>
      </div>

      <Panel title={t('setup.styleSample')} description={t('setup.styleSampleHint')}>
        <TextArea
          rows={6}
          value={texts.styleSample}
          onChange={(event) => {
            setTexts({ ...texts, styleSample: event.target.value });
            scheduleLiveSave();
          }}
        />
      </Panel>

      <Panel title={t('setup.rules')} description={t('setup.rulesHint')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3.5">
            <Field label={t('setup.ruleStyle')}>
              <TextArea
                rows={3}
                value={preferences.rules.style}
                onChange={(event) => {
                  patchRules({ style: event.target.value });
                  scheduleLiveSave();
                }}
              />
            </Field>
            <Field label={t('setup.rulePov')}>
              <TextInput
                value={preferences.rules.pov}
                onChange={(event) => {
                  patchRules({ pov: event.target.value });
                  scheduleLiveSave();
                }}
              />
            </Field>
            <Field label={t('setup.ruleSpeech')}>
              <TextArea
                rows={3}
                value={preferences.rules.speechHabits}
                onChange={(event) => {
                  patchRules({ speechHabits: event.target.value });
                  scheduleLiveSave();
                }}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3.5">
            <Field label={t('setup.ruleForbidden')} hint={t('setup.ruleForbiddenHint')}>
              <TextArea
                rows={4}
                value={forbiddenText}
                onChange={(event) => {
                  setForbiddenText(event.target.value);
                  scheduleLiveSave();
                }}
              />
            </Field>
            <Field label={t('setup.ruleExtra')} hint={t('setup.ruleExtraHint')}>
              <TextArea
                rows={4}
                value={extraText}
                onChange={(event) => {
                  setExtraText(event.target.value);
                  scheduleLiveSave();
                }}
              />
            </Field>
            <Toggle
              checked={preferences.rules.allowExplicit}
              onChange={(value) => {
                  patchRules({ allowExplicit: value });
                  scheduleLiveSave();
                }}
              label={t('setup.allowExplicit')}
              hint={t('setup.allowExplicitHint')}
            />
            <Toggle
              checked={preferences.rules.allowViolence}
              onChange={(value) => {
                  patchRules({ allowViolence: value });
                  scheduleLiveSave();
                }}
              label={t('setup.allowViolence')}
            />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('setup.targetWords')} description={t('setup.targetWordsHint')}>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('setup.targetWords')}>
              <TextInput
                type="number"
                min={500}
                max={30000}
                step={100}
                value={preferences.targetWords}
                onChange={(event) => {
                  setPreferences({ ...preferences, targetWords: Number(event.target.value) });
                  scheduleLiveSave();
                }}
              />
            </Field>
            <Field label={t('setup.wordTolerance')} hint={t('setup.wordToleranceHint')}>
              <TextInput
                type="number"
                min={0}
                max={60}
                value={preferences.wordTolerancePercent}
                onChange={(event) => {
                  setPreferences({
                    ...preferences,
                    wordTolerancePercent: Number(event.target.value),
                  });
                  scheduleLiveSave();
                }}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <Toggle
              checked={preferences.autoAdvanceEvent}
              onChange={(value) => {
                setPreferences({ ...preferences, autoAdvanceEvent: value });
                scheduleLiveSave();
              }}
              label={t('setup.autoAdvanceEvent')}
              hint={t('setup.autoAdvanceEventHint')}
            />
            <Toggle
              checked={preferences.autoExtractSettings}
              onChange={(value) => {
                setPreferences({ ...preferences, autoExtractSettings: value });
                scheduleLiveSave();
              }}
              label={t('setup.autoExtractSettings')}
              hint={t('setup.autoExtractSettingsHint')}
            />
            <Toggle
              checked={preferences.allowEventRecall}
              onChange={(value) => {
                setPreferences({ ...preferences, allowEventRecall: value });
                scheduleLiveSave();
              }}
              label={t('setup.allowEventRecall')}
              hint={t('setup.allowEventRecallHint')}
            />
          </div>
        </Panel>

        <Panel title={t('setup.budget')} description={t('setup.budgetHint')}>
          <div className="grid gap-3.5 sm:grid-cols-2">
            {BUDGET_FIELDS.map(([key, labelKey]) => (
              <Field key={key} label={t(labelKey)}>
                <TextInput
                  type="number"
                  min={0}
                  step={1000}
                  value={preferences.budget[key]}
                  onChange={(event) => {
                    patchBudget({ [key]: Number(event.target.value) } as Partial<ContextBudget>);
                    scheduleLiveSave();
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            {t('setup.budgetUsed')}：{budgetSum.toLocaleString('zh-Hans-CN')} /{' '}
            {preferences.budget.total.toLocaleString('zh-Hans-CN')} token
          </p>
        </Panel>
      </div>

      {/*
        保存条固定在视口底部，滚动到页面任何位置都能直接保存。
        整页只保留这一个保存入口，状态提示也收在这里。
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 shadow-[var(--shadow-raised),var(--glow-accent)]">
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            {saving ? (
              <Spinner />
            ) : justSaved ? (
              <i className="fa-solid fa-circle-check text-ok" aria-hidden />
            ) : (
              <i className="fa-solid fa-cloud-arrow-up opacity-60" aria-hidden />
            )}
            {saving
              ? t('setup.autoSaving')
              : justSaved
                ? t('setup.savedHint')
                : t('setup.autoSaveHint')}
          </span>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
            <i className="fa-solid fa-floppy-disk" aria-hidden />
            {t('common.save')}
          </Button>
        </div>
      </div>
      <Modal
        open={overviewAiOpen}
        title={t('setup.outlineOverviewAi')}
        description={t('setup.outlineOverviewAiHint')}
        size="xl"
        onClose={() => setOverviewAiOpen(false)}
        footer={
          <>
            <Button onClick={() => setOverviewAiOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={applyOverviewResult}
              disabled={!generation.text.trim()}
            >
              <i className="fa-solid fa-check" aria-hidden />
              {t('common.apply')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('workbench.outlineRevise')} hint={t('workbench.outlineRevisePlaceholder')}>
            <TextArea
              rows={3}
              value={overviewAsk}
              onChange={(event) => setOverviewAsk(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void runOverviewAi()}
              disabled={generation.status === 'running'}
            >
              {generation.status === 'running' ? (
                <Spinner />
              ) : (
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
              )}
              {t('workbench.outlineGenerate')}
            </Button>
            {generation.status === 'running' ? (
              <Button onClick={generation.pause}>
                <i className="fa-solid fa-pause" aria-hidden />
                {t('workbench.chapterPause')}
              </Button>
            ) : null}
          </div>
          <BudgetConfirmPrompt generation={generation} />
          {generation.error ? (
            <p className="rounded-[6px] bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
              {generation.error}
            </p>
          ) : null}
          {generation.text ? (
            <div className="card max-h-96 overflow-y-auto px-4 py-3">
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{generation.text}</p>
            </div>
          ) : (
            <p className="text-xs text-ink-faint">{t('workbench.streamIdle')}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
