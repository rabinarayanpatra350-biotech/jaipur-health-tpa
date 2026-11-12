#!/usr/bin/env python3
"""build_report.py — project report for the Full Stack Developer Fresher internship."""
from __future__ import annotations
import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

STEEL = RGBColor(0x0F, 0x51, 0x32)
GREY = RGBColor(0x55, 0x55, 0x55)
W = {"n": 0}

doc = Document()
doc.styles["Normal"].font.name = "Georgia"
doc.styles["Normal"].font.size = Pt(10.5)
for s in doc.sections:
    s.top_margin = s.bottom_margin = Inches(0.85)
    s.left_margin = s.right_margin = Inches(0.9)

def para(text="", size=10.5, bold=False, italic=False, align="justify", space_after=6, color=None):
    p = doc.add_paragraph()
    p.alignment = {"justify": WD_ALIGN_PARAGRAPH.JUSTIFY, "center": WD_ALIGN_PARAGRAPH.CENTER,
                   "left": WD_ALIGN_PARAGRAPH.LEFT}[align]
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.15
    import re
    for tok in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*)", text):
        if not tok: continue
        if tok.startswith("**") and tok.endswith("**"):
            r = p.add_run(tok[2:-2]); r.bold = True
        elif tok.startswith("*") and tok.endswith("*") and len(tok) > 2:
            r = p.add_run(tok[1:-1]); r.italic = True
        else:
            r = p.add_run(tok)
        r.font.size = Pt(size); r.font.name = "Georgia"
        if color: r.font.color.rgb = color
        if bold: r.bold = True
        if italic: r.italic = True
    return p

def h1(text):
    W["n"] += 1
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16); p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(f"{W['n']}. {text}")
    r.bold = True; r.font.size = Pt(15); r.font.color.rgb = STEEL; r.font.name = "Georgia"
    pPr = p._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr"); bt = OxmlElement("w:bottom")
    bt.set(qn("w:val"), "single"); bt.set(qn("w:sz"), "6"); bt.set(qn("w:space"), "2"); bt.set(qn("w:color"), "0F5132")
    b.append(bt); pPr.append(b)

def h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10); p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = STEEL; r.font.name = "Georgia"

def table(headers, rows, caption=None, widths=None, fs=8.6):
    if caption:
        cp = doc.add_paragraph(); cp.paragraph_format.space_before = Pt(8); cp.paragraph_format.space_after = Pt(3)
        cp.paragraph_format.keep_with_next = True
        cr = cp.add_run(caption); cr.italic = True; cr.font.size = Pt(8.5); cr.font.color.rgb = GREY; cr.font.name = "Georgia"
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, htxt in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        r = p.add_run(htxt); r.bold = True; r.font.size = Pt(fs); r.font.name = "Georgia"
        sh = OxmlElement("w:shd"); sh.set(qn("w:fill"), "E6F2EA"); hdr[i]._tc.get_or_add_tcPr().append(sh)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            for tok in str(val).split("**"):
                r = p.add_run(tok); r.font.size = Pt(fs); r.font.name = "Georgia"
            if str(val).startswith("**"):
                for r in p.runs: r.bold = True
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)

# ---------------------------------------------------------------- title
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(30)
r = p.add_run("Jaipur Health TPA"); r.bold = True; r.font.size = Pt(24); r.font.color.rgb = STEEL; r.font.name = "Georgia"

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("A Clinic Appointment and e-Prescription Platform"); r.font.size = Pt(14); r.italic = True; r.font.name = "Georgia"

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(14)
r = p.add_run("Project Report — Full Stack Developer Fresher Internship, Jaipur"); r.font.size = Pt(11); r.font.name = "Georgia"

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Rabi Narayan Patra"); r.bold = True; r.font.size = Pt(11.5); r.font.name = "Georgia"

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("26 September – 21 November 2026"); r.font.size = Pt(10); r.font.color.rgb = GREY; r.font.name = "Georgia"

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(18)
r = p.add_run("Repository  github.com/rabinarayanpatra350-biotech/jaipur-health-tpa"); r.font.size = Pt(9.5); r.font.name = "Georgia"
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Live  rabinarayanpatra350-biotech.github.io/jaipur-health-tpa"); r.font.size = Pt(9.5); r.bold = True; r.font.name = "Georgia"

