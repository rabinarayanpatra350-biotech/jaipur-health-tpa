import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateBody, validateQuery } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { admissionCreateSchema, admissionUpdateSchema, admissionQuerySchema } from '../schemas.js';
import { mapDiagnosis } from '../etl/icd10Map.js';

const router = Router();
router.use(requireAuth);

const SELECT = `SELECT a.id, a.admitted_at AS "admittedAt", a.discharge_date AS "dischargeDate",
  a.discharge_disposition AS "dischargeDisposition", a.diagnosis_text AS "diagnosisText",
  a.diagnosis_code AS "diagnosisCode",
  CASE WHEN a.discharge_date IS NULL THEN NULL ELSE (a.discharge_date - a.admitted_at::date) END AS "lengthOfStayDays",
  h.id AS "hospitalId", h.name AS "hospitalName",
  p.id AS "patientId", p.mrn AS "patientMrn", p.full_name AS "patientName",
  dep.name AS "departmentName"
  FROM admissions a
  JOIN hospitals h ON h.id = a.hospital_id
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN departments dep ON dep.id = a.department_id`;

router.get('/', requireRole('clinician', 'admin'), validateQuery(admissionQuerySchema), asyncHandler(async (req, res) => {
  const { page, pageSize, hospitalId, patientId, open, from, to } = req.query;
  const where = []; const params = [];
  if (hospitalId) { params.push(hospitalId); where.push(`a.hospital_id = $${params.length}`); }
  if (patientId) { params.push(patientId); where.push(`a.patient_id = $${params.length}`); }
  if (open === 'true') where.push('a.discharge_date IS NULL');
  if (open === 'false') where.push('a.discharge_date IS NOT NULL');
  if (from) { params.push(from); where.push(`a.admitted_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`a.admitted_at < $${params.length}::date + 1`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT count(*)::int n FROM admissions a ${clause}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`${SELECT} ${clause} ORDER BY a.admitted_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE a.id = $1`, [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Admission not found');
  res.json({ data: rows[0] });
}));

router.post('/', requireRole('clinician', 'admin'), validateBody(admissionCreateSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const hosp = await query('SELECT id FROM hospitals WHERE id = $1', [b.hospitalId]);
  if (!hosp.rowCount) throw ApiError.notFound('Hospital not found');
  const diag = b.diagnosisText ? mapDiagnosis(b.diagnosisText) : { code: null };
  const { rows } = await query(
    `INSERT INTO admissions (hospital_id, department_id, patient_id, bed_id, admitted_at,
       discharge_date, discharge_disposition, diagnosis_text, diagnosis_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [b.hospitalId, b.departmentId || null, b.patientId, b.bedId || null, b.admittedAt,
      b.dischargeDate || null, b.dischargeDisposition || null, b.diagnosisText || null, diag.code]);
  const out = await query(`${SELECT} WHERE a.id = $1`, [rows[0].id]);
  res.status(201).json({ data: out.rows[0] });
}));

/** Discharging a patient. This is the write that turns an open stay into a
 *  measurable length of stay, so the date is validated against admission here and
 *  again by a database CHECK constraint. */
router.patch('/:id', requireRole('clinician', 'admin'), validateBody(admissionUpdateSchema), asyncHandler(async (req, res) => {
  const sets = []; const params = [];
  if (req.body.dischargeDate !== undefined) { params.push(req.body.dischargeDate); sets.push(`discharge_date = $${params.length}`); }
  if (req.body.dischargeDisposition !== undefined) { params.push(req.body.dischargeDisposition); sets.push(`discharge_disposition = $${params.length}`); }
  if (req.body.diagnosisText !== undefined) {
    params.push(req.body.diagnosisText); sets.push(`diagnosis_text = $${params.length}`);
    params.push(mapDiagnosis(req.body.diagnosisText).code); sets.push(`diagnosis_code = $${params.length}`);
  }
  params.push(req.params.id);
  const { rows } = await query(`UPDATE admissions SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${params.length} RETURNING id`, params);
  if (!rows[0]) throw ApiError.notFound('Admission not found');
  const out = await query(`${SELECT} WHERE a.id = $1`, [req.params.id]);
  res.json({ data: out.rows[0] });
}));

export default router;
