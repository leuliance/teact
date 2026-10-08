/**
 * Registry for `teact add`: what to install for each integration and the code that wires it
 * into `createBot({ plugins: [...] })`. Pure data + functions (no I/O) so it is easy to test.
 */

export interface ImportDecl {
  from: string;
  /** Named imports (`{ a, b }`). */
  named?: string[];
  /** Default import binding. */
  default?: string;
}

export interface Wiring {
  /** Packages to install (dependencies). */
  packages: string[];
  imports: ImportDecl[];
  /** Statements placed after the imports (clients, drivers). */
  setup: string[];
  /** Expressions appended to the `plugins: [...]` array. */
  plugins: string[];
  /** Environment variables the integration reads. */
  env: string[];
  /** Extra tips printed after wiring. */
  notes: string[];
}

export interface RegistryEntry {
  id: string;
  aliases?: string[];
  description: string;
  /** Client-library variants (`--client`). The first one is the default. */
  clients?: Record<string, string>;
  build(client?: string): Wiring;
}

const STORAGE = '@teactjs/storage';

function wiring(w: Partial<Wiring> & Pick<Wiring, 'packages'>): Wiring {
  return { imports: [], setup: [], plugins: [], env: [], notes: [], ...w };
}

function sessionNote(driverVar: string): string {
  return `Durable sessions: createBot({ session: { store: createSessionStore(${driverVar}) } }) — createSessionStore comes from ${STORAGE}.`;
}

/** Sub-plugins shipped in @teactjs/plugins: id → [export name, default call]. */
const PLUGINS_PKG = '@teactjs/plugins';
const SUB_PLUGINS: Record<string, { fn: string; call: string; description: string; aliases?: string[]; notes?: string[] }> = {
  'rate-limit': { fn: 'rateLimit', call: "rateLimit({ window: 2000, limit: 3, onLimited: '⏳ Slow down a bit!' })", description: 'Throttle users/chats (sliding or fixed window)', aliases: ['ratelimit', 'throttle'] },
  logger: { fn: 'logger', call: 'logger()', description: 'Log every update (pretty or JSON)', aliases: ['logging'] },
  maintenance: { fn: 'maintenance', call: "maintenance({ enabled: process.env.MAINTENANCE === '1' })", description: 'Maintenance mode with an allow-list' },
  'chat-filter': { fn: 'chatFilter', call: 'chatFilter()', description: 'Allow/deny chats, users and chat types', aliases: ['chatfilter'] },
  'ignore-old': { fn: 'ignoreOld', call: 'ignoreOld()', description: 'Drop updates that queued up while the bot was offline', aliases: ['ignoreold'] },
  'error-reporter': {
    fn: 'errorReporter',
    call: "errorReporter({ report: (err, ctx, info) => console.error('[bot error]', info.source, err) })",
    description: 'Report middleware/render errors (Sentry, logs, admin chat)',
    aliases: ['errors', 'sentry'],
  },
  analytics: { fn: 'analytics', call: 'analytics()', description: 'Count updates, commands and routes' },
  'feature-flags': { fn: 'featureFlags', call: 'featureFlags({ flags: {} })', description: 'Per-user/chat feature flags', aliases: ['flags', 'featureflags'] },
  broadcast: {
    fn: 'createBroadcaster',
    call: '',
    description: 'Rate-limited mass messaging (createBroadcaster)',
    aliases: ['broadcasts', 'broadcaster'],
    notes: ['createBroadcaster is not a plugin — call it where you send:', '  const result = await createBroadcaster({ adapter, recipients }).send(\'📣 Hello!\');'],
  },
};