doc.add_page_break()

# ---------------------------------------------------------------- 1
h1("Executive Summary")
para("This report describes a complete clinic appointment and e-prescription platform built for a fictional "
     "Jaipur health-insurance third-party administrator covering four hospitals. The brief asked for a system "
     "serving both patients and clinic staff, built on React with a Node and Express backend over PostgreSQL, "
     "seeded from deliberately messy hospital exports, and reporting average length of stay, bed occupancy and "
     "30-day readmission.")
para("The platform is delivered as a working application rather than a description of one. It comprises an "
     "Express API of eighteen endpoints, a React staff console, a PostgreSQL schema of eighteen tables and two "
     "views, an ETL pipeline that normalises the four hospitals' exports, a PostgreSQL-backed background job "
     "queue carrying queued email notifications, **97 passing tests**, a GitHub Actions pipeline that runs them "
     "against a real PostgreSQL service on every push, an OpenAPI 3.1 specification, and a live public build on "
     "GitHub Pages reading a managed PostgreSQL database.")
para("The most substantial work is the data layer. The brief names three specific kinds of mess, and each is "
     "handled by an explicit, testable rule rather than by hand: free-text diagnoses are mapped to ICD-10 codes "
     "through a reviewable table that keeps the original text beside the derived code; stays without a discharge "
     "date are recorded as *open* rather than given an invented one; and duplicate patient registrations are "
     "merged only on exact evidence, with the justification written down so a merge can be explained and "
     "reversed. The result is that 91.7% of visits carry a coded diagnosis and 24 duplicate registrations "
     "collapse into their canonical patient, with every rejected row preserved and explained.")

# ---------------------------------------------------------------- 2
h1("Requirement Coverage")
para("Every requirement in the brief, and where it is satisfied:")
table(["Requirement", "Delivered"],
      [["React front end, Node/Express, PostgreSQL", "React 18 + Vite (`web/`), Express (`server/`), PostgreSQL 16"],
       ["Data from 4 hospitals with the three named messes", "ETL pipeline; 91.7% coding coverage, 24 duplicates merged, 214 open stays recorded"],
       ["Sign-up, login, JWT + refresh tokens", "15-minute access tokens; 30-day opaque refresh tokens with rotation and reuse detection"],
       ["Role-based access for users and admins", "patient < clinician < admin, enforced in the API (`middleware/auth.js`)"],
       ["CRUD for at least three core entities", "Six: hospitals, patients, appointments, admissions, prescriptions, media"],
       ["Search with filters", "Every list endpoint; patients by name/MRN, appointments by hospital/status/date"],
       ["File or image upload", "`POST /api/media`, MIME-allowlisted, size-capped, generated filenames"],
       ["Admin dashboard: ALOS, occupancy, readmission", "`GET /api/metrics`, asserted against hand-computed values"],
       ["Validation on client and server", "One zod schema per endpoint, mirrored in the React forms"],
       ["Consistent errors, important events logged", "Uniform `{ error: { code, message } }`; pino request logs with patient data redacted"],
       ["Unit and API tests", "**97 passing** across six files"],
       ["GitHub Actions on every push", "`.github/workflows/ci.yml` against a real Postgres service"],
       ["Deploy with environment-based config", "`render.yaml`, `web/vercel.json`, `.env.example`; no secret committed"],
       ["**Stretch: email notifications**", "**Queued, not inline** — three templates"],
       ["**Stretch: background job queue**", "**`FOR UPDATE SKIP LOCKED`** on PostgreSQL"],
       ["Repository, live URL, API docs, diagram, README", "All delivered; see Section 9"]],
      caption="Table 1. Requirement coverage.", widths=[2.6, 3.9])

# ---------------------------------------------------------------- 3
h1("Architecture")
para("The system is three tiers plus a background worker:")
table(["Layer", "Responsibility", "Where"],
      [["Presentation", "React 18 staff console; static build for GitHub Pages", "`web/`, `docs/index.html`"],
       ["Application", "Express API: routing, authentication, validation, error handling", "`server/src/routes`, `middleware`"],
       ["Domain", "Business rules: metrics definitions, ICD-10 mapping, patient identity, queue semantics", "`server/src/services`, `etl`, `jobs`"],
       ["Persistence", "PostgreSQL: eighteen tables, two views, constraints as a backstop", "`server/src/db/schema.sql`"]],
      caption="Table 2. Layering.", widths=[1.2, 3.6, 1.7])
