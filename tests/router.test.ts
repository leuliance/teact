import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { RouterProvider, CommitModeCtx, type CommitModeRef } from '../packages/core/src/runtime/router';
import { createRouter, useNavigate, useParams } from '../packages/core/src/runtime';

function waitForCommit(ms = 15): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function Home() {
  const navigate = useNavigate();
  return React.createElement('tg-message', { text: 'Home' },
    React.createElement('tg-keyboard', null,
      React.createElement('tg-button-row', null,
        React.createElement('tg-button', { text: 'Go', callbackData: '__route:/about' }),
      ),
    ),
  );
}

function About() {
  return React.createElement('tg-message', { text: 'About page' });
}

function UserPage() {
  const { id } = useParams<'/user/:id'>();
  return React.createElement('tg-message', { text: `User ${id}` });
}

const router = createRouter({
  '/': Home,
  '/about': About,
  '/user/:id': UserPage,
});

describe('Router', () => {
  test('renders default route', async () => {
    let output: OutputNode | null = null;
    const commitMode: CommitModeRef = { current: 'replace' };

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        CommitModeCtx.Provider,
        { value: commitMode },
        React.createElement(RouterProvider, { config: router, initialPath: '/' }),
      ),
    );
    await waitForCommit();

    expect(output).not.toBeNull();
    expect(output!.props.text).toBe('Home');
  });

  test('renders a specific initial route', async () => {
    let output: OutputNode | null = null;
    const commitMode: CommitModeRef = { current: 'replace' };

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        CommitModeCtx.Provider,
        { value: commitMode },
        React.createElement(RouterProvider, { config: router, initialPath: '/about' }),
      ),
    );
    await waitForCommit();

    expect(output!.props.text).toBe('About page');
  });

  test('extracts params from route', async () => {
    let output: OutputNode | null = null;
    const commitMode: CommitModeRef = { current: 'replace' };

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        CommitModeCtx.Provider,
        { value: commitMode },
        React.createElement(RouterProvider, { config: router, initialPath: '/user/42' }),
      ),
    );
    await waitForCommit();

    expect(output!.props.text).toBe('User 42');
  });

  test('renders NotFound for unknown path', async () => {
    let output: OutputNode | null = null;
    const commitMode: CommitModeRef = { current: 'replace' };

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        CommitModeCtx.Provider,
        { value: commitMode },
        React.createElement(RouterProvider, { config: router, initialPath: '/nonexistent' }),
      ),
    );
    await waitForCommit();

    expect(output!.props.text).toContain('Page not found');
  });

  test('renders custom notFound component', async () => {
    function Custom404() {
      return React.createElement('tg-message', { text: 'Custom 404!' });
    }
    const routerWith404 = createRouter(
      { '/': Home, '/about': About },
      { notFound: Custom404 },
    );

    let output: OutputNode | null = null;
    const commitMode: CommitModeRef = { current: 'replace' };

    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(
        CommitModeCtx.Provider,
        { value: commitMode },
        React.createElement(RouterProvider, { config: routerWith404, initialPath: '/nope' }),
      ),
    );
    await waitForCommit();

    expect(output!.props.text).toBe('Custom 404!');
  });
});
