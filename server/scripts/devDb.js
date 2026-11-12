/**
 * devDb.js — a throwaway PostgreSQL server for local development and tests.
 *
 * The application only ever needs DATABASE_URL. This helper drives the official
 * PostgreSQL binaries that ship with `embedded-postgres` (initdb, pg_ctl) so a
 * developer gets a real Postgres with no Docker daemon and no system install.
 * CI uses a Postgres service container and production uses a managed instance —
 * the driver is identical, so the code path under test is the code that ships.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function binDir() {
  const arch = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`;
  const candidates = [
    join(here, '..', 'node_modules', '@embedded-postgres', arch, 'native', 'bin'),
    join(process.cwd(), 'node_modules', '@embedded-postgres', arch, 'native', 'bin'),
  ];
  for (const c of candidates) if (existsSync(join(c, 'initdb'))) return c;
  throw new Error(`PostgreSQL binaries not found. Run npm install, or set PG_BIN_DIR. Looked in: ${candidates.join(', ')}`);
}

const BIN = process.env.PG_BIN_DIR || binDir();
const exe = (n) => join(BIN, n);

export async function startDevDb({
  database = 'hospital',
  port = Number(process.env.PG_PORT || 55432),
  dataDir = process.env.PG_DATA_DIR || join(here, '..', '.pgdata'),
} = {}) {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'postgres', '--encoding=UTF8', '--locale=C', '-A', 'trust'], { stdio: 'pipe' });
  }
  const logFile = join(dataDir, 'server.log');
  execFileSync(exe('pg_ctl'), [
    '-D', dataDir, '-l', logFile, '-o',
    `-p ${port} -k ${dataDir} -c listen_addresses=127.0.0.1 -c shared_buffers=16MB -c max_connections=20 -c work_mem=4MB`,
    '-w', '-t', '60', 'start',
  ], { stdio: 'pipe' });

  const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const pgMod = await import('pg');
  const client = new pgMod.default.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!rows.length) await client.query(`CREATE DATABASE "${database}"`);
  } finally { await client.end(); }

  return {
    url: `postgres://postgres@127.0.0.1:${port}/${database}`,
    dataDir, port,
    stop: () => { try { execFileSync(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', '-t', '60', 'stop'], { stdio: 'pipe' }); } catch { /* already stopped */ } },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await startDevDb();
  console.log(`DATABASE_URL=${db.url}`);
  const stop = () => { db.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
