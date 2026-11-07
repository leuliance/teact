/**
 * Load a Node built-in at runtime, synchronously, without a static `import` — so the module
 * still bundles for edge/browser targets (Vercel Edge, Deno Deploy, Workers without
 * nodejs_compat), where it simply returns `undefined`. Bun and Node ≥ 20.16 provide
 * `process.getBuiltinModule`.
 */
export function nodeBuiltin<T = any>(name: string): T | undefined {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    return proc?.getBuiltinModule?.(name) as T | undefined;
  } catch {
    return undefined;
  }
}
