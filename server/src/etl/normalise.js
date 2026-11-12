/**
 * Pure normalisation helpers. No database, no I/O — which is what makes them cheap
 * to test exhaustively, and why the ETL's correctness rests on tested functions
 * rather than on inspection of the loaded tables.
 */
import { mapDiagnosis, normaliseKey } from './icd10Map.js';

/* ------------------------------------------------------------------ dates */
/**
 * Parses the two formats the exports use: ISO (YYYY-MM-DD) and Indian
 * DD/MM/YYYY. Order matters — "03/04/2026" is 3 April here, and reading it
 * month-first would shift a third of the visits by a month while still looking
 * entirely plausible.
 */
export function parseDate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // a datetime is accepted and reduced to its date part
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/.exec(s);
  if (dmy) return validDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // rejects 31 February, which Date would otherwise roll into March
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export const isoDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

/** Parses "2026-03-04 14:30" / "04/03/2026 14:30" into a timestamp. */
export function parseTimestamp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^(.+?)[ T](\d{1,2}):(\d{2})$/.exec(s);
  const datePart = m ? parseDate(m[1]) : parseDate(s);
  if (!datePart) return null;
  const hh = m ? Number(m[2]) : 9;
  const mm = m ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59) return null;
  datePart.setUTCHours(hh, mm, 0, 0);
  return datePart;
}

/* ------------------------------------------------------------------ text */
export const cleanText = (raw) => (raw === null || raw === undefined ? '' : String(raw).replace(/\s+/g, ' ').trim());

