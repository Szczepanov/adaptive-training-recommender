# Plan status reconciliation — 2026-09-17

This is a dated audit of `docs/plans/` against the latest `origin/main` repository state
(commit `a9d6ccbe`). The canonical mutable status board remains
[`docs/plans/README.md`](../plans/README.md); this document records the evidence and the
disposition of work that is easy to misread as an unfinished implementation task.

## Audit scope

- 65 plan and companion Markdown files under `docs/plans/` (the status board excluded).
- Plan headers, task boards, acceptance checklists, cross-plan ownership notes, and recent
  delivery commits.
- Recent deliveries included in this reconciliation: PRs #464, #471, #572, #583, #626,
  #627, #631, and the dependency/integration hardening in #632.

The result is that no Phase 0–8 implementation is outstanding. The remaining work falls into
three different categories and must not be collapsed into one delivery queue:

1. evidence or real-use collection;
2. production activation decisions with explicit safety gates; and
3. remaining implementation or verification work that is actionable only when its named
   dependency or usage trigger is satisfied.

## Remaining work matrix

| Owner | Current remainder | Kind | Disposition |
|---|---|---|---|
| Phase 9.0 | 9.0.7 run the real block; 9.0.8 readout and decision | real-use evidence | Startable; the repository already has the ingestion, journal, export, and isolation surface. The historical 2026-08-22 target date has passed without a recorded completed block. |
| Phase 9 | 9.8 prospective subjective-baseline go/no-go | evidence/activation | Waits for Phase 9.0 prospective evidence. |
| HRF | HRF8 replay plus independent paired-reference evidence; HRF9 activation; HRF11 living closeout; HRF10 only if its usage trigger fires | evidence/activation | Default-off. No HR-derived production authority is implied by HRF0–HRF7. |
| WU | WU5 catalog-specific visual capture and full host-window verification | closed verification | Completed in the follow-up working-tree verification: the primary catalog journey and full 60-capture refresh pass at desktop and 390 px mobile widths. |
| M | M6.1–M6.4, M8.1–M8.3, M9.1–M9.3 | usage/evidence gates | Deliberately not a sequential delivery queue. Start only when each named trigger is real. |
| OV | OV7.1 capture of a real event outcome, then OV7.2–OV7.4; OV4.4/OV6.2 on their triggers; OV8 after multiple comparable blocks | operational evidence | PR #631 delivered the OV7 capture infrastructure, but the plan correctly remains open until real event data and the block readout exist. |
| HA | HA6.4 labelled personal history, HA7 release evidence, HA8 visible surfaces, HA9-R3/R4/R5/R6 evidence and release decisions | evidence/activation | Shadow anomaly work is shipped; user-visible wording and training tightening remain gated. |
| SV | SV6 multi-block prospective calibration synthesis | real-use evidence | Requires multiple real athlete blocks. |
| MS | MS17 metric-by-metric production activation decision | activation | Google Restricted Scope App Verification/CASA for Google Health transport, verified in-app health-data disclosure and explicit consent, sufficient prospective/incremental evidence, and a rollback flag remain required; fusion stays off. |
| PI | PI8 prospective labels, PI9 activation decision, PI10 activation-time telemetry/retention policy | evidence/activation | Historical replay and review UI are delivered; no production identity promotion has been accepted. |
| ES | ES9 continued shadow accumulation and ES10 activation review | evidence/activation | Direct Eight Sleep ingestion remains default-off. |
| TO | TO4 history shadow evidence and TO5 FIT identity evidence | evidence/activation | Decode/shadow only; no new live recommendation authority is authorized. |
| SKR | SKR5 freshness governance; SKR6 human-reviewed evidence-synthesis workflow when demand justifies it | planned governance | SKR1–SKR4 are delivered; no high-impact/high-safety uncovered family remains. |
| SAW | Completion/deployment verification for the server-authoritative anthropometry path | closed verification | The 2026-09-17 production release at `a9d6ccbe` passed CI, backend/index/rules/Hosting deployment, and the Hosting → anthropometry rewrite smoke check; focused tests and the full frontend gate also pass. |
| RP / ADR-0038 | RP0, RP1, RP3, RP4, RP5A, RP5B; RP2 is implemented | draft/activation | Behavior remains blocked until ADR-0038 is accepted or explicitly authorized. |

## Closed or deliberately deferred work

- Phases 0–8, AJ, G, CT, E2E, UX, SEP, and BC0–BC4 are delivered. BC5 is explicitly
  optional and skipped by its own plan.
- Issue #458 diagnostics and issues #459–#461 are merged; their plans are implementation
  records, not open work queues.
- H4 Phases 1–6, H5a–H5c, external-plan@5, and confirmed progression selection wiring are
  delivered. Full D-AUDIT placement compliance and unsupported evergreen coverage roles remain
  explicitly unscoped follow-ups, not hidden H4/H5 tasks.
- Strength load costing, zone-derived credit, multisource fusion, identity promotion, and
  other default-off candidates remain evidence-gated by design. Their lack of activation is
  not an implementation defect.

## Companion-document disposition

The following files remain useful historical or review material but are not independent status
boards:

- `training-occurrence-implementation-checklist.md`, `training-occurrence-open-questions.md`,
  `training-occurrence-pr1-scope.md`, `training-occurrence-review-checklist.md`,
  `training-occurrence-review-notes.md`, and `training-occurrence-summary.md` are pre-PR324
  design/review companions. Their unchecked checkboxes are not current tasks.
- `strength-recommendation-canonical-occurrence-cutover-plan.md` is superseded for current
  status by the TO row and ADR-0034; its PR1–PR3 design history remains useful, while TO4/TO5
  own the remaining rollout evidence.
- `h4-434-pr3-phase3-handover.md` is already explicitly superseded, and the H4 analysis and
  pipeline notes are historical implementation records.
- `2026-08-27-real-google-health-ingestion.md` is a supplemental MS evidence log; MS17's
  canonical status belongs to `multisource-health-and-recovery-ingestion.md`.
- `h5c-pr517-review-hardening.md` is a review note. Its remaining write-once review-snapshot
  boundary is future scope, not an unrecorded H5c delivery task.

## Documentation actions taken with this reconciliation

1. Add ADR-0038 recovery placement to the central plan board.
2. Align the MS, HRF, PI, and SKR plan-level lifecycle labels with the work already started,
   and preserve the complete evidence/compliance/activation gates in both plan headers and the
   central board.
3. Record the latest OV7 and SAW implementation boundaries without prematurely calling their
   operational verification complete.
4. Mark pre-PR324 occurrence documents and the old strength cutover plan as historical
   companions.

No source-code behavior, production policy, or activation flag is changed by this audit.
