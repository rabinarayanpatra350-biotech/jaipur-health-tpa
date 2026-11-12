import { describe, it, expect } from 'vitest';
import { mapDiagnosis, buildLookup, normaliseKey, ICD10_CONCEPTS, labelFor } from '../../src/etl/icd10Map.js';

describe('mapDiagnosis', () => {
  it.each([
    ['T2DM', 'E11.9'], ['type 2 diabetes', 'E11.9'], ['Type II DM', 'E11.9'], ['DM2', 'E11.9'],
    ['HTN', 'I10'], ['high bp', 'I10'],
    ['UTI', 'N39.0'], ['urine infection', 'N39.0'],
    ['AECOPD', 'J44.1'], ['CCF', 'I50.9'], ['CVA', 'I63.9'],
  ])('maps the free-text "%s" to %s', (raw, code) => {
    expect(mapDiagnosis(raw).code).toBe(code);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapDiagnosis('  t2dm  ').code).toBe('E11.9');
    expect(mapDiagnosis('TYPE 2 DIABETES').code).toBe('E11.9');
  });

  it('maps the canonical label as well as the abbreviation', () => {
    expect(mapDiagnosis('Type 2 diabetes mellitus without complications').code).toBe('E11.9');
  });

  it('passes an already-coded diagnosis straight through', () => {
    expect(mapDiagnosis('I10').code).toBe('I10');
    expect(mapDiagnosis('E11.9').code).toBe('E11.9');
  });

  it('returns null and a reason for text it does not recognise, rather than guessing', () => {
    const r = mapDiagnosis('generalised weakness');
    expect(r.code).toBeNull();
    expect(r.reason).toMatch(/Unrecognised/);
  });

  it('returns null for empty input', () => {
    expect(mapDiagnosis('').code).toBeNull();
    expect(mapDiagnosis(null).code).toBeNull();
  });

  it('never maps two different concepts to the same code', () => {
    const codes = ICD10_CONCEPTS.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('buildLookup', () => {
  it('lets the TPA dictionary extend and override the built-in map', () => {
    const lookup = buildLookup([
      { concept_code: 'R51', variant: 'headache' },
      { concept_code: 'J06.9', variant: 'T2DM' }, // deliberate override
    ]);
    expect(mapDiagnosis('headache', lookup).code).toBe('R51');
    expect(mapDiagnosis('T2DM', lookup).code).toBe('J06.9');
    expect(mapDiagnosis('HTN', lookup).code).toBe('I10'); // built-ins survive
  });
});

describe('normaliseKey', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normaliseKey('  Type   II  DM. ')).toBe('type ii dm');
  });
});

describe('labelFor', () => {
  it('returns the human label for a code', () => {
    expect(labelFor('E11.9')).toMatch(/Type 2 diabetes/);
    expect(labelFor('NOPE')).toBeNull();
  });
});
