import React, { useState, useContext, useId, useMemo, useCallback } from 'react';
import { useBot } from './context';
import { CallbackRegistryCtx } from '@teactjs/react';

// ---- Validation ----

/**
 * Validation function: return `true` to accept, or an error-message string.
 *
 * @example
 * const notEmpty: ValidateFn = (v) => v.trim() ? true : 'Cannot be empty';
 */
export type ValidateFn = (value: string) => true | string;

/** Duck-typed Zod / Standard Schema — anything with a `.safeParse()` method. */
export interface SchemaLike {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } };
}

/**
 * Input validator — either a plain function or a Zod-compatible schema.
 *
 * @example
 * // Function validator
 * const v: Validator = (val) => val.length >= 2 || 'Too short';
 *
 * // Zod schema
 * const v: Validator = z.string().min(2);
 */
export type Validator = ValidateFn | SchemaLike;

function runValidation(validator: Validator, value: string): true | string {
  if (typeof validator === 'function') return validator(value);
  if (typeof validator === 'object' && 'safeParse' in validator) {
    const r = validator.safeParse(value);
    return r.success ? true : ((r as any).error?.issues?.[0]?.message ?? 'Invalid input');
  }
  return true;
}

// ---- Step definitions ----

type AskOption = string | { text: string; value: string };

/** Navigation actions available inside custom render steps. */
export interface StepActions {
  back(): void;
  goTo(key: string): void;
  canGoBack(): boolean;
}

/**
 * A single conversation step definition:
 * - `prompt` — wait for free-text input with optional validation
 * - `ask` — present inline-keyboard buttons for selection
 * - `render` — custom React element with manual `done()` callback
 */
export type StepDef =
  | { prompt: string; validate?: Validator }
  | { ask: string; options: AskOption[][] }
  | { render: (done: (value?: string) => void, actions: StepActions) => React.ReactElement };

/** Map of step names to their definitions. */
export type StepsConfig = Record<string, StepDef>;

/** Navigation actions returned by `useConversation` for controlling flow. */
export interface ConversationActions {
  goTo(key: string): void;
  back(): void;
  reset(): void;
  clear(key: string): void;
  canGoBack(): boolean;
}

/** Navigation actions returned by `useForm` for controlling form flow. */
export interface FormActions<K extends string = string> {
  goTo(key: K): void;
  back(): void;
  reset(): void;
}

// ---- useConversation ----

interface UseConversationOptions {
  validate?: (key: string, value: string) => true | string;
}

export interface ConversationState<K extends string = string> {
  has(key: K): boolean;
  get(key: K): string | undefined;
  set(key: K, value: string): void;
  /** Remove a collected answer, causing that step to be re-asked. */
  clear(key: K): void;
  prompt(key: K, questionText: string): React.ReactElement;
  ask(key: K, questionText: string, options: AskOption[][]): React.ReactElement;
  waitFor(key: K): void;
  /** Current step index (0-based). */
  step: number;
  /** Key of the current step, or null when complete. */
  current: K | null;
  /** True when all declared steps are done (always false in imperative mode). */
  complete: boolean;
  isWaiting: boolean;
  data: Readonly<Record<K, string>>;
  lastError: string | null;
  /**
   * Render the conversation flow.
   *
   * With a completion callback (recommended) — no `if` check needed:
   * ```tsx
   * return conv.render(() => <Message text="Done!" />);
   * ```
   *
   * Without a callback — returns null when complete:
   * ```tsx
   * const el = conv.render();
   * if (!el) return <Message text="Done!" />;
   * return el;
   * ```
   */
  render(onComplete: () => React.ReactElement): React.ReactElement;
  render(): React.ReactElement | null;
  /** Go back to the previous step. Clears that step's answer so it gets re-asked. */
  back(): void;
  /** Jump to a specific step. Clears that step's answer so it gets re-asked. After answering, resumes from there. */
  goTo(key: K): void;
  /** True when there is a previous step to go back to. */
  canGoBack(): boolean;
  reset(): void;
}

function isStepsConfig(arg: any): arg is StepsConfig {
  if (!arg || typeof arg !== 'object') return false;
  if ('validate' in arg && typeof arg.validate === 'function') return false;
  const vals = Object.values(arg);
  return vals.length > 0 && vals.every((v: any) =>
    v && typeof v === 'object' && ('prompt' in v || 'ask' in v || 'render' in v),
  );
}

