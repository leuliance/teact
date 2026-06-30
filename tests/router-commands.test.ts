import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRouter, type PathParams } from '../packages/core/src/runtime/router';

const Home = () => React.createElement('tg-message', { text: 'home' });
const List = () => React.createElement('tg-message', { text: 'list' });
const Card = () => React.createElement('tg-message', { text: 'card' });

describe('Typed router — co-located commands', () => {
  test('createRouter collects command: entries into config.commands', () => {
    const router = createRouter({
      '/': { component: Home, command: { name: 'start', description: 'Start' } },
      '/list': { component: List, command: { name: 'pokedex', description: 'Open Pokedex' } },
      '/pokemon/:id': Card,
    });

    expect(router.commands).toEqual({
      start: { description: 'Start', route: '/' },
      pokedex: { description: 'Open Pokedex', route: '/list' },
    });
  });

  test('deepLink is carried onto the resolved command', () => {
    const deepLink = (args: string[]) => `/pokemon/${args[0]}`;
    const router = createRouter({
      '/': { component: Home, command: { name: 'start', description: 'Start', deepLink } },
    });
    expect(router.commands.start.route).toBe('/');
    expect(router.commands.start.deepLink).toBe(deepLink);
  });

  test('routes without command produce no command entries', () => {
    const router = createRouter({ '/': Home, '/list': List });
    expect(Object.keys(router.commands)).toHaveLength(0);
  });

  // Compile-time check: PathParams extracts :param names (verified by tsc).
  test('PathParams type extracts params (type-level)', () => {
    const p: PathParams<'/pokemon/:id'> = { id: '25' };
    const q: PathParams<'/team/:tid/member/:mid'> = { tid: '1', mid: '2' };
    expect(p.id).toBe('25');
    expect(q.tid).toBe('1');
    expect(q.mid).toBe('2');
  });
});