para("A deliberate property of the design is that `server/src/app.js` exports a factory and **never calls "
     "`listen()`**. That single decision is what allows the identical module to run as a long-lived server "
     "locally and as a serverless request handler on a hosting platform, without a second entry point or a "
     "divergent code path. The entry point that does listen lives in `server.js`, one file away.")
para("Errors are handled in one place. Every handler throws an `ApiError`, and a single middleware turns it "
     "into `{ error: { code, message, details } }` with a request id that also appears in the log line — so a "
     "user's report of a failure and the server's record of it refer to the same event.")

# ---------------------------------------------------------------- 4
h1("The Data Problem")
para("The four hospitals supply anonymised exports of appointments, admissions, lab tests and billing records. "
     "They are messy in exactly the ways the brief anticipates, plus several a real export always contains.")

h2("4.1 Diagnosis written in free text instead of codes")
para("The same diagnosis appears as `T2DM`, `Type II DM`, `DM2`, `diabetes mellitus type 2` and `Type 2 DM`. "
     "A fuzzy string match would confidently map `DM` to both *diabetes mellitus* and *dermatomyositis*; on a "
     "claims dataset that is not a rounding error, it is a wrong payment.")
para("The mapping is therefore an explicit table of eighteen ICD-10 concepts and roughly ninety aliases "
     "(`src/etl/icd10Map.js`), extensible from the TPA's own `diagnosis_dictionary.csv`. Two decisions matter. "
     "First, **both the derived code and the original text are stored**, so a mapping can be audited later "
     "rather than trusted — the same reasoning as keeping an exchange rate beside a converted amount. Second, "
     "text the table does not recognise is **reported, never guessed**: it stays as a visit with a null code, "
     "and the pipeline reports the coding coverage it achieved. On this dataset that is 825 of 900 visits, or "
     "91.7%, with the remaining 75 listed for the TPA to code.")

h2("4.2 Missing discharge dates")
para("214 of the exported stays carry no discharge date. Three states are distinguishable and must not be "
     "conflated:")
table(["State", "Interpretation", "Handling"],
      [["Discharge present, after admission", "A closed stay", "Counts toward length of stay and readmission"],
       ["Discharge absent", "An open stay — or a lost date", "Counted in occupancy, **excluded** from ALOS"],
       ["Discharge before admission", "Impossible", "Quarantined with a reason code; `CHECK` constraint as backstop"]],
      caption="Table 3. The three discharge-date states.", widths=[2.0, 2.0, 2.5])
para("The export cannot distinguish a patient still in hospital from a record whose date was lost, so the "
     "pipeline does not pretend to. It records the stay as open and reports how many there are. Dividing by an "
     "invented discharge date would produce a length of stay that looked plausible and was wrong — the worst "
     "possible outcome for a metric a TPA uses to price care.")

h2("4.3 Patients registered twice with different IDs")
para("Twenty-four patients appear twice under two medical record numbers. The duplicates differ in casing, "
     "spacing and phone formatting, so an exact-match dedupe finds none of them. Two identity keys are built — "
     "**name + date of birth** and **name + phone** — because neither alone suffices: 15% of rows have no date "
     "of birth and 10% have no phone.")
para("A row is merged only on an exact match after normalisation. **Name alone is never used**, because two "
     "different Ramesh Sharmas in Jaipur is not a rare event and merging them would attach one person's "
     "clinical history to another. Every merge writes a row to `patient_merges` recording the rule and the "
     "evidence, so it can be explained — and in principle reversed — by someone who was not there when it was "
     "made.")

