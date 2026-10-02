import { describe, test, expect } from 'bun:test';
import React from 'react';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { FileDriver, MemoryDriver, storagePlugin, useStorage } from '../packages/storage/src';
import { createTestBot } from '../packages/testing/src';

describe('FileDriver hardening', () => {
  test('a corrupt store is moved aside, never overwritten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teact-'));
    const file = join(dir, 'store.json');
    writeFileSync(file, '{"chat:1":{"a":1},"chat:2":'); // truncated
    const d = new FileDriver(file);
    d.set('x', 1);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ x: 1 });
    const backup = readdirSync(dir).find((f) => f.includes('.corrupt-'))!;
    expect(readFileSync(join(dir, backup), 'utf-8')).toBe('{"chat:1":{"a":1},"chat:2":');
  });

  test('a non-object store (null / array) does not crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teact-'));
    const file = join(dir, 'store.json');
    writeFileSync(file, 'null');
    const d = new FileDriver(file);
    expect(d.get('anything')).toBeUndefined();
  });

  test('prototype-ish keys are ordinary keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teact-'));
    const file = join(dir, 'store.json');
    const d = new FileDriver(file);
    expect(d.has('constructor')).toBe(false);
    expect(d.get('toString')).toBeUndefined();
    d.set('__proto__', 5);
    expect(d.keys()).toEqual(['__proto__']);
    expect(new FileDriver(file).get<number>('__proto__')).toBe(5);
  });
});

describe('useStorage', () => {
  test('updaters see the latest stored value across separate roots (no lost updates)', async () => {
    const driver = new MemoryDriver();
    function Favs() {
      const [favs, setFavs] = useStorage<number[]>('favs', []);
      return (
        <Message text={`favs=${favs.join(',')}`}>
          <InlineKeyboard><Button text="add" onClick={() => setFavs((p) => [...p, p.length + 1])} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Favs, plugins: [storagePlugin({ driver })] });
    await t.send('hi');                // root #1 mounts, reads []
    await t.click('add');              // [1]
    driver.set('mock:1:favs', [1, 2]); // another root/instance wrote meanwhile
    await t.click('add');              // must build on [1,2], not on stale [1]
    expect(driver.get<number[]>('mock:1:favs')).toEqual([1, 2, 3]);
    expect(t.lastMessage?.text).toBe('favs=1,2,3');
    await t.stop();
  });
});
