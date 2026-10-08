/**
 * Static route extraction for `teact routes`: finds `createRouter({ … })` object literals
 * (or `createRouter(routes)` where `routes` is a `const` object literal in the same file) and
 * reads each `'/path': …` entry with its component, co-located command and guard. User code
 * is never executed.
 */
import { maskSource, matchBracket, findTopLevelKey } from './add/wire';

export interface RouteInfo {
  path: string;
  file: string;
  line: number;
  component?: string;
  command?: string;
  description?: string;
  guard: boolean;
  deepLink: boolean;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** Read the string literal whose opening quote is at `i` (quotes survive masking). */
function readString(src: string, masked: string, i: number): { value: string; end: number } | null {
  const q = masked[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let j = i + 1;
  while (j < src.length && masked[j] !== q) j++;
  const raw = src.slice(i + 1, j);
  if (q === '`' && raw.includes('${')) return null;
  return { value: raw, end: j + 1 };
}

/** End (exclusive) of the expression starting at `i` inside an object: next depth-0 `,` or `close`. */
function valueEnd(masked: string, i: number, close: number): number {
  let depth = 0;
  for (let j = i; j < close; j++) {
    const ch = masked[j];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return j;
  }
  return close;
}

function propValue(src: string, masked: string, open: number, close: number, key: string): { start: number; end: number } | null {
  const k = findTopLevelKey(masked, open, close, key);
  if (k === -1) return null;
  const colon = skipWs(masked, k + key.length);
  if (masked[colon] !== ':') {
    // shorthand `{ component }` or method `beforeLoad() {}`
    return masked[colon] === '(' ? { start: k, end: valueEnd(masked, k, close) } : { start: k, end: k + key.length };
  }
  const start = skipWs(masked, colon + 1);
  return { start, end: valueEnd(masked, start, close) };
}

function parseRoutesObject(src: string, masked: string, open: number, file: string): RouteInfo[] {
  const close = matchBracket(masked, open);
  if (close === -1) return [];
  const routes: RouteInfo[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; continue; }
    if (depth !== 0 || (ch !== '"' && ch !== "'" && ch !== '`')) continue;

    const key = readString(src, masked, i);
    if (!key) continue;
    const colon = skipWs(masked, key.end);
    if (masked[colon] !== ':' || !key.value.startsWith('/')) { i = key.end - 1; continue; }

    const vStart = skipWs(masked, colon + 1);
    const vEnd = valueEnd(masked, vStart, close);
    const info: RouteInfo = { path: key.value, file, line: lineOf(src, i), guard: false, deepLink: false };

    if (masked[vStart] === '{') {
      const vClose = matchBracket(masked, vStart);
      const comp = propValue(src, masked, vStart, vClose, 'component');
      if (comp) info.component = src.slice(comp.start, comp.end).trim().replace(/\s+/g, ' ');
      info.guard = findTopLevelKey(masked, vStart, vClose, 'beforeLoad') !== -1;
      const cmd = propValue(src, masked, vStart, vClose, 'command');
      if (cmd) {
        if (masked[cmd.start] === '{') {
          const cClose = matchBracket(masked, cmd.start);
          const name = propValue(src, masked, cmd.start, cClose, 'name');
          const desc = propValue(src, masked, cmd.start, cClose, 'description');
          const n = name && readString(src, masked, name.start);
          const d = desc && readString(src, masked, desc.start);
          if (n) info.command = n.value.replace(/^\//, '');
          if (d) info.description = d.value;
          info.deepLink = findTopLevelKey(masked, cmd.start, cClose, 'deepLink') !== -1;
        } else {
          const s = readString(src, masked, cmd.start);
          if (s) info.command = s.value.replace(/^\//, '');
        }
      }
    } else {
      const expr = src.slice(vStart, vEnd).trim().replace(/\s+/g, ' ');
      if (expr) info.component = expr;
    }
    routes.push(info);
    i = vEnd - 1;
  }
  return routes;
}

export function extractRoutes(src: string, file = '<source>'): RouteInfo[] {
  const masked = maskSource(src);
  const routes: RouteInfo[] = [];
  for (const m of masked.matchAll(/\bcreateRouter\s*(?:<[^>]*>\s*)?\(/g)) {
    let arg = skipWs(masked, m.index! + m[0].length);
    if (masked[arg] !== '{') {
      const ident = masked.slice(arg).match(/^[A-Za-z_$][\w$]*/)?.[0];
      if (!ident) continue;
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident.replace(/\$/g, '\\$')}\\b[^=]*=\\s*\\{`).exec(masked);
      if (!decl) continue;
      arg = decl.index + decl[0].length - 1;
    }
    routes.push(...parseRoutesObject(src, masked, arg, file));
  }
  return routes;
}
