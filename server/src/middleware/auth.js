import { verifyAccessToken } from '../lib/tokens.js';
import { ApiError } from '../lib/errors.js';
import { query } from '../db/pool.js';

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

export async function requireAuth(req, _res, next) {
  try {
    const token = bearer(req) || req.cookies?.accessToken;
    if (!token) throw ApiError.unauthorized('Authentication required');
    let payload;
    try { payload = verifyAccessToken(token); }
    catch { throw ApiError.unauthorized('Access token is invalid or has expired'); }
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const u = rows[0];
    if (!u || !u.is_active) throw ApiError.unauthorized('Account is not active');
    req.user = { id: u.id, email: u.email, role: u.role, fullName: u.full_name };
    next();
  } catch (e) { next(e); }
}

export async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();
  try {
    const p = verifyAccessToken(token);
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [p.sub]);
    if (rows[0]?.is_active) req.user = { id: rows[0].id, email: rows[0].email, role: rows[0].role, fullName: rows[0].full_name };
  } catch { /* anonymous */ }
  next();
}

/** Role gate. `patient` < `clinician` < `admin`. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden(`This action requires: ${roles.join(' or ')}`));
  next();
};
