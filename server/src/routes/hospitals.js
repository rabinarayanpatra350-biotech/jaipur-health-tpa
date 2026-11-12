import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hospitalQuerySchema, hospitalUpdateSchema } from '../schemas.js';

const router = Router();

router.get('/', validateQuery(hospitalQuerySchema), asyncHandler(async (req, res) => {
  const { page, pageSize, q, city, minBeds, sort, order } = req.query;
  const where = ['is_active']; const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`); }
  if (city) { params.push(city); where.push(`city = $${params.length}`); }
  if (minBeds !== undefined) { params.push(minBeds); where.push(`beds >= $${params.length}`); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (await query(`SELECT count(*)::int n FROM hospitals ${clause}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT id, code, name, city, beds, is_active AS "isActive", created_at AS "createdAt"
     FROM hospitals ${clause} ORDER BY ${sort} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM hospitals WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Hospital not found');
  const counts = await query(
    `SELECT (SELECT count(*)::int FROM doctors WHERE hospital_id=$1) AS doctors,
            (SELECT count(*)::int FROM admissions WHERE hospital_id=$1) AS admissions,
            (SELECT count(*)::int FROM appointments WHERE hospital_id=$1) AS appointments`, [req.params.id]);
  res.json({ data: { ...rows[0], counts: counts.rows[0] } });
}));

router.patch('/:id', requireAuth, requireRole('admin'), validateBody(hospitalUpdateSchema), asyncHandler(async (req, res) => {
  const map = { name: 'name', city: 'city', beds: 'beds', isActive: 'is_active' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${col} = $${params.length}`); }
  }
  params.push(req.params.id);
  const { rows } = await query(`UPDATE hospitals SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw ApiError.notFound('Hospital not found');
  res.json({ data: rows[0] });
}));

export default router;
