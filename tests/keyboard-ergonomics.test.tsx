import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { Message, Button, InlineKeyboard } from '../packages/ui/src';

function render(el: React.ReactElement): Promise<OutputNode> {
  return new Promise((resolve) => {
    const root = createRoot((tree) => resolve(tree));
    root.render(el);
  });
}

function find(node: OutputNode, type: string): OutputNode | null {
  if (node.type === type) return node;
  for (const c of node.children) {
    const hit = find(c, type);
    if (hit) return hit;
  }
  return null;
}

function buttonsOf(node: OutputNode): OutputNode[] {
  const out: OutputNode[] = [];
  const walk = (n: OutputNode) => {
    if (n.type === 'tg-button') out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

describe('Keyboard ergonomics', () => {
  test('columns auto-groups bare buttons into rows', async () => {
    const tree = await render(
      <Message text="grid">
        <InlineKeyboard columns={2}>
          <Button text="A" onClick={() => {}} />
          <Button text="B" onClick={() => {}} />
          <Button text="C" onClick={() => {}} />
        </InlineKeyboard>
      </Message>,
    );
    const keyboard = find(tree, 'tg-keyboard')!;
    expect(keyboard).not.toBeNull();
    const rows = keyboard.children.filter((c) => c.type === 'tg-button-row');
    expect(rows.length).toBe(2);
    expect(rows[0].children.length).toBe(2); // A, B
    expect(rows[1].children.length).toBe(1); // C
  });

  test('bare Button inside InlineKeyboard (no ButtonRow) works', async () => {
    const tree = await render(
      <Message text="bare">
        <InlineKeyboard>
          <Button text="Solo" onClick={() => {}} />
        </InlineKeyboard>
      </Message>,
    );
    const buttons = buttonsOf(find(tree, 'tg-keyboard')!);
    expect(buttons.length).toBe(1);
    expect(buttons[0].props.text).toBe('Solo');
  });

  test('Button route emits a navigation callback', async () => {
    const tree = await render(
      <Message text="nav">
        <InlineKeyboard>
          <Button text="Home" route="/" />
        </InlineKeyboard>
      </Message>,
    );
    const btn = buttonsOf(tree)[0];
    expect(btn.props.callbackData).toBe('__route:/');
  });

  test('Button route fills :param segments from params', async () => {
    const tree = await render(
      <Message text="nav">
        <InlineKeyboard>
          <Button text="Pikachu" route="/pokemon/:id" params={{ id: 25 }} />
        </InlineKeyboard>
      </Message>,
    );
    const btn = buttonsOf(tree)[0];
    expect(btn.props.callbackData).toBe('__route:/pokemon/25');
  });
});