/**
 * Multi-step conversation hook.
 *
 * @example Step-based (declarative)
 * ```tsx
 * const conv = useConversation({
 *   name:   { prompt: "What's your name?" },
 *   rating: { ask: 'Rate us:', options: [['⭐ 1', '⭐⭐ 2']] },
 * });
 *
 * return conv.render(() => (
 *   <Message text={`Thanks ${conv.data.name}! Rating: ${conv.data.rating}`} />
 * ));
 * ```
 *
 * @example Imperative (manual control)
 * ```tsx
 * const conv = useConversation();
 * if (!conv.has('name')) return conv.prompt('name', "What's your name?");
 * ```
 */
export function useConversation<T extends StepsConfig>(config: T): ConversationState<Extract<keyof T, string>>;
export function useConversation(config?: UseConversationOptions): ConversationState;
export function useConversation(config?: StepsConfig | UseConversationOptions): ConversationState {
  const stepsMode = config ? isStepsConfig(config) : false;
  const steps = stepsMode ? config as StepsConfig : undefined;
  const opts = stepsMode ? undefined : config as UseConversationOptions | undefined;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [waitMode, setWaitMode] = useState<'text' | 'callback'>('text');
  const [processedMsgId, setProcessedMsgId] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);

  const bot = useBot();
  const registry = useContext(CallbackRegistryCtx);
  const hookId = useId();
  const text = bot.text;
  const callbackData = bot.callbackData;
  const msgId = bot.messageId ?? '';

  const stepKeys = useMemo(() => steps ? Object.keys(steps) : [], [steps]);

  const validateFn = useMemo(() => {
    if (steps) {
      return (key: string, value: string): true | string => {
        const def = steps[key];
        if (def && 'prompt' in def && def.validate) {
          return runValidation(def.validate, value);
        }
        return true;
      };
    }
    return opts?.validate;
  }, [steps, opts?.validate]);

  if (activeKey && !(activeKey in answers) && msgId !== processedMsgId) {
    if (waitMode === 'text' && text && !callbackData) {
      const result = validateFn?.(activeKey, text) ?? true;
      if (result === true) {
        setAnswers({ ...answers, [activeKey]: text });
        setActiveKey(null);
        if (lastError) setLastError(null);
      } else {
        setLastError(result);
      }
      setProcessedMsgId(msgId);
    } else if (waitMode === 'callback' && text && !callbackData) {
      setLastError('Please pick an option from the buttons above.');
      setProcessedMsgId(msgId);
    }
  }

  const setFn = useCallback((key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setActiveKey(prev => prev === key ? null : prev);
    setLastError(null);
  }, []);

  function activateText(key: string) {
    if (!activeKey && !(key in answers)) {
      setActiveKey(key);
      setWaitMode('text');
      setProcessedMsgId(msgId);
    }
  }

  function buildAsk(key: string, questionText: string, options: AskOption[][]): React.ReactElement {
    if (!activeKey && !(key in answers)) {
      setActiveKey(key);
      setWaitMode('callback');
      setProcessedMsgId(msgId);
    }

    const rows = options.map((row, ri) => {
      const buttons = row.map((opt, ci) => {
        const optText = typeof opt === 'string' ? opt : opt.text;
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const cbId = `__ask:${hookId}:${key}:${ri}:${ci}`;
        registry?.handlers.set(cbId, () => setFn(key, optValue));
        return React.createElement('tg-button', { key: `${ri}:${ci}`, text: optText, callbackData: cbId });
      });
      return React.createElement('tg-button-row', { key: String(ri) }, ...buttons);
    });

    return React.createElement(
      'tg-message', { text: questionText },
      React.createElement('tg-keyboard', {}, ...rows),
    );
  }

  const currentKey = stepKeys.find(k => !(k in answers)) ?? null;

  function renderStep(): React.ReactElement | null {
    if (!steps || !currentKey) return null;
    const def = steps[currentKey];

    if ('prompt' in def) {
      const promptText = lastError ? `⚠️ ${lastError}\n\n${def.prompt}` : def.prompt;
      activateText(currentKey);
      return React.createElement('tg-message', { text: promptText });
    }

    if ('ask' in def) {
      const askText = lastError ? `⚠️ ${lastError}\n\n${def.ask}` : def.ask;
      return buildAsk(currentKey, askText, def.options);
    }

    if ('render' in def) {
      return def.render(
        (value) => setFn(currentKey, value ?? 'done'),
        { back, goTo, canGoBack },
      );
    }

    return null;
  }

  function clearStep(key: string) {
    setAnswers(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActiveKey(null);
    setLastError(null);
  }

  function back() {
    const idx = currentKey ? stepKeys.indexOf(currentKey) : stepKeys.length;
    for (let i = idx - 1; i >= 0; i--) {
      if (stepKeys[i] in answers) {
        clearStep(stepKeys[i]);
        return;
      }
    }
  }

  function goTo(key: string) {
    clearStep(key);
  }

  function canGoBack(): boolean {
    const idx = currentKey ? stepKeys.indexOf(currentKey) : stepKeys.length;
    for (let i = idx - 1; i >= 0; i--) {
      if (stepKeys[i] in answers) return true;
    }
    return false;
  }

  function render(onComplete?: () => React.ReactElement): React.ReactElement | null {
    const stepEl = renderStep();
    if (stepEl) return stepEl;
    return onComplete ? onComplete() : null;
  }

  return {
    has: (key) => key in answers,
    get: (key) => answers[key],
    set: setFn,
    clear: clearStep,

    prompt(key: string, questionText: string) {
      activateText(key);
      return React.createElement('tg-message', { text: questionText });
    },

    ask: buildAsk,

    waitFor(key: string) {
      activateText(key);
    },

    step: currentKey ? stepKeys.indexOf(currentKey) : stepKeys.length,
    current: currentKey,
    complete: stepsMode ? currentKey === null && stepKeys.length > 0 : false,
    isWaiting: activeKey !== null,
    lastError,
    data: answers,
    render: render as ConversationState['render'],
    back,
    goTo,
    canGoBack,
    reset: () => { setAnswers({}); setActiveKey(null); setWaitMode('text'); setLastError(null); },
  } as ConversationState;
}

