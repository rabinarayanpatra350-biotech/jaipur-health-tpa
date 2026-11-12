import { startDevDb } from './devDb.js';
const db = await startDevDb({ database: 'hospital_smoke', port: 55460, dataDir: '/scratch/work/hospital/server/.pgsmoke' });
Object.assign(process.env, {
  DATABASE_URL: db.url, NODE_ENV: 'production', LOG_LEVEL: 'silent',
  JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40),
  CORS_ORIGINS: 'http://localhost:5173', MAIL_TRANSPORT: 'record',
});
const { migrate } = await import('../src/db/migrate.js');
await migrate();
await (await import('../src/etl/run.js')).runEtl();

const { createApp } = await import('../src/app.js');
const { query } = await import('../src/db/pool.js');
const bcrypt = (await import('bcryptjs')).default;
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (m, p, { body, token } = {}) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

// seed users
await query(`INSERT INTO users (email,password_hash,full_name,role) VALUES ($1,$2,'Admin','admin'),($3,$4,'Dr Rao','clinician'),($5,$6,'Patient One','patient')`,
  ['admin@example.com', await bcrypt.hash('Password12345', 10), 'dr@example.com', await bcrypt.hash('Password12345', 10), 'pat@example.com', await bcrypt.hash('Password12345', 10)]);

let r = await call('GET', '/api/health');
ok('GET /api/health', r.status === 200 && r.body.data.database === 'up', JSON.stringify(r.body.data));

r = await call('GET', '/api/hospitals');
ok('GET /api/hospitals', r.status === 200 && r.body.data.length === 4, `${r.body.data?.length} hospitals`);

const hId = r.body.data[0].id;

r = await call('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'Password12345' } });
ok('POST /api/auth/login', r.status === 200 && !!r.body.data.accessToken);
const adminToken = r.body.data.accessToken;

r = await call('POST', '/api/auth/login', { body: { email: 'pat@example.com', password: 'Password12345' } });
const patToken = r.body.data.accessToken;

r = await call('GET', '/api/patients', { token: adminToken });
ok('GET /api/patients (admin)', r.status === 200 && r.body.meta.total > 200, `${r.body.meta?.total} patients`);

r = await call('GET', '/api/patients', { token: patToken });
ok('GET /api/patients (patient) blocked', r.status === 403, `status ${r.status}`);

r = await call('GET', '/api/appointments?pageSize=5', { token: adminToken });
ok('GET /api/appointments', r.status === 200 && r.body.data.length === 5);

r = await call('GET', '/api/admissions?open=true&pageSize=3', { token: adminToken });
ok('GET /api/admissions (open stays)', r.status === 200 && r.body.data.every(a => a.dischargeDate === null), `${r.body.meta?.total} open`);

const from = '2026-01-01', to = '2026-12-31';
r = await call('GET', `/api/metrics?from=${from}&to=${to}`, { token: adminToken });
const m = r.body.data;
ok('GET /api/metrics', r.status === 200 && m.portfolio.discharges > 0,
  `ALOS ${m?.portfolio.avgLengthOfStayDays}d, occupancy ${(m?.portfolio.bedOccupancyRate * 100).toFixed(1)}%, readmission ${(m?.portfolio.readmissionRate30d * 100).toFixed(1)}%`);

r = await call('GET', `/api/metrics?from=${from}&to=${to}`, { token: patToken });
ok('metrics blocked for patient', r.status === 403);

r = await call('POST', '/api/auth/refresh', { body: { refreshToken: (await call('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'Password12345' } })).body.data.refreshToken } });
ok('POST /api/auth/refresh (rotation)', r.status === 200 && !!r.body.data.accessToken);

// create an appointment -> should enqueue a confirmation and a clinic alert
const hosp = (await call('GET', '/api/hospitals')).body.data[0];
const patList = (await call('GET', '/api/patients?pageSize=1', { token: adminToken })).body.data[0];
r = await call('POST', '/api/appointments', { token: adminToken, body: {
  hospitalId: hosp.id, patientId: patList.id, scheduledAt: '2026-12-01T10:30:00.000Z',
  durationMin: 20, status: 'scheduled', diagnosisText: 'T2DM' } });
ok('POST /api/appointments (enqueues emails)', r.status === 201 && r.body.data.diagnosisCode === 'E11.9',
   `icd10=${r.body.data?.diagnosisCode}`);

// drain the queue the way the worker does
const { createWorker } = await import('../src/jobs/worker.js');
const w = createWorker({ workerId: 'smoke' });
for (let i = 0; i < 5; i += 1) await w.tick();
ok('worker drained queue', w.counters.succeeded > 0, `${w.counters.succeeded} jobs processed`);

const jobs = await query('SELECT count(*)::int n FROM email_log');
ok('email notifications logged', jobs.rows[0].n > 0, `${jobs.rows[0].n} emails`);
const q = await query('SELECT count(*)::int n FROM jobs');
ok('job queue populated', q.rows[0].n > 0, `${q.rows[0].n} jobs`);

srv.close(); const { pool } = await import('../src/db/pool.js'); await pool.end(); db.stop(); process.exit(0);
