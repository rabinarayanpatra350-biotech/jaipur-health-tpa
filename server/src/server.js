import config from './config/index.js';
import logger from './lib/logger.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { createWorker } from './jobs/worker.js';

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.env }, 'API listening');
});

// The worker runs in-process by default so a single `npm start` is enough locally.
// In production it can be scaled out by running `npm run worker` separately and
// setting JOBS_INLINE=false here.
let worker = null;
if (process.env.JOBS_INLINE !== 'false') {
  worker = createWorker({ workerId: 'api-inline' }).start();
}

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    if (worker) await worker.stop();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