h2("4.4 Data-quality outcome")
table(["Entity", "Read", "Loaded", "Quarantined", "Notes"],
      [["Hospitals", "4", "4", "0", ""],
       ["Departments", "15", "15", "0", ""],
       ["Doctors", "45", "45", "0", ""],
       ["Patients", "1,525", "1,501", "0", "24 merged as duplicates"],
       ["Appointments", "900", "900", "0", "75 unmapped diagnoses (warning)"],
       ["Admissions", "1,689", "1,616", "73", "214 open stays, 73 reversed dates"],
       ["Lab tests", "1,200", "1,200", "0", ""],
       ["Invoices", "800", "800", "0", ""]],
      caption="Table 4. The pipeline's outcome. Nothing is silently dropped.", widths=[1.4, 0.8, 0.9, 1.2, 2.2])
para("Every quarantined row is written to `etl_issues` with its source file, row number, reason code and the "
     "original row, so a decision can be reviewed later rather than reconstructed from memory.")

# ---------------------------------------------------------------- 5
h1("The Three Metrics")
para("Average length of stay, bed occupancy and 30-day readmission are defined once, in "
     "`server/src/services/metricsService.js`, so the dashboard, the tests and this report cannot drift apart. "
     "Each definition embeds a decision that changes the number, and each is stated rather than buried.")
table(["Metric", "Definition", "The decision it embeds"],
      [["Average length of stay", "Bed-days of closed stays ÷ discharges", "Open stays are excluded — dividing by an invented discharge date would understate it"],
       ["Bed occupancy", "Occupied bed-days ÷ (licensed beds × nights)", "One row per admission per night **is** a bed-day; grouping by (hospital, date) would cap occupancy at hospitals × days"],
       ["30-day readmission", "Discharges with a later admission within 30 days ÷ discharges", "Counted at **any hospital in the group** — a patient discharged from SMS and readmitted at Fortis is still a readmission"]],
      caption="Table 5. The metric definitions and the judgement inside each.", widths=[1.5, 2.0, 3.0])
para("On the seeded dataset the portfolio reports **ALOS 6.06 days, bed occupancy approximately 48%, and a "
     "30-day readmission rate of approximately 9%** — figures in the range a Jaipur TPA would recognise.")
para("These definitions are not asserted in prose alone. The metrics test builds a ten-bed hospital with a "
     "known set of stays and asserts against numbers worked out by hand: 100 available bed-days, 14 occupied, "
     "occupancy 0.14, two discharges, ALOS 3.5, one readmission of two. A change in definition fails the build "
     "rather than the monthly report.")

# ---------------------------------------------------------------- 6
h1("Authentication and Authorisation")
para("Access tokens are JWTs valid for fifteen minutes. Refresh tokens are **opaque random strings, not "
     "JWTs** — an opaque token can be revoked the instant it is used, whereas a self-contained JWT stays valid "
     "until it expires. Each refresh is a rotation: the presented token is revoked and replaced, and the new "
     "one joins the same family.")
para("Replaying a burned token is treated as evidence of theft: the entire family is revoked and the user must "
     "sign in again. This check runs **outside** the rotation transaction, and that detail is the whole "
     "security property. Revoking the family inside a transaction that then throws would roll the revocation "
     "back, leaving the attacker's token alive — precisely the attack the mechanism exists to stop. The test "
     "that asserts a replayed token is rejected also asserts the rotated token stops working.")
para("Authorisation is enforced in the API, not merely hidden in the interface: a hidden button is not an "
     "access control. Public sign-up always creates a *patient*; clinician and admin accounts are created by an "
     "administrator, otherwise the first person to register would own the system. A patient can read only their "
     "own prescriptions, and the test suite asserts that a patient receives 403 from the patient list and the "
     "dashboard.")

# ---------------------------------------------------------------- 7
h1("The Stretch Requirement: Email and a Job Queue")
para("Sending an email is a network call to somebody else's server. Done inline in a request handler, a slow "
     "SMTP host becomes a slow appointment booking and an SMTP outage becomes a failed booking — for a booking "
     "that was already committed to the database. The notification is therefore enqueued **in the same "
     "transaction as the business event**, so either both exist or neither does.")
para("The queue is PostgreSQL, not Redis. Workers claim rows with `FOR UPDATE SKIP LOCKED`, which gives exactly "
     "the semantics a worker pool needs: two workers cannot claim the same row, and a worker that dies "
     "mid-job leaves its lock to be reclaimed after a visibility timeout. Adding Redis to a deployment that "
     "already has PostgreSQL would add a moving part for no new capability.")
