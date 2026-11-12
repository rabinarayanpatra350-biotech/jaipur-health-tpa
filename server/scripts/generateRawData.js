#!/usr/bin/env node
/**
 * generateRawData.js — the anonymised exports handed over by the four Jaipur hospitals.
 *
 * Deliberately messy in the three ways the brief names, plus a few a real export
 * always contains. Deterministic (seeded), so the ETL tests can assert on exact
 * counts instead of "some rows failed".
 *
 *   1. diagnosis written in free text instead of codes  -> "T2DM", "type II DM", "DM2"
 *   2. missing discharge dates                          -> open stays and lost dates
 *   3. patients registered twice with different IDs     -> same person, two MRNs
 *   plus: DD/MM/YYYY vs ISO dates, blank phone numbers, ages instead of DOB,
 *   discharge before admission, and free-text genders.
 *
 * Run: node scripts/generateRawData.js
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'data', 'raw');
mkdirSync(OUT, { recursive: true });

let seed = 20260926;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ------------------------------------------------------------------ hospitals
const HOSPITALS = [
  ['JPR-SMS', 'Sawai Man Singh Hospital', 'Jaipur', 22],
  ['JPR-FORT', 'Fortis Hospital Jaipur', 'Jaipur', 16],
  ['JPR-NAR', 'Narayana Multispeciality Hospital', 'Jaipur', 12],
  ['JPR-MET', 'Metro Mas Hospital', 'Jaipur', 10],
];
writeFileSync(join(OUT, 'hospitals.csv'),
  ['hospital_code,hospital_name,city,beds', ...HOSPITALS.map(h => h.join(','))].join('\n') + '\n');

const DEPARTMENTS = {
  'JPR-SMS': [['MED', 'General Medicine'], ['SUR', 'General Surgery'], ['ORT', 'Orthopaedics'], ['OBS', 'Obstetrics'], ['PED', 'Paediatrics']],
  'JPR-FORT': [['MED', 'Internal Medicine'], ['CAR', 'Cardiology'], ['ORT', 'Orthopaedics'], ['EMR', 'Emergency']],
  'JPR-NAR': [['MED', 'General Medicine'], ['NEP', 'Nephrology'], ['GAS', 'Gastroenterology']],
  'JPR-MET': [['MED', 'General Medicine'], ['SUR', 'General Surgery'], ['PUL', 'Pulmonology']],
};
const depRows = ['hospital_code,dept_code,dept_name'];
for (const [code, deps] of Object.entries(DEPARTMENTS)) for (const [dc, dn] of deps) depRows.push(`${code},${dc},${dn}`);
writeFileSync(join(OUT, 'departments.csv'), depRows.join('\n') + '\n');

const FIRST = ['Ramesh', 'Suresh', 'Anita', 'Priya', 'Mohan', 'Kavita', 'Rajesh', 'Sunita', 'Vikram', 'Meena',
  'Arjun', 'Pooja', 'Deepak', 'Neha', 'Sanjay', 'Rekha', 'Amit', 'Shalini', 'Ravi', 'Geeta',
  'Mahesh', 'Lata', 'Nitin', 'Asha', 'Yogesh', 'Urmila', 'Bharat', 'Kamla', 'Dinesh', 'Sarita'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Jain', 'Agarwal', 'Singh', 'Rathore', 'Meena', 'Saini', 'Yadav',
  'Choudhary', 'Purohit', 'Joshi', 'Bhatt', 'Mathur', 'Trivedi', 'Shrimali', 'Dadhich', 'Khandelwal', 'Goyal'];

// ------------------------------------------------------------------ patients
// 25 people are registered twice under two different MRNs — the exact problem the
// brief names. The duplicates differ in casing, spacing or phone formatting, so a
// naive exact-match dedupe finds none of them.
const patients = [];
let mrnSeq = 100000;
const nextMrn = () => `PT-${++mrnSeq}`;
const usedPeople = [];
for (let i = 0; i < 1500; i += 1) {
  const fn = pick(FIRST); const ln = pick(LAST);
  const dobY = int(1935, 2015); const dobM = int(1, 12); const dobD = int(1, 28);
  const phone = `+91 ${int(70, 99)}${int(100, 999)} ${int(10000, 99999)}`;
  const person = {
    mrn: nextMrn(),
    name: `${fn} ${ln}`,
    dob: `${dobY}-${String(dobM).padStart(2, '0')}-${String(dobD).padStart(2, '0')}`,
    gender: pick(['Male', 'Female', 'male', 'F', 'M', 'Female']),
    phone: rnd() < 0.1 ? '' : phone,
    city: pick(['Jaipur', 'Jaipur', 'Jaipur', 'Ajmer', 'Alwar', 'Sikar']),
  };
  patients.push(person);
  usedPeople.push(person);
}
// duplicates: same human, new MRN, slightly different spelling of the same fields
for (let i = 0; i < 25; i += 1) {
  const p = usedPeople[i];
  const variant = {
    mrn: nextMrn(),
    name: rnd() < 0.5 ? p.name.toUpperCase() : ` ${p.name.replace(' ', '  ')} `,
    dob: rnd() < 0.15 ? '' : p.dob,
    gender: p.gender,
    phone: p.phone ? p.phone.replace(/\s/g, '') : '',
    city: p.city,
  };
  patients.push(variant);
}
writeFileSync(join(OUT, 'patients.csv'),
  ['mrn,full_name,date_of_birth,gender,phone,city', ...patients.map(p =>
    [p.mrn, `"${p.name}"`, p.dob, p.gender, `"${p.phone}"`, p.city].join(','))].join('\n') + '\n');

// ------------------------------------------------------------------ diagnosis free text
// Each canonical ICD-10 concept appears under several free-text spellings. This is
// the mapping problem the brief names, and it is the same shape as a room-type
// alias table: an explicit, reviewable map beats a fuzzy match.
const DIAGNOSES = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications',
    variants: ['T2DM', 'type 2 diabetes', 'Type II DM', 'DM2', 'diabetes mellitus type 2', 'T2 DM uncontrolled', 'Type 2 DM'] },
  { code: 'I10', label: 'Essential (primary) hypertension',
    variants: ['HTN', 'hypertension', 'essential hypertension', 'High BP', 'HT', 'raised blood pressure'] },
  { code: 'J18.9', label: 'Pneumonia, unspecified organism',
    variants: ['pneumonia', 'Pneumonia', 'LRTI with pneumonia', 'community acquired pneumonia'] },
  { code: 'A09', label: 'Infectious gastroenteritis and colitis',
    variants: ['gastroenteritis', 'AGE', 'acute gastroenteritis', 'Acute GE', 'diarrhoea and vomiting'] },
  { code: 'K29.70', label: 'Gastritis, unspecified, without bleeding',
    variants: ['gastritis', 'acute gastritis', 'Gastritis'] },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified',
    variants: ['UTI', 'urinary tract infection', 'Urine infection', 'UTI lower'] },
  { code: 'I50.9', label: 'Heart failure, unspecified',
    variants: ['CHF', 'congestive cardiac failure', 'heart failure', 'CCF'] },
  { code: 'J44.1', label: 'COPD with acute exacerbation',
    variants: ['COPD exacerbation', 'acute exacerbation of COPD', 'COPD with AE', 'AECOPD'] },
  { code: 'K35.80', label: 'Unspecified acute appendicitis',
    variants: ['acute appendicitis', 'appendicitis', 'Ac appendicitis'] },
  { code: 'J45.909', label: 'Unspecified asthma, uncomplicated',
    variants: ['asthma', 'bronchial asthma', 'Asthma'] },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease without oesophagitis',
    variants: ['GERD', 'acid reflux', 'reflux disease', 'GORD'] },
  { code: 'D64.9', label: 'Anaemia, unspecified',
    variants: ['anaemia', 'anemia', 'Anaemia moderate', 'low haemoglobin'] },
  { code: 'N18.9', label: 'Chronic kidney disease, unspecified',
    variants: ['CKD', 'chronic kidney disease', 'CKD stage 4', 'renal failure chronic'] },
  { code: 'I63.9', label: 'Cerebral infarction, unspecified',
    variants: ['stroke', 'CVA', 'ischaemic stroke', 'cerebrovascular accident'] },
  { code: 'M54.5', label: 'Low back pain',
    variants: ['low back pain', 'LBP', 'back pain', 'lumbar pain'] },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified',
    variants: ['dyslipidaemia', 'high cholesterol', 'hyperlipidemia', 'DLP'] },
  { code: 'R50.9', label: 'Fever, unspecified',
    variants: ['fever', 'pyrexia', 'PUO', 'fever under evaluation'] },
  { code: 'L03.90', label: 'Cellulitis, unspecified',
    variants: ['cellulitis', 'Cellulitis of leg', 'skin infection cellulitis'] },
];
// A handful of diagnoses the map does not cover — deliberately. They are real
// clinical text the TPA has not yet coded, and the pipeline reports them rather
// than inventing a code.
const UNMAPPED = ['post-operative wound review', 'routine antenatal check', 'generalised weakness',
  'suspected viral illness', 'follow-up for fracture healing'];

const diagRows = ['concept_code,concept_label,variant'];
for (const d of DIAGNOSES) for (const v of d.variants) diagRows.push(`${d.code},"${d.label}","${v}"`);
writeFileSync(join(OUT, 'diagnosis_dictionary.csv'), diagRows.join('\n') + '\n');

// ------------------------------------------------------------------ doctors
const docRows = ['doctor_code,hospital_code,dept_code,full_name,registration,speciality'];
const DOCTORS = [];
let dseq = 0;
for (const [code, deps] of Object.entries(DEPARTMENTS)) {
  for (const [dc] of deps) {
    for (let i = 0; i < 3; i += 1) {
      dseq += 1;
      const dc2 = `DOC-${String(dseq).padStart(4, '0')}`;
      const fn = pick(FIRST); const ln = pick(LAST);
      DOCTORS.push({ code: dc2, hospital: code, dept: dc, name: `Dr ${fn} ${ln}` });
      docRows.push([dc2, code, dc, `"Dr ${fn} ${ln}"`, `RJMC-${int(10000, 99999)}`, dc].join(','));
    }
  }
}
writeFileSync(join(OUT, 'doctors.csv'), docRows.join('\n') + '\n');

// ------------------------------------------------------------------ appointments
const iso = (d) => d.toISOString().slice(0, 10);
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const START = new Date('2026-01-01T00:00:00Z');

const apptRows = ['visit_ref,hospital_code,doctor_code,patient_mrn,scheduled_at,status,diagnosis,notes'];
let unmappedUsed = 0;
for (let i = 0; i < 900; i += 1) {
  const doc = pick(DOCTORS);
  const pat = pick(patients);
  const when = addDays(START, int(0, 300));
  const diagPick = rnd();
  let diagnosis;
  if (diagPick < 0.08) { diagnosis = pick(UNMAPPED); unmappedUsed += 1; }
  else diagnosis = pick(pick(DIAGNOSES).variants);
  const fmt = rnd() < 0.35 ? dmy : iso;
  apptRows.push([
    `VIS-${String(i + 1).padStart(5, '0')}`, doc.hospital, doc.code, pat.mrn,
    `${fmt(when)} ${String(int(9, 18)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`,
    pick(['completed', 'completed', 'completed', 'scheduled', 'no_show', 'cancelled']),
    `"${diagnosis}"`, '',
  ].join(','));
}
writeFileSync(join(OUT, 'appointments.csv'), apptRows.join('\n') + '\n');

// ------------------------------------------------------------------ admissions
// ~14% have no discharge date. Of those, most are genuinely still in hospital;
// a few are records where the date was simply lost. The export cannot tell them
// apart, so the pipeline must not pretend to.
const admRows = ['admission_ref,hospital_code,dept_code,patient_mrn,admitted_on,discharge_date,disposition,diagnosis'];
let noDischarge = 0; let reversed = 0;
const admissionsOut = [];
// Admission episodes are built per patient rather than drawn at random, because
// random assignment gave every patient seven unrelated admissions and produced a
// 55% "readmission rate" that measured nothing. Here 11% of patients are
// deliberately readmitted inside 30 days — the figure a TPA actually watches.
const episodes = [];
for (const pat of patients) {
  const first = int(0, 250);
  episodes.push({ pat, day: first });
  if (rnd() < 0.11) episodes.push({ pat, day: first + int(2, 29), readmission: true });
}
const admTotal = Math.min(2400, episodes.length);
for (let i = 0; i < admTotal; i += 1) {
  const ep = episodes[i];
  const doc = pick(DOCTORS);
  const pat = ep.pat;
  const admitted = addDays(START, ep.day);
  const los = int(1, 11);
  let discharge = addDays(admitted, los);
  let dischargeStr = iso(discharge);
  if (rnd() < 0.14) { dischargeStr = ''; noDischarge += 1; }
  else if (rnd() < 0.05) { dischargeStr = iso(addDays(admitted, -int(1, 3))); reversed += 1; }
  else if (rnd() < 0.25) dischargeStr = dmy(discharge);
  const diag = pick(pick(DIAGNOSES).variants);
  admissionsOut.push({ ref: `ADM-${String(i + 1).padStart(5, '0')}`, pat, hospital: doc.hospital, admitted });
  admRows.push([
    `ADM-${String(i + 1).padStart(5, '0')}`, doc.hospital, doc.dept, pat.mrn,
    iso(admitted), dischargeStr, dischargeStr ? pick(['home', 'home', 'transfer', 'deceased', 'ama']) : '',
    `"${diag}"`,
  ].join(','));
}
writeFileSync(join(OUT, 'admissions.csv'), admRows.join('\n') + '\n');

// ------------------------------------------------------------------ lab tests + invoices
const TESTS = [['Haemoglobin', 'Hb', 'g/dL'], ['Fasting glucose', 'FBS', 'mg/dL'], ['Serum creatinine', 'CREA', 'mg/dL'],
  ['Total leukocyte count', 'TLC', '/uL'], ['HbA1c', 'HBA1C', '%'], ['Serum sodium', 'NA', 'mmol/L'],
  ['Chest X-ray', 'CXR', ''], ['Urine routine', 'UR', '']];
const labRows = ['test_ref,hospital_code,patient_mrn,test_name,loinc_code,ordered_at,result_value,result_unit,status'];
for (let i = 0; i < 1200; i += 1) {
  const [tn, loinc, unit] = pick(TESTS);
  const pat = pick(patients);
  const h = pick(HOSPITALS)[0];
  const when = addDays(START, int(0, 300));
  const resulted = rnd() < 0.8;
  labRows.push([
    `LAB-${String(i + 1).padStart(5, '0')}`, h, pat.mrn, `"${tn}"`, loinc, iso(when),
    resulted ? String(int(3, 180)) : '', `"${unit}"`, resulted ? 'resulted' : pick(['ordered', 'collected', 'cancelled']),
  ].join(','));
}
writeFileSync(join(OUT, 'lab_tests.csv'), labRows.join('\n') + '\n');

const invRows = ['invoice_ref,hospital_code,patient_mrn,amount_inr,status,issued_at'];
for (let i = 0; i < 800; i += 1) {
  const pat = pick(patients);
  const h = pick(HOSPITALS)[0];
  invRows.push([
    `INV-${String(i + 1).padStart(5, '0')}`, h, pat.mrn, int(1500, 240000),
    pick(['issued', 'paid', 'paid', 'claimed', 'rejected']), iso(addDays(START, int(0, 300))),
  ].join(','));
}
writeFileSync(join(OUT, 'invoices.csv'), invRows.join('\n') + '\n');

console.log('raw exports written to', OUT);
console.log(`  hospitals       ${HOSPITALS.length}`);
console.log(`  departments     ${depRows.length - 1}`);
console.log(`  doctors         ${DOCTORS.length}`);
console.log(`  patients        ${patients.length} (incl. 25 duplicate registrations)`);
console.log(`  appointments    ${apptRows.length - 1} (${unmappedUsed} with an unmapped diagnosis)`);
console.log(`  admissions      ${admRows.length - 1} (${noDischarge} with no discharge date, ${reversed} with discharge before admission)`);
console.log(`  lab tests       ${labRows.length - 1}`);
console.log(`  invoices        ${invRows.length - 1}`);
