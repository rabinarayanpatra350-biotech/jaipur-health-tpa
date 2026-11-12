import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';
import logger from '../lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (version) VALUES ('001_initial') ON CONFLICT DO NOTHING`);
    await client.query('COMMIT');
    logger.info('migrations applied');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).then(() => process.exit(0))
    .catch((e) => { logger.error({ e }, 'migration failed'); process.exit(1); });
}
