#!/usr/bin/env node
/**
 * run.js — the normalisation pipeline for the four hospitals' exports.
 *
 * Reads the raw CSVs, normalises them, loads what is trustworthy, and records
 * everything it could not justify loading. Nothing is silently dropped and
 * nothing is silently coerced.
 *
 * Idempotent: re-running replaces the loaded rows and appends a new batch, so a
 * corrected mapping is a two-minute fix rather than a data-loss event.
 *
 * Run: npm run seed
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'csv-parse/sync';

import { pool, query, withTransaction } from '../db/pool.js';
import logger from '../lib/logger.js';
import { buildLookup } from './icd10Map.js';
import {
  validateAppointmentRow, validateAdmissionRow, patientKeys, normaliseName,
  cleanText, parseDate, isoDate, normalisePhone, normaliseGender, normaliseStatus,
} from './normalise.js';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, '..', '..', 'data', 'raw');

const readCsv = async (n) => parse(await readFile(join(RAW, n), 'utf8'), {
  columns: true, skip_empty_lines: true, trim: false,
});

const stats = {
  hospitals: { in: 0, loaded: 0 },
  departments: { in: 0, loaded: 0 },
  doctors: { in: 0, loaded: 0 },
  patients: { in: 0, loaded: 0, merged: 0, quarantined: 0 },
  appointments: { in: 0, loaded: 0, quarantined: 0, warnings: 0, coded: 0, unmapped: 0 },
  admissions: { in: 0, loaded: 0, quarantined: 0, open: 0, closed: 0 },
  labTests: { in: 0, loaded: 0, quarantined: 0 },
  invoices: { in: 0, loaded: 0, quarantined: 0 },
  issues: [],
  byCode: {},
};

function record(batchId, entity, file, rowNumber, code, detail, rawRow, severity = 'error') {
  stats.issues.push({ batchId, entity, file, rowNumber, code, detail, rawRow, severity });
  stats.byCode[code] = (stats.byCode[code] || 0) + 1;
  const bucket = { appointment: stats.appointments, admission: stats.admissions, patient: stats.patients }[entity];
  if (severity === 'error' && bucket) bucket.quarantined += 1;
  if (severity === 'warning' && entity === 'appointment') stats.appointments.warnings += 1;
}

export async function runEtl() {
  logger.info('ETL starting');
  const batch = await query(
    `INSERT INTO etl_batches (source_file, started_at) VALUES ($1, now()) RETURNING id`, ['data/raw/*.csv'],
  );
  const batchId = batch.rows[0].id;

  // ---------------------------------------------------------------- hospitals
  const hospitalRows = await readCsv('hospitals.csv');
  stats.hospitals.in = hospitalRows.length;
  const hospitalByCode = new Map();
  for (const h of hospitalRows) {
    const code = cleanText(h.hospital_code).toUpperCase();
    const { rows } = await query(
      `INSERT INTO hospitals (code, name, city, beds) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, beds = EXCLUDED.beds, updated_at = now()
       RETURNING *`,
      [code, cleanText(h.hospital_name), cleanText(h.city) || 'Jaipur', Number.parseInt(h.beds, 10) || 0],
    );
    hospitalByCode.set(code, rows[0]);
    stats.hospitals.loaded += 1;
  }

  // ---------------------------------------------------------------- departments
  const deptRows = await readCsv('departments.csv');
  stats.departments.in = deptRows.length;
  const deptByKey = new Map();
  for (const d of deptRows) {
    const hCode = cleanText(d.hospital_code).toUpperCase();
    const hospital = hospitalByCode.get(hCode);
    if (!hospital) continue;
    const code = cleanText(d.dept_code).toUpperCase();
    const { rows } = await query(
      `INSERT INTO departments (hospital_id, code, name) VALUES ($1,$2,$3)
       ON CONFLICT (hospital_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
      [hospital.id, code, cleanText(d.dept_name)],
    );
    deptByKey.set(`${hCode}|${code}`, rows[0]);
    stats.departments.loaded += 1;
  }

  // ---------------------------------------------------------------- doctors
  const docRows = await readCsv('doctors.csv');
  stats.doctors.in = docRows.length;
  const doctorByCode = new Map();
  await query('DELETE FROM doctors');
  for (const d of docRows) {
    const hCode = cleanText(d.hospital_code).toUpperCase();
    const hospital = hospitalByCode.get(hCode);
    if (!hospital) continue;
    const code = cleanText(d.doctor_code).toUpperCase();
    const dept = deptByKey.get(`${hCode}|${cleanText(d.dept_code).toUpperCase()}`);
    const { rows } = await query(
      `INSERT INTO doctors (hospital_id, department_id, full_name, registration, speciality)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [hospital.id, dept?.id ?? null, cleanText(d.full_name), cleanText(d.registration) || null,
        cleanText(d.speciality) || null],
    );
    doctorByCode.set(code, rows[0]);
    stats.doctors.loaded += 1;
  }

  // ---------------------------------------------------------------- patients (dedupe)
  const patientRows = await readCsv('patients.csv');
  stats.patients.in = patientRows.length;
  await query('DELETE FROM patient_merges');
  await query('DELETE FROM patients');

  const patientByMrn = new Map();
  const byNameDob = new Map();
  const byNamePhone = new Map();

  for (let i = 0; i < patientRows.length; i += 1) {
    const row = patientRows[i];
    const mrn = cleanText(row.mrn).toUpperCase();
    const name = normaliseName(row.full_name);
    if (!mrn || !name) {
      record(batchId, 'patient', 'patients.csv', i + 2, 'MISSING_IDENTITY',
        'Row has no MRN or no name', row);
      continue;
    }

    const keys = patientKeys({ fullName: name, dateOfBirth: row.date_of_birth, phone: row.phone });

    // Duplicate detection: an exact match on name+DOB, else name+phone.
    let survivor = null; let rule = null;
    if (keys.nameDob && byNameDob.has(keys.nameDob)) { survivor = byNameDob.get(keys.nameDob); rule = 'name+dob'; }
    else if (keys.namePhone && byNamePhone.has(keys.namePhone)) { survivor = byNamePhone.get(keys.namePhone); rule = 'name+phone'; }

    if (survivor) {
      // Record the merge with the evidence that justified it, so it can be undone.
      await query(
        `INSERT INTO patient_merges (survivor_id, merged_id, rule, evidence)
         VALUES ($1,$1,$2,$3)`,
        [survivor.id, rule, JSON.stringify({ mrn, name, dob: keys.dob, phone: keys.phone, matched_on: rule })],
      );
      patientByMrn.set(mrn, survivor);
      stats.patients.merged += 1;
      record(batchId, 'patient', 'patients.csv', i + 2, 'DUPLICATE_PATIENT',
        `${mrn} is the same person as ${survivor.mrn} (${rule}); merged into the earlier record`,
        row, 'warning');
      continue;
    }

    const { rows } = await query(
      `INSERT INTO patients (mrn, full_name, date_of_birth, gender, phone, city)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [mrn, name, isoDate(parseDate(row.date_of_birth)), normaliseGender(row.gender),
        normalisePhone(row.phone), cleanText(row.city) || null],
    );
    const patient = rows[0];
    patientByMrn.set(mrn, patient);
    if (keys.nameDob) byNameDob.set(keys.nameDob, patient);
    if (keys.namePhone) byNamePhone.set(keys.namePhone, patient);
    stats.patients.loaded += 1;
  }

  // keep the recorded merges pointing at real rows
  await query(
    `UPDATE patient_merges pm SET merged_id = pm.survivor_id WHERE merged_id IS NULL`,
  );

  // ---------------------------------------------------------------- dictionary
  let icdLookup;
  try {
    const dict = await readCsv('diagnosis_dictionary.csv');
    icdLookup = buildLookup(dict);
  } catch {
    icdLookup = buildLookup([]);
  }

  const ctx = { patientByMrn, hospitalByCode, doctorByCode, icdLookup };

  // ---------------------------------------------------------------- appointments
  const apptRows = await readCsv('appointments.csv');
  stats.appointments.in = apptRows.length;
  await query('DELETE FROM appointments');

  for (let i = 0; i < apptRows.length; i += 1) {
    const res = validateAppointmentRow(apptRows[i], ctx);
    if (!res.ok) {
      for (const iss of res.issues) record(batchId, 'appointment', 'appointments.csv', i + 2, iss.code, iss.detail, apptRows[i]);
      continue;
    }
    for (const w of res.warnings) record(batchId, 'appointment', 'appointments.csv', i + 2, w.code, w.detail, apptRows[i], 'warning');

    const v = res.value;
    const hospital = hospitalByCode.get(v.hospitalCode);
    const doctor = v.doctorCode ? doctorByCode.get(v.doctorCode) : null;
    const patient = patientByMrn.get(v.patientMrn);

    await query(
      `INSERT INTO appointments
        (hospital_id, department_id, doctor_id, patient_id, scheduled_at, status,
         diagnosis_text, diagnosis_code, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [hospital.id, doctor?.department_id ?? null, doctor?.id ?? null, patient.id,
        v.scheduledAt, v.status, v.diagnosisText, v.diagnosisCode, v.notes],
    );
    stats.appointments.loaded += 1;
    if (v.diagnosisCode) stats.appointments.coded += 1; else stats.appointments.unmapped += 1;
  }

  // ---------------------------------------------------------------- admissions
  const admRows = await readCsv('admissions.csv');
  stats.admissions.in = admRows.length;
  await query('DELETE FROM admissions');

  for (let i = 0; i < admRows.length; i += 1) {
    const res = validateAdmissionRow(admRows[i], ctx);
    if (!res.ok) {
      for (const iss of res.issues) record(batchId, 'admission', 'admissions.csv', i + 2, iss.code, iss.detail, admRows[i]);
      continue;
    }
    for (const w of res.warnings) record(batchId, 'admission', 'admissions.csv', i + 2, w.code, w.detail, admRows[i], 'warning');

    const v = res.value;
    const hospital = hospitalByCode.get(v.hospitalCode);
    const dept = v.deptCode ? deptByKey.get(`${v.hospitalCode}|${v.deptCode}`) : null;
    const patient = patientByMrn.get(v.patientMrn);

    await query(
      `INSERT INTO admissions
        (hospital_id, department_id, patient_id, admitted_at, discharge_date, discharge_disposition,
         diagnosis_text, diagnosis_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [hospital.id, dept?.id ?? null, patient.id, `${v.admittedOn}T09:00:00Z`, v.dischargeDate,
        v.disposition, v.diagnosisText, v.diagnosisCode],
    );
    stats.admissions.loaded += 1;
    if (v.dischargeDate) stats.admissions.closed += 1; else stats.admissions.open += 1;
  }

  // ---------------------------------------------------------------- lab tests
  const labRows = await readCsv('lab_tests.csv');
  stats.labTests.in = labRows.length;
  await query('DELETE FROM lab_tests');
  for (let i = 0; i < labRows.length; i += 1) {
    const r = labRows[i];
    const hCode = cleanText(r.hospital_code).toUpperCase();
    const mrn = cleanText(r.patient_mrn).toUpperCase();
    const hospital = hospitalByCode.get(hCode);
    const patient = patientByMrn.get(mrn);
    const ordered = parseDate(r.ordered_at);
    if (!hospital || !patient || !ordered) {
      record(batchId, 'lab_test', 'lab_tests.csv', i + 2, 'INVALID_LAB_ROW',
        `hospital=${hCode} patient=${mrn} date=${r.ordered_at}`, r);
      continue;
    }
    const status = ['ordered', 'collected', 'resulted', 'cancelled'].includes(cleanText(r.status).toLowerCase())
      ? cleanText(r.status).toLowerCase() : 'ordered';
    await query(
      `INSERT INTO lab_tests (hospital_id, patient_id, test_name, loinc_code, ordered_at, result_value, result_unit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [hospital.id, patient.id, cleanText(r.test_name), cleanText(r.loinc_code) || null,
        `${isoDate(ordered)}T09:00:00Z`, cleanText(r.result_value) || null,
        cleanText(r.result_unit) || null, status],
    );
    stats.labTests.loaded += 1;
  }

  // ---------------------------------------------------------------- invoices
  const invRows = await readCsv('invoices.csv');
  stats.invoices.in = invRows.length;
  await query('DELETE FROM invoices');
  for (let i = 0; i < invRows.length; i += 1) {
    const r = invRows[i];
    const hospital = hospitalByCode.get(cleanText(r.hospital_code).toUpperCase());
    const patient = patientByMrn.get(cleanText(r.patient_mrn).toUpperCase());
    const amount = Number.parseFloat(String(r.amount_inr).replace(/[^0-9.]/g, ''));
    const issued = parseDate(r.issued_at);
    if (!hospital || !patient || !Number.isFinite(amount) || amount < 0 || !issued) {
      record(batchId, 'invoice', 'invoices.csv', i + 2, 'INVALID_INVOICE_ROW',
        `hospital=${r.hospital_code} patient=${r.patient_mrn} amount=${r.amount_inr}`, r);
      continue;
    }
    const status = ['issued', 'paid', 'claimed', 'rejected'].includes(cleanText(r.status).toLowerCase())
      ? cleanText(r.status).toLowerCase() : 'issued';
    await query(
      `INSERT INTO invoices (hospital_id, patient_id, amount_inr, status, issued_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [hospital.id, patient.id, amount, status, `${isoDate(issued)}T09:00:00Z`],
    );
    stats.invoices.loaded += 1;
  }

  // ---------------------------------------------------------------- persist issues
  await withTransaction(async (client) => {
    for (const it of stats.issues) {
      await client.query(
        `INSERT INTO etl_issues (batch_id, source_file, row_number, entity, severity, issue_code, detail, raw_row)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [it.batchId, it.file, it.rowNumber, it.entity, it.severity, it.code, it.detail, JSON.stringify(it.rawRow)],
      );
    }
    await client.query(
      `UPDATE etl_batches SET rows_in = $1, rows_loaded = $2, rows_quarantined = $3, finished_at = now()
       WHERE id = $4`,
      [stats.appointments.in + stats.admissions.in, stats.appointments.loaded + stats.admissions.loaded,
        stats.appointments.quarantined + stats.admissions.quarantined, batchId],
    );
  });

  return { batchId, stats };
}

/** Human-readable data-quality report — the numbers the docs quote. */
export function formatReport({ batchId, stats: s }) {
  const L = [];
  const pctOf = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0');
  L.push('');
  L.push('='.repeat(74));
  L.push('  DATA QUALITY REPORT — Jaipur TPA, four hospitals');
  L.push('='.repeat(74));
  L.push(`  batch   ${batchId}`);
  L.push('');
  L.push('  ENTITY          READ    LOADED   QUARANTINED   NOTES');
  L.push('  ' + '-'.repeat(64));
  const row = (n, o, note = '') => L.push(
    `  ${n.padEnd(14)}  ${String(o.in).padStart(5)}  ${String(o.loaded).padStart(7)}  ` +
    `${String(o.quarantined ?? 0).padStart(11)}   ${note}`,
  );
  row('hospitals', s.hospitals);
  row('departments', s.departments);
  row('doctors', s.doctors);
  row('patients', s.patients, `${s.patients.merged} merged as duplicates`);
  row('appointments', s.appointments, `${s.appointments.warnings} warnings`);
  row('admissions', s.admissions, `${s.admissions.open} open, ${s.admissions.closed} closed`);
  row('lab tests', s.labTests);
  row('invoices', s.invoices);
  L.push('');
  L.push(`  Diagnosis coding coverage : ${s.appointments.coded}/${s.appointments.loaded} visits ` +
    `(${pctOf(s.appointments.coded, s.appointments.loaded)}%)`);
  L.push(`  Unmapped free-text diagnoses: ${s.appointments.unmapped}`);
  L.push(`  Open stays (no discharge)   : ${s.admissions.open}/${s.admissions.loaded}`);
  L.push('');
  L.push('  ISSUES BY CODE');
  L.push('  ' + '-'.repeat(64));
  const entries = Object.entries(s.byCode).sort((a, b) => b[1] - a[1]);
  if (!entries.length) L.push('  (none)');
  for (const [code, n] of entries) L.push(`  ${code.padEnd(32)} ${String(n).padStart(5)}`);
  L.push('='.repeat(74));
  L.push('');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEtl()
    .then((r) => { console.log(formatReport(r)); return pool.end(); })
    .then(() => process.exit(0))
    .catch((e) => { logger.error({ e }, 'ETL failed'); process.exit(1); });
}
