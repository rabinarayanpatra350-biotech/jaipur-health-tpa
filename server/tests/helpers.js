import crypto from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { query } from '../src/db/pool.js';

export { query };
export const app = createApp();
export { request };
/**
 * A unique email per call.
 *
 * This used to be `Date.now()` plus a module-level counter, which collided the
 * moment two test files loaded in separate module registries and called it in the
 * same millisecond — producing "duplicate key value violates unique constraint
 * users_email_lower_idx" and failing the build intermittently. A random UUID has
 * no such coupling to clock resolution or module lifetime.
 */
export const uniq = (p = 'x') => `${p}.${crypto.randomUUID()}@example.com`;
export const hash = (pw) => bcrypt.hash(pw, 4); // low cost: tests are not a password-storage benchmark

export async function makeUser(role = 'admin') {
  const email = uniq(role);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING *`,
    [email, await hash('Password12345'), `${role} user`, role]);
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Password12345' });
  return { user: rows[0], email, token: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
}
export const auth = (t) => ({ Authorization: `Bearer ${t}` });
export const sampleHospital = async () => (await query('SELECT * FROM hospitals ORDER BY code LIMIT 1')).rows[0];
export const samplePatient = async () => (await query('SELECT * FROM patients ORDER BY mrn LIMIT 1')).rows[0];
