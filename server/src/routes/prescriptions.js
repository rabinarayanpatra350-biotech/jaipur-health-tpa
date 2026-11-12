import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateBody, validateQuery } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { prescriptionCreateSchema, prescriptionQuerySchema } from '../schemas.js';
import { enqueue } from '../jobs/queue.js';

const router = Router();
router.use(requireAuth);

/**
 * The e-prescription. Written by a clinician, readable by the patient it belongs
 * to. The confirmation email is enqueued in the same transaction, so a rollback
 * cannot leave a patient holding a prescription that does not exist.
 */
router.post('/', requireRole('clinician', 'admin'), validateBody(prescriptionCreateSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const out = await withTransaction(async (client) => {
    const pat = await client.query('SELECT * FROM patients WHERE id = $1', [b.patientId]);
    if (!pat.rows[0]) throw ApiError.notFound('Patient not found');

    const { rows } = await client.query(
      `INSERT INTO prescriptions (appointment_id, admission_id, patient_id, doctor_id, items, instructions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.appointmentId || null, b.admissionId || null, b.patientId, b.doctorId || null,
        JSON.stringify(b.items), b.instructions || null, req.user.id]);

    const rx = rows[0];
    const reference = `RX-${rx.id.slice(0, 8).toUpperCase()}`;
    await enqueue('prescription_issued', {
      to: 'patient@example.com',
      prescription: { reference, patientName: pat.rows[0].full_name, items: b.items, instructions: b.instructions || null },
    }, { client, dedupeKey: `rx-issued:${rx.id}` });

    return { ...rx, reference };
  });
  res.status(201).json({ data: out });
}));

router.get('/', validateQuery(prescriptionQuerySchema), asyncHandler(async (req, res) => {
  const { page, pageSize, patientId } = req.query;
  const where = []; const params = [];
  if (patientId) { params.push(patientId); where.push(`pr.patient_id = $${params.length}`); }
  if (req.user.role === 'patient') {
    params.push(req.user.id);
    where.push(`p.user_id = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(
    `SELECT count(*)::int n FROM prescriptions pr JOIN patients p ON p.id = pr.patient_id ${clause}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT pr.id, pr.issued_at AS "issuedAt", pr.items, pr.instructions,
            p.full_name AS "patientName", p.mrn AS "patientMrn", d.full_name AS "doctorName"
     FROM prescriptions pr JOIN patients p ON p.id = pr.patient_id
     LEFT JOIN doctors d ON d.id = pr.doctor_id
     ${clause} ORDER BY pr.issued_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pr.*, p.full_name AS "patientName", p.mrn AS "patientMrn", p.user_id AS "patientUserId"
     FROM prescriptions pr JOIN patients p ON p.id = pr.patient_id WHERE pr.id = $1`, [req.params.id]);
  const rx = rows[0];
  if (!rx) throw ApiError.notFound('Prescription not found');
  if (req.user.role === 'patient' && rx.patientUserId !== req.user.id) throw ApiError.forbidden();
  delete rx.patientUserId;
  res.json({ data: rx });
}));

export default router;
