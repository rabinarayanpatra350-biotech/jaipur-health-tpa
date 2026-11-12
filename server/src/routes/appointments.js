import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateBody, validateQuery } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { appointmentCreateSchema, appointmentUpdateSchema, appointmentQuerySchema } from '../schemas.js';
import { mapDiagnosis } from '../etl/icd10Map.js';
import { enqueue } from '../jobs/queue.js';
import config from '../config/index.js';

const router = Router();
router.use(requireAuth);

const SELECT = `SELECT a.id, a.scheduled_at AS "scheduledAt", a.duration_min AS "durationMin", a.status,
  a.diagnosis_text AS "diagnosisText", a.diagnosis_code AS "diagnosisCode", a.notes,
  h.id AS "hospitalId", h.name AS "hospitalName",
  p.id AS "patientId", p.mrn AS "patientMrn", p.full_name AS "patientName",
  d.full_name AS "doctorName", dep.name AS "departmentName"
  FROM appointments a
  JOIN hospitals h ON h.id = a.hospital_id
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN departments dep ON dep.id = a.department_id`;

router.get('/', validateQuery(appointmentQuerySchema), asyncHandler(async (req, res) => {
  const { page, pageSize, hospitalId, patientId, doctorId, status, from, to, q, order } = req.query;
  const where = []; const params = [];
  if (req.user.role === 'patient') {
    // A patient's own user record is linked by email; without a link they see nothing.
    params.push(req.user.id);
    where.push(`p.user_id = $${params.length}`);
  }
  if (hospitalId) { params.push(hospitalId); where.push(`a.hospital_id = $${params.length}`); }
  if (patientId) { params.push(patientId); where.push(`a.patient_id = $${params.length}`); }
  if (doctorId) { params.push(doctorId); where.push(`a.doctor_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`a.scheduled_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`a.scheduled_at < $${params.length}::date + 1`); }
  if (q) { params.push(`%${q}%`); where.push(`(p.full_name ILIKE $${params.length} OR p.mrn ILIKE $${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT count(*)::int n FROM appointments a JOIN patients p ON p.id=a.patient_id ${clause}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`${SELECT} ${clause} ORDER BY a.scheduled_at ${order}
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE a.id = $1`, [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Appointment not found');
  res.json({ data: rows[0] });
}));

/**
 * Booking an appointment. The confirmation email is enqueued INSIDE the same
 * transaction as the appointment, so a rollback cannot leave a patient holding a
 * confirmation for a booking that never existed.
 */
router.post('/', requireRole('clinician', 'admin'), validateBody(appointmentCreateSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const result = await withTransaction(async (client) => {
    const pat = await client.query('SELECT * FROM patients WHERE id = $1', [b.patientId]);
    if (!pat.rows[0]) throw ApiError.notFound('Patient not found');
    const hosp = await client.query('SELECT * FROM hospitals WHERE id = $1', [b.hospitalId]);
    if (!hosp.rows[0]) throw ApiError.notFound('Hospital not found');

    const diag = b.diagnosisText ? mapDiagnosis(b.diagnosisText) : { code: null };

    const { rows } = await client.query(
      `INSERT INTO appointments (hospital_id, department_id, doctor_id, patient_id, scheduled_at,
         duration_min, status, diagnosis_text, diagnosis_code, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b.hospitalId, b.departmentId || null, b.doctorId || null, b.patientId, b.scheduledAt,
        b.durationMin, b.status, b.diagnosisText || null, diag.code, b.notes || null, req.user.id]);

    const apptId = rows[0].id;
    const reference = `APT-${apptId.slice(0, 8).toUpperCase()}`;
    const doctorName = b.doctorId
      ? (await client.query('SELECT full_name FROM doctors WHERE id = $1', [b.doctorId])).rows[0]?.full_name : null;

    const payload = { appointment: {
      reference, patientName: pat.rows[0].full_name, hospitalName: hosp.rows[0].name,
      doctorName, departmentName: null, scheduledAt: b.scheduledAt } };

    await enqueue('appointment_confirmation', { ...payload, to: 'patient@example.com' },
      { client, dedupeKey: `appt-confirm:${apptId}` });
    await enqueue('clinic_alert', { ...payload, to: config.mail.clinicInbox },
      { client, dedupeKey: `appt-alert:${apptId}` });

    return { id: apptId, reference };
  });
  const { rows } = await query(`${SELECT} WHERE a.id = $1`, [result.id]);
  res.status(201).json({ data: { ...rows[0], reference: result.reference } });
}));

router.patch('/:id', requireRole('clinician', 'admin'), validateBody(appointmentUpdateSchema), asyncHandler(async (req, res) => {
  const sets = []; const params = [];
  if (req.body.status !== undefined) { params.push(req.body.status); sets.push(`status = $${params.length}`); }
  if (req.body.notes !== undefined) { params.push(req.body.notes); sets.push(`notes = $${params.length}`); }
  if (req.body.scheduledAt !== undefined) { params.push(req.body.scheduledAt); sets.push(`scheduled_at = $${params.length}`); }
  if (req.body.durationMin !== undefined) { params.push(req.body.durationMin); sets.push(`duration_min = $${params.length}`); }
  if (req.body.diagnosisText !== undefined) {
    params.push(req.body.diagnosisText); sets.push(`diagnosis_text = $${params.length}`);
    params.push(mapDiagnosis(req.body.diagnosisText).code); sets.push(`diagnosis_code = $${params.length}`);
  }
  params.push(req.params.id);
  const { rows } = await query(`UPDATE appointments SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${params.length} RETURNING id`, params);
  if (!rows[0]) throw ApiError.notFound('Appointment not found');
  const out = await query(`${SELECT} WHERE a.id = $1`, [req.params.id]);
  res.json({ data: out.rows[0] });
}));

export default router;
