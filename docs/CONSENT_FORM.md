# Project Raven — Data Collection Consent Form

**Date:** ____________________

**Collection session reference number:** ____________________

Read the section that applies to you (A or B). Both sections share the same
storage, access, withdrawal, and deletion terms. Ask the project team member
present if anything is unclear before you sign. You will be given a copy of
the signed form.

---

## Variant A — Camera footage participants

For people who will be recorded walking known routes for the multi-camera
tracking corpus (Corpus B).

### What we are asking you to do

Walk a route we show you, normally, while our cameras record. You may be
asked to walk the same route a few times so we have repeated examples.

### What is being recorded

- How you look while walking (your appearance in the video: clothes, shape,
  movement).
- Where and when you appear in each camera's view.

What is **not** being recorded:

- No sound. The cameras record pictures only; audio is not captured, and any
  microphone on the recording device is turned off or has no microphone
  attached.
- No name, address, phone number, or any other personal detail is recorded
  as part of the footage. We label you with a participant code (for example
  "P03"), not your name, in the ground truth log.

### What the footage will be used for

Your footage will be used to train and test a person tracking system built
in the Raven project: software that follows the same person across several
camera views. Concretely this means:

- Measuring how well the tracker follows people (for example IDF1 scores
  recorded in `docs/RESULTS.md`).
- Tuning the system's matching settings on real lighting, occlusion, and
  camera angles.
- Showing the tracker working during the campus pilot demonstration.

Your footage will **not** be used for facial recognition against any
identity database, for identifying anyone outside this pilot, or for scoring
or predicting anyone's behaviour. Those uses are permanently out of scope
for Raven (D9, PRD §5).

### Where it will be stored

- On the project team's local machine only (the pilot workstation and its
  attached project drive).
- It is **not** uploaded to any cloud service, shared drive, or external
  server. Raven has no network path to the outside (no third-party calls
  anywhere in the pipeline), and your footage never leaves the premises
  network.

### Who will have access

- The Raven project team only: the people running the collection session
  and building the system.
- Nobody else: no other students, no campus administration, no police
  agency, no outside party. If an agency evaluator later reviews the pilot,
  they see the measured numbers and the system, not your raw footage,
  unless you have separately agreed to extended retention (below).

### How long it will be kept

- Until the M6 campus pilot evaluation is complete and its numbers are
  recorded in `docs/RESULTS.md`.
- After that, your footage is deleted, unless you tick the extended
  retention box below agreeing that it may be kept longer as part of the
  in-domain evaluation set (Corpus B).
- Deletion means the video files and any per-frame data derived only from
  your footage are removed from the pilot machine. Aggregate numbers
  already published (for example "IDF1 0.62 on session 2026-10-04") cannot
  be un-published, but they contain no pictures of you.

Extended retention (optional, opt-in):

- [ ] I agree that my footage may be kept after the M6 evaluation as part
  of the project's in-domain test set, under the same local-only storage
  and project-team-only access described above. I can still ask for it to
  be deleted later (see below).

### Voluntary participation and withdrawal

- Taking part is voluntary. You can refuse to take part, and you can stop
  at any time during the session, with no explanation needed and no
  consequences.
- If you withdraw **before your footage has been used in an evaluation
  run**, your footage is deleted and not used.
- If you withdraw **after your footage has already been measured**, the
  published aggregate numbers stay (they contain no pictures of you), but
  your raw footage and anything derived only from it is still deleted on
  request.
- In either case, tell any project team member present, or contact the
  team afterwards using the contact details they give you at the session.

### Deletion on request

- You can ask for your footage to be deleted at any point, whether or not
  you formally withdraw. Ask in person at a session or through the team
  contact details.
- The team will confirm in writing (email or signed note) once deletion
  is done.

### Signatures — Variant A

Participant name (print): ____________________

Participant code assigned (for example P03): ____________________

Date: ____________________

