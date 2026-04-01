import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { renderBot } from '../packages/testing/src/render';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

describe('renderBot (test harness)', () => {
  test('renders a simple component', async () => {
    function App() {
      return React.createElement('tg-message', { text: 'Hello Test' });
    }

    const result = renderBot(App);
    await waitForCommit();

    expect(result.output).not.toBeNull();
    expect(result.output!.props.text).toBe('Hello Test');
  });

  test('findByType returns matching nodes', async () => {
    function App() {
      return React.createElement('tg-message', { text: 'hi' },
        React.createElement('tg-keyboard', null,
          React.createElement('tg-button-row', null,
            React.createElement('tg-button', { text: 'A' }),
            React.createElement('tg-button', { text: 'B' }),
          ),
        ),
      );
    }

    const result = renderBot(App);
    await waitForCommit();

    const buttons = result.findByType('tg-button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.text).toBe('A');
    expect(buttons[1].props.text).toBe('B');
  });

  test('findText collects all text', async () => {
    function App() {
      return React.createElement('tg-message', { text: 'Count: 0' });
    }

    const result = renderBot(App);
    await waitForCommit();

    expect(result.findText()).toContain('Count: 0');
  });

  test('unmount works', async () => {
    function App() {
      return React.createElement('tg-message', { text: 'bye' });
    }

    const result = renderBot(App);
    await waitForCommit();
    result.unmount();
    await waitForCommit();
  });
});
