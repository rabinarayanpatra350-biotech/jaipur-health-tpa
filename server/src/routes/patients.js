import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { patientCreateSchema, patientUpdateSchema, patientQuerySchema } from '../schemas.js';

const router = Router();
router.use(requireAuth);

// A patient may only read their own record; clinicians and admins see all.
const scoped = (req) => (req.user.role === 'patient' ? req.user.id : null);

router.get('/', requireRole('clinician', 'admin'), validateQuery(patientQuerySchema), asyncHandler(async (req, res) => {
  const { page, pageSize, q, mrn, sort, order } = req.query;
  const where = ['p.merged_into IS NULL']; const params = [];
  if (q) { params.push(`%${q}%`); where.push(`p.full_name ILIKE $${params.length}`); }
  if (mrn) { params.push(mrn.toUpperCase()); where.push(`p.mrn = $${params.length}`); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (await query(`SELECT count(*)::int n FROM patients p ${clause}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT p.id, p.mrn, p.full_name AS "fullName", p.date_of_birth AS "dateOfBirth", p.gender, p.phone, p.city,
            (SELECT count(*)::int FROM appointments a WHERE a.patient_id = p.id) AS appointments,
            (SELECT count(*)::int FROM admissions a WHERE a.patient_id = p.id) AS admissions
     FROM patients p ${clause} ORDER BY ${sort === 'full_name' ? 'p.full_name' : `p.${sort}`} ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
  const p = rows[0];
  if (!p) throw ApiError.notFound('Patient not found');
  if (req.user.role === 'patient' && p.id !== scoped(req)) throw ApiError.forbidden();

  const [appts, adms, rxs] = await Promise.all([
    query(`SELECT a.id, a.scheduled_at, a.status, a.diagnosis_code, a.diagnosis_text, h.name AS hospital
           FROM appointments a JOIN hospitals h ON h.id = a.hospital_id
           WHERE a.patient_id = $1 ORDER BY a.scheduled_at DESC LIMIT 20`, [p.id]),
    query(`SELECT a.id, a.admitted_at, a.discharge_date, a.diagnosis_code, h.name AS hospital
           FROM admissions a JOIN hospitals h ON h.id = a.hospital_id
           WHERE a.patient_id = $1 ORDER BY a.admitted_at DESC LIMIT 20`, [p.id]),
    query(`SELECT id, issued_at, items FROM prescriptions WHERE patient_id = $1 ORDER BY issued_at DESC LIMIT 10`, [p.id]),
  ]);
  res.json({ data: { ...p, appointments: appts.rows, admissions: adms.rows, prescriptions: rxs.rows } });
}));

router.post('/', requireRole('clinician', 'admin'), validateBody(patientCreateSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO patients (mrn, full_name, date_of_birth, gender, phone, city)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.mrn.toUpperCase(), b.fullName, b.dateOfBirth || null, b.gender || null, b.phone || null, b.city || null]);
  res.status(201).json({ data: rows[0] });
}));

router.patch('/:id', requireRole('clinician', 'admin'), validateBody(patientUpdateSchema), asyncHandler(async (req, res) => {
  const map = { fullName: 'full_name', dateOfBirth: 'date_of_birth', gender: 'gender', phone: 'phone', city: 'city' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) throw ApiError.badRequest('Nothing to update');
  params.push(req.params.id);
  const { rows } = await query(`UPDATE patients SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw ApiError.notFound('Patient not found');
  res.json({ data: rows[0] });
}));

export default router;
