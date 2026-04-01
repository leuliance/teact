import { describe, test, expect } from 'bun:test';
import React, { useState, useReducer, useMemo, useRef, useContext, createContext } from 'react';
import { createRoot, type OutputNode } from '../packages/core/src';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

describe('createRoot + reconciler', () => {
  test('renders a host element', async () => {
    let output: OutputNode | null = null;

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement('tg-message', { text: 'Hello' }));
    await waitForCommit();

    expect(output).not.toBeNull();
    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toBe('Hello');
  });

  test('renders nested host elements', async () => {
    let output: OutputNode | null = null;

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement('tg-message', { text: 'hi' },
        React.createElement('tg-keyboard', null,
          React.createElement('tg-button', { text: 'Click' })
        )
      )
    );
    await waitForCommit();

    expect(output!.type).toBe('tg-message');
    expect(output!.children[0].type).toBe('tg-keyboard');
    expect(output!.children[0].children[0].type).toBe('tg-button');
    expect(output!.children[0].children[0].props.text).toBe('Click');
  });

  test('renders a function component', async () => {
    let output: OutputNode | null = null;

    function Greet({ name }: { name: string }) {
      return React.createElement('tg-message', { text: `Hello ${name}` });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement(Greet, { name: 'World' }));
    await waitForCommit();

    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toBe('Hello World');
  });

  test('renders text nodes', async () => {
    let output: OutputNode | null = null;

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement('tg-message', null, 'Hello'));
    await waitForCommit();

    expect(output!.type).toBe('tg-message');
    expect(output!.children[0].type).toBe('#text');
    expect(output!.children[0].props.value).toBe('Hello');
  });

  test('unmount clears the tree', async () => {
    let output: OutputNode | null = null;
    let commitCount = 0;

    const root = createRoot((tree) => { output = tree; commitCount++; });
    root.render(React.createElement('tg-message', { text: 'test' }));
    await waitForCommit();
    expect(commitCount).toBe(1);

    root.unmount();
    await waitForCommit();
  });
});

describe('React hooks via reconciler', () => {
  test('useState works', async () => {
    let output: OutputNode | null = null;

    function Counter() {
      const [count] = useState(42);
      return React.createElement('tg-message', { text: `Count: ${count}` });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement(Counter));
    await waitForCommit();

    expect(output!.props.text).toBe('Count: 42');
  });

  test('useReducer works', async () => {
    let output: OutputNode | null = null;

    function Counter() {
      const [count] = useReducer((s: number, a: 'inc' | 'dec') => a === 'inc' ? s + 1 : s - 1, 10);
      return React.createElement('tg-message', { text: `Count: ${count}` });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement(Counter));
    await waitForCommit();

    expect(output!.props.text).toBe('Count: 10');
  });

  test('useMemo works', async () => {
    let output: OutputNode | null = null;
    let computeCount = 0;

    function App() {
      const val = useMemo(() => { computeCount++; return 'expensive'; }, []);
      return React.createElement('tg-message', { text: val });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement(App));
    await waitForCommit();

    expect(output!.props.text).toBe('expensive');
    expect(computeCount).toBe(1);
  });

  test('useRef works', async () => {
    let refValue: any;

    function App() {
      const ref = useRef(99);
      refValue = ref;
      return React.createElement('tg-message', { text: 'ref' });
    }

    const root = createRoot((tree) => {});
    root.render(React.createElement(App));
    await waitForCommit();

    expect(refValue.current).toBe(99);
  });

  test('useContext works', async () => {
    let output: OutputNode | null = null;

    const ThemeCtx = createContext('light');

    function Child() {
      const theme = useContext(ThemeCtx);
      return React.createElement('tg-message', { text: `Theme: ${theme}` });
    }

    function App() {
      return React.createElement(ThemeCtx.Provider, { value: 'dark' },
        React.createElement(Child)
      );
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(React.createElement(App));
    await waitForCommit();

    expect(output!.props.text).toBe('Theme: dark');
  });
});
