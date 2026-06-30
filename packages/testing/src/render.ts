import React from 'react';
import type { FunctionComponent } from 'react';
import { createRoot, type OutputNode, type BotContext } from '@teactjs/core';
import { RuntimeContext, type RuntimeContextValue } from '@teactjs/core';

export interface RenderResult {
  output: OutputNode | null;
  rerender: (ctxOverrides?: Partial<BotContext>) => void;
  unmount: () => void;
  findByType: (type: string, node?: OutputNode) => OutputNode[];
  findText: (node?: OutputNode) => string;
}

/**
 * Render a Teact component in a test harness.
 * Returns the serialized output tree and helpers for assertions.
 */
export function renderBot(
  Component: FunctionComponent<{ ctx: BotContext }>,
  initialCtx?: Partial<BotContext>,
): RenderResult {
  let currentOutput: OutputNode | null = null;

  const root = createRoot((tree) => {
    currentOutput = tree;
  });

  const baseBotCtx: BotContext = {
    chatId: 'test-chat',
    userId: 'test-user',
    user: { id: 'test-user', firstName: 'Test', platform: 'mock' },
    platform: 'mock',
    raw: {},
    ...initialCtx,
  };

  const session = {};

  function doRender(ctx: BotContext) {
    const value: RuntimeContextValue = {
      botCtx: ctx,
      session,
      updateSession(patch) { Object.assign(session, patch); },
      command: null,
    };

    root.render(
      React.createElement(
        RuntimeContext.Provider,
        { value },
        React.createElement(Component, { ctx }),
      ),
    );
  }

  doRender(baseBotCtx);

  return {
    get output() { return currentOutput; },

    rerender(ctxOverrides) {
      doRender({ ...baseBotCtx, ...ctxOverrides });
    },

    unmount() {
      root.unmount();
    },

    findByType(type, node = currentOutput!) {
      return findNodesByType(node, type);
    },

    findText(node = currentOutput!) {
      return collectText(node);
    },
  };
}

function findNodesByType(node: OutputNode, type: string): OutputNode[] {
  const results: OutputNode[] = [];
  if (node.type === type) results.push(node);
  for (const c of node.children) results.push(...findNodesByType(c, type));
  return results;
}

function collectText(node: OutputNode): string {
  let text = '';
  if (node.props.text) text += node.props.text;
  if (node.props.value) text += node.props.value;
  for (const c of node.children) text += collectText(c);
  return text;
}
