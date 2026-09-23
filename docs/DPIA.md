# Data Protection Impact Assessment — Raven Campus Pilot

**System:** Raven criminal network analysis platform, campus pilot (M6).
**Law assessed against:** the Digital Personal Data Protection Act, 2023
(DPDP Act).
**Status:** pilot assessment. The system processes no real criminal case
data and no agency data; all pilot data is fictional content or
consented self-collected data (Corpus B, D19/D26). This assessment
covers the pilot as it will actually run, states what is unmeasured, and
names the gaps rather than omitting them.

**A note on the law itself:** as of the knowledge cutoff, the DPDP Act
has been enacted but not all of its Rules have been published. Every
statement below about compliance mechanics (consent manager flows,
Breach notification windows, Data Protection Board procedure) is
therefore conditional: compliance must be re-verified against the
published Rules when available. That re-verification is scheduled in §9
rather than assumed away here.

---

## 1. Purpose and scope

**What the system does.** Raven ingests case documents, communication
and financial records, and camera footage; extracts the entities and
relationships inside them; and presents a network in which every link
traces back to the evidence that produced it (PRD §1). In the campus
pilot specifically, it does three things: tracks consenting participants
across 4 cameras (S1b/S2), reads handwritten FIR-format forms with
fictional content (S3), and carries both through the full pipeline from
ingestion to graph to candidate review.

**What personal data it processes (pilot).** Video appearance of
participants (processed in memory, not stored as frames); appearance
embeddings derived from that video; participant codes linked to signed
consent records held on paper; handwritten pages (fictional content in
the writers' real handwriting — the handwriting itself is biometric-adjacent
even though the content is invented); login credentials and role
assignments of the pilot team; and the audit log of everything they do.

**Who processes it and in what role.** The project team acts as the
Data Fiduciary for pilot data: it determines the purpose (evaluation and
measurement) and the means (the Raven deployment on the pilot machine).
Participants are Data Principals. No Data Processor is engaged — there
is no cloud host, no analytics provider, no transcription vendor; every
stage runs on the premises machine. If an agency evaluator later
receives the system, the agency becomes the Fiduciary for any real case
data and this assessment must be redone for that deployment; nothing
here transfers.

**What it does not do.** This matters more than the feature list,
because each exclusion removes a category of harm:

- No facial recognition against identity databases. Appearance Re-ID
  within a session matches clothing/shape/movement across cameras; it
  never matches a face against a database of identities, and no such
  database exists anywhere in the system (D9, PRD §5).
- No predictive risk scoring. Movement routine analysis over confirmed
  historical data is in scope; forecasting who will offend, or scoring
  individuals for risk, is permanently excluded (PRD §5 — and the API
  carries no `risk_score` field by design).
- No automatic identity assertion. Cross-camera matches and entity
  merges are proposals with `status='proposed'`; a human confirms before
  anything enters a case record, the graph, or the map, with no code
  path, config flag, or confidence shortcut around that (rule 1, D9,
  FR-5.7).

---

## 2. Data inventory

Retention periods below are pilot periods. Anything kept longer needs
the participant's extended-retention agreement on the consent form and a
new row in this table.