// ---- High-level: useForm ----

export interface FormFieldDef {
  /** Question text, or a function that receives collected data so far. */
  prompt: string | ((data: Readonly<Record<string, string>>) => string);
  /** If provided, show inline-keyboard buttons instead of waiting for text input. Each inner array is a row. */
  options?: string[][];
  /**
   * Validate text input before accepting.
   * - Function: `(v) => true | "error message"`
   * - Zod schema: `z.string().min(2)`
   * - Any object with `.safeParse()` (Standard Schema protocol)
   */
  validate?: Validator;
}

export interface FormResult<K extends string = string> {
  /** True when all fields have been collected. */
  complete: boolean;
  /** All collected answers, keyed by field name. */
  data: Readonly<Record<K, string>>;
  /**
   * Render the form flow.
   * ```tsx
   * return form.render(() => <Message text={`Hello ${form.data.name}!`} />);
   * ```
   */
  render(onComplete: () => React.ReactElement): React.ReactElement;
  render(): React.ReactElement | null;
  /** Go back to the previous field. */
  back(): void;
  /** Jump to a specific field. */
  goTo(key: K): void;
  /** True when there is a previous field to go back to. */
  canGoBack(): boolean;
  /** Clear all answers and restart the form. */
  reset(): void;
}

/**
 * Multi-step form hook with validation, back/goTo navigation, and completion state.
 *
 * @param schema - Map of field names to their prompt text, options, and validators.
 * @returns A {@link FormResult} object for rendering and reading collected data.
 *
 * @example
 * ```tsx
 * const form = useForm({
 *   name:   { prompt: "What's your name?", validate: z.string().min(2) },
 *   region: { prompt: 'Pick a region:', options: [['Kanto', 'Johto']] },
 * });
 *
 * return form.render(() => (
 *   <Message text={`${form.data.name} from ${form.data.region}`} />
 * ));
 * ```
 */