export function normaliseName(raw) {
  const t = cleanText(raw);
  if (!t) return '';
  return t.split(' ').map(w => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

/** Digits only, last 10 kept — "+91 98765 43210" and "9876543210" are one phone. */
export function normalisePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length === 10 ? local : null;
}

/** 'M', 'Male', 'male ' -> 'male'; 'F' -> 'female'. Unknown values return null. */
export function normaliseGender(raw) {
  const k = cleanText(raw).toLowerCase();
  if (!k) return null;
  if (['m', 'male', 'man'].includes(k)) return 'male';
  if (['f', 'female', 'woman'].includes(k)) return 'female';
  if (['o', 'other', 'non-binary', 'nb'].includes(k)) return 'other';
  return null;
}

/* ------------------------------------------------------------------ patient identity */
/**
 * Two keys are produced for duplicate detection, because neither alone is enough:
 *
 *   name+dob    strong, but 15% of rows have no date of birth
 *   name+phone  strong when present, but 10% have no phone
 *
 * A row is only merged when a key matches exactly after normalisation. Name alone
 * is never used: two different Ramesh Sharmas in Jaipur is not a rare event, and
 * merging them would attach one person's clinical history to another.
 */
export function patientKeys({ fullName, dateOfBirth, phone }) {
  const name = normaliseKey(normaliseName(fullName));
  const dob = isoDate(parseDate(dateOfBirth));
  const tel = normalisePhone(phone);
  return {
    nameDob: name && dob ? `${name}|${dob}` : null,
    namePhone: name && tel ? `${name}|${tel}` : null,
    name, dob, phone: tel,
  };
}

/* ------------------------------------------------------------------ row validators */
/** Validates one raw appointment row. Returns a cleaned value or a list of codes. */
export function validateAppointmentRow(row, ctx) {
  const issues = [];
  const when = parseTimestamp(row.scheduled_at);
  if (!when) issues.push({ code: 'INVALID_SCHEDULED_AT', detail: `Could not parse "${row.scheduled_at}"` });

  const mrn = cleanText(row.patient_mrn).toUpperCase();
  if (!ctx.patientByMrn.has(mrn)) issues.push({ code: 'UNKNOWN_PATIENT', detail: `No patient ${mrn}` });

  const hospital = cleanText(row.hospital_code).toUpperCase();
  if (!ctx.hospitalByCode.has(hospital)) issues.push({ code: 'UNKNOWN_HOSPITAL', detail: `No hospital ${hospital}` });

  const doctor = cleanText(row.doctor_code).toUpperCase();
  if (doctor && !ctx.doctorByCode.has(doctor)) issues.push({ code: 'UNKNOWN_DOCTOR', detail: `No doctor ${doctor}` });

  const diag = mapDiagnosis(row.diagnosis, ctx.icdLookup);
  // An unmapped diagnosis does not invalidate the visit — the patient was seen.
  // It is a warning, and the pipeline reports the coding coverage it achieved.
  const warnings = diag.code ? [] : [{ code: 'UNMAPPED_DIAGNOSIS', detail: diag.reason }];

  if (issues.length) return { ok: false, issues };

  return {
    ok: true, warnings,
    value: {
      visitRef: cleanText(row.visit_ref),
      hospitalCode: hospital,
      doctorCode: doctor || null,
      patientMrn: mrn,
      scheduledAt: when,
      status: normaliseStatus(row.status),
      diagnosisText: cleanText(row.diagnosis) || null,
      diagnosisCode: diag.code,
      notes: cleanText(row.notes) || null,
    },
  };
}

const APPT_STATUS = new Set(['scheduled', 'completed', 'no_show', 'cancelled']);
export function normaliseStatus(raw) {
  const s = cleanText(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return APPT_STATUS.has(s) ? s : 'scheduled';
}

/**
 * Validates one admission row.
 *
 * The discharge date is the interesting field. Three states are distinguishable
 * and must not be conflated:
 *   - present and after admission  -> a closed stay, usable for length of stay
 *   - absent                       -> an open stay, OR a lost date; the export
 *                                     cannot tell us which, so it is recorded as
 *                                     open and reported, never invented
 *   - before admission             -> impossible; quarantined
 */
export function validateAdmissionRow(row, ctx) {
  const issues = [];
  const warnings = [];

  const admitted = parseDate(row.admitted_on);
  if (!admitted) issues.push({ code: 'INVALID_ADMITTED_ON', detail: `Could not parse "${row.admitted_on}"` });

  const rawDischarge = cleanText(row.discharge_date);
  let discharge = null;
  if (rawDischarge) {
    discharge = parseDate(rawDischarge);
    if (!discharge) {
      warnings.push({ code: 'UNPARSEABLE_DISCHARGE_DATE', detail: `Could not parse "${rawDischarge}"; treated as an open stay` });
    } else if (admitted && discharge.getTime() < admitted.getTime()) {
      issues.push({
        code: 'DISCHARGE_BEFORE_ADMISSION',
        detail: `discharge ${isoDate(discharge)} is before admission ${isoDate(admitted)}`,
      });
    }
  } else {
    warnings.push({ code: 'MISSING_DISCHARGE_DATE', detail: 'No discharge date; recorded as an open stay' });
  }

  const mrn = cleanText(row.patient_mrn).toUpperCase();
  if (!ctx.patientByMrn.has(mrn)) issues.push({ code: 'UNKNOWN_PATIENT', detail: `No patient ${mrn}` });

  const hospital = cleanText(row.hospital_code).toUpperCase();
  if (!ctx.hospitalByCode.has(hospital)) issues.push({ code: 'UNKNOWN_HOSPITAL', detail: `No hospital ${hospital}` });

  if (issues.length) return { ok: false, issues };

  const diag = mapDiagnosis(row.diagnosis, ctx.icdLookup);
  if (!diag.code) warnings.push({ code: 'UNMAPPED_DIAGNOSIS', detail: diag.reason });

  return {
    ok: true, warnings,
    value: {
      admissionRef: cleanText(row.admission_ref),
      hospitalCode: hospital,
      deptCode: cleanText(row.dept_code).toUpperCase() || null,
      patientMrn: mrn,
      admittedOn: isoDate(admitted),
      dischargeDate: discharge ? isoDate(discharge) : null,
      disposition: normaliseDisposition(row.disposition),
      diagnosisText: cleanText(row.diagnosis) || null,
      diagnosisCode: diag.code,
    },
  };
}

const DISPOSITIONS = new Set(['home', 'transfer', 'deceased', 'ama']);
export function normaliseDisposition(raw) {
  const s = cleanText(raw).toLowerCase();
  return DISPOSITIONS.has(s) ? s : null;
}

export { mapDiagnosis, normaliseKey };
