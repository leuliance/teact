/**
 * Careful text edits that wire an integration into a source file: merge imports, add setup
 * statements and append to the `plugins: [...]` array of `createBot({...})` (or
 * `defineConfig({...})`). Anything unexpected → `{ ok: false, reason }` and the caller prints
 * the snippet instead. User code is never executed.
 */
import type { ImportDecl, Wiring } from './registry';
import { renderImport } from './registry';

export type WireResult =
  | { ok: true; source: string; changes: string[]; /** Plugins whose factory is already registered (with possibly different options). */ skipped: string[] }
  | { ok: false; reason: string };

interface Edit { at: number; end: number; text: string }

/**
 * Replace the contents of strings, template literals and comments with spaces (same length),
 * so structural searches (brackets, identifiers) never match inside them.
 */
export function maskSource(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // Stack of brace depths for `${ … }` inside template literals.
  const tplStack: number[] = [];
  let depth = 0;
  let i = 0;
  const n = src.length;

  const scanTemplate = (start: number): number => {
    // start is just after the opening backtick (or after the closing `}` of `${}`)
    let j = start;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') { blank(start, j); return j + 1; }
      if (ch === '$' && src[j + 1] === '{') {
        blank(start, j);
        tplStack.push(depth);
        depth++;
        return j + 2;
      }
      j++;
    }
    blank(start, n);
    return n;
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (ch === '`') {
      i = scanTemplate(i + 1);
    } else if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      i++;
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (ch === '}' && tplStack.length && tplStack[tplStack.length - 1] === depth) {
        tplStack.pop();
        i = scanTemplate(i + 1);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Index of the bracket matching the one at `open` (in masked source), or -1. */
export function matchBracket(masked: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch in pairs) stack.push(pairs[ch]);
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function lineIndent(src: string, at: number): string {
  const lineStart = src.lastIndexOf('\n', at - 1) + 1;
  return src.slice(lineStart).match(/^[ \t]*/)![0];
}

/** Find a depth-0 property key inside an object literal spanning (open, close). */
export function findTopLevelKey(masked: string, open: number, close: number, key: string): number {
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (depth === 0 && masked.startsWith(key, i) && !/[\w$.]/.test(masked[i - 1] ?? '') && !/[\w$]/.test(masked[i + key.length] ?? '')) {
      return i;
    }
  }
  return -1;
}

interface ParsedImport { start: number; end: number; clause: string; from: string; typeOnly: boolean }

export function parseImports(src: string, masked: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const re = /^import\s+(type\s+)?([\s\S]*?)\s*from\s*(['"])([^'"\n]+)\3[ \t]*;?|^import\s*(['"])([^'"\n]+)\5[ \t]*;?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (masked.slice(m.index, m.index + 6) !== 'import') continue; // inside a comment/string
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      clause: m[2] ?? '',
      from: m[4] ?? m[6],
      typeOnly: !!m[1],
    });
  }
  return out;
}

