import { describe, it, expect } from 'vitest';
import {
  parseDate, isoDate, parseTimestamp, normaliseName, normalisePhone, normaliseGender,
  patientKeys, validateAdmissionRow, validateAppointmentRow, normaliseStatus, normaliseDisposition,
} from '../../src/etl/normalise.js';

describe('parseDate', () => {
  it('reads ISO dates', () => {
    expect(isoDate(parseDate('2026-03-04'))).toBe('2026-03-04');
  });
  it('reads Indian DD/MM/YYYY, not month-first', () => {
    // 04/03/2026 is 4 March. Reading it month-first would silently shift a third
    // of the visits by a month and still look plausible.
    expect(isoDate(parseDate('04/03/2026'))).toBe('2026-03-04');
    expect(isoDate(parseDate('25/12/2026'))).toBe('2026-12-25');
  });
  it('rejects impossible calendar dates instead of rolling them forward', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('2026-02-30')).toBeNull();
  });
  it('rejects empty and nonsense input', () => {
    for (const v of ['', '   ', null, undefined, 'not a date', '13/13/2026']) expect(parseDate(v)).toBeNull();
  });
  it('accepts a datetime and keeps only the date', () => {
    expect(isoDate(parseDate('2026-03-04T14:30:00Z'))).toBe('2026-03-04');
  });
});

describe('parseTimestamp', () => {
  it('parses both formats with a time', () => {
    expect(parseTimestamp('2026-03-04 14:30').toISOString()).toBe('2026-03-04T14:30:00.000Z');
    expect(parseTimestamp('04/03/2026 09:15').toISOString()).toBe('2026-03-04T09:15:00.000Z');
  });
  it('defaults to 09:00 when no time is given', () => {
    expect(parseTimestamp('2026-03-04').toISOString()).toBe('2026-03-04T09:00:00.000Z');
  });
  it('rejects an impossible hour', () => {
    expect(parseTimestamp('2026-03-04 25:00')).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('reduces every spelling of one number to the same ten digits', () => {
    const a = normalisePhone('+91 98765 43210');
    const b = normalisePhone('9876543210');
    const c = normalisePhone('+91-98765-43210');
    expect(a).toBe('9876543210');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('rejects a number that is not ten digits long', () => {
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});

describe('normaliseGender', () => {
  it.each([['M', 'male'], ['male', 'male'], ['Male ', 'male'], ['F', 'female'], ['female', 'female'], ['O', 'other']])(
    'maps %s to %s', (raw, expected) => { expect(normaliseGender(raw)).toBe(expected); },
  );
  it('returns null for an unknown value rather than guessing', () => {
    expect(normaliseGender('unknown')).toBeNull();
  });
});

describe('normaliseName', () => {
  it('tidies spacing and casing without mangling initials', () => {
    expect(normaliseName('  RAMESH   sharma ')).toBe('Ramesh Sharma');
    expect(normaliseName('ramesh k sharma')).toBe('Ramesh K Sharma');
  });
});

describe('patientKeys', () => {
  it('produces a name+dob key and a name+phone key', () => {
    const k = patientKeys({ fullName: 'Ramesh Sharma', dateOfBirth: '1985-04-12', phone: '+91 98765 43210' });
    expect(k.nameDob).toBe('ramesh sharma|1985-04-12');
    expect(k.namePhone).toBe('ramesh sharma|9876543210');
  });
  it('omits a key when its evidence is missing, rather than keying on the name alone', () => {
    const k = patientKeys({ fullName: 'Ramesh Sharma', dateOfBirth: '', phone: '' });
    expect(k.nameDob).toBeNull();
    expect(k.namePhone).toBeNull();
  });
  it('matches the same person across spelling and formatting differences', () => {
    const a = patientKeys({ fullName: 'Ramesh Sharma', dateOfBirth: '1985-04-12', phone: '+91 98765 43210' });
    const b = patientKeys({ fullName: ' RAMESH  SHARMA ', dateOfBirth: '12/04/1985', phone: '9876543210' });
    expect(b.nameDob).toBe(a.nameDob);
    expect(b.namePhone).toBe(a.namePhone);
  });
});

describe('validateAdmissionRow', () => {
  const ctx = {
    patientByMrn: new Map([['PT-1', { id: 'p1' }]]),
    hospitalByCode: new Map([['JPR-SMS', { id: 'h1' }]]),
    icdLookup: undefined,
  };
  const base = { admission_ref: 'A1', hospital_code: 'JPR-SMS', dept_code: 'MED', patient_mrn: 'PT-1', diagnosis: 'T2DM' };

  it('accepts a closed stay and computes nothing it was not given', () => {
    const r = validateAdmissionRow({ ...base, admitted_on: '2026-03-01', discharge_date: '2026-03-06' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.value.dischargeDate).toBe('2026-03-06');
    expect(r.warnings).toHaveLength(0);
  });

  it('treats a missing discharge date as an OPEN stay, not an error and not a guess', () => {
    const r = validateAdmissionRow({ ...base, admitted_on: '2026-03-01', discharge_date: '' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.value.dischargeDate).toBeNull();
    expect(r.warnings.map(w => w.code)).toContain('MISSING_DISCHARGE_DATE');
  });

  it('quarantines a discharge that precedes the admission', () => {
    const r = validateAdmissionRow({ ...base, admitted_on: '2026-03-10', discharge_date: '2026-03-04' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('DISCHARGE_BEFORE_ADMISSION');
  });

  it('quarantines an unparseable admission date', () => {
    const r = validateAdmissionRow({ ...base, admitted_on: 'sometime', discharge_date: '' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('INVALID_ADMITTED_ON');
  });
});

describe('validateAppointmentRow', () => {
  const ctx = {
    patientByMrn: new Map([['PT-1', { id: 'p1' }]]),
    hospitalByCode: new Map([['JPR-SMS', { id: 'h1' }]]),
    doctorByCode: new Map([['DOC-0001', { id: 'd1' }]]),
  };
  const base = { visit_ref: 'V1', hospital_code: 'JPR-SMS', doctor_code: 'DOC-0001', patient_mrn: 'PT-1', scheduled_at: '2026-03-04 10:00', status: 'completed' };

  it('maps the free-text diagnosis and keeps the original text', () => {
    const r = validateAppointmentRow({ ...base, diagnosis: 'Type II DM' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.value.diagnosisCode).toBe('E11.9');
    expect(r.value.diagnosisText).toBe('Type II DM');
  });

  it('keeps an unmapped diagnosis as a warning, because the visit still happened', () => {
    const r = validateAppointmentRow({ ...base, diagnosis: 'generalised weakness' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.value.diagnosisCode).toBeNull();
    expect(r.warnings.map(w => w.code)).toContain('UNMAPPED_DIAGNOSIS');
  });

  it('quarantines a visit for a patient that does not exist', () => {
    const r = validateAppointmentRow({ ...base, patient_mrn: 'PT-999', diagnosis: 'T2DM' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('UNKNOWN_PATIENT');
  });
});

describe('small normalisers', () => {
  it('normalises appointment status and falls back safely', () => {
    expect(normaliseStatus('No-Show')).toBe('no_show');
    expect(normaliseStatus('COMPLETED')).toBe('completed');
    expect(normaliseStatus('banana')).toBe('scheduled');
  });
  it('normalises disposition', () => {
    expect(normaliseDisposition('Home')).toBe('home');
    expect(normaliseDisposition('')).toBeNull();
  });
});