para("Under failure the queue retries with **exponential backoff and jitter**, gives up after a configurable "
     "number of attempts, records the final error, and deduplicates on a key so a retried request cannot send "
     "two emails. Jitter is not decoration: a hundred jobs that failed at the same instant would otherwise all "
     "retry at the same instant and recreate the outage that caused them to fail.")
para("Three notifications are queued — appointment confirmation, clinic alert and prescription issued — and "
     "every attempt is written to `email_log`, so *we told this patient* is a queryable fact rather than an "
     "assumption. The templates deliberately carry **no clinical content**: a notification that says *you have "
     "an appointment* is safe over unencrypted mail; one that says *your test result is ready* is not. Every "
     "interpolated value is escaped, because a patient's name is user input and an email body is exactly where "
     "an unescaped name becomes HTML injection.")

# ---------------------------------------------------------------- 8
h1("Testing and Continuous Integration")
table(["File", "Tests", "What it covers"],
      [["`tests/unit/normalise.test.js`", "30", "Dates, phones, genders, patient keys, row validators"],
       ["`tests/unit/icd10.test.js`", "20", "Free-text → ICD-10, dictionary overrides, refusals"],
       ["`tests/api/auth.test.js`", "12", "Signup, login, rotation, reuse detection, logout"],
       ["`tests/api/rbac.test.js`", "7", "patient < clinician < admin, enforced in the API"],
       ["`tests/api/metrics.test.js`", "7", "ALOS, occupancy, readmission vs hand-computed figures"],
       ["`tests/api/resources.test.js`", "21", "CRUD, filters, validation, job enqueueing"],
       ["**Total**", "**97**", "All passing"]],
      caption="Table 6. The test suite.", widths=[2.2, 0.7, 3.6])
para("The API tests run against a **real PostgreSQL instance**, not a substitute. The application depends on "
     "transactions, on `FOR UPDATE SKIP LOCKED` and on a `CHECK` constraint; a mock would prove none of them. "
     "Locally the suite starts a real PostgreSQL from bundled binaries, and CI runs the same tests against a "
     "PostgreSQL service container, so the code path under test is the code that ships.")
para("CI runs on every push across Node 20 and 22. A separate job fails the build if a `.env` file, a private "
     "key or a hard-coded secret is ever committed — the brief's *no exposed secrets* requirement enforced by "
     "the pipeline rather than by good intentions.")

# ---------------------------------------------------------------- 9
h1("Deployment and the Live Project")
h2("9.1 The live build")
para("**Live: rabinarayanpatra350-biotech.github.io/jaipur-health-tpa**")
para("A managed PostgreSQL 17 instance has been provisioned and seeded with the full dataset — 4 hospitals, "
     "1,525 patients, 1,616 admissions, 900 appointments, 1,200 lab tests — and a static build of the front end "
     "is published to GitHub Pages. It reads the same database through Supabase's REST API rather than the "
     "Express server, because GitHub Pages serves files and runs no code.")
para("That build carries the hospital directory, per-hospital metrics and the claims dashboard. It cannot carry "
     "sign-in, staff roles or patient records, because those require a server to issue a token and hold a "
     "session; the page states this in a visible note rather than letting a visitor discover it.")

h2("9.2 Row-level security as the boundary")
para("Once a browser addresses the database directly, the database is the only thing between a visitor and the "
     "data. Every table is closed by default and opened only where the public site genuinely needs it:")
table(["Table", "Anonymous access"],
      [["`hospitals`, `departments`, `doctors`", "SELECT — the organisational directory"],
       ["`public_hospital_metrics` (view)", "SELECT — aggregates only, no patient rows"],
       ["`patients`, `admissions`, `appointments`, `lab_tests`, `invoices`, `prescriptions`", "**none**"],
       ["`users`, `refresh_tokens`, `jobs`, `email_log`, `etl_*`", "**none**"]],
      caption="Table 7. Row-level security on the live database.", widths=[3.6, 2.9])
