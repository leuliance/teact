import { describe, test, expect, mock } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { ErrorBoundary } from '../packages/core/src/renderer/error-boundary';

function waitForCommit(ms = 15): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function suppressConsoleError<T>(fn: () => T): T {
  const orig = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = orig; }
}

function ThrowingComponent(): React.ReactElement {
  throw new Error('Component exploded');
}

function WorkingComponent(): React.ReactElement {
  return React.createElement('tg-message', { text: 'All good' });
}

describe('ErrorBoundary', () => {
  test('renders children when no error', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(ErrorBoundary, null,
        React.createElement(WorkingComponent)
      ),
    );
    await waitForCommit();

    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toBe('All good');
  });

  test('catches render errors and shows default fallback', async () => {
    let output: OutputNode | null = null;
    const root = suppressConsoleError(() => createRoot((tree) => { output = tree; }));
    const orig = console.error;
    console.error = () => {};
    root.render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent)
      ),
    );
    await waitForCommit();
    console.error = orig;

    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toContain('Something went wrong');
    expect(output!.props.text).toContain('Component exploded');
  });

  test('shows custom fallback element', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    const orig = console.error;
    console.error = () => {};
    root.render(
      React.createElement(
        ErrorBoundary,
        { fallback: React.createElement('tg-message', { text: 'Custom error page' }) },
        React.createElement(ThrowingComponent),
      ),
    );
    await waitForCommit();
    console.error = orig;

    expect(output!.props.text).toBe('Custom error page');
  });

  test('shows custom fallback function with error info', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    const orig = console.error;
    console.error = () => {};
    root.render(
      React.createElement(
        ErrorBoundary,
        {
          fallback: (err: Error) =>
            React.createElement('tg-message', { text: `Caught: ${err.message}` }),
        },
        React.createElement(ThrowingComponent),
      ),
    );
    await waitForCommit();
    console.error = orig;

    expect(output!.props.text).toBe('Caught: Component exploded');
  });

  test('calls onError callback', async () => {
    const onError = mock(() => {});
    const root = createRoot(() => {});
    const orig = console.error;
    console.error = () => {};
    root.render(
      React.createElement(
        ErrorBoundary,
        { onError },
        React.createElement(ThrowingComponent),
      ),
    );
    await waitForCommit();
    console.error = orig;

    expect(onError).toHaveBeenCalled();
    const [err] = onError.mock.calls[0] as unknown as [Error, any];
    expect(err.message).toBe('Component exploded');
  });

  test('nested boundaries catch at the right level', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    const orig = console.error;
    console.error = () => {};
    root.render(
      React.createElement(
        ErrorBoundary,
        { fallback: React.createElement('tg-message', { text: 'Outer' }) },
        React.createElement(
          ErrorBoundary,
          { fallback: React.createElement('tg-message', { text: 'Inner' }) },
          React.createElement(ThrowingComponent),
        ),
      ),
    );
    await waitForCommit();
    console.error = orig;

    expect(output!.props.text).toBe('Inner');
  });
});