export const REGISTRY: RegistryEntry[] = [
  {
    id: 'storage',
    description: 'useStorage() with memory/file drivers (or any DB driver below)',
    build: () =>
      wiring({
        packages: [STORAGE],
        imports: [{ from: STORAGE, named: ['storagePlugin'] }],
        plugins: ["storagePlugin({ driver: 'file', path: '.teact/storage.json' })"],
      }),
  },
  {
    id: 'redis',
    description: 'Redis storage driver, sessions and useRedis()',
    clients: { ioredis: 'ioredis', redis: 'node-redis v4+', upstash: '@upstash/redis (HTTP, edge-friendly)', bun: "Bun's built-in RedisClient" },
    build(client = 'ioredis') {
      const base = { packages: ['@teactjs/redis', STORAGE], env: ['REDIS_URL'] };
      const imports: ImportDecl[] = [
        { from: STORAGE, named: ['storagePlugin'] },
        { from: '@teactjs/redis', named: ['RedisDriver', 'redisPlugin'] },
      ];
      const tail = [
        'const redisDriver = new RedisDriver({ client: redis });',
      ];
      const plugins = ['redisPlugin({ client: redis, closeOnStop: true })', 'storagePlugin({ driver: redisDriver })'];
      const notes = [sessionNote('redisDriver')];
      switch (client) {
        case 'ioredis':
          return wiring({ ...base, packages: [...base.packages, 'ioredis'], imports: [{ from: 'ioredis', default: 'Redis' }, ...imports], setup: ['const redis = new Redis(process.env.REDIS_URL!);', ...tail], plugins, notes });
        case 'redis':
          return wiring({ ...base, packages: [...base.packages, 'redis'], imports: [{ from: 'redis', named: ['createClient'] }, ...imports], setup: ['const redis = createClient({ url: process.env.REDIS_URL });', 'await redis.connect();', ...tail], plugins, notes });
        case 'upstash':
          return wiring({ ...base, env: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], packages: [...base.packages, '@upstash/redis'], imports: [{ from: '@upstash/redis', named: ['Redis'] }, ...imports], setup: ['const redis = Redis.fromEnv();', ...tail], plugins, notes });
        case 'bun':
          return wiring({ ...base, imports: [{ from: 'bun', named: ['RedisClient'] }, ...imports], setup: ['const redis = new RedisClient(process.env.REDIS_URL);', ...tail], plugins, notes });
        default:
          throw new UnknownClientError('redis', client, Object.keys(this.clients!));
      }
    },
  },
  {
    id: 'postgres',
    aliases: ['pg', 'postgresql', 'neon', 'supabase'],
    description: 'Postgres storage driver, sessions and usePostgres()',
    clients: { pg: 'node-postgres Pool', postgres: 'postgres.js', neon: '@neondatabase/serverless (HTTP, edge-friendly)', pglite: '@electric-sql/pglite (embedded, dev/tests)' },
    build(client = 'pg') {
      const imports: ImportDecl[] = [
        { from: STORAGE, named: ['storagePlugin'] },
        { from: '@teactjs/postgres', named: ['PostgresDriver', 'postgresPlugin'] },
      ];
      const tail = ['const pg = new PostgresDriver({ client: db, closeClient: true });'];
      const base = {
        env: ['DATABASE_URL'],
        plugins: ['storagePlugin({ driver: pg })', 'postgresPlugin({ driver: pg })'],
        notes: [sessionNote('pg'), 'Table DDL: console.log(createTableSql()) from @teactjs/postgres, if you manage migrations yourself.'],
      };
      const pkgs = ['@teactjs/postgres', STORAGE];
      switch (client) {
        case 'pg':
          return wiring({ ...base, packages: [...pkgs, 'pg'], imports: [{ from: 'pg', named: ['Pool'] }, ...imports], setup: ['const db = new Pool({ connectionString: process.env.DATABASE_URL });', ...tail] });
        case 'postgres':
          return wiring({ ...base, packages: [...pkgs, 'postgres'], imports: [{ from: 'postgres', default: 'postgres' }, ...imports], setup: ['const db = postgres(process.env.DATABASE_URL!);', ...tail] });
        case 'neon':
          return wiring({ ...base, packages: [...pkgs, '@neondatabase/serverless'], imports: [{ from: '@neondatabase/serverless', named: ['neon'] }, ...imports], setup: ['const db = neon(process.env.DATABASE_URL!);', ...tail] });
        case 'pglite':
          return wiring({ ...base, env: [], packages: [...pkgs, '@electric-sql/pglite'], imports: [{ from: '@electric-sql/pglite', named: ['PGlite'] }, ...imports], setup: ["const db = new PGlite('./data/pg');", ...tail] });
        default:
          throw new UnknownClientError('postgres', client, Object.keys(this.clients!));
      }
    },
  },
  {
    id: 'sqlite',
    description: 'SQLite storage driver (bun:sqlite, better-sqlite3 on Node), sessions and useSqlite()',
    clients: { bun: 'bun:sqlite (built in)', 'better-sqlite3': 'better-sqlite3 (Node)' },
    build(client = 'bun') {
      if (client !== 'bun' && client !== 'better-sqlite3') throw new UnknownClientError('sqlite', client, Object.keys(this.clients!));
      return wiring({
        packages: ['@teactjs/sqlite', STORAGE, ...(client === 'better-sqlite3' ? ['better-sqlite3'] : [])],
        imports: [
          { from: STORAGE, named: ['storagePlugin'] },
          { from: '@teactjs/sqlite', named: ['SqliteDriver', 'sqlitePlugin'] },
        ],
        setup: ["const sqlite = new SqliteDriver({ path: './data/bot.db' });"],
        plugins: ['storagePlugin({ driver: sqlite })', 'sqlitePlugin({ driver: sqlite })'],
        notes: [sessionNote('sqlite'), 'Add data/ to .gitignore.'],
      });
    },
  },
  {
    id: 'mongodb',
    aliases: ['mongo'],
    description: 'MongoDB storage driver, sessions and useMongo()',
    build: () =>
      wiring({
        packages: ['@teactjs/mongodb', STORAGE, 'mongodb'],
        env: ['MONGO_URL'],
        imports: [
          { from: 'mongodb', named: ['MongoClient'] },
          { from: STORAGE, named: ['storagePlugin'] },
          { from: '@teactjs/mongodb', named: ['MongoDriver', 'mongoPlugin'] },
        ],
        setup: [
          'const mongo = new MongoClient(process.env.MONGO_URL!);',
          "const mongoDriver = new MongoDriver({ client: mongo, dbName: 'bot' });",
        ],
        plugins: ["mongoPlugin({ client: mongo, dbName: 'bot', closeOnStop: true })", 'storagePlugin({ driver: mongoDriver })'],
        notes: [sessionNote('mongoDriver')],
      }),
  },
  {
    id: 'cloudflare',
    aliases: ['cf', 'kv', 'd1', 'workers'],
    description: 'Cloudflare KV / D1 storage drivers for Workers',
    clients: { kv: 'Workers KV namespace', d1: 'D1 database' },
    build(client = 'kv') {
      if (client !== 'kv' && client !== 'd1') throw new UnknownClientError('cloudflare', client, Object.keys(this.clients!));
      const driver = client === 'kv' ? 'KVDriver' : 'D1Driver';
      const binding = client === 'kv' ? 'env.BOT_KV' : 'env.DB';
      return wiring({
        packages: ['@teactjs/cloudflare', STORAGE],
        notes: [
          "Workers-only (`cloudflare:workers` doesn't exist under bun dev), so it is not auto-inserted. In the module your worker imports:",
          `  import { env } from 'cloudflare:workers';`,
          `  import { ${driver} } from '@teactjs/cloudflare';`,
          `  storagePlugin({ driver: new ${driver}(() => ${binding}) })`,
          `Declare the binding in wrangler.jsonc (${client === 'kv' ? '"kv_namespaces"' : '"d1_databases"'}). Run \`teact deploy\` to scaffold the worker.`,
        ],
      });
    },
  },
  {
    id: 'i18n',
    description: 'Translations with useTranslation() and per-user locale',
    build: () =>
      wiring({
        packages: ['@teactjs/i18n'],
        notes: [
          'Register it with your locale files (not auto-inserted — it needs your JSON imports):',
          "  import { i18nPlugin } from '@teactjs/i18n';",
          "  import en from './locales/en.json';",
          "  plugins: [i18nPlugin({ locales: { en }, defaultLocale: 'en' })]",
          'Then use useT() / useFormat() / <LanguagePicker /> in components.',
        ],
      }),
  },
  {
    id: 'plugins',
    description: `All middleware plugins (${Object.keys(SUB_PLUGINS).join(', ')})`,
    build: () => wiring({ packages: [PLUGINS_PKG], notes: [`Pick one: teact add ${Object.keys(SUB_PLUGINS).slice(0, 3).join(' ')} …`] }),
  },
  ...Object.entries(SUB_PLUGINS).map(([id, p]): RegistryEntry => ({
    id,
    aliases: p.aliases,
    description: `${p.description} (${PLUGINS_PKG})`,
    build: () =>
      wiring({
        packages: [PLUGINS_PKG],
        imports: p.call ? [{ from: PLUGINS_PKG, named: [p.fn] }] : [],
        plugins: p.call ? [p.call] : [],
        notes: p.notes ?? [],
      }),
  })),
];