| Data type | Source | Retention period | Who can access (by role) | Where stored | Encrypted in transit | Encrypted at rest |
|:---|:---|:---|:---|:---|:---|:---|
| Camera footage frames | Pilot cameras / recorded files | **Not stored.** Decoded, detected, and tracked in memory; MJPEG streamed to the viewer, never persisted | N/A (no stored frames to access) | Memory only | TLS required by design on all inter-service traffic, but **not implemented** in the current compose file — pilot runs on a trusted LAN only (see §6) | N/A |
| Appearance embeddings (`vector(512)`, pgvector HNSW) | Derived from footage at lock-on and per completed tracklet | Confirmed sightings retained for the pilot; unconfirmed tracklet embeddings expire per the D7 retention policy (exact expiry interval: not yet configured — see §8) | Investigating officer (confirm/reject), analyst (view), auditor (read-only verify), admin (unrestricted read-only oversight across every case, D37 amends D21 — no write/confirm capability) | Postgres + pgvector, premises machine | Same TLS caveat as above | Database volume encryption: **not configured** — relies on physical control of the pilot machine (see §6) |
| Location history (confirmed sightings, routine clusters) | Confirmed camera sightings, registered addresses, ingested records | Pilot duration, then deleted with the case unless extended retention agreed | Same role split as embeddings; routine responses always carry supporting point counts (FR-6.3) | Postgres (`location_history`), graph projection in Neo4j (derived, rebuildable) | Same TLS caveat | Same volume caveat |
| CDR records | Ingested CSV/JSON/XLSX via typed parse (no model inference) | Pilot duration (pilot CDRs are fictional fixtures, provenance `synthetic`, excluded from metrics per D19) | Same role split; cross-case reads denied by RLS (M0-T4, 81 tests) | Postgres (`cdr_records`), blobs content-addressed by SHA-256 | Same TLS caveat | Same volume caveat |
| FIR document text (scans + transcriptions) | Scanned handwritten forms (300 DPI PDF) + reviewer corrections | Until M6 evaluation complete, then deleted/shredded unless extended retention agreed | Same role split; every field from a non-gated script sits in the review queue until a person confirms (FR-2.6/2.7) | Postgres (`source_files`, `review_items`), blob store on disk | Same TLS caveat | Same volume caveat |
| Extracted entities, identifiers, relationships, evidence spans | NER over confirmed text; spans resolved deterministically (D11-A) | Pilot duration; merges reversible via `entity_merges.reversible_snapshot` | Same role split; merges are proposals until confirmed (FR-3.3) | Postgres, projected to Neo4j via the server saga (sole writer, D10) | Same TLS caveat | Same volume caveat |
| Audit log (`audit_log`, ledger anchors) | Every mutating endpoint writes an audit row before returning; file hash anchored at ingest, extraction hash after commit (D5) | Retained as the accountability record of the pilot; individual rows are not deletable (see §5 on the ledger limit) | Auditor (read-only review), admin (read-only, D37), all roles' actions recorded with their identity | Postgres + Fabric/mock ledger via the gateway | Same TLS caveat | Same volume caveat |
| User credentials | GoTrue (`auth.users`) + `profiles` (badge_no, full_name, role, ledger_id, org_unit) | Pilot duration; deactivation flips `active`, rows and audit trail survive (no delete path by design) | Admin manages accounts, and separately has unrestricted read-only oversight of case content (D37); users see only their own credential state | Supabase Auth schema + `public.profiles` | Same TLS caveat | Same volume caveat |

Why the two "same caveat" columns repeat instead of being footnoted:
an evaluator checking any single row should see the protection state
without chasing a footnote. The protection state is: physical and
network isolation doing the real work, cryptography configured but
incomplete. §6 says so plainly.

---

## 3. Legal basis

Under the DPDP Act 2023, personal data may be processed for a lawful
purpose with the Data Principal's consent, or without consent for
specified legitimate uses including State functions for law enforcement
purposes.

- **Pilot footage and handwriting (Corpus B): consent.** Every
  participant signs `docs/CONSENT_FORM.md` (Variant A for footage,
  Variant B for handwriting) before collection starts (D26). Consent is
  specific (what is recorded, what it is used for, where it is stored,
  who sees it, how long it is kept), voluntary, withdrawable at any
  time before evaluation use, and paired with deletion on request. This
  is the consent the Act requires, kept on paper by session reference
  number. Formal institutional ethics approval is not required for
  self-collected data among consenting adults who understand the
  purpose (D26); the team still confirms with its faculty contact
  whether the host institution's own policy requires additional
  approval, and collection does not start until that check is done.
