import ReactReconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants.js';
import type { ReactNode } from 'react';
import { TNode, TextNode } from './nodes';
import type { OutputNode } from './types';

type Container = { root: TNode; onCommit: (tree: OutputNode) => void };
type Instance = TNode;
type TextInstance = TextNode;

export const KNOWN_HOST_TYPES = new Set([
  'tg-message', 'tg-button', 'tg-button-row', 'tg-keyboard',
  'tg-photo', 'tg-document', 'tg-bold', 'tg-italic', 'tg-code',
  'tg-alert', 'tg-list', 'tg-list-item', 'tg-divider',
  'tg-video', 'tg-voice', 'tg-audio', 'tg-animation', 'tg-video-note', 'tg-sticker',
  'tg-contact', 'tg-location', 'tg-venue',
  'tg-media-group', 'tg-media-photo', 'tg-media-video',
  'tg-reply-keyboard', 'tg-reply-row', 'tg-reply-button', 'tg-reply-keyboard-remove',
  'tg-notification', 'tg-poll',
]);

let currentUpdatePriority: number = DefaultEventPriority;

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,

  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  setCurrentUpdatePriority(newPriority: number) { currentUpdatePriority = newPriority; },
  getCurrentUpdatePriority() { return currentUpdatePriority; },
  resolveUpdatePriority() { return currentUpdatePriority || DefaultEventPriority; },

  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
  shouldAttemptEagerTransition: () => false,

  NotPendingTransition: null as any,
  HostTransitionContext: { $$typeof: Symbol.for('react.context'), _currentValue: null } as any,
  resetFormInstance: () => {},

  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,

  preparePortalMount: () => {},
  bindToConsole: (_name: string, fn: Function, _isError: boolean) => fn,

  supportsTestSelectors: false,
  findFiberRoot: () => null,
  getBoundingRect: () => null,
  getTextContent: () => null,
  isHiddenSubtree: () => false,
  matchAccessibilityRole: () => false,
  setFocusIfFocusable: () => false,
  setupIntersectionObserver: () => null,

  getRootHostContext: () => ({}),
  getChildHostContext: () => ({}),

  createInstance(type: string, props: Record<string, any>) {
    if (!KNOWN_HOST_TYPES.has(type)) {
      const suggestions = [...KNOWN_HOST_TYPES].filter(t => t.includes(type.replace('tg-', '')));
      throw new Error(
        `Unknown Teact element <${type}>.` +
        (suggestions.length ? ` Did you mean <${suggestions[0]}>?` : ` Known types: ${[...KNOWN_HOST_TYPES].join(', ')}`)
      );
    }
    const { children: _, ...rest } = props;
    return new TNode(type, rest);
  },

  createTextInstance(text: string) {
    return new TextNode(text);
  },

  shouldSetTextContent: () => false,

  appendInitialChild(parent: Instance, child: Instance | TextInstance) {
    parent.appendChild(child);
  },

  appendChild(parent: Instance, child: Instance | TextInstance) {
    parent.appendChild(child);
  },

  appendChildToContainer(container: Container, child: Instance | TextInstance) {
    container.root.appendChild(child);
  },

  insertBefore(parent: Instance, child: Instance | TextInstance, before: Instance | TextInstance) {
    parent.insertBefore(child, before);
  },

  insertInContainerBefore(container: Container, child: Instance | TextInstance, before: Instance | TextInstance) {
    container.root.insertBefore(child, before);
  },

  removeChild(parent: Instance, child: Instance | TextInstance) {
    parent.removeChild(child);
  },

  removeChildFromContainer(container: Container, child: Instance | TextInstance) {
    container.root.removeChild(child);
  },

  clearContainer(container: Container) {
    container.root.children = [];
  },

  commitUpdate(instance: Instance, type: string, oldProps: Record<string, any>, newProps: Record<string, any>) {
    const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
    for (const key of allKeys) {
      if (key === 'children') continue;
      if (!Object.is(oldProps[key], newProps[key])) {
        instance.props[key] = newProps[key];
      }
    }
  },

  commitMount() {},

  commitTextUpdate(textInstance: TextInstance, _oldText: string, newText: string) {
    textInstance.text = newText;
  },

  resetTextContent() {},

  hideInstance(instance: Instance) {
    instance.props.__hidden = true;
  },

  unhideInstance(instance: Instance) {
    delete instance.props.__hidden;
  },

  hideTextInstance(textInstance: TextInstance) {
    (textInstance as any).__hidden = true;
  },

  unhideTextInstance(textInstance: TextInstance) {
    delete (textInstance as any).__hidden;
  },

  finalizeInitialChildren: () => false,
  getPublicInstance: (instance: Instance) => instance,
  prepareForCommit: () => null,

  resetAfterCommit(container: Container) {
    const root = container.root;
    const serialized = root.children.length === 1
      ? root.children[0].serialize()
      : { type: '#root', props: {}, children: root.children.map((c) => c.serialize()) };
    container.onCommit(serialized);
  },
};

const RECONCILER_KEY = '__teact_reconciler__';
const reconciler: ReturnType<typeof ReactReconciler> =
  (globalThis as any)[RECONCILER_KEY] ??
  ((globalThis as any)[RECONCILER_KEY] = ReactReconciler(hostConfig as any));

// ---- public API ----

export interface TeactRoot {
  render(element: ReactNode): void;
  unmount(): void;
}

export function createRoot(onCommit: (tree: OutputNode) => void): TeactRoot {
  const rootNode = new TNode('#root');
  const container: Container = { root: rootNode, onCommit };

  const fiberRoot = reconciler.createContainer(
    container,
    0,     // ConcurrentRoot tag
    null,  // hydration callbacks
    false, // isStrictMode
    null,  // concurrentUpdatesByDefaultOverride
    '',    // identifierPrefix
    (err: Error) => console.error('[teact] uncaught error', err),   // onUncaughtError
    (err: Error) => console.error('[teact] caught error', err),     // onCaughtError
    (err: Error) => console.error('[teact] recoverable error', err), // onRecoverableError
    null as any,  // transitionCallbacks
  );

  return {
    render(element: ReactNode) {
      reconciler.updateContainer(element, fiberRoot, null, () => {});
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, () => {});
    },
  };
}
