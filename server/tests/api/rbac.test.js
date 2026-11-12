import { describe, it, expect } from 'vitest';
import { app, request, makeUser, auth } from '../helpers.js';

/**
 * Role-based access is enforced in the API, not only hidden in the interface.
 * A hidden button is not an authorisation control.
 */
describe('role-based access', () => {
  it('lets an admin list patients', async () => {
    const { token } = await makeUser('admin');
    const res = await request(app).get('/api/patients').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('lets a clinician list patients', async () => {
    const { token } = await makeUser('clinician');
    const res = await request(app).get('/api/patients').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('refuses a patient the patient list', async () => {
    const { token } = await makeUser('patient');
    const res = await request(app).get('/api/patients').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('refuses a patient the metrics dashboard', async () => {
    const { token } = await makeUser('patient');
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(401);
    const authed = await request(app).get('/api/metrics').set(auth(token));
    expect(authed.status).toBe(403);
  });

  it('refuses a clinician the user-administration endpoints', async () => {
    const { token } = await makeUser('clinician');
    const res = await request(app).get('/api/auth/users').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('lets an admin create a staff account and change a role', async () => {
    const { token } = await makeUser('admin');
    const email = `staff.${Date.now()}@example.com`;
    const created = await request(app).post('/api/auth/users').set(auth(token))
      .send({ email, password: 'Password12345', fullName: 'Dr New', role: 'clinician' });
    expect(created.status).toBe(201);
    expect(created.body.data.role).toBe('clinician');

    const patched = await request(app).patch(`/api/auth/users/${created.body.data.id}/role`)
      .set(auth(token)).send({ role: 'admin' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.role).toBe('admin');
  });

  it('refuses an anonymous write to a protected resource', async () => {
    const res = await request(app).post('/api/patients').send({ mrn: 'PT-X', fullName: 'Nobody' });
    expect(res.status).toBe(401);
  });
});