export function useForm<T extends Record<string, FormFieldDef>>(
  schema: T,
): FormResult<Extract<keyof T, string>> {
  const conv = useConversation({
    validate(key, value) {
      const field = schema[key];
      if (!field?.validate) return true;
      return runValidation(field.validate, value);
    },
  });
  const registry = useContext(CallbackRegistryCtx);
  const formId = useId();

  const keys = useMemo(() => Object.keys(schema) as (keyof T & string)[], []);
  const currentKey = keys.find(k => !conv.has(k));
  const complete = !currentKey;

  function renderStep(): React.ReactElement | null {
    if (!currentKey) return null;
    const field = schema[currentKey];
    const basePrompt = typeof field.prompt === 'function'
      ? field.prompt(conv.data)
      : field.prompt;

    const promptText = conv.lastError
      ? `⚠️ ${conv.lastError}\n\n${basePrompt}`
      : basePrompt;

    if (field.options) {
      const rows = field.options.map((row, ri) => {
        const buttons = row.map((opt, ci) => {
          const cbId = `__form:${formId}:${ri}:${ci}`;
          registry?.handlers.set(cbId, () => conv.set(currentKey!, opt));
          return React.createElement('tg-button', { key: `${ri}:${ci}`, text: opt, callbackData: cbId });
        });
        return React.createElement('tg-button-row', { key: String(ri) }, ...buttons);
      });

      return React.createElement(
        'tg-message', { text: promptText },
        React.createElement('tg-keyboard', {}, ...rows),
      );
    }

    return conv.prompt(currentKey, promptText);
  }

  function back() {
    const idx = currentKey ? keys.indexOf(currentKey) : keys.length;
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.has(keys[i])) {
        conv.clear(keys[i]);
        return;
      }
    }
  }

  function goTo(key: Extract<keyof T, string>) {
    conv.clear(key);
  }

  function render(onComplete?: () => React.ReactElement): React.ReactElement | null {
    const stepEl = renderStep();
    if (stepEl) return stepEl;
    return onComplete ? onComplete() : null;
  }

  function canGoBack(): boolean {
    const idx = currentKey ? keys.indexOf(currentKey) : keys.length;
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.has(keys[i])) return true;
    }
    return false;
  }

  return {
    complete,
    data: conv.data as Record<Extract<keyof T, string>, string>,
    render: render as FormResult<Extract<keyof T, string>>['render'],
    back,
    goTo,
    canGoBack,
    reset: () => conv.reset(),
  };
}

// ---- Contexts ----

const ConvCtx = React.createContext<ConversationState | null>(null);
const FormCtxInternal = React.createContext<FormResult | null>(null);

/** Access the nearest `<Conversation>` state from any child component. */
export function useConversationContext(): ConversationState {
  const ctx = React.useContext(ConvCtx);
  if (!ctx) throw new Error('useConversationContext must be used inside <Conversation>');
  return ctx;
}

/** Access the nearest `<Form>` state from any child component. */
export function useFormContext<K extends string = string>(): FormResult<K> {
  const ctx = React.useContext(FormCtxInternal);
  if (!ctx) throw new Error('useFormContext must be used inside <Form>');
  return ctx as FormResult<K>;
}

// ---- Phantom step components (carry config via props, never render) ----

interface ConvPromptProps { name: string; text: string; validate?: Validator }
function ConversationPrompt(_: ConvPromptProps): null { return null; }

interface ConvAskProps { name: string; text: string; options: AskOption[][] }
function ConversationAsk(_: ConvAskProps): null { return null; }

interface ConvStepProps { name: string; children: (done: (value?: string) => void, actions: StepActions) => React.ReactElement }
function ConversationStepChild(_: ConvStepProps): null { return null; }

interface ConvCompleteProps { children: React.ReactNode | ((conv: ConversationState) => React.ReactElement) }
function ConversationComplete(_: ConvCompleteProps): null { return null; }

interface FormFieldProps {
  name: string;
  prompt: string | ((data: Readonly<Record<string, string>>) => string);
  options?: string[][];
  validate?: Validator;
}
function FormFieldChild(_: FormFieldProps): null { return null; }

interface FormCompleteProps { children: React.ReactNode | ((form: FormResult) => React.ReactElement) }
function FormCompleteChild(_: FormCompleteProps): null { return null; }

// ---- <Conversation> compound component ----

/**
 * Shadcn-like composable conversation component.
 *
 * @example With `useConversation` hook (recommended)
 * ```tsx
 * const conv = useConversation({
 *   name: { prompt: "What's your name?" },
 *   rating: { ask: 'Rate us:', options: [['⭐ 1', '⭐⭐ 2']] },
 * });
 *
 * return (
 *   <Conversation value={conv}>
 *     <Conversation.Complete>
 *       <Message text={`Hello ${conv.data.name}! Rating: ${conv.data.rating}`} />
 *     </Conversation.Complete>
 *   </Conversation>
 * );
 * ```
 *
 * @example Self-contained (steps as children, like shadcn Tabs)
 * ```tsx
 * <Conversation>
 *   <Conversation.Prompt name="name" text="What's your name?" />
 *   <Conversation.Ask name="color" text="Pick:" options={[['Red', 'Blue']]} />
 *   <Conversation.Complete>
 *     {(conv) => <Message text={`${conv.data.name} chose ${conv.data.color}`} />}
 *   </Conversation.Complete>
 * </Conversation>
 * ```
 */