- **Any future real case data: legitimate use for law enforcement
  purposes.** Raven's eventual agency deployment would process FIRs,
  CDRs, and footage under the Act's legitimate-use ground for State
  law-enforcement functions, not under participant consent. That ground
  is noted here so the pilot is not mistaken for the legal model of the
  production system — but it is not relied upon for anything in the
  pilot, where consent covers everything.
- **Rules gap (explicit).** The Act's operational detail — consent
  notice wording, consent manager interoperability, breach notification
  procedure, children's data rules, and the Board's process — sits in
  Rules that had not all been published as of the knowledge cutoff.
  This assessment therefore does not claim clause-level compliance with
  instruments that do not yet exist in final form. When the Rules are
  published, §§2–5 of this document must be re-checked against them
  (scheduled in §9), and any consent wording the Rules require must be
  added to `docs/CONSENT_FORM.md` before the next collection.

---

## 4. Data minimisation

What is **not** collected or stored is the strongest part of this
assessment, because absent data cannot leak:

- **Raw video frames are not persisted.** Frames are decoded (NVDEC),
  passed through detection and tracking, and discarded. What persists
  is detections, tracklets, and (only after human lock-on) appearance
  embeddings — never the pixels. The viewer sees MJPEG streamed from
  the engine node, not playback from storage.
- **Audio is not captured.** Collection uses picture-only recording;
  any device microphone is disabled or absent. There is no audio column
  anywhere in the schema to store it in.
- **Facial biometrics are not extracted or stored.** The Re-ID
  embedder (OSNet, 512-d) encodes whole-appearance similarity for
  within-session matching, not facial identity, and there is no face
  template table, no face matching endpoint, and no identity database
  to match against (PRD §5 exclusion).
- **No data leaves the premises network.** Extraction, recognition,
  and matching run on local hardware; map tiles come from the local
  PMTiles extract; fonts come from the local glyphs directory; the CI
  egress test fails the build on any third-party request (NFR-6). The
  pilot machine can be taken offline after setup with no loss of
  function.

