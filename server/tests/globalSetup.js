import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startDevDb } from '../scripts/devDb.js';

/** Boots a real PostgreSQL, migrates and seeds it once, then hands the URL to the
 *  test process through a file — env vars set here do not propagate to workers. */
export default async function setup() {
  const urlFile = join(process.cwd(), '.test-db-url');
  const db = await startDevDb({ database: 'hospital_test', port: 55461, dataDir: join(process.cwd(), '.pgdata-test') });
  Object.assign(process.env, { DATABASE_URL: db.url, NODE_ENV: 'test', LOG_LEVEL: 'silent', MAIL_TRANSPORT: 'record' });
  const { migrate } = await import('../src/db/migrate.js');
  await migrate();
  const { runEtl } = await import('../src/etl/run.js');
  await runEtl();
  writeFileSync(urlFile, db.url);
  return async () => { db.stop(); rmSync(urlFile, { force: true }); };
}
