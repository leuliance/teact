import { describe, test, expect } from 'bun:test';
import { extractRoutes } from '../packages/cli/src/routes-extract';

const FIXTURE = `
import { createRouter, redirect } from '@teactjs/core';
// '/commented': Nope,
const notARoute = { '/fake': Fake };

export const router = createRouter(
  {
    '/': {
      component: MainMenu,
      command: {
        name: 'start',
        description: 'Open the menu',
        deepLink: (args) => (args[0] ? \`/item/\${args[0]}\` : '/'),
      },
    },
    "/list": { component: List, command: { name: 'list', description: "Browse, list" } },
    '/item/:id': ItemCard,
    '/admin': {
      component: AdminPanel,
      beforeLoad: ({ session }) => {
        if (!session.admin) return redirect('/');
      },
    },
    '/lazy': () => <Message text="inline {braces} '/inner': x" />,
  },
  { notFound: NotFound },
);
`;

describe('teact routes · extraction', () => {
  test('reads routes, components, commands, guards and deep links', () => {
    const routes = extractRoutes(FIXTURE, 'src/index.tsx');
    expect(routes.map((r) => r.path)).toEqual(['/', '/list', '/item/:id', '/admin', '/lazy']);
    const [home, list, item, admin] = routes;
    expect(home).toMatchObject({ component: 'MainMenu', command: 'start', description: 'Open the menu', deepLink: true, guard: false, file: 'src/index.tsx' });
    expect(list).toMatchObject({ component: 'List', command: 'list', description: 'Browse, list' });
    expect(item).toMatchObject({ component: 'ItemCard', guard: false });
    expect(item.command).toBeUndefined();
    expect(admin).toMatchObject({ component: 'AdminPanel', guard: true });
    expect(home.line).toBe(8);
  });

  test('ignores object literals outside createRouter() and strings/comments', () => {
    const paths = extractRoutes(FIXTURE).map((r) => r.path);
    expect(paths).not.toContain('/fake');
    expect(paths).not.toContain('/commented');
    expect(paths).not.toContain('/inner');
  });

  test('follows createRouter(identifier) to a const object literal in the same file', () => {
    const src = `const routes: Record<string, RouteValue> = {\n  '/': Home,\n  '/about': { component: About, command: { name: 'about', description: 'About' } },\n};\nconst router = createRouter(routes);\n`;
    const routes = extractRoutes(src);
    expect(routes.map((r) => [r.path, r.component, r.command])).toEqual([
      ['/', 'Home', undefined],
      ['/about', 'About', 'about'],
    ]);
  });

  test('handles generic call syntax and multiple routers', () => {
    const src = `createRouter<Routes>({ '/a': A });\ncreateRouter({ '/b': B });`;
    expect(extractRoutes(src).map((r) => r.path)).toEqual(['/a', '/b']);
  });

  test('returns nothing for files without createRouter', () => {
    expect(extractRoutes(`const x = { '/a': A };`)).toEqual([]);
  });
});
