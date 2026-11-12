import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as queue from '../jobs/queue.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

/** Queue observability. A background queue nobody can see is a queue nobody can debug. */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: { counts: await queue.stats(), jobs: await queue.listJobs({ status: req.query.status, limit: 50 }) } });
}));

router.get('/emails', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, to_address AS "to", subject, template, status, provider, error, created_at AS "createdAt"
     FROM email_log ORDER BY created_at DESC LIMIT 50`);
  res.json({ data: rows });
}));

export default router;
