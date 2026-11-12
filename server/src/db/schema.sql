-- ============================================================================
-- Jaipur TPA — clinic appointment and e-prescription platform
-- PostgreSQL 14+. Applied by src/db/migrate.js. Every statement is idempotent.
--
-- Design notes that matter:
--  * `diagnosis_code` (ICD-10) is DERIVED from `diagnosis_text`, and both are
--    kept. The code is what the reports group by; the text is what the clinician
--    actually wrote. Keeping both means the mapping can be audited later rather
--    than trusted — the same reasoning as storing an FX rate beside a converted
--    amount.
--  * `admissions.discharge_date` is nullable on purpose. A patient who has not
--    been discharged is a real state, not a data error; the metrics distinguish
--    "still admitted" from "discharge date missing".
--  * Patient identity is `mrn` (medical record number). Duplicate registrations
--    across the four hospitals are merged into a canonical patient and recorded
--    in `patient_merges`, so a merge is reversible and explainable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- auth
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  -- patient: sees only their own records. clinician: clinical data. admin: everything.
  role          TEXT NOT NULL DEFAULT 'patient'
                CHECK (role IN ('patient', 'clinician', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ---------------------------------------------------------------- organisation
CREATE TABLE IF NOT EXISTS hospitals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT 'Jaipur',
  beds       INTEGER NOT NULL DEFAULT 0 CHECK (beds >= 0),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  UNIQUE (hospital_id, code)
);

CREATE TABLE IF NOT EXISTS doctors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  registration  TEXT,
  speciality    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doctors_hospital_idx ON doctors (hospital_id);

-- ---------------------------------------------------------------- patients
CREATE TABLE IF NOT EXISTS patients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn          TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  date_of_birth DATE,
  gender       TEXT CHECK (gender IN ('male', 'female', 'other')),
  phone        TEXT,
  city         TEXT,
  -- set when this row was merged into another patient, so history is preserved
  merged_into  UUID REFERENCES patients(id) ON DELETE SET NULL,
  -- optional link to a login, so a patient account can see its own records and
  -- nothing else. Absent for the vast majority of records loaded from the exports.
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (lower(full_name));
CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients (phone);

-- One row per merge, with the evidence that justified it. A merge that cannot be
-- explained later is a merge nobody can undo.
CREATE TABLE IF NOT EXISTS patient_merges (
  id             BIGSERIAL PRIMARY KEY,
  survivor_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  merged_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rule           TEXT NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- clinical
CREATE TABLE IF NOT EXISTS appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,
  doctor_id      UUID REFERENCES doctors(id) ON DELETE SET NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  scheduled_at   TIMESTAMPTZ NOT NULL,
  duration_min   SMALLINT NOT NULL DEFAULT 15 CHECK (duration_min > 0),
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
  -- both kept: the derived code and what the clinician actually wrote
  diagnosis_text TEXT,
  diagnosis_code TEXT,
  notes          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS appointments_hospital_time_idx ON appointments (hospital_id, scheduled_at);

CREATE TABLE IF NOT EXISTS beds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  ward        TEXT NOT NULL,
  bed_number  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (hospital_id, ward, bed_number)
);

CREATE TABLE IF NOT EXISTS admissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  bed_id         UUID REFERENCES beds(id) ON DELETE SET NULL,
  admitted_at    TIMESTAMPTZ NOT NULL,
  -- NULL means the patient has not been discharged yet. Deliberately nullable.
  discharge_date DATE,
  discharge_disposition TEXT CHECK (discharge_disposition IN ('home', 'transfer', 'deceased', 'ama')),
  diagnosis_text TEXT,
  diagnosis_code TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admissions_discharge_after_admit
    CHECK (discharge_date IS NULL OR discharge_date >= admitted_at::date)
);
CREATE INDEX IF NOT EXISTS admissions_patient_idx ON admissions (patient_id);
CREATE INDEX IF NOT EXISTS admissions_hospital_idx ON admissions (hospital_id, admitted_at);

