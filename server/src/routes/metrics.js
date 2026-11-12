import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { validateQuery } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { computeMetrics, occupancySeries } from '../services/metricsService.js';
import { ApiError } from '../lib/errors.js';
import config from '../config/index.js';

const router = Router();

const defaultWindow = () => {
  const to = new Date();
  const from = new Date(to.getTime() - config.reporting.defaultDays * 86400000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

/** The dashboard. Average length of stay, bed occupancy and 30-day readmission —
 *  the three figures the brief names — plus the counts that make them readable. */
/** Rejects a window that runs backwards or is not a date at all, rather than
 *  returning a dashboard of zeros that reads as "no activity". */
function windowFrom(req) {
  const d = defaultWindow();
  const from = req.query.from || d.from;
  const to = req.query.to || d.to;
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) {
      throw ApiError.unprocessable('Validation failed', [{ field: k, message: 'Use YYYY-MM-DD' }]);
    }
  }
  if (Date.parse(to) <= Date.parse(from)) {
    throw ApiError.unprocessable('Validation failed', [{ field: 'to', message: 'The window must end after it starts' }]);
  }
  return { from, to };
}

router.get('/', requireAuth, requireRole('clinician', 'admin'), asyncHandler(async (req, res) => {
  const { from, to } = windowFrom(req);
  res.json({ data: await computeMetrics({ hospitalId: req.query.hospitalId, from, to }) });
}));

router.get('/:hospitalId/occupancy', requireAuth, requireRole('clinician', 'admin'), asyncHandler(async (req, res) => {
  const { from, to } = windowFrom(req);
  res.json({ data: { window: { from, to }, series: await occupancySeries({ hospitalId: req.params.hospitalId, from, to }) } });
}));

export default router;
