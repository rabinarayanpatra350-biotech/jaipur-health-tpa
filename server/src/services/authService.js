import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';
import { signAccessToken, newRefreshToken, hashToken, refreshExpiry } from '../lib/tokens.js';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
export const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, isActive: u.is_active });

export async function signup({ email, password, fullName }) {
  const exists = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (exists.rowCount) throw ApiError.conflict('An account with that email already exists');
  // Public sign-up always creates a patient. Clinician and admin accounts are
  // created by an admin — otherwise the first person to register owns the system.
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,'patient') RETURNING *`,
    [email, await hashPassword(password), fullName],
  );
  return publicUser(rows[0]);
}

export async function login({ email, password, userAgent, ip }) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  // Constant-ish work whether or not the account exists, so timing does not reveal
  // which emails are registered.
  const ok = user ? await verifyPassword(password, user.password_hash)
    : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!user || !ok) throw ApiError.unauthorized('Email or password is incorrect');
  if (!user.is_active) throw ApiError.forbidden('This account has been deactivated');

  const familyId = crypto.randomUUID();
  const { token, hash } = newRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user.id, hash, familyId, refreshExpiry(), userAgent || null, ip || null],
  );
  return { user: publicUser(user), accessToken: signAccessToken(user), refreshToken: token };
}

/**
 * Rotating refresh with reuse detection.
 *
 * Reuse detection runs OUTSIDE the rotation transaction: revoking the family
 * inside it and then throwing would roll the revocation back, leaving the stolen
 * token's sibling alive — precisely the attack this is meant to stop.
 */
export async function refresh({ token, userAgent, ip }) {
  if (!token) throw ApiError.unauthorized('Refresh token missing');
  const hash = hashToken(token);

  const pre = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hash]);
  const preRow = pre.rows[0];
  if (!preRow) throw ApiError.unauthorized('Refresh token is not valid');
  if (preRow.revoked_at) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [preRow.family_id]);
    throw ApiError.unauthorized('Refresh token has already been used; please sign in again');
  }
  if (new Date(preRow.expires_at) < new Date()) throw ApiError.unauthorized('Refresh token has expired; please sign in again');

  return withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hash]);
    const row = found.rows[0];
    if (!row || row.revoked_at) throw ApiError.unauthorized('Refresh token has already been used; please sign in again');
    const userRes = await client.query('SELECT * FROM users WHERE id = $1', [row.user_id]);
    const user = userRes.rows[0];
    if (!user || !user.is_active) throw ApiError.forbidden('This account is no longer active');

    const { token: newToken, hash: newHash } = newRefreshToken();
    const ins = await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.id, newHash, row.family_id, refreshExpiry(), userAgent || null, ip || null],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [ins.rows[0].id, row.id]);
    return { user: publicUser(user), accessToken: signAccessToken(user), refreshToken: newToken };
  });
}

export async function logout({ token }) {
  if (!token) return { revoked: 0 };
  const { rowCount } = await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
  return { revoked: rowCount };
}

export async function getById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw ApiError.notFound('User not found');
  return publicUser(rows[0]);
}

export async function listUsers({ role }) {
  const params = []; let where = 'WHERE 1=1';
  if (role) { params.push(role); where += ` AND role = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT 200`, params);
  return rows.map(publicUser);
}

export async function setRole(id, role) {
  const { rows } = await query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING *', [role, id]);
  if (!rows[0]) throw ApiError.notFound('User not found');
  return publicUser(rows[0]);
}