para("This was verified rather than assumed. Switching the database session to the `anon` role and querying "
     "each table returns 4 hospitals, 45 doctors, 15 departments and 4 metric rows — and **0 rows** from "
     "patients, admissions, appointments, lab tests, invoices, prescriptions and users. No diagnosis is "
     "reachable from the browser, which is the property that matters when the client can address the database "
     "directly.")

h2("9.3 The full-stack deployment")
para("`render.yaml` describes the complete arrangement the brief names: the API, a separate worker process and "
     "a managed PostgreSQL, created together from the repository. `web/vercel.json` configures the React build "
     "for Vercel. Both are environment-driven and contain no secret. The managed database is live; the "
     "full-stack hosting is configured and requires only the repository to be linked in the provider's "
     "dashboard, which is an action only the account owner can authorise.")

# ---------------------------------------------------------------- 10
h1("Design Decisions Worth Defending")
table(["Decision", "Alternative rejected", "Why"],
      [["Explicit ICD-10 alias table", "Fuzzy string matching", "Fuzzy matching maps DM to both diabetes and dermatomyositis; a wrong code is a wrong payment"],
       ["Open stays recorded as open", "Impute a discharge date", "An invented date produces a plausible, wrong length of stay"],
       ["Merge only on exact evidence", "Name-only matching", "Two people can share a name; merging attaches one person's history to another"],
       ["Opaque refresh tokens", "Self-contained refresh JWTs", "Only an opaque token can be revoked the instant it is used"],
       ["PostgreSQL queue", "Redis queue", "SKIP LOCKED already provides the semantics; Redis adds a moving part for no new capability"],
       ["Real PostgreSQL in tests", "In-memory mock", "The design depends on transactions and row locking, which a mock cannot prove"],
       ["Serverless-ready app factory", "A listen() call at import", "One module runs as a server and as a handler, with no second code path"]],
      caption="Table 8. Decisions and their justifications.", widths=[1.9, 1.8, 2.8])

# ---------------------------------------------------------------- 11
h1("Limitations")
para("**Patient identity is the weakest part of the design.** Name plus date of birth and name plus phone catch "
     "the duplicates in this dataset, but they will not catch a patient registered as *R. Sharma* at one "
     "hospital and *Ramesh Kumar Sharma* at another, or a phone number shared by a family. Worse, the merge is "
     "not reversible in the database: the merged record points at the survivor, but nothing re-splits it if the "
     "match was wrong. The fix is a real master-patient index — deterministic matching first, then probabilistic "
     "scoring with a human review queue for the middle band, and a merge that can be undone by replaying "
     "`patient_merges` backwards. The evidence is already recorded for exactly that reason.")
para("**Bed occupancy is measured against licensed beds**, which is the figure a TPA contracts on but not the "
     "figure a ward sister would quote; staffed beds would be more operationally honest and are not in the "
     "export.")
para("**The static build has no authentication**, by necessity rather than by choice. It exposes aggregates "
     "only, and the clinical tables are closed at the database rather than at the page.")
para("**The seeded dataset is synthetic.** It is sized and shaped to produce realistic metrics, but a real "
     "TPA export would be an order of magnitude larger and would contain mess this generator did not imagine.")

# ---------------------------------------------------------------- 12
h1("Conclusion")
para("The brief asked for a complete clinic appointment and e-prescription platform, built quickly but with "
     "production habits, from messy multi-hospital data, with a stretch requirement and a live deployment. What "
     "is delivered is a working system of eighteen endpoints, eighteen tables and two views, 97 passing tests, "
     "a normalisation pipeline that handles all three named data problems with rules that can be inspected, a "
     "PostgreSQL job queue carrying queued email, a live public build on a managed database, and a written "
     "record of the decisions — including the one part of the design that is not yet good enough.")
para("The recurring theme is that a number which looks plausible is more dangerous than one that fails. An "
     "alignment that silently produced a wrong tree, a length of stay computed from an invented discharge date, "
     "a diagnosis confidently mapped to the wrong code — each would have shipped without complaint. The "
     "approach taken throughout is to make the pipeline state what it could not do, rather than fill the gap "
     "quietly.")

out = "/scratch/output/Hospital_Platform_Project_Report.docx"
doc.save(out)
print("saved", out)
