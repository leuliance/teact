import { describe, test, expect } from 'bun:test';
import React, { Suspense, use } from 'react';
import { createRoot, type OutputNode } from '../packages/renderer/src';

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(fn: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timed out');
    await waitFor(20);
  }
}

describe('Suspense', () => {
  test('shows fallback while promise is pending, then resolves', async () => {
    let output: OutputNode | null = null;
    let resolveData!: (v: string) => void;
    const dataPromise = new Promise<string>((r) => { resolveData = r; });

    function AsyncChild() {
      const data = use(dataPromise);
      return React.createElement('tg-message', { text: data });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        Suspense,
        { fallback: React.createElement('tg-message', { text: 'Loading...' }) },
        React.createElement(AsyncChild),
      ),
    );

    await waitUntil(() => output !== null);
    expect(output!.props.text).toBe('Loading...');

    resolveData('Data loaded!');
    await waitUntil(() => output!.props.text === 'Data loaded!');
    expect(output!.props.text).toBe('Data loaded!');
  });

  test('renders data when promise resolves before render', async () => {
    let output: OutputNode | null = null;
    const resolvedPromise = Promise.resolve('Already here');
    await resolvedPromise;

    function AsyncChild() {
      const data = use(resolvedPromise);
      return React.createElement('tg-message', { text: data });
    }

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        Suspense,
        { fallback: React.createElement('tg-message', { text: 'Loading...' }) },
        React.createElement(AsyncChild),
      ),
    );

    await waitUntil(() => output !== null && output!.props.text === 'Already here');
    expect(output!.props.text).toBe('Already here');
  });
});
