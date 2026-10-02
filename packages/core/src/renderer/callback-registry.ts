import React from 'react';

/** A button click handler. Async handlers are awaited before the update finishes. */
export type CallbackHandler = () => void | Promise<void>;
export type CallbackMap = Map<string, CallbackHandler>;

/**
 * Shared between Button components (register handlers during render)
 * and the runtime (dispatch handlers when callback queries arrive).
 */
export const CallbackRegistryCtx = React.createContext<{ handlers: CallbackMap } | null>(null);