export class UnknownClientError extends Error {
  constructor(readonly entry: string, readonly client: string, readonly available: string[]) {
    super(`Unknown --client "${client}" for ${entry}. Available: ${available.join(', ')}`);
  }
}

export function findPlugin(name: string): RegistryEntry | undefined {
  const key = name.toLowerCase().replace(/^@teactjs\//, '').replace(/_/g, '-');
  return REGISTRY.find((e) => e.id === key || e.aliases?.includes(key));
}

/** Merge several wirings (dedupes packages, imports, setup lines and plugins). */
export function mergeWirings(list: Wiring[]): Wiring {
  const out = wiring({ packages: [] });
  const uniq = <T>(arr: T[], v: T) => { if (!arr.includes(v)) arr.push(v); };
  for (const w of list) {
    w.packages.forEach((p) => uniq(out.packages, p));
    w.setup.forEach((s) => uniq(out.setup, s));
    w.plugins.forEach((s) => uniq(out.plugins, s));
    w.env.forEach((s) => uniq(out.env, s));
    w.notes.forEach((s) => uniq(out.notes, s));
    for (const imp of w.imports) {
      const existing = out.imports.find((i) => i.from === imp.from);
      if (!existing) { out.imports.push({ from: imp.from, named: imp.named ? [...imp.named] : undefined, default: imp.default }); continue; }
      if (imp.default) existing.default ??= imp.default;
      for (const n of imp.named ?? []) { existing.named ??= []; uniq(existing.named, n); }
    }
  }
  return out;
}

export function renderImport(imp: ImportDecl): string {
  const parts: string[] = [];
  if (imp.default) parts.push(imp.default);
  if (imp.named?.length) parts.push(`{ ${imp.named.join(', ')} }`);
  return `import ${parts.join(', ')} from '${imp.from}';`;
}

/** The copy-paste snippet for a wiring. */
export function renderSnippet(w: Wiring): string {
  const lines: string[] = [];
  lines.push(...w.imports.map(renderImport));
  if (w.setup.length) lines.push('', ...w.setup);
  if (w.plugins.length) {
    lines.push('', 'export const bot = createBot({', '  // …', '  plugins: [');
    lines.push(...w.plugins.map((p) => `    ${p},`));
    lines.push('  ],', '});');
  }
  return lines.join('\n');
}
