/**
 * Free-text diagnosis -> ICD-10 code.
 *
 * The brief names this as the central data problem, and it is the one that cannot
 * be automated away. A fuzzy string match confidently maps "DM" to "diabetes" and
 * also to "dermatomyositis"; on a claims dataset that is not a rounding error, it
 * is a wrong payment. So the map is explicit, reviewable, and anything it does not
 * recognise is reported rather than guessed at.
 *
 * The dictionary ships as a CSV the TPA can edit (data/raw/diagnosis_dictionary.csv);
 * this module is the in-code fallback used when that file is absent, and the thing
 * the tests assert against.
 */

export const ICD10_CONCEPTS = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' },
  { code: 'I10', label: 'Essential (primary) hypertension' },
  { code: 'J18.9', label: 'Pneumonia, unspecified organism' },
  { code: 'A09', label: 'Infectious gastroenteritis and colitis' },
  { code: 'K29.70', label: 'Gastritis, unspecified, without bleeding' },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified' },
  { code: 'I50.9', label: 'Heart failure, unspecified' },
  { code: 'J44.1', label: 'COPD with acute exacerbation' },
  { code: 'K35.80', label: 'Unspecified acute appendicitis' },
  { code: 'J45.909', label: 'Unspecified asthma, uncomplicated' },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease without oesophagitis' },
  { code: 'D64.9', label: 'Anaemia, unspecified' },
  { code: 'N18.9', label: 'Chronic kidney disease, unspecified' },
  { code: 'I63.9', label: 'Cerebral infarction, unspecified' },
  { code: 'M54.5', label: 'Low back pain' },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified' },
  { code: 'R50.9', label: 'Fever, unspecified' },
  { code: 'L03.90', label: 'Cellulitis, unspecified' },
];

const ALIASES = {
  'E11.9': ['t2dm', 'type 2 diabetes', 'type ii dm', 'dm2', 'diabetes mellitus type 2', 't2 dm uncontrolled', 'type 2 dm'],
  I10: ['htn', 'hypertension', 'essential hypertension', 'high bp', 'ht', 'raised blood pressure'],
  'J18.9': ['pneumonia', 'lrti with pneumonia', 'community acquired pneumonia'],
  A09: ['gastroenteritis', 'age', 'acute gastroenteritis', 'acute ge', 'diarrhoea and vomiting'],
  'K29.70': ['gastritis', 'acute gastritis'],
  'N39.0': ['uti', 'urinary tract infection', 'urine infection', 'uti lower'],
  'I50.9': ['chf', 'congestive cardiac failure', 'heart failure', 'ccf'],
  'J44.1': ['copd exacerbation', 'acute exacerbation of copd', 'copd with ae', 'aecopd'],
  'K35.80': ['acute appendicitis', 'appendicitis', 'ac appendicitis'],
  'J45.909': ['asthma', 'bronchial asthma'],
  'K21.9': ['gerd', 'acid reflux', 'reflux disease', 'gord'],
  'D64.9': ['anaemia', 'anemia', 'anaemia moderate', 'low haemoglobin'],
  'N18.9': ['ckd', 'chronic kidney disease', 'ckd stage 4', 'renal failure chronic'],
  'I63.9': ['stroke', 'cva', 'ischaemic stroke', 'cerebrovascular accident'],
  'M54.5': ['low back pain', 'lbp', 'back pain', 'lumbar pain'],
  'E78.5': ['dyslipidaemia', 'high cholesterol', 'hyperlipidemia', 'dlp'],
  'R50.9': ['fever', 'pyrexia', 'puo', 'fever under evaluation'],
  'L03.90': ['cellulitis', 'cellulitis of leg', 'skin infection cellulitis'],
};

export const normaliseKey = (raw) => String(raw ?? '')
  .trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '');

const LOOKUP = new Map();
for (const [code, list] of Object.entries(ALIASES)) for (const a of list) LOOKUP.set(a, code);
for (const c of ICD10_CONCEPTS) LOOKUP.set(normaliseKey(c.label), c.code);

/** Builds the lookup from the TPA's editable dictionary CSV when one is supplied. */
export function buildLookup(rows) {
  const m = new Map(LOOKUP);
  for (const r of rows) {
    const key = normaliseKey(r.variant);
    if (key && r.concept_code) m.set(key, String(r.concept_code).trim());
  }
  return m;
}

/**
 * @returns {{ code: string|null, matchedBy: 'alias'|'label'|null, reason?: string }}
 */
export function mapDiagnosis(rawText, lookup = LOOKUP) {
  const key = normaliseKey(rawText);
  if (!key) return { code: null, matchedBy: null, reason: 'Empty diagnosis' };

  const hit = lookup.get(key);
  if (hit) return { code: hit, matchedBy: key === normaliseKey(rawText) ? 'alias' : 'alias' };

  // Already coded: "E11.9" or "I10" passed straight through.
  if (/^[A-TV-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i.test(String(rawText).trim())) {
    return { code: String(rawText).trim().toUpperCase(), matchedBy: 'label' };
  }
  return { code: null, matchedBy: null, reason: `Unrecognised diagnosis "${String(rawText).trim()}"` };
}

export const labelFor = (code) => ICD10_CONCEPTS.find(c => c.code === code)?.label ?? null;
export { ALIASES, LOOKUP };
