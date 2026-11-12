import { describe, it, expect, beforeAll } from 'vitest';
import { app, request, makeUser, auth, query, uniq } from '../helpers.js';

/**
 * Occupancy, average length of stay and 30-day readmission, checked against
 * figures worked out by hand. If the definitions in metricsService.js ever drift,
 * these fail.
 *
 * Scenario — one hospital, 10 licensed beds, window 2027-01-01 .. 2027-01-11 (10 nights)
 *   available bed-days          = 10 beds x 10 nights           = 100
 *   A  admit 01-01, discharge 01-06  (5 nights)  open bed-days  = 5
 *   B  admit 01-03, discharge 01-05  (2 nights)  open bed-days  = 2
 *   C  admit 01-04, still admitted  (open stay)  bed-days to 01-11 = 7
 *   D  readmission of A: admit 01-20, discharge 01-25 -> gap 14 days from A
 *   E  admission of B 60 days later -> NOT a 30-day readmission
 *
 *   occupied bed-days (within window) = 5 + 2 + 7 = 14   -> occupancy 14/100 = 0.14
 *   discharges in window              = 2 (A and B)      -> ALOS (5+2)/2 = 3.5
 *   30-day readmissions               = 1 of 2 (A)       -> 0.5
 */
let token; let hospitalId; let patientA; let patientB; let patientC;

beforeAll(async () => {
  ({ token } = await makeUser('admin'));
  const h = await query(
    `INSERT INTO hospitals (code, name, city, beds) VALUES ($1,'Metrics Test Hospital','Jaipur',10) RETURNING id`,
    [`MTH${Date.now().toString(36).toUpperCase()}`]);
  hospitalId = h.rows[0].id;

  const mk = async (name) => (await query(
    `INSERT INTO patients (mrn, full_name) VALUES ($1,$2) RETURNING id`,
    [`MT-${Math.random().toString(36).slice(2, 9).toUpperCase()}`, name])).rows[0].id;

  patientA = await mk('Patient A');
  patientB = await mk('Patient B');
  patientC = await mk('Patient C');

  const admit = (pid, from, to) => query(
    `INSERT INTO admissions (hospital_id, patient_id, admitted_at, discharge_date)
     VALUES ($1,$2,$3,$4)`, [hospitalId, pid, `${from}T09:00:00Z`, to]);

  await admit(patientA, '2027-01-01', '2027-01-06'); // 5 nights
  await admit(patientB, '2027-01-03', '2027-01-05'); // 2 nights
  await admit(patientC, '2027-01-04', null);         // open stay
  await admit(patientA, '2027-01-20', '2027-01-25'); // readmission of A, 14-day gap
  await admit(patientB, '2027-03-06', '2027-03-10'); // 60 days later: not a readmission
});

describe('GET /api/metrics', () => {
  it('computes occupancy, ALOS and 30-day readmission as defined', async () => {
    const res = await request(app)
      .get(`/api/metrics?from=2027-01-01&to=2027-01-11&hospitalId=${hospitalId}`)
      .set(auth(token));
    expect(res.status).toBe(200);

    const p = res.body.data.portfolio;
    expect(p.availableBedDays).toBe(100);       // 10 beds x 10 nights
    expect(p.occupiedBedDays).toBe(14);         // 5 + 2 + 7
    expect(p.bedOccupancyRate).toBeCloseTo(0.14, 4);
    expect(p.discharges).toBe(2);               // A and B; C is still admitted
    expect(p.totalBedDays).toBe(7);             // 5 + 2
    expect(p.avgLengthOfStayDays).toBeCloseTo(3.5, 2);
    expect(p.readmitted30d).toBe(1);            // only A
    expect(p.readmissionRate30d).toBeCloseTo(0.5, 4);
  });

  it('excludes an open stay from length of stay but includes it in occupancy', async () => {
    const res = await request(app)
      .get(`/api/metrics?from=2027-01-01&to=2027-01-11&hospitalId=${hospitalId}`)
      .set(auth(token));
    const p = res.body.data.portfolio;
    // C contributes 7 occupied bed-days but no discharge and no bed-days of length
    expect(p.occupiedBedDays).toBeGreaterThan(p.totalBedDays);
    expect(p.discharges).toBe(2);
  });

  it('reports the window it actually used', async () => {
    const res = await request(app)
      .get(`/api/metrics?from=2027-01-01&to=2027-01-11&hospitalId=${hospitalId}`)
      .set(auth(token));
    expect(res.body.data.window).toMatchObject({ from: '2027-01-01', to: '2027-01-11', days: 10 });
  });

  it('returns per-hospital rows alongside the portfolio total', async () => {
    const res = await request(app).get('/api/metrics?from=2027-01-01&to=2027-01-11').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.hospitals.length).toBeGreaterThanOrEqual(4);
    expect(res.body.data.portfolio).toBeDefined();
  });

  it('rejects an inverted window', async () => {
    const res = await request(app).get('/api/metrics?from=2027-01-11&to=2027-01-01').set(auth(token));
    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/metrics/:id/occupancy', () => {
  it('returns a daily series whose occupied beds never exceed licensed beds', async () => {
    const res = await request(app)
      .get(`/api/metrics/${hospitalId}/occupancy?from=2027-01-01&to=2027-01-11`)
      .set(auth(token));
    expect(res.status).toBe(200);
    const series = res.body.data.series;
    expect(series).toHaveLength(10);
    for (const d of series) {
      expect(d.occupiedBeds).toBeLessThanOrEqual(d.licensedBeds);
      expect(d.occupancyRate).toBeGreaterThanOrEqual(0);
      expect(d.occupancyRate).toBeLessThanOrEqual(1);
    }
    // 01-04 has all three patients in house
    const jan4 = series.find(d => d.date === '2027-01-04');
    expect(jan4.occupiedBeds).toBe(3);
  });
});