function ConversationRoot({ children, value }: {
  children: React.ReactNode;
  value?: ConversationState;
}): React.ReactElement {
  const configRef = React.useRef<StepsConfig | undefined>(undefined);
  const built = React.useRef(false);

  if (!built.current) {
    built.current = true;
    const config: StepsConfig = {};
    React.Children.forEach(children, child => {
      if (!React.isValidElement(child)) return;
      if (child.type === ConversationPrompt) {
        const p = child.props as ConvPromptProps;
        config[p.name] = { prompt: p.text, validate: p.validate };
      } else if (child.type === ConversationAsk) {
        const p = child.props as ConvAskProps;
        config[p.name] = { ask: p.text, options: p.options };
      } else if (child.type === ConversationStepChild) {
        const p = child.props as ConvStepProps;
        config[p.name] = { render: p.children };
      }
    });
    configRef.current = Object.keys(config).length > 0 ? config : undefined;
  }

  if (configRef.current) {
    React.Children.forEach(children, child => {
      if (React.isValidElement(child) && child.type === ConversationStepChild) {
        const p = child.props as ConvStepProps;
        const def = configRef.current![p.name];
        if (def && 'render' in def) (def as any).render = p.children;
      }
    });
  }

  const internalConv = useConversation(configRef.current);
  const conv = value ?? internalConv;

  let completeContent: React.ReactNode | ((c: ConversationState) => React.ReactElement) = null;
  React.Children.forEach(children, child => {
    if (React.isValidElement(child) && child.type === ConversationComplete) {
      completeContent = (child.props as ConvCompleteProps).children;
    }
  });

  const el = conv.render(() => {
    if (typeof completeContent === 'function') return completeContent(conv);
    return (completeContent as React.ReactElement) ?? React.createElement('tg-message', { text: '✓' });
  });

  return React.createElement(ConvCtx.Provider, { value: conv }, el);
}

export const Conversation = Object.assign(ConversationRoot, {
  Prompt: ConversationPrompt,
  Ask: ConversationAsk,
  Step: ConversationStepChild,
  Complete: ConversationComplete,
});

// ---- <Form> compound component ----

/**
 * Shadcn-like composable form component.
 *
 * @example With `useForm` hook (recommended)
 * ```tsx
 * const form = useForm({
 *   name: { prompt: "Name?", validate: z.string().min(2) },
 *   region: { prompt: "Region?", options: [['Kanto', 'Johto']] },
 * });
 *
 * return (
 *   <Form value={form}>
 *     <Form.Complete>
 *       <Message text={`${form.data.name} from ${form.data.region}`} />
 *     </Form.Complete>
 *   </Form>
 * );
 * ```
 *
 * @example Self-contained (fields as children)
 * ```tsx
 * <Form>
 *   <Form.Field name="name" prompt="Name?" validate={z.string().min(2)} />
 *   <Form.Field name="region" prompt="Region?" options={[['Kanto', 'Johto']]} />
 *   <Form.Complete>
 *     {(form) => <Message text={`${form.data.name} from ${form.data.region}`} />}
 *   </Form.Complete>
 * </Form>
 * ```
 */
function FormRoot({ children, value }: {
  children: React.ReactNode;
  value?: FormResult;
}): React.ReactElement {
  const schemaRef = React.useRef<Record<string, FormFieldDef> | undefined>(undefined);
  const built = React.useRef(false);

  if (!built.current) {
    built.current = true;
    const schema: Record<string, FormFieldDef> = {};
    React.Children.forEach(children, child => {
      if (!React.isValidElement(child)) return;
      if (child.type === FormFieldChild) {
        const p = child.props as FormFieldProps;
        schema[p.name] = { prompt: p.prompt, options: p.options, validate: p.validate };
      }
    });
    schemaRef.current = Object.keys(schema).length > 0 ? schema : undefined;
  }

  const internalForm = useForm(schemaRef.current ?? {});
  const form = value ?? internalForm;

  let completeContent: React.ReactNode | ((f: FormResult) => React.ReactElement) = null;
  React.Children.forEach(children, child => {
    if (React.isValidElement(child) && child.type === FormCompleteChild) {
      completeContent = (child.props as FormCompleteProps).children;
    }
  });

  const el = form.render(() => {
    if (typeof completeContent === 'function') return completeContent(form);
    return (completeContent as React.ReactElement) ?? React.createElement('tg-message', { text: '✓' });
  });

  return React.createElement(FormCtxInternal.Provider, { value: form }, el);
}

export const Form = Object.assign(FormRoot, {
  Field: FormFieldChild,
  Complete: FormCompleteChild,
});