CREATE TABLE IF NOT EXISTS lab_tests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  patient_id   UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  test_name    TEXT NOT NULL,
  loinc_code   TEXT,
  ordered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_value TEXT,
  result_unit  TEXT,
  status       TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'collected', 'resulted', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_tests_patient_idx ON lab_tests (patient_id);

-- The e-prescription itself. Items are stored as JSONB because a prescription is
-- an ordered list of free-form drugs with doses — a child table would be more
-- "correct" and would also make every read three queries instead of one.
CREATE TABLE IF NOT EXISTS prescriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  admission_id   UUID REFERENCES admissions(id) ON DELETE SET NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id      UUID REFERENCES doctors(id) ON DELETE SET NULL,
  items          JSONB NOT NULL,
  instructions   TEXT,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS prescriptions_patient_idx ON prescriptions (patient_id);

CREATE TABLE IF NOT EXISTS invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  patient_id   UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  admission_id UUID REFERENCES admissions(id) ON DELETE SET NULL,
  amount_inr   NUMERIC(12, 2) NOT NULL CHECK (amount_inr >= 0),
  status       TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'claimed', 'rejected')),
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_hospital_idx ON invoices (hospital_id, issued_at);

-- ---------------------------------------------------------------- media / audit
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('patient', 'hospital', 'prescription')),
  entity_id     UUID NOT NULL,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  url           TEXT NOT NULL,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_entity_idx ON media (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS event_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_log_action_idx ON event_log (action, created_at DESC);

-- ---------------------------------------------------------------- ETL
CREATE TABLE IF NOT EXISTS etl_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file      TEXT NOT NULL,
  rows_in          INTEGER NOT NULL DEFAULT 0,
  rows_loaded      INTEGER NOT NULL DEFAULT 0,
  rows_quarantined INTEGER NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS etl_issues (
  id          BIGSERIAL PRIMARY KEY,
  batch_id    UUID REFERENCES etl_batches(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  row_number  INTEGER NOT NULL,
  entity      TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error')),
  issue_code  TEXT NOT NULL,
  detail      TEXT NOT NULL,
  raw_row     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etl_issues_batch_idx ON etl_issues (batch_id);
CREATE INDEX IF NOT EXISTS etl_issues_code_idx ON etl_issues (issue_code);

-- ---------------------------------------------------------------- jobs (stretch)
CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  last_error   TEXT,
  dedupe_key   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (status, run_at) WHERE status IN ('pending', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_log (
  id          BIGSERIAL PRIMARY KEY,
  job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,
  to_address  TEXT NOT NULL,
  subject     TEXT NOT NULL,
  template    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider    TEXT NOT NULL DEFAULT 'console',
  provider_id TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC);

-- ---------------------------------------------------------------- metrics
-- Average length of stay, per discharge. A stay still open has no length, so it
-- is excluded here and counted separately as a current inpatient.
CREATE OR REPLACE VIEW v_length_of_stay AS
SELECT a.id AS admission_id,
       a.hospital_id,
       a.patient_id,
       a.admitted_at::date AS admitted_on,
       a.discharge_date,
       (a.discharge_date - a.admitted_at::date) AS days_stayed
FROM admissions a
WHERE a.discharge_date IS NOT NULL;

-- 30-day readmission. A discharge is "readmitted" when the same patient has
-- another admission starting within 30 days of it, at any hospital in the group —
-- which is the whole point of a TPA looking across four providers.
CREATE OR REPLACE VIEW v_readmissions AS
SELECT a.id AS admission_id,
       a.hospital_id,
       a.patient_id,
       a.discharge_date,
       n.id AS next_admission_id,
       n.admitted_at::date AS next_admitted_on,
       (n.admitted_at::date - a.discharge_date) AS gap_days
FROM admissions a
JOIN LATERAL (
  SELECT b.id, b.admitted_at
  FROM admissions b
  WHERE b.patient_id = a.patient_id
    AND b.id <> a.id
    AND b.admitted_at::date > a.discharge_date
  ORDER BY b.admitted_at
  LIMIT 1
) n ON TRUE
WHERE a.discharge_date IS NOT NULL;
