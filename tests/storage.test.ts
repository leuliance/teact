import { describe, test, expect } from 'bun:test';
import { MemoryDriver } from '../packages/storage/src/drivers/memory';
import { FileDriver } from '../packages/storage/src/drivers/file';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StorageDriver } from '../packages/storage/src/types';

describe('MemoryDriver', () => {
  test('get returns undefined for missing key', () => {
    const driver = new MemoryDriver();
    expect(driver.get('missing')).toBeUndefined();
  });

  test('set and get stores a string value', () => {
    const driver = new MemoryDriver();
    driver.set('name', 'Alice');
    expect(driver.get('name')).toBe('Alice');
  });

  test('set and get stores an object value', () => {
    const driver = new MemoryDriver();
    driver.set('user', { id: 1, name: 'Bob' });
    expect(driver.get('user')).toEqual({ id: 1, name: 'Bob' });
  });

  test('set overwrites existing value', () => {
    const driver = new MemoryDriver();
    driver.set('count', 1);
    driver.set('count', 2);
    expect(driver.get('count')).toBe(2);
  });

  test('delete removes a key', () => {
    const driver = new MemoryDriver();
    driver.set('temp', 'value');
    expect(driver.get('temp')).toBe('value');
    driver.delete('temp');
    expect(driver.get('temp')).toBeUndefined();
  });

  test('delete on missing key does not throw', () => {
    const driver = new MemoryDriver();
    expect(() => driver.delete('nonexistent')).not.toThrow();
  });

  test('has returns true for existing key', () => {
    const driver = new MemoryDriver();
    driver.set('exists', true);
    expect(driver.has('exists')).toBe(true);
  });

  test('has returns false for missing key', () => {
    const driver = new MemoryDriver();
    expect(driver.has('nope')).toBe(false);
  });

  test('keys returns all stored keys', () => {
    const driver = new MemoryDriver();
    driver.set('a', 1);
    driver.set('b', 2);
    driver.set('c', 3);
    const keys = driver.keys();
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
    expect(keys).toHaveLength(3);
  });

  test('keys returns empty array when no data', () => {
    const driver = new MemoryDriver();
    expect(driver.keys()).toEqual([]);
  });

  test('clear removes all keys', () => {
    const driver = new MemoryDriver();
    driver.set('x', 1);
    driver.set('y', 2);
    driver.clear();
    expect(driver.keys()).toEqual([]);
    expect(driver.get('x')).toBeUndefined();
    expect(driver.get('y')).toBeUndefined();
  });

  test('stores various data types', () => {
    const driver = new MemoryDriver();
    driver.set('number', 42);
    driver.set('boolean', false);
    driver.set('array', [1, 2, 3]);
    driver.set('null', null);

    expect(driver.get('number')).toBe(42);
    expect(driver.get('boolean')).toBe(false);
    expect(driver.get('array')).toEqual([1, 2, 3]);
    expect(driver.get('null')).toBeNull();
  });

  test('implements StorageDriver interface', () => {
    const driver: StorageDriver = new MemoryDriver();
    expect(typeof driver.get).toBe('function');
    expect(typeof driver.set).toBe('function');
    expect(typeof driver.delete).toBe('function');
    expect(typeof driver.has).toBe('function');
    expect(typeof driver.clear).toBe('function');
    expect(typeof driver.keys).toBe('function');
  });
});

describe('FileDriver', () => {
  const testDir = join(import.meta.dir, '.tmp-test-storage');
  const testPath = join(testDir, 'test-store.json');

  function cleanUp() {
    try { unlinkSync(testPath); } catch {}
    try { unlinkSync(testDir); } catch {}
  }

  test('get returns undefined for missing key on fresh driver', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    expect(driver.get('missing')).toBeUndefined();
    cleanUp();
  });

  test('set and get stores a value', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('name', 'Charlie');
    expect(driver.get('name')).toBe('Charlie');
    cleanUp();
  });

  test('delete removes a key', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('toRemove', 'val');
    driver.delete('toRemove');
    expect(driver.get('toRemove')).toBeUndefined();
    cleanUp();
  });

  test('has returns correct boolean', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('present', 1);
    expect(driver.has('present')).toBe(true);
    expect(driver.has('absent')).toBe(false);
    cleanUp();
  });

  test('keys returns stored keys', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('k1', 'v1');
    driver.set('k2', 'v2');
    const keys = driver.keys();
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
    cleanUp();
  });

  test('clear removes all data', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('a', 1);
    driver.set('b', 2);
    driver.clear();
    expect(driver.keys()).toEqual([]);
    cleanUp();
  });

  test('flush writes to disk', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver = new FileDriver(testPath);
    driver.set('persisted', 'data');
    driver.flush();
    expect(existsSync(testPath)).toBe(true);
    cleanUp();
  });

  test('implements StorageDriver interface', () => {
    cleanUp();
    mkdirSync(testDir, { recursive: true });
    const driver: StorageDriver = new FileDriver(testPath);
    expect(typeof driver.get).toBe('function');
    expect(typeof driver.set).toBe('function');
    expect(typeof driver.delete).toBe('function');
    expect(typeof driver.has).toBe('function');
    expect(typeof driver.clear).toBe('function');
    expect(typeof driver.keys).toBe('function');
    cleanUp();
  });
});
