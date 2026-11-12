import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../lib/errors.js';
import authRoutes from './auth.js';
import hospitalRoutes from './hospitals.js';
import patientRoutes from './patients.js';
import appointmentRoutes from './appointments.js';
import admissionRoutes from './admissions.js';
import prescriptionRoutes from './prescriptions.js';
import metricsRoutes from './metrics.js';
import mediaRoutes from './media.js';
import jobRoutes from './jobs.js';

const router = Router();

router.get('/health', asyncHandler(async (_req, res) => {
  let database = 'down';
  try { await query('SELECT 1'); database = 'up'; } catch { /* reported below */ }
  res.status(database === 'up' ? 200 : 503).json({
    data: { status: database === 'up' ? 'ok' : 'degraded', database, uptimeSeconds: Math.round(process.uptime()) },
  });
}));

router.use('/auth', authRoutes);
router.use('/hospitals', hospitalRoutes);
router.use('/patients', patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/admissions', admissionRoutes);
router.use('/prescriptions', prescriptionRoutes);
router.use('/metrics', metricsRoutes);
router.use('/media', mediaRoutes);
router.use('/jobs', jobRoutes);

export default router;
