import { claim, complete, fail, reclaimStale, newWorkerId } from './queue.js';
import { getHandler } from './handlers.js';
import logger from '../lib/logger.js';
import config from '../config/index.js';

/** One job at a time per worker: trivially correct, and throughput scales by
 *  running more workers — which SKIP LOCKED supports. */
export function createWorker({ workerId = newWorkerId(), pollIntervalMs = config.jobs.pollIntervalMs } = {}) {
  let running = false; let timer = null; let stopped = false;
  const counters = { processed: 0, succeeded: 0, failed: 0, retried: 0 };

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const job = await claim(workerId);
      if (!job) return;
      try {
        const result = await getHandler(job.type)(job.payload, job);
        await complete(job.id, result);
        counters.processed += 1; counters.succeeded += 1;
      } catch (err) {
        const outcome = await fail(job.id, err);
        counters.processed += 1;
        if (outcome.status === 'retry') counters.retried += 1; else counters.failed += 1;
        logger.warn({ jobId: job.id, type: job.type, outcome, err: err.message }, 'job failed');
      }
    } catch (err) { logger.error({ err: err.message }, 'worker tick failed'); }
    finally { running = false; }
  }

  return {
    workerId, counters, tick,
    start() {
      stopped = false;
      reclaimStale({ visibilityTimeoutMs: config.jobs.visibilityTimeoutMs }).catch(() => {});
      timer = setInterval(tick, pollIntervalMs);
      if (timer.unref) timer.unref();
      logger.info({ workerId, pollIntervalMs }, 'worker started');
      return this;
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      while (running) await new Promise(r => setTimeout(r, 25));
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const w = createWorker().start();
  const stop = async () => { await w.stop(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
