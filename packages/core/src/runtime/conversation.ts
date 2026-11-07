import React, { useState, useContext, useEffect, useId, useMemo, useCallback, useRef } from 'react';
import { sharedContext } from '../renderer/shared-context';
import { useBot, useSession } from './context';
import { CallbackRegistryCtx } from '../renderer';

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
  if (typeof validator === 'function') return toVerdict(validator(value));
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
  /**
   * Stable id for persisting in-progress answers in the session (so a restart or another
   * serverless instance continues the form). `useForm` and steps mode default to the field
   * names; imperative forms are persisted only when an `id` is given.
   */
  id?: string;
}

/** Session key prefix for in-progress form state. */
const FORM_SESSION_PREFIX = '__teact_form:';
/** `/cmd` or `/cmd@bot` — never taken as a form answer. */
const COMMAND_RE = /^\/[A-Za-z0-9_]+(@\w+)?(\s|$)/;
const INVALID_INPUT = 'Invalid input';

/**
 * Which hook consumed the text of an update. When two forms are on screen, one message
 * answers only ONE of them (the first to claim it).
 */
const consumedBy = new WeakMap<object, string>();

interface PersistedForm {
  a: Record<string, string>;
  k: string | null;
  m: 'text' | 'callback';
  o?: string;
}

/** Normalize a validator result: only `true` accepts; anything else is a visible error. */
function toVerdict(result: unknown): true | string {
  if (result === true) return true;
  if (typeof result === 'string' && result.trim()) return result;
  return INVALID_INPUT;
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

  const bot = useBot();
  const [session, updateSession] = useSession();
  const hookId = useId();
  // React's useId is a global counter on client roots — not stable across restarts — so the
  // persistence key comes from an explicit id or the step names. Imperative forms without
  // an `id` are not persisted.
  const stableId = opts?.id ?? (stepsMode ? Object.keys(config as StepsConfig).join(',') : undefined);
  const persistKey = stableId ? `${FORM_SESSION_PREFIX}${stableId}` : undefined;
  // Restore an in-progress form (restart / another serverless instance) — unless this mount
  // was triggered by a command such as /start, which means "start over".
  const [restored] = useState<PersistedForm | null>(() => {
    const saved = persistKey ? (session?.[persistKey] as PersistedForm | undefined) : undefined;
    if (!saved || typeof saved !== 'object' || !saved.a || COMMAND_RE.test(bot.text ?? '')) return null;
    return saved;
  });
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...(restored?.a ?? {}) }));
  const [lastError, setLastError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // Activation tracking lives in REFS, not state. `renderStep()` (which activates the
  // current step) runs inside the child <Form>/<Conversation>, so doing setState there
  // would warn "update X while rendering a different component". Mutating refs during
  // render is safe; re-renders are still driven by setAnswers/setLastError.
  const activeKeyRef = useRef<string | null>(restored?.k ?? null);
  const waitModeRef = useRef<'text' | 'callback'>(restored?.m ?? 'text');
  // Restored: the CURRENT message may be the answer, so nothing is marked processed yet.
  const processedMsgIdRef = useRef('');
  // In shared chats, the user who started the form — only they can answer it.
  const ownerRef = useRef<string | null>(restored?.o ?? null);
  const shared = !!bot.chatType && bot.chatType !== 'private';
  const isOwner = !shared || ownerRef.current === null || ownerRef.current === bot.userId;

  const registry = useContext(CallbackRegistryCtx);
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

  const active = activeKeyRef.current;
  const claimedByOther = (() => {
    const by = consumedBy.get(bot);
    return by !== undefined && by !== hookId;
  })();
  if (
    active && !(active in answers) && msgId !== processedMsgIdRef.current &&
    isOwner && !claimedByOther && !(text && COMMAND_RE.test(text))
  ) {
    if (waitModeRef.current === 'text' && text && !callbackData) {
      consumedBy.set(bot, hookId);
      let result: true | string;
      try {
        result = validateFn ? toVerdict(validateFn(active, text)) : true;
      } catch (err) {
        // A buggy validator must not crash the screen (and wipe earlier answers).
        console.error(`[teact] Validator for "${active}" threw — treating the input as invalid:`, err);
        result = INVALID_INPUT;
      }
      if (result === true) {
        setAnswers({ ...answers, [active]: text });
        activeKeyRef.current = null;
        if (lastError) setLastError(null);
      } else {
        setLastError(result);
      }
      processedMsgIdRef.current = msgId;
    } else if (waitModeRef.current === 'callback' && text && !callbackData) {
      consumedBy.set(bot, hookId);
      setLastError('Please pick an option from the buttons above.');
      processedMsgIdRef.current = msgId;
    }
  }

  const setFn = useCallback((key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (activeKeyRef.current === key) activeKeyRef.current = null;
    setCursor(c => (c === key ? null : c));
    setLastError(null);
  }, []);

  // A slot is free when nothing is active OR the active key was already answered — the
  // latter happens when React finishes a render pass with stale `answers` right after a
  // render-phase setAnswers, re-activating the step that was just answered.
  function canActivate(key: string): boolean {
    const cur = activeKeyRef.current;
    return (!cur || cur in answers) && !(key in answers);
  }

  function activate(key: string, mode: 'text' | 'callback') {
    if (activeKeyRef.current === key && !(key in answers)) {
      waitModeRef.current = mode;
      return; // already waiting (e.g. restored after a restart) — keep the current message answerable
    }
    if (canActivate(key)) {
      activeKeyRef.current = key;
      waitModeRef.current = mode;
      processedMsgIdRef.current = msgId;
      if (shared && ownerRef.current === null) ownerRef.current = bot.userId;
    }
  }

  function activateText(key: string) {
    activate(key, 'text');
  }

  function buildAsk(key: string, questionText: string, options: AskOption[][]): React.ReactElement {
    activate(key, 'callback');
    // In a shared chat, only the form's owner gets working buttons (a tap by anyone else
    // finds no handler — the engine re-renders as the tapper before dispatching).
    const ownerView = !shared || ownerRef.current === null || ownerRef.current === bot.userId;

    const rows = options.map((row, ri) => {
      const buttons = row.map((opt, ci) => {
        const optText = typeof opt === 'string' ? opt : opt.text;
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const cbId = `__ask:${hookId}:${key}:${ri}:${ci}`;
        if (ownerView) registry?.handlers.set(cbId, () => setFn(key, optValue));
        return React.createElement('tg-button', { key: `${ri}:${ci}`, text: optText, callbackData: cbId });
      });
      return React.createElement('tg-button-row', { key: String(ri) }, ...buttons);
    });

    return React.createElement(
      'tg-message', { text: questionText },
      React.createElement('tg-keyboard', {}, ...rows),
    );
  }

  const currentKey = (cursor && stepKeys.includes(cursor) && !(cursor in answers) ? cursor : null)
    ?? stepKeys.find(k => !(k in answers)) ?? null;

  // Persist in-progress state to the session so a restart / another instance continues the
  // form. Finished (or idle) forms are removed again.
  const lastPersisted = useRef<string | undefined>(restored ? JSON.stringify(restored) : undefined);
  useEffect(() => {
    if (!persistKey) return;
    const k = activeKeyRef.current;
    const inProgress = k !== null && !(k in answers);
    const next: PersistedForm | undefined = inProgress
      ? { a: answers, k, m: waitModeRef.current, ...(ownerRef.current ? { o: ownerRef.current } : {}) }
      : undefined;
    const serialized = next ? JSON.stringify(next) : undefined;
    if (serialized === lastPersisted.current) return;
    lastPersisted.current = serialized;
    (updateSession as (p: Record<string, unknown>, o?: { rerender?: boolean }) => void)(
      { [persistKey]: next },
      { rerender: false },
    );
  });

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
    activeKeyRef.current = null;
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
    if (!stepKeys.includes(key)) return;
    clearStep(key);
    setCursor(key);
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
    // Getter: read after prompt()/ask()/render() activated the step in this render.
    get isWaiting() {
      const k = activeKeyRef.current;
      return k !== null && !(k in answers);
    },
    lastError,
    data: answers,
    render: render as ConversationState['render'],
    back,
    goTo,
    canGoBack,
    reset: () => {
      setAnswers({});
      setCursor(null);
      activeKeyRef.current = null;
      waitModeRef.current = 'text';
      ownerRef.current = null;
      setLastError(null);
    },
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
    id: `form:${Object.keys(schema).join(',')}`,
    validate(key, value) {
      const field = schema[key];
      if (!field?.validate) return true;
      return runValidation(field.validate, value);
    },
  });
  // Recomputed every render: fields can appear conditionally (e.g. a <Form.Field> added later).
  const keys = Object.keys(schema) as (keyof T & string)[];
  const [cursor, setCursor] = useState<string | null>(null);
  const currentKey = (cursor && keys.includes(cursor) && !conv.has(cursor) ? cursor : undefined)
    ?? keys.find(k => !conv.has(k));
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
      // Delegate to ask(): its callback ids include the field key, so a late tap on an
      // earlier question's button can never answer the current one, and typed text gets
      // a "pick an option" hint instead of being silently ignored.
      return conv.ask(currentKey, promptText, field.options);
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
    if (!keys.includes(key)) return;
    conv.clear(key);
    setCursor(key);
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
    reset: () => { setCursor(null); conv.reset(); },
  };
}

// ---- Contexts ----

const ConvCtx = sharedContext<ConversationState | null>('conversation', null);
const FormCtxInternal = sharedContext<FormResult | null>('form', null);

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

  // Rebuilt every render, so steps that appear conditionally are picked up.
  {
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

  // Rebuilt every render, so fields that appear conditionally are picked up.
  {
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
