# Planning and Diagnostic Export Review

**Status:** Implemented and verified locally.

**Goal:** Make the remaining AI context exports fit the ongoing coaching workflow without changing recommendation decisions or structured ledger identities.

**Scope and approach:** Reuse the existing purpose-specific renderers. Planning needs the full next 14 days of app-held commitments, readable development/session context, and its existing import instructions. Diagnostic needs evidence and uncertainty rather than the planning template. Both must preserve notes containing section-like text without confusing export metadata or truncating completed-training evidence. The bounded ledger audit found no reproducible defect; ledger/workout/assessment transport schemas remain unchanged.

- [x] Added regression tests for week-two fixed activities, travel and imported sessions, including read failures and horizon boundaries.
- [x] Made planning development/authority text readable while preserving diagnostic provenance and safety restrictions.
- [x] Separated diagnostic guidance from plan-authoring instructions.
- [x] Protected canonical metadata and section boundaries from headings inside athlete notes.
- [x] Updated the export contract to v12, relevant snapshots and documentation; ran focused checks and `make verify`.

**Additional verified finding:** Planning/diagnostic handoff summaries labelled provider recordings as sessions. They now explicitly describe provider recordings and point to canonical completed-training totals.

**Verification:** All 457 affected context-brief/service tests passed, as did TypeScript and ESLint. Independent review found no further actionable issues. `make verify` passed all required local gates, including unit suites, both Firestore-rule shards, all 65 browser tests, build, simulations, corpus/registry checks, policy drift and performance gates. Ledger JSON was audited separately without a confirmed defect; no ledger/workout schema or recommendation decision changed. No live account export or workout-export audit was performed.

**Stop condition:** Confirmed findings fixed and verified, with no new planning engine, export preset, dependency, synchronization mechanism or unrelated cleanup.
