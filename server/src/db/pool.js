import pg from 'pg';
import config from '../config/index.js';

// NUMERIC and COUNT arrive as strings by default; this application does maths on
// both, so parse them once here rather than casting in every handler.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
// DATE -> 'YYYY-MM-DD' string, so a date never shifts by a timezone offset.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.isProd ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (e) => console.error('idle client error', e.message));

export async function query(text, params) { return pool.query(text, params); }

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
export const closePool = () => pool.end();