Participant signature: ____________________

Extended retention agreed? Yes / No (circle one; must match the tick box above)

Project team member name (print, witness): ____________________

Team member signature: ____________________

Date: ____________________

---

## Variant B — Handwriting participants

For people who will fill in FIR form templates with fictional content for
the handwriting corpus.

### What we are asking you to do

Fill in one or more printed FIR form templates (Maharashtra Police FIR
format, Form 154 CrPC layout) by hand, using the fictional story prompts
the team gives you (for example "a stolen bicycle on a named street").

### What is being written

- Fictional FIR content only: made-up names, addresses, dates, and
  incidents from the prompt sheet.
- **Do not use any real personal information.** Do not write your own
  name, address, or phone number, or anyone else's real details, or any
  real incident. Everything on the form must be invented.
- The team checks each form after collection; any form found to contain
  what looks like real personal information is excluded from the corpus
  and destroyed.

### What the forms will be used for

Your handwritten pages will be used to train and test a handwriting
recognition system built in the Raven project: software that reads
handwritten FIR forms, including English and Indic scripts. Concretely
this means:

- Measuring how accurately the recogniser reads handwriting (character
  error rate per script, recorded in `docs/RESULTS.md`).
- Testing page layout detection and form-field reading on real pen
  writing rather than typed text.
- Showing the recognition and review workflow working during the campus
  pilot demonstration.

The forms are never treated as real police records and never leave the
pilot case. No entity extracted from your fictional content is presented
as a real person or a real incident.

### Storage and access

Same as Variant A:

- Scans and transcriptions are stored on the project team's local machine
  only. They are not uploaded to any cloud service or external server,
  and they never leave the premises network.
- Access is limited to the Raven project team only. Nobody else sees your
  pages: no other students, no campus administration, no police agency,
  no outside party.

### How long the forms will be kept

- Until the M6 campus pilot evaluation is complete and its numbers are
  recorded in `docs/RESULTS.md`, then deleted, unless you agree to
  extended retention by ticking the box below.
- Deletion means the scans, transcriptions, and the paper forms (shredded)
  are all destroyed. Aggregate numbers already published (for example
  "CER 0.18 on Devanagari lines") cannot be un-published, but they
  contain no image of your handwriting linked to you.

Extended retention (optional, opt-in):

- [ ] I agree that my scanned forms and their transcriptions may be kept
  after the M6 evaluation as part of the project's in-domain test set,
  under the same local-only storage and project-team-only access described
  above. I can still ask for them to be deleted later.

### Voluntary participation and withdrawal

Same as Variant A:

- Taking part is voluntary. You can refuse, and you can stop at any time,
  with no explanation needed and no consequences.
- If you withdraw before your pages have been used in an evaluation run,
  they are excluded and destroyed.
- If you withdraw after measurement, published aggregate numbers stay
  (they contain no image of your handwriting linked to you), but your
  scans, transcriptions, and paper forms are still destroyed on request.

### Deletion on request

- You can ask for your forms and scans to be deleted at any point. Ask in
  person or through the team contact details given at the session.
- The team will confirm in writing once deletion and shredding are done.

### Signatures — Variant B

Participant name (print): ____________________

Writer code assigned (for example W07): ____________________

Date: ____________________

Participant signature: ____________________

I confirm that everything I wrote on the forms is fictional and contains
no real personal information about me or anyone else: Yes / No (circle one)

Extended retention agreed? Yes / No (circle one; must match the tick box above)

Project team member name (print, witness): ____________________

Team member signature: ____________________

Date: ____________________

---

*Notes for the team member running the session (not read out verbatim):
confirm with your faculty contact whether the host institution has its own
policy requiring additional approval before collection starts (D26) — this
is a check, not an assumed blocker. Do not start recording or handing out
forms until every participant present has signed. File signed forms by
session reference number; they are prerequisites for Corpus B collection,
not paperwork to catch up on later.*
