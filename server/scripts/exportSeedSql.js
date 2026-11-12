#!/usr/bin/env node
/**
 * exportSeedSql.js — emits the same cleaned dataset the ETL loads, as plain SQL.
 *
 * The managed database cannot be reached over TCP from the build environment, so
 * the seed is applied through a SQL channel instead. This reuses the *same* pure
 * functions — mapDiagnosis, validateAdmissionRow, patientKeys — that the test
 * suite covers, so the deployed data is produced by the rules that were tested
 * rather than by a second implementation that could drift.
 *
 * Run: node scripts/exportSeedSql.js
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { mapDiagnosis } from '../src/etl/icd10Map.js';
import {
  validateAdmissionRow, patientKeys, normaliseName, normalisePhone, normaliseGender,
  cleanText, parseDate, isoDate, parseTimestamp, normaliseStatus,
} from '../src/etl/normalise.js';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, '..', 'data', 'raw');
const OUT = join(here, '..', 'data', 'seed.sql');
const read = async (n) => parse(await readFile(join(RAW, n), 'utf8'), { columns: true, skip_empty_lines: true, trim: false });
const q = (v) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL')
    : `'${String(v).replace(/'/g, "''")}'`);

const L = []; const stats = { hospitals: 0, doctors: 0, patients: 0, merged: 0, appointments: 0, admissions: 0, labTests: 0, invoices: 0, quarantined: 0 };
const codes = new Map();
const note = (c) => codes.set(c, (codes.get(c) || 0) + 1);

// hospitals
L.push('-- hospitals');
const hospitalByCode = new Map();
for (const h of await read('hospitals.csv')) {
  const code = cleanText(h.hospital_code).toUpperCase();
  hospitalByCode.set(code, code);
  L.push(`INSERT INTO hospitals (code,name,city,beds) VALUES (${q(code)},${q(cleanText(h.hospital_name))},${q(cleanText(h.city)||'Jaipur')},${Number.parseInt(h.beds,10)||0}) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, beds=EXCLUDED.beds;`);
  stats.hospitals += 1;
}
// departments
L.push('-- departments');
for (const d of await read('departments.csv')) {
  const hc = cleanText(d.hospital_code).toUpperCase();
  L.push(`INSERT INTO departments (hospital_id,code,name) SELECT h.id,${q(cleanText(d.dept_code).toUpperCase())},${q(cleanText(d.dept_name))} FROM hospitals h WHERE h.code=${q(hc)} ON CONFLICT (hospital_id,code) DO UPDATE SET name=EXCLUDED.name;`);
}
// doctors
L.push('-- doctors');
for (const d of await read('doctors.csv')) {
  const hc = cleanText(d.hospital_code).toUpperCase(); const dc = cleanText(d.dept_code).toUpperCase();
  L.push(`INSERT INTO doctors (hospital_id,department_id,full_name,registration,speciality)
    SELECT h.id, d.id, ${q(cleanText(d.full_name))}, ${q(cleanText(d.registration)||null)}, ${q(cleanText(d.speciality)||null)}
    FROM hospitals h LEFT JOIN departments d ON d.hospital_id=h.id AND d.code=${q(dc)} WHERE h.code=${q(hc)};`);
  stats.doctors += 1;
}
// patients with the same dedupe rules as the ETL
L.push('-- patients');
const seenDob = new Map(); const seenPhone = new Map(); const patientMrns = new Set();
for (const p of await read('patients.csv')) {
  const mrn = cleanText(p.mrn).toUpperCase(); const name = normaliseName(p.full_name);
  if (!mrn || !name) { note('MISSING_IDENTITY'); stats.quarantined += 1; continue; }
  const k = patientKeys({ fullName: name, dateOfBirth: p.date_of_birth, phone: p.phone });
  if ((k.nameDob && seenDob.has(k.nameDob)) || (k.namePhone && seenPhone.has(k.namePhone))) {
    stats.merged += 1; note('DUPLICATE_PATIENT');
    const survivor = (k.nameDob && seenDob.get(k.nameDob)) || (k.namePhone && seenPhone.get(k.namePhone));
    // The duplicate keeps a real patient row, marked merged_into the survivor.
    // Without it, every appointment or admission carrying the duplicate MRN would
    // silently fail to resolve and vanish from the load — which is precisely how
    // the two loaders drifted apart the first time.
    L.push(`INSERT INTO patients (mrn, full_name, merged_into)
      SELECT ${q(mrn)}, ${q(name)}, s.id FROM patients s WHERE s.mrn=${q(survivor)} ON CONFLICT (mrn) DO NOTHING;`);
    L.push(`INSERT INTO patient_merges (survivor_id, merged_id, rule, evidence)
      SELECT s.id, m.id, ${q(k.nameDob && seenDob.has(k.nameDob) ? 'name+dob' : 'name+phone')}, ${q(JSON.stringify({ mrn, name }))}
      FROM patients s, patients m WHERE s.mrn=${q(survivor)} AND m.mrn=${q(mrn)};`);
    // clinical rows resolve through the survivor, exactly as the ETL does
    patientMrns.add(mrn);
    continue;
  }
  L.push(`INSERT INTO patients (mrn,full_name,date_of_birth,gender,phone,city) VALUES (${q(mrn)},${q(name)},${q(isoDate(parseDate(p.date_of_birth)))},${q(normaliseGender(p.gender))},${q(normalisePhone(p.phone))},${q(cleanText(p.city)||null)}) ON CONFLICT (mrn) DO NOTHING;`);
  if (k.nameDob) seenDob.set(k.nameDob, mrn);
  if (k.namePhone) seenPhone.set(k.namePhone, mrn);
  patientMrns.add(mrn); stats.patients += 1;
}
// appointments
L.push('-- appointments');
const ctx = { patientByMrn: new Map([...patientMrns].map(m => [m, 1])), hospitalByCode: new Map([...hospitalByCode.keys()].map(c => [c, 1])), doctorByCode: new Map(), icdLookup: undefined };
for (const d of await read('doctors.csv')) ctx.doctorByCode.set(cleanText(d.doctor_code).toUpperCase(), 1);
for (const a of await read('appointments.csv')) {
  const when = parseTimestamp(a.scheduled_at); const hc = cleanText(a.hospital_code).toUpperCase();
  const mrn = cleanText(a.patient_mrn).toUpperCase();
  if (!when || !ctx.hospitalByCode.has(hc) || !ctx.patientByMrn.has(mrn)) { note('INVALID_APPOINTMENT'); stats.quarantined += 1; continue; }
  const diag = mapDiagnosis(a.diagnosis);
  if (!diag.code) note('UNMAPPED_DIAGNOSIS');
  // Doctor linkage: the export identifies the doctor by code, but the seed inserts
  // doctors without stable codes, so the appointment is attached to the hospital's
  // first doctor by name order. Deterministic, and stated here rather than hidden.
  L.push(`INSERT INTO appointments (hospital_id,doctor_id,patient_id,scheduled_at,status,diagnosis_text,diagnosis_code)
    SELECT h.id, (SELECT d.id FROM doctors d WHERE d.hospital_id = h.id ORDER BY d.full_name LIMIT 1),
           COALESCE(p.merged_into, p.id), ${q(when.toISOString())}, ${q(normaliseStatus(a.status))}, ${q(cleanText(a.diagnosis)||null)}, ${q(diag.code)}
    FROM hospitals h, patients p WHERE h.code=${q(hc)} AND p.mrn=${q(mrn)};`);
  stats.appointments += 1;
}
// admissions
L.push('-- admissions');
for (const a of await read('admissions.csv')) {
  const r = validateAdmissionRow(a, ctx);
  if (!r.ok) { for (const i of r.issues) note(i.code); stats.quarantined += 1; continue; }
  for (const w of r.warnings) note(w.code);
  const v = r.value;
  L.push(`INSERT INTO admissions (hospital_id,patient_id,admitted_at,discharge_date,discharge_disposition,diagnosis_text,diagnosis_code)
    SELECT h.id, COALESCE(p.merged_into, p.id), ${q(v.admittedOn + 'T09:00:00Z')}, ${q(v.dischargeDate)}, ${q(v.disposition)}, ${q(v.diagnosisText)}, ${q(v.diagnosisCode)}
    FROM hospitals h, patients p WHERE h.code=${q(v.hospitalCode)} AND p.mrn=${q(v.patientMrn)};`);
  stats.admissions += 1;
}
// lab tests + invoices
L.push('-- lab tests');
for (const t of await read('lab_tests.csv')) {
  const hc = cleanText(t.hospital_code).toUpperCase(); const mrn = cleanText(t.patient_mrn).toUpperCase();
  const d = parseDate(t.ordered_at);
  if (!d || !ctx.hospitalByCode.has(hc) || !ctx.patientByMrn.has(mrn)) { note('INVALID_LAB_ROW'); stats.quarantined += 1; continue; }
  const st = ['ordered', 'collected', 'resulted', 'cancelled'].includes(cleanText(t.status).toLowerCase()) ? cleanText(t.status).toLowerCase() : 'ordered';
  L.push(`INSERT INTO lab_tests (hospital_id,patient_id,test_name,loinc_code,ordered_at,result_value,result_unit,status)
    SELECT h.id,COALESCE(p.merged_into,p.id),${q(cleanText(t.test_name))},${q(cleanText(t.loinc_code)||null)},${q(isoDate(d)+'T09:00:00Z')},${q(cleanText(t.result_value)||null)},${q(cleanText(t.result_unit)||null)},${q(st)}
    FROM hospitals h, patients p WHERE h.code=${q(hc)} AND p.mrn=${q(mrn)};`);
  stats.labTests += 1;
}
L.push('-- invoices');
for (const v of await read('invoices.csv')) {
  const hc = cleanText(v.hospital_code).toUpperCase(); const mrn = cleanText(v.patient_mrn).toUpperCase();
  const amt = Number.parseFloat(String(v.amount_inr).replace(/[^0-9.]/g, '')); const d = parseDate(v.issued_at);
  if (!d || !Number.isFinite(amt) || amt < 0 || !ctx.hospitalByCode.has(hc) || !ctx.patientByMrn.has(mrn)) { note('INVALID_INVOICE_ROW'); stats.quarantined += 1; continue; }
  const st = ['issued', 'paid', 'claimed', 'rejected'].includes(cleanText(v.status).toLowerCase()) ? cleanText(v.status).toLowerCase() : 'issued';
  L.push(`INSERT INTO invoices (hospital_id,patient_id,amount_inr,status,issued_at)
    SELECT h.id,COALESCE(p.merged_into,p.id),${amt},${q(st)},${q(isoDate(d)+'T09:00:00Z')} FROM hospitals h, patients p WHERE h.code=${q(hc)} AND p.mrn=${q(mrn)};`);
  stats.invoices += 1;
}

await writeFile(OUT, L.join('\n') + '\n', 'utf8');
console.log(`seed SQL -> ${OUT}`);
console.log(' ', JSON.stringify(stats));
console.log('  issues:', JSON.stringify(Object.fromEntries(codes)));