Kept data is further minimised by role: the administrator who manages
users, cases, cameras, and templates has unrestricted read-only oversight
of case content but cannot write, confirm, reject, annotate or ingest
anything (D37 amends D21's original exclusion — see D37 for the pilot
operator's rationale for narrowing that separation-of-duties boundary);
analysts cannot confirm sightings; auditors cannot modify anything. The
graph default view is person-to-person with other types expanded only on
demand (D23), which limits incidental exposure during routine use.

---

## 5. Rights of data subjects

Under the DPDP Act 2023, Data Principals hold rights including access,
correction, and erasure (and nomination and grievance redressal, which
apply to the agency deployment rather than the pilot and are noted in
§8). How Raven supports each in the pilot:

- **Access.** A participant who asks what the system holds about them
  is shown: their consent record, their ground-truth log entries under
  their participant/writer code, their footage or scans, any embeddings
  or transcriptions derived from them, and the audit rows recording
  access to those items. The audit log is readable on request. The
  process for handling such requests (who receives them, response
  time) is currently unwritten — flagged in §8 as an unwritten process step, not
  by technology: the data is all retrievable, but no named owner or
  turnaround is assigned yet.
- **Correction.** Entity records, transcriptions (via the review
  queue's correction path, attributed to the reviewer), and
  case-assignment rows can all be amended; corrections are themselves
  audit-logged rather than silently overwritten. A participant who
  spots an error in their ground-truth entry or transcription can have
  it fixed by telling any team member.
- **Erasure.** Deletion on request is a consent-form promise and works
  as follows: rows derived from the participant are cascade-deleted
  from the entities/identifiers/relationships/evidence tables, blobs
  are deleted from the content-addressed store, and paper forms are
  shredded. **Limitation, stated honestly:** ledger entries cannot be
  deleted. An anchor (`docHash`) or action record written to the Fabric
  ledger or the mock log is tamper-evident precisely because it is
  append-only; erasing it would break the integrity guarantee for
  everyone else's evidence. What erasure therefore means for anchored
  items is: the content is deleted, the hash remains as an
  uninterpretable string with no recoverable link to the person, and
  the erasure itself is recorded as a new ledger action. Participants
  are told this before they sign (the consent form states that
  published aggregate numbers cannot be un-published); the mechanism
  above is how the team honours the deletion half of that promise.

---

## 6. Security measures

- **On-premises only, no cloud egress (D6, rule 6).** The single most
  effective control: the attack surface of a machine with no outbound
  data path is the LAN it sits on. Verified by the network policy test
  in CI, map tiles and fonts included.
- **Role-based access control (D21, D37).** GoTrue authentication,
  per-case row-level security, and four roles with distinct capability
  sets: three case-working roles gated by case assignment, plus an
  administrator with unrestricted read-only oversight across every case
  (D37 amends D21's original exclusion) and no write/confirm/ingest
  capability anywhere. An RLS bug is treated as a data breach and has a
  dedicated suite (NFR-8; 81/81 green, `RESULTS.md` M0-T4-rls rows) —
  that suite still denies admin at the direct-Postgres layer it tests,
  which is an intentionally tracked gap from the API-layer grant, not a
  contradiction (see D37's consequences).
- **Tamper-evident ledger (D22).** File hash anchored at ingest,
  extraction hash after commit (D5); opening a document recomputes its
  hash and compares; mismatch marks every derived entity and edge and
  excludes them from analysis (FR-4.6). Multi-org endorsement (policy
  `AND('district-cid.member','cyber-cell.member')`) means altering a
  record requires cross-agency collusion. The pilot runs the mock
  ledger until Fabric is stood up — mock endorsements render with the
  amber MOCK LEDGER badge and are never presented as real.
- **All actions attributable (D21).** Confirmations, rejections,
  merges, annotations, and evidence access are signed with the
  authenticated user's ledger identity. Every mutating endpoint writes
  an audit row before returning (API_CONTRACTS rule 6).
- **RLS enforced at database level (M0-T4, 81 tests).** Policies live
  in the migrations, not in application code; application code never
  uses a service-role key on a user's behalf. The D28 tightening of
  `insight_reviews` (fail-closed on unresolvable types) is part of this
  posture.
- **TLS on all inter-service communication — required, not yet
  implemented.** `ARCHITECTURE.md` §1.1 mandates TLS with mutual
  authentication on every boundary including loopback. The current
  compose file does not implement it (plain HTTP/Bolt, flagged since
  M0-T8). The pilot compensates with a trusted premises LAN and no
  exposure beyond it, but this is compensation, not compliance: TLS
  remains an open item in §8 and must land before any agency pilot.

---

## 7. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|:---|:---|:---|:---|
| False cross-camera match leading to wrong identification | Medium (Re-ID accuracy unquantified; S2 blocked) | High (in production: liberty harm; in pilot: fictional participants, so contained — but the mechanism must be judged as if it were not) | Human confirmation required before anything enters the record (D9); evidence panel shows both crops, score, threshold, topology expectation, and time gap (FR-5.6); rejected candidates remain visible as audit evidence and tuning signal |
| Human error at the confirmation step (confirming a wrong candidate the system correctly scored low) | Medium (review fatigue is real; throughput is bounded by human review by design) | High (same liberty harm, one step removed) | Scores and thresholds stay visible rather than collapsing to a yes/no; rejections recorded; merges reversible via `reversible_snapshot`; confirmation is a signed, anchored, attributable act, which changes the psychology from clicking through to deciding |
| Unauthorised access to case data | Low on a premises LAN with RLS enforced | High (case content exposure); a compromised administrator credential is now also a full case-content-exposure vector, not just account control (D37 amends D21 — see §6) | RLS at database level with 81-test suite; case-assignment gating for the three case-working roles; audit log of access (including admin reads, D37); no service-role key in application paths |
| Evidence tampering | Low (requires host access or cross-org collusion) | High (integrity of the record) | Ledger anchoring (D5), recompute-and-compare verification on read, tamper state propagating to graph entities and edges (FR-4.6), multi-org endorsement in fabric mode |
| System error producing wrong entity merge (fusing two people's records) | Medium (extraction precision measured low on Enron S4 rows; resolution metrics unmeasurable — no resolver implements FR-3.3 yet) | High (fused records attribute one person's history to another) | Every merge recorded and reversible (FR-3.3); merges are proposals until confirmed; pairwise/B-cubed measurement required before any correctness claim (S4) |
| Data breach via network | Low in the pilot topology (no egress path, trusted LAN) | High | Premises-only deployment, no external endpoints, CI egress gate; residual exposure is the unimplemented inter-service TLS (see §6) plus physical access to the machine |
| Model bias in appearance matching (worse accuracy for some clothing styles, body types, lighting conditions, or skin tones) | Unknown — **unquantified at this stage** | High if carried into production unmeasured | Flagged as a known open risk (§8), not mitigated away: S2 measurement on collected footage is pending, and no fairness disaggregation exists yet. The pilot must log participant diversity limits honestly rather than claiming representativeness it does not have |

---

## 8. Residual risks and open items

These are not failures. They are the honest state of a system in pilot,
and documenting them is more credible than omitting them.

- **S2 Re-ID accuracy unquantified.** No rank-1/mAP, no IDF1/HOTA, no
  precision at the operating threshold, no topology-prior ablation
  (`RESULTS.md` S2 STATUS rows, BLOCKED through 2026-09-15). The pilot
  exists partly to produce the first real numbers.
- **S3 HTR accuracy unquantified.** No per-script CER on any data,
  benchmark or in-domain; the gate raises rather than guesses
  (`docs-lane/gate.py`). Every pilot form routes to the review queue.
- **DPDP Act Rules not fully published.** Clause-level compliance
  mechanics cannot be finally verified until they are (see §3). The
  re-verification is scheduled, not assumed.
- **Model bias not assessed.** No disaggregated accuracy measurement
  exists for the detector, tracker, or embedder across the dimensions
  that matter for fairness. Until S2 runs with a documented,
  diverse-enough participant set, any claim about equal performance is
  unearned — and none is made here.
- **Access-request process unwritten (§5).** The data is retrievable;
  the owner and turnaround are not assigned.
- **Inter-service TLS unimplemented (§6).** Required by architecture,
  absent from compose, compensated by LAN trust in the pilot only.
- **Tracklet embedding retention interval unconfigured (D7/PRD Q5).**
  The policy direction (confirmed sightings retained, unconfirmed
  embeddings expire) is decided; the exact expiry is not. Before
  continuous operation, set it — an unbounded gallery is a slow-motion
  data-hoarding breach of minimisation.
- **Nomination and grievance redressal mechanics** (DPDP Act rights
  beyond access/correction/erasure) are not designed for the pilot
  scale and must be designed before any agency deployment.

---

## 9. Review schedule

| Trigger | Who reviews | What happens |
|:---|:---|:---|
| Before each pilot deployment | Project team lead + faculty contact | Re-read this document against the actual machine, data, and participant set; update §§2 and 6 if anything changed; confirm consent forms match the current system behaviour |
| After any significant system change (new data type stored, new role or permission, new network path, Fabric replacing mock, TLS landing, retention interval set) | Project team | Amend the affected section in the same change (same discipline as `DECISIONS.md`: mark superseded text, never silently overwrite); record the amendment date |
| After DPDP Rules are published | Project team lead | Clause-level re-verification of §§3–5; consent form wording updated before the next collection; residual item closed or re-dated |
| After S2/S3 first measurements land in `RESULTS.md` | Project team | Update §§7–8: likelihoods re-scored with numbers, bias item either measured or explicitly still open |
| Annually at minimum, even if nothing changed | Project team lead | Confirm-or-update pass; a year with no review is a process failure |

*Document history: created for the M6 campus pilot preparation. No
prior version exists; the first review is the pre-pilot review above.*
