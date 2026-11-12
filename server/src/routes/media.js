import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { query } from '../db/pool.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { validateQuery } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { mediaQuerySchema } from '../schemas.js';
import config from '../config/index.js';

const router = Router();
const ALLOWED = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['application/pdf', '.pdf']]);

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _f, cb) => { await mkdir(config.uploads.dir, { recursive: true }); cb(null, config.uploads.dir); },
    // The stored name is generated, never taken from the client: a filename is
    // user input and "../../etc/passwd" is a filename.
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED.get(file.mimetype) || extname(file.originalname)}`),
  }),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.has(file.mimetype)
    ? cb(null, true) : cb(ApiError.badRequest(`Unsupported file type ${file.mimetype}. Allowed: PNG, JPEG, WebP, PDF`))),
});

router.post('/', requireAuth, requireRole('clinician', 'admin'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded (field name must be "file")');
  const entityType = req.body.entityType; const entityId = req.body.entityId;
  if (!['patient', 'hospital', 'prescription'].includes(entityType)) throw ApiError.badRequest('entityType must be patient, hospital or prescription');
  if (!entityId) throw ApiError.badRequest('entityId is required');

  const url = `${config.uploads.publicBaseUrl || ''}/uploads/${req.file.filename}`;
  const { rows } = await query(
    `INSERT INTO media (entity_type, entity_id, filename, original_name, mime_type, size_bytes, url, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [entityType, entityId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url, req.user.id]);
  res.status(201).json({ data: rows[0] });
}));

router.get('/', requireAuth, validateQuery(mediaQuerySchema), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, filename, original_name AS "originalName", mime_type AS "mimeType",
            size_bytes AS "sizeBytes", url, created_at AS "createdAt"
     FROM media WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
    [req.query.entityType, req.query.entityId]);
  res.json({ data: rows });
}));

export default router;
