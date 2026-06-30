import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { createRouter, RouterProvider, CommitModeCtx, type CommitModeRef } from '../packages/core/src/runtime/router';

const waitForCommit = (ms = 15) => new Promise<void>(r => setTimeout(r, ms));

function renderWithRouter(config: ReturnType<typeof createRouter>, initialPath: string) {
  let output: OutputNode | null = null;
  const commitMode: CommitModeRef = { current: 'replace' };
  const root = createRoot((tree) => { output = tree; });
  root.render(
    React.createElement(
      CommitModeCtx.Provider,
      { value: commitMode },
      React.createElement(RouterProvider, { config, initialPath }),
    ),
  );
  return { root, getOutput: () => output };
}

function Home() {
  return React.createElement('tg-message', { text: 'Home Page' });
}

function About() {
  return React.createElement('tg-message', { text: 'About Page' });
}

function Settings() {
  return React.createElement('tg-message', { text: 'Settings Page' });
}

function CustomNotFound() {
  return React.createElement('tg-message', { text: 'Custom 404: Nothing here!' });
}

describe('NotFound — default behavior', () => {
  const router = createRouter({
    '/': Home,
    '/about': About,
  });

  test('unknown route renders default NotFound', async () => {
    const { getOutput } = renderWithRouter(router, '/nonexistent');
    await waitForCommit();
    const output = getOutput();
    expect(output).toBeTruthy();
    expect(output!.props.text).toContain('Page not found');
  });

  test('default NotFound mentions /start', async () => {
    const { getOutput } = renderWithRouter(router, '/xyz');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toContain('/start');
  });

  test('root route still works with default NotFound', async () => {
    const { getOutput } = renderWithRouter(router, '/');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Home Page');
  });

  test('named route still works with default NotFound', async () => {
    const { getOutput } = renderWithRouter(router, '/about');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('About Page');
  });

  test('deeply nested unknown path shows default NotFound', async () => {
    const { getOutput } = renderWithRouter(router, '/a/b/c/d');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toContain('Page not found');
  });
});

describe('NotFound — custom notFound option', () => {
  const routerCustom = createRouter(
    { '/': Home, '/about': About, '/settings': Settings },
    { notFound: CustomNotFound },
  );

  test('custom NotFound renders for unknown route', async () => {
    const { getOutput } = renderWithRouter(routerCustom, '/nonexistent');
    await waitForCommit();
    const output = getOutput();
    expect(output).toBeTruthy();
    expect(output!.props.text).toBe('Custom 404: Nothing here!');
  });

  test('custom NotFound renders for any unknown path', async () => {
    const { getOutput } = renderWithRouter(routerCustom, '/foo/bar');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Custom 404: Nothing here!');
  });

  test('root route still works with custom NotFound', async () => {
    const { getOutput } = renderWithRouter(routerCustom, '/');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Home Page');
  });

  test('about route still works with custom NotFound', async () => {
    const { getOutput } = renderWithRouter(routerCustom, '/about');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('About Page');
  });

  test('settings route still works with custom NotFound', async () => {
    const { getOutput } = renderWithRouter(routerCustom, '/settings');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Settings Page');
  });
});

describe('NotFound — edge cases', () => {
  test('router with only notFound handles everything', async () => {
    const routerOnlyNotFound = createRouter({}, { notFound: CustomNotFound });
    const { getOutput } = renderWithRouter(routerOnlyNotFound, '/anything');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Custom 404: Nothing here!');
  });

  test('router with only root and notFound', async () => {
    const routerMinimal = createRouter(
      { '/': Home },
      { notFound: CustomNotFound },
    );

    const { getOutput: getHome } = renderWithRouter(routerMinimal, '/');
    await waitForCommit();
    expect(getHome()!.props.text).toBe('Home Page');

    const { getOutput: get404 } = renderWithRouter(routerMinimal, '/missing');
    await waitForCommit();
    expect(get404()!.props.text).toBe('Custom 404: Nothing here!');
  });

  test('empty path falls back to NotFound', async () => {
    const routerNoRoot = createRouter(
      { '/about': About },
      { notFound: CustomNotFound },
    );
    const { getOutput } = renderWithRouter(routerNoRoot, '/');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toBe('Custom 404: Nothing here!');
  });
});
