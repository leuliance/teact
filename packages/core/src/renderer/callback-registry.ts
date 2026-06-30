import React from 'react';

export type CallbackHandler = () => void;
export type CallbackMap = Map<string, CallbackHandler>;

/**
 * Shared between Button components (register handlers during render)
 * and the runtime (dispatch handlers when callback queries arrive).
 */
export const CallbackRegistryCtx = React.createContext<{ handlers: CallbackMap } | null>(null);
