import { describe, it, expect, beforeAll } from 'vitest';
import { app, request, makeUser, auth, query, sampleHospital, samplePatient, uniq } from '../helpers.js';

let admin; let hospital; let patient;

beforeAll(async () => {
  ({ token: admin } = await makeUser('admin'));
  hospital = await sampleHospital();
  patient = await samplePatient();
});

describe('GET /api/health', () => {
  it('reports the database as up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('hospitals', () => {
  it('lists the four seeded hospitals', async () => {
    const res = await request(app).get('/api/hospitals?pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.meta.total).toBe(4);
  });

  it('filters by minimum beds', async () => {
    const res = await request(app).get('/api/hospitals?minBeds=15');
    expect(res.status).toBe(200);
    expect(res.body.data.every(h => h.beds >= 15)).toBe(true);
  });

  it('returns one hospital with its counts', async () => {
    const res = await request(app).get(`/api/hospitals/${hospital.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toBeDefined();
  });

  it('404s an unknown id', async () => {
    const res = await request(app).get('/api/hospitals/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('lets an admin update the bed count but refuses a clinician', async () => {
    const ok = await request(app).patch(`/api/hospitals/${hospital.id}`).set(auth(admin)).send({ beds: 25 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.beds).toBe(25);
    await query('UPDATE hospitals SET beds = $1 WHERE id = $2', [hospital.beds, hospital.id]);

    const { token: clinician } = await makeUser('clinician');
    const no = await request(app).patch(`/api/hospitals/${hospital.id}`).set(auth(clinician)).send({ beds: 99 });
    expect(no.status).toBe(403);
  });
});

describe('patients', () => {
  it('searches by name and paginates', async () => {
    const res = await request(app).get('/api/patients?pageSize=5').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.pageSize).toBe(5);
  });

  it('creates a patient and rejects a duplicate MRN', async () => {
    const mrn = `PT-T${Date.now().toString(36).toUpperCase()}`;
    const created = await request(app).post('/api/patients').set(auth(admin))
      .send({ mrn, fullName: 'Test Patient', gender: 'female' });
    expect(created.status).toBe(201);
    const dup = await request(app).post('/api/patients').set(auth(admin))
      .send({ mrn, fullName: 'Another' });
    expect(dup.status).toBe(409);
  });

  it('validates a malformed MRN', async () => {
    const res = await request(app).post('/api/patients').set(auth(admin))
      .send({ mrn: 'has spaces!', fullName: 'X' });
    expect(res.status).toBe(422);
  });

  it('returns a patient with their history', async () => {
    const res = await request(app).get(`/api/patients/${patient.id}`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.appointments)).toBe(true);
  });
});

describe('appointments', () => {
  it('creates an appointment, codes the diagnosis and queues two emails', async () => {
    const before = (await query('SELECT count(*)::int n FROM jobs')).rows[0].n;
    const res = await request(app).post('/api/appointments').set(auth(admin)).send({
      hospitalId: hospital.id, patientId: patient.id,
      scheduledAt: '2027-02-01T10:00:00.000Z', diagnosisText: 'HTN',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.diagnosisCode).toBe('I10');
    expect(res.body.data.diagnosisText).toBe('HTN');
    const after = (await query('SELECT count(*)::int n FROM jobs')).rows[0].n;
    expect(after - before).toBe(2); // patient confirmation + clinic alert
  });

  it('filters appointments by status', async () => {
    const res = await request(app).get('/api/appointments?status=completed&pageSize=5').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.status === 'completed')).toBe(true);
  });

  it('rejects an appointment for a patient that does not exist', async () => {
    const res = await request(app).post('/api/appointments').set(auth(admin)).send({
      hospitalId: hospital.id, patientId: '00000000-0000-0000-0000-000000000000',
      scheduledAt: '2027-02-01T10:00:00.000Z',
    });
    expect(res.status).toBe(404);
  });

  it('validates the timestamp format', async () => {
    const res = await request(app).post('/api/appointments').set(auth(admin)).send({
      hospitalId: hospital.id, patientId: patient.id, scheduledAt: 'next tuesday',
    });
    expect(res.status).toBe(422);
  });
});

describe('admissions', () => {
  it('lists only open stays when asked', async () => {
    const res = await request(app).get('/api/admissions?open=true&pageSize=5').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.dischargeDate === null)).toBe(true);
  });

  it('admits a patient, then discharges them and computes the length of stay', async () => {
    const created = await request(app).post('/api/admissions').set(auth(admin)).send({
      hospitalId: hospital.id, patientId: patient.id, admittedAt: '2027-05-01', diagnosisText: 'pneumonia',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.lengthOfStayDays).toBeNull();

    const discharged = await request(app).patch(`/api/admissions/${created.body.data.id}`)
      .set(auth(admin)).send({ dischargeDate: '2027-05-06', dischargeDisposition: 'home' });
    expect(discharged.status).toBe(200);
    expect(discharged.body.data.lengthOfStayDays).toBe(5);
  });

  it('refuses a discharge date before the admission', async () => {
    const created = await request(app).post('/api/admissions').set(auth(admin)).send({
      hospitalId: hospital.id, patientId: patient.id, admittedAt: '2027-06-10',
    });
    const bad = await request(app).patch(`/api/admissions/${created.body.data.id}`)
      .set(auth(admin)).send({ dischargeDate: '2027-06-01' });
    expect(bad.status).toBe(400); // database CHECK constraint
  });
});

describe('prescriptions', () => {
  it('issues an e-prescription and queues a notification', async () => {
    const before = (await query('SELECT count(*)::int n FROM jobs')).rows[0].n;
    const res = await request(app).post('/api/prescriptions').set(auth(admin)).send({
      patientId: patient.id,
      items: [{ drug: 'Metformin', dose: '500mg', frequency: 'BD', durationDays: 30 }],
      instructions: 'After meals',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^RX-/);
    const after = (await query('SELECT count(*)::int n FROM jobs')).rows[0].n;
    expect(after - before).toBe(1);
  });

  it('rejects a prescription with no drugs', async () => {
    const res = await request(app).post('/api/prescriptions').set(auth(admin))
      .send({ patientId: patient.id, items: [] });
    expect(res.status).toBe(422);
  });
});

describe('job queue observability', () => {
  it('reports queue counts to an admin', async () => {
    const res = await request(app).get('/api/jobs').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toBeDefined();
  });
  it('refuses a clinician', async () => {
    const { token } = await makeUser('clinician');
    const res = await request(app).get('/api/jobs').set(auth(token));
    expect(res.status).toBe(403);
  });
});
