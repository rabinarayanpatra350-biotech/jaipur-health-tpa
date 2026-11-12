import { query } from '../db/queryCompat.js';

/**
 * Average length of stay, bed occupancy and 30-day readmission.
 *
 * These three are defined once, here, and every consumer — the dashboard, the API
 * tests and the written report — reads the same definitions, so they cannot drift
 * apart.
 *
 * The decisions that change the numbers, stated rather than buried:
 *
 *  1. A stay still open has no length. It is EXCLUDED from average length of stay
 *     (dividing by an invented discharge date would understate the average) and
 *     INCLUDED in bed occupancy, because the bed is genuinely occupied today.
 *  2. Occupancy is measured against licensed beds, not staffed beds, because that
 *     is the figure the TPA is contracted on.
 *  3. A readmission is counted at any hospital in the group, not just the same
 *     one — the whole point of a TPA looking across four providers is that a
 *     patient discharged from SMS and readmitted at Fortis is still a readmission.
 *  4. Cancelled and no-show appointments never count anywhere.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

export async function computeMetrics({ hospitalId, from, to }) {
  const params = [from, to];
  let hospFilter = '';
  if (hospitalId) { params.push(hospitalId); hospFilter = ` AND h.id = $${params.length}`; }

  const nights = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

  // ---- average length of stay: closed stays discharged inside the window
  const los = await query(
    `SELECT h.id AS hospital_id, h.code, h.name, h.beds,
            COUNT(a.id)::int AS discharges,
            COALESCE(SUM(a.discharge_date - a.admitted_at::date), 0)::int AS total_bed_days,
            COALESCE(AVG(a.discharge_date - a.admitted_at::date), 0) AS avg_los
     FROM hospitals h
     LEFT JOIN admissions a
       ON a.hospital_id = h.id
      AND a.discharge_date IS NOT NULL
      AND a.discharge_date >= $1::date AND a.discharge_date < $2::date
     WHERE h.is_active ${hospFilter}
     GROUP BY h.id, h.code, h.name, h.beds
     ORDER BY h.name`,
    params,
  );

  // ---- bed occupancy: bed-days actually occupied inside the window
  // An open stay occupies every night from admission to the end of the window.
  const occ = await query(
    `WITH nights AS (
       SELECT d::date AS stay_date FROM generate_series($1::date, $2::date - INTERVAL '1 day', INTERVAL '1 day') AS d
     ),
     occupied AS (
       -- One row per admission per night: that IS a bed-day. Grouping by
       -- (hospital, date) instead would collapse every occupied bed on a night
       -- into a single row and cap occupancy at hospitals x days.
       SELECT a.hospital_id, a.id AS admission_id, n.stay_date
       FROM admissions a
       JOIN nights n
         ON n.stay_date >= a.admitted_at::date
        AND n.stay_date < COALESCE(a.discharge_date, $2::date)
     )
     SELECT hospital_id, COUNT(*)::int AS occupied_bed_days
     FROM occupied GROUP BY hospital_id`,
    [from, to],
  );
  const occByHospital = new Map(occ.rows.map(r => [r.hospital_id, r.occupied_bed_days]));

  // ---- 30-day readmission, across the whole group
  const readm = await query(
    `WITH discharges AS (
       SELECT a.id, a.hospital_id, a.patient_id, a.discharge_date
       FROM admissions a
       WHERE a.discharge_date IS NOT NULL
         AND a.discharge_date >= $1::date AND a.discharge_date < $2::date
     ),
     next_adm AS (
       SELECT d.id, d.hospital_id,
              (SELECT MIN(b.admitted_at::date) FROM admissions b
                WHERE b.patient_id = d.patient_id AND b.id <> d.id
                  AND b.admitted_at::date > d.discharge_date) AS next_on
       FROM discharges d
     )
     SELECT hospital_id,
            COUNT(*)::int AS discharges,
            COUNT(*) FILTER (WHERE next_on IS NOT NULL AND next_on - (SELECT discharge_date FROM discharges x WHERE x.id = next_adm.id) <= 30)::int AS readmitted_30d
     FROM next_adm GROUP BY hospital_id`,
    [from, to],
  );
  const readmByHospital = new Map(readm.rows.map(r => [r.hospital_id, r]));

  const rows = los.rows.map((r) => {
    const occupiedBedDays = occByHospital.get(r.hospital_id) || 0;
    const availableBedDays = r.beds * nights;
    const rm = readmByHospital.get(r.hospital_id) || { discharges: r.discharges, readmitted_30d: 0 };
    return {
      hospitalId: r.hospital_id,
      hospitalCode: r.code,
      hospitalName: r.name,
      licensedBeds: r.beds,
      discharges: r.discharges,
      totalBedDays: r.total_bed_days,
      avgLengthOfStayDays: round2(r.avg_los),
      occupiedBedDays,
      availableBedDays,
      bedOccupancyRate: availableBedDays > 0 ? round4(occupiedBedDays / availableBedDays) : 0,
      readmitted30d: rm.readmitted_30d,
      readmissionRate30d: rm.discharges > 0 ? round4(rm.readmitted_30d / rm.discharges) : 0,
    };
  });

  const T = rows.reduce((a, r) => ({
    discharges: a.discharges + r.discharges,
    totalBedDays: a.totalBedDays + r.totalBedDays,
    occupiedBedDays: a.occupiedBedDays + r.occupiedBedDays,
    availableBedDays: a.availableBedDays + r.availableBedDays,
    readmitted30d: a.readmitted30d + r.readmitted30d,
  }), { discharges: 0, totalBedDays: 0, occupiedBedDays: 0, availableBedDays: 0, readmitted30d: 0 });

  const portfolio = {
    discharges: T.discharges,
    totalBedDays: T.totalBedDays,
    avgLengthOfStayDays: T.discharges > 0 ? round2(T.totalBedDays / T.discharges) : 0,
    occupiedBedDays: T.occupiedBedDays,
    availableBedDays: T.availableBedDays,
    bedOccupancyRate: T.availableBedDays > 0 ? round4(T.occupiedBedDays / T.availableBedDays) : 0,
    readmitted30d: T.readmitted30d,
    readmissionRate30d: T.discharges > 0 ? round4(T.readmitted30d / T.discharges) : 0,
  };

  // ---- a few supporting counts that make the headline numbers interpretable
  const extra = await query(
    `SELECT
       (SELECT count(*)::int FROM appointments ap JOIN hospitals h ON h.id = ap.hospital_id
         WHERE ap.scheduled_at >= $1::date AND ap.scheduled_at < $2::date
           AND ap.status NOT IN ('cancelled','no_show') ${hospFilter}) AS opd_visits,
       (SELECT count(*)::int FROM admissions a JOIN hospitals h ON h.id = a.hospital_id
         WHERE a.discharge_date IS NULL ${hospFilter}) AS currently_admitted,
       (SELECT count(*)::int FROM appointments ap JOIN hospitals h ON h.id = ap.hospital_id
         WHERE ap.scheduled_at >= $1::date AND ap.scheduled_at < $2::date AND ap.diagnosis_code IS NULL
           ${hospFilter}) AS uncoded_visits`,
    params,
  );

  return {
    window: { from, to, days: nights },
    portfolio,
    hospitals: rows,
    supporting: extra.rows[0],
  };
}

/** Daily bed-occupancy series for one hospital, for the dashboard chart. */
export async function occupancySeries({ hospitalId, from, to }) {
  const { rows } = await query(
    `WITH nights AS (
       SELECT d::date AS stay_date FROM generate_series($2::date, $3::date - INTERVAL '1 day', INTERVAL '1 day') AS d
     ),
     occ AS (
       SELECT n.stay_date, COUNT(a.id)::int AS occupied
       FROM nights n
       LEFT JOIN admissions a
         ON n.stay_date >= a.admitted_at::date AND n.stay_date < COALESCE(a.discharge_date, $3::date)
        AND a.hospital_id = $1
       GROUP BY n.stay_date
     ),
     beds AS (SELECT beds FROM hospitals WHERE id = $1)
     SELECT o.stay_date, o.occupied, (SELECT beds FROM beds) AS licensed_beds
     FROM occ o ORDER BY o.stay_date`,
    [hospitalId, from, to],
  );
  return rows.map(r => ({
    date: r.stay_date,
    occupiedBeds: r.occupied,
    licensedBeds: r.licensed_beds,
    occupancyRate: r.licensed_beds > 0 ? round4(r.occupied / r.licensed_beds) : 0,
  }));
}
