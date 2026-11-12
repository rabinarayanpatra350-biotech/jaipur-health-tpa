import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export const signAccessToken = (user) => jwt.sign(
  { sub: user.id, role: user.role, email: user.email }, config.jwt.accessSecret,
  { expiresIn: config.jwt.accessTtl, issuer: config.jwt.issuer, audience: 'hospital-api' },
);

export const verifyAccessToken = (token) => jwt.verify(token, config.jwt.accessSecret, {
  issuer: config.jwt.issuer, audience: 'hospital-api',
});

// Refresh tokens are opaque, not JWTs: an opaque token can be revoked the instant
// it is used, whereas a self-contained JWT stays valid until it expires.
export function newRefreshToken() {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export function refreshExpiry() { const d = new Date(); d.setDate(d.getDate() + config.jwt.refreshTtlDays); return d; }
