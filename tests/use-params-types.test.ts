import { test, expect } from 'bun:test';
import { useParams } from '../packages/core/src';

// Compile-time checks (run by `tsc --noEmit`); the runtime test only keeps bun happy.
const fromPath: ReturnType<typeof useParams<'/pokemon/:id'>> = { id: '1' };
const fromShape: ReturnType<typeof useParams<{ id: string }>> = { id: '1' };
// Never called — only type-checked: with no type argument params are a loose string map.
const loose = () => { const p = useParams(); const s: string | undefined = p.anything; return s; };
// @ts-expect-error — unknown param name on a typed path
const bad: ReturnType<typeof useParams<'/pokemon/:id'>> = { nope: '1' };

test('useParams accepts a path template or an explicit shape', () => {
  expect([fromPath.id, fromShape.id, loose, bad]).toBeDefined();
});