function boundNames(clause: string): string[] {
  const names: string[] = [];
  const brace = clause.match(/\{([\s\S]*)\}/);
  if (brace) {
    for (const part of brace[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.push((as[1] ?? as[0]).trim());
    }
  }
  const def = clause.replace(/\{[\s\S]*\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const d of def) {
    const ns = d.match(/^\*\s+as\s+([\w$]+)/);
    names.push(ns ? ns[1] : d);
  }
  return names;
}

function isDeclared(masked: string, name: string): boolean {
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${name.replace(/\$/g, '\\$')}\\b`).test(masked);
}

function calleeOf(expr: string): string | null {
  return expr.match(/^([\w$.]+)\s*\(/)?.[1] ?? null;
}

/**
 * Wire `w` into `source`. `call` is the function whose first argument (an object literal)
 * receives the plugins: `createBot` for entry files, `defineConfig` for teact.config.ts.
 */
export function wireSource(source: string, w: Wiring, call: 'createBot' | 'defineConfig' = 'createBot'): WireResult {
  const masked = maskSource(source);
  const edits: Edit[] = [];
  const changes: string[] = [];
  const skipped: string[] = [];

  // ---- locate call({ ... }) ----
  const callRe = new RegExp(`\\b${call}\\s*(?:<[^>]*>\\s*)?\\(`, 'g');
  const calls = [...masked.matchAll(callRe)];
  if (w.plugins.length > 0) {
    if (calls.length === 0) return { ok: false, reason: `no ${call}(…) call found` };
    if (calls.length > 1) return { ok: false, reason: `found ${calls.length} ${call}(…) calls — not sure which one to edit` };
  }
  const callIdx = calls[0]?.index ?? -1;

  // ---- imports ----
  const imports = parseImports(source, masked);
  const lastImportEnd = imports.length ? Math.max(...imports.map((i) => i.end)) : (source.startsWith('#!') ? source.indexOf('\n') + 1 : 0);
  if (callIdx !== -1 && lastImportEnd > callIdx) return { ok: false, reason: `imports appear after ${call}(…)` };

  const newImportLines: string[] = [];
  for (const imp of w.imports) {
    const fromSame = imports.filter((i) => i.from === imp.from && !i.typeOnly);
    const fromOthers = imports.filter((i) => i.from !== imp.from);
    const already = new Set(fromSame.flatMap((i) => boundNames(i.clause)));
    const otherNames = new Set(fromOthers.flatMap((i) => boundNames(i.clause)));

    const wanted: ImportDecl = { from: imp.from };
    const missingNamed = (imp.named ?? []).filter((n) => !already.has(n));
    const needDefault = imp.default && !already.has(imp.default) ? imp.default : undefined;
    for (const n of [...missingNamed, ...(needDefault ? [needDefault] : [])]) {
      if (otherNames.has(n) || isDeclared(masked, n)) return { ok: false, reason: `"${n}" is already declared in this file` };
    }
    if (!missingNamed.length && !needDefault) continue;

    // Merge named imports into an existing `import { … } from 'x'`.
    const target = fromSame.find((i) => /\{[\s\S]*\}/.test(i.clause));
    if (target && !needDefault && missingNamed.length) {
      const rel = source.slice(target.start, target.end);
      const close = rel.lastIndexOf('}');
      const before = rel.slice(0, close);
      const trimmed = before.trimEnd();
      const insertAt = target.start + trimmed.length;
      const text = trimmed.endsWith(',') ? ` ${missingNamed.join(', ')},` : `, ${missingNamed.join(', ')}`;
      // `import {} from` edge case
      const finalText = trimmed.endsWith('{') ? ` ${missingNamed.join(', ')}` : text;
      edits.push({ at: insertAt, end: insertAt, text: finalText });
      changes.push(`import { ${missingNamed.join(', ')} } from '${imp.from}' (merged)`);
      continue;
    }
    if (needDefault) wanted.default = needDefault;
    if (missingNamed.length) wanted.named = missingNamed;
    newImportLines.push(renderImport(wanted));
    changes.push(renderImport(wanted));
  }

  // ---- setup statements ----
  const setupLines: string[] = [];
  const normalized = source.replace(/\s+/g, ' ');
  for (const line of w.setup) {
    if (normalized.includes(line.replace(/\s+/g, ' '))) continue;
    const decl = line.match(/^(?:const|let|var)\s+([\w$]+)/)?.[1];
    if (decl && (isDeclared(masked, decl) || imports.some((i) => boundNames(i.clause).includes(decl)))) {
      return { ok: false, reason: `"${decl}" is already declared in this file` };
    }
    setupLines.push(line);
    changes.push(line);
  }

  if (newImportLines.length || setupLines.length) {
    let text = '';
    if (newImportLines.length) text += (lastImportEnd > 0 ? '\n' : '') + newImportLines.join('\n') + (lastImportEnd > 0 ? '' : '\n');
    if (setupLines.length) text += '\n\n' + setupLines.join('\n');
    edits.push({ at: lastImportEnd, end: lastImportEnd, text });
  }

  // ---- plugins array ----
  if (w.plugins.length > 0) {
    const parenIdx = callIdx + calls[0][0].length - 1;
    const objOpen = skipWs(masked, parenIdx + 1);
    if (masked[objOpen] !== '{') return { ok: false, reason: `${call}(…) is not called with an object literal` };
    const objClose = matchBracket(masked, objOpen);
    if (objClose === -1) return { ok: false, reason: `could not find the end of ${call}({ … })` };

    const keyIdx = findTopLevelKey(masked, objOpen, objClose, 'plugins');
    // The masker didn't see a `plugins` key but the raw text has one: unusual syntax (e.g.
    // an apostrophe in JSX text) confused it. Adding a second key would silently shadow
    // or be shadowed by the real one, so refuse.
    if (keyIdx === -1 && /(^|[\s,{])plugins\s*:/.test(source.slice(objOpen, objClose))) {
      return { ok: false, reason: `could not reliably locate \`plugins\` in ${call}({ … }) — add the plugins manually` };
    }
    if (keyIdx !== -1) {
      const colon = skipWs(masked, keyIdx + 'plugins'.length);
      if (masked[colon] !== ':') return { ok: false, reason: '`plugins` is a shorthand/variable — add the plugins to it manually' };
      const arrOpen = skipWs(masked, colon + 1);
      if (masked[arrOpen] !== '[') return { ok: false, reason: '`plugins` is not an array literal' };
      const arrClose = matchBracket(masked, arrOpen);
      if (arrClose === -1) return { ok: false, reason: 'could not find the end of the plugins array' };

      const innerMasked = masked.slice(arrOpen + 1, arrClose);
      const toAdd = w.plugins.filter((p) => {
        const callee = calleeOf(p);
        const present = !!callee && new RegExp(`(^|[^\\w$.])${callee.replace(/[.$]/g, '\\$&')}\\s*\\(`).test(innerMasked);
        if (present && !source.slice(arrOpen + 1, arrClose).replace(/\s+/g, '').includes(p.replace(/\s+/g, ''))) skipped.push(p);
        return !present;
      });
      if (toAdd.length) {
        const multiline = innerMasked.includes('\n');
        const lastCode = innerMasked.trimEnd().length; // relative to arrOpen + 1
        const isEmpty = innerMasked.trim() === '';
        const baseIndent = lineIndent(source, keyIdx);
        if (isEmpty) {
          const text = `\n${toAdd.map((p) => `${baseIndent}  ${p},`).join('\n')}\n${baseIndent}`;
          edits.push({ at: arrOpen + 1, end: arrClose, text });
        } else {
          const at = arrOpen + 1 + lastCode;
          const hasTrailingComma = innerMasked.trimEnd().endsWith(',');
          if (multiline) {
            const itemIndent = lineIndent(source, at - 1) || baseIndent + '  ';
            if (!hasTrailingComma) edits.push({ at, end: at, text: ',' });
            // Keep a trailing `// comment` on the last item's line attached to it.
            const eol = source.indexOf('\n', at);
            const insertAt = eol !== -1 && eol < arrClose && masked.slice(at, eol).trim() === '' ? eol : at;
            edits.push({ at: insertAt, end: insertAt, text: toAdd.map((p) => `\n${itemIndent}${p},`).join('') });
          } else {
            const text = hasTrailingComma ? ` ${toAdd.join(', ')},` : `, ${toAdd.join(', ')}`;
            edits.push({ at, end: at, text });
          }
        }
        changes.push(...toAdd.map((p) => `plugins += ${p}`));
      }
    } else {
      const inner = masked.slice(objOpen + 1, objClose);
      if (inner.includes('\n')) {
        const firstProp = skipWs(masked, objOpen + 1);
        const propIndent = firstProp < objClose ? lineIndent(source, firstProp) : lineIndent(source, objOpen) + '  ';
        const text = `\n${propIndent}plugins: [\n${w.plugins.map((p) => `${propIndent}  ${p},`).join('\n')}\n${propIndent}],`;
        edits.push({ at: objOpen + 1, end: objOpen + 1, text });
      } else {
        const text = inner.trim() ? ` plugins: [${w.plugins.join(', ')}],` : ` plugins: [${w.plugins.join(', ')}] `;
        edits.push({ at: objOpen + 1, end: objOpen + 1, text });
      }
      changes.push(...w.plugins.map((p) => `plugins += ${p}`));
    }
  }

  let out = source;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.end);
  }
  return { ok: true, source: out, changes, skipped };
}
