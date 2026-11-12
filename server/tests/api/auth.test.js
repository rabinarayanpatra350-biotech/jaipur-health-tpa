import { describe, it, expect } from 'vitest';
import { app, request, uniq, makeUser, auth, query } from '../helpers.js';

describe('POST /api/auth/signup', () => {
  it('creates a patient account and never returns the password hash', async () => {
    const email = uniq('signup');
    const res = await request(app).post('/api/auth/signup')
      .send({ email, password: 'Password12345', fullName: 'Asha Rao' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email, role: 'patient' });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|passwordHash/);
  });

  it('always creates a patient, never an admin', async () => {
    const res = await request(app).post('/api/auth/signup')
      .send({ email: uniq('sneak'), password: 'Password12345', fullName: 'Sneaky', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('patient');
  });

  it('rejects a weak password', async () => {
    const res = await request(app).post('/api/auth/signup')
      .send({ email: uniq('weak'), password: 'short', fullName: 'X' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a duplicate email', async () => {
    const email = uniq('dup');
    await request(app).post('/api/auth/signup').send({ email, password: 'Password12345', fullName: 'Asha Rao' });
    const res = await request(app).post('/api/auth/signup').send({ email, password: 'Password12345', fullName: 'Asha Rao' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('returns an access token and a refresh token', async () => {
    const email = uniq('login');
    await request(app).post('/api/auth/signup').send({ email, password: 'Password12345', fullName: 'Asha Rao' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'Password12345' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const email = uniq('enum');
    await request(app).post('/api/auth/signup').send({ email, password: 'Password12345', fullName: 'Asha Rao' });
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' });
    const missing = await request(app).post('/api/auth/login').send({ email: uniq('ghost'), password: 'Password12345' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the token and issues a new access token', async () => {
    const { refreshToken } = await makeUser('clinician');
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('detects reuse of a burned token and revokes the whole family', async () => {
    const { refreshToken } = await makeUser('clinician');
    const first = await request(app).post('/api/auth/refresh').send({ refreshToken });
    const rotated = first.body.data.refreshToken;

    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);

    // the family is dead: the rotated token must not work either
    const after = await request(app).post('/api/auth/refresh').send({ refreshToken: rotated });
    expect(after.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-token-at-all' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the caller and refuses an anonymous request', async () => {
    const { token, email } = await makeUser('admin');
    const ok = await request(app).get('/api/auth/me').set(auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe(email);
    const no = await request(app).get('/api/auth/me');
    expect(no.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const { token } = await makeUser('admin');
    const res = await request(app).get('/api/auth/me').set(auth(token.slice(0, -4) + 'aaaa'));
    expect(res.status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes the presented refresh token', async () => {
    const { refreshToken } = await makeUser('patient');
    const out = await request(app).post('/api/auth/logout').send({ refreshToken });
    expect(out.status).toBe(200);
    const after = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(after.status).toBe(401);
  });
});
