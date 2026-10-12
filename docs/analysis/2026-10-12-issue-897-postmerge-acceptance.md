# Issue #897 — Post-merge acceptance audit

**Date:** 2026-10-12 (Europe/Warsaw)
**Code baseline:** `main@6da708277a99e24d64eec65fa8af1c0f5e5e8b4c`
**Issue:** [#897](https://github.com/Szczepanov/adaptive-training-recommender/issues/897), OPEN; body and both comments retrieved on the audit date.
**Status owner:** [Performance outcome validation](../plans/performance-outcome-validation.md).

## Finding and scope

[PR #1043](https://github.com/Szczepanov/adaptive-training-recommender/pull/1043) merged WP8.2 on
2026-10-12 at 06:54:24 UTC / 08:54:24 Warsaw (`mergedAt` from GitHub). WP8.0 (#1033),
WP8.1 (#1036), WP8.3 (#1042), WP6.6 (#1016, merged 2026-10-09) and the WL import already exist on this baseline.
The smallest justified immediate slice is acceptance/status reconciliation and an operational
collection/readout procedure. No runtime change is justified by the three disclosed reader
limitations without additional authoritative inputs or a product contract decision.

This audit inspected code, test assertions, documents and GitHub metadata. It did **not** read
production athlete records, private lift exports or live assessments. Evidence below is engineering
proof from existing synthetic tests, not a claim that the athlete has completed the planned battery
or improved after training. The 19–25 October baseline is still a future plan on the audit date.
An unchecked GitHub checkbox is not evidence that its implementation is absent.

## Acceptance matrix

Rows follow every checkbox in the current issue body. Paths below are repository-relative;
references name modules/tests rather than transient line numbers. “Implemented” means the
contract and synthetic regression coverage exist; it does not establish operational acceptance.

| # | Acceptance criterion | Current authority and engineering proof | Actual athlete evidence / disposition |
|---|---|---|---|
| C1 | Start, complete and reconstruct exact protocol revision | `measurementProtocolService`, `assessmentAttemptService`, `assessmentCaptureService`; their tests and `testing-physical-capital.pw.ts` lock/capture/reload flows | Implemented; real reconstruction not inspected |
| C2 | Abandoned evidence retained, never benchmarked | `assessmentEvidenceEligibility` / `isBenchmarkEligibleAttempt`; eligibility, capture and goal-progress tests exclude abandoned/unknown parents | Implemented; real abandoned record not inspected |
| C3 | Valid completed canonical result with provenance | `assessmentDerivation` / `assessmentReducers`; derivation/reducer and capture-service tests retain source trial references and algorithm version | Implemented; real canonical record not inspected |
| C4 | Compatible repeat produces longitudinal comparison | `assessmentProgress` / `computeSeriesProgress` reuses `deriveProgress`; progress tests and broad-jump checkpoint E2E | Implemented; real comparable repeat not inspected; no reliability means raw delta only |
| C5 | Incompatible context/protocol never yields a numerical trend | `assessmentHistory`, `assessmentProgress`, `fixedLoadVelocity`; tests separate revisions/setup/method/load and withhold cross-series deltas | Implemented; real changed-setup evidence not inspected |
| C6 | Physical assessment appears once in training history | Ordinary `SessionRunner` execution; assessment stores are separate from performed occurrences (ADR-0023/0034/0046). Fixed-load E2E asserts one session execution; `canonicalBroadHistory.test.ts` covers matched structured/provider deduplication | Synthetic constituent proof; real Testing → Activities reconciliation remains to be checked |
| B1 | Bench 1RM bundled | `physicalCapitalProtocols` / `BENCH_PRESS_1RM_PROTOCOL`; protocol/catalog tests | Implemented; real gym use not inspected |
| B2 | Back-squat 1RM bundled | `BACK_SQUAT_1RM_PROTOCOL`; protocol tests and WL squat-import E2E | Implemented; real gym use not inspected |
| B3 | Standing broad jump bundled | `STANDING_BROAD_JUMP_PROTOCOL`; protocol tests and multi-trial checkpoint E2E | Implemented; real field use not inspected |
| B4 | Wall-touch CMJ bundled | `WALL_TOUCH_CMJ_PROTOCOL`; protocol/reducer tests pin touch-minus-reach semantics | Implemented; real field use not inspected |
| B5 | 3 kg seated chest throw bundled | `SEATED_MEDBALL_THROW_PROTOCOL`; protocol/reducer tests | Implemented; real field use not inspected |
| B6 | Three 6 s seated sprints, separate 1 s peak / 5 s mean | `CYCLING_6S_SEATED_SPRINT_PROTOCOL`; protocol tests pin metrics, warm-up/recovery/no-ERG; reducer test allows winners from different trials | Implemented; real sprint exports not inspected |
| B7 | Repeated jump/throw/sprint trials retained | `assessmentTrials`, `assessmentTrialService`; trial/capture/export tests, trial-rules emulator and broad-jump E2E | Implemented; actual trial completeness not inspected |
| B8 | Successful and missed strength loads retained | `assessmentTrials`, `assessmentReducers`; highest-successful-load and all-missed tests; diagnostic export preserves rows | Implemented; real failed-lift record not inspected |
| B9 | WL velocity has device/setup provenance | `wlAnalysisCsv`, `velocityFileImport`, capture drafts and trial context; WL import tests and squat-import E2E | Implemented; real camera/calibration/files not inspected |
| B10 | Failed heavier load cannot replace valid 1RM | `assessmentReducers` failed-heavier/invalid-success regressions | Implemented; no real 1RM acceptance asserted |
| B11 | Practice/familiarization cannot silently baseline | Shared eligibility plus trial validity filtering; `assessmentProgress.test.ts`, eligibility and block-review tests | Implemented; real purpose/validity choices not inspected |
| B12 | Historical cycling-5s-peak-power revision 1 unchanged | `physicalCapitalProtocols.test.ts` byte-for-byte historical summary-only fixture | Implemented; no migration or history rewrite |
| B13 | Reviewed comparable fixed-load mean velocity | Accepted ADR-0047 Option A; dedicated bench/squat protocols, `fixedLoadVelocity`, method/load/setup identity tests and fixed-load E2E | Implemented representation; real dedicated comparable repeat still needed; 1RM warm-up rows are not promoted |
| H1 | History baseline/latest/change/comparability | `assessmentHistoryService`, `AssessmentHistory`, `AssessmentSeriesCard`; service/component/progress tests and checkpoint E2E | Implemented; athlete interpretation not inspected |
| H2 | Existing progress vocabulary reused | `computeSeriesProgress` calls `deriveProgress` / `ov-progress-v1`; progress tests | Implemented; no second trend engine |
| H3 | Compact relevant planning Context Brief | `contextBriefAssessments`, `assessmentHistoryService.planning`, Context Brief renderer/service; relevance, partial-read and bounded-row tests (#1042) | Implemented; real coach readout not inspected |
| H4 | Normalized CSV | `assessmentCsvExport`; deterministic headers/rows and spreadsheet-boundary tests; history E2E downloads | Implemented; real export not inspected |
| H5 | Auditable diagnostic JSON | `assessmentExport`, `assessmentExportService`; tests and E2E retain protocols, trials, corrections and source/reducer provenance | Implemented; real raw-to-canonical audit not inspected |
| H6 | Supported typed goals, explicit measured squat/bench bridge | `exerciseAssessmentBridge`, `goalProgress`; tests separate bench/squat and measured/e1RM, reject ineligible attempts; architecture authority tests | Implemented (#1036); real goal evidence not inspected; no new goal type |
| V1 | Unit coverage for repeats/reducers/validity/revisions/provenance | Named domain/service tests above, including `fixedLoadVelocity.test.ts` | Existing synthetic coverage; no new runtime logic in this audit |
| V2 | Ownership/raw-trial emulator coverage | `assessmentTrialRules.emulator.test.ts`, `firestoreRulesParity.test.ts` | Existing synthetic security proof; no production write attempted |
| V3 | Summary-only history readable without migration | Protocol summary-only regression, history/export backward-compatible paths | Implemented; no real legacy export inspected |
| V4 | Multi-trial create/run/complete/history E2E | `app/tests/e2e/testing-physical-capital.pw.ts` broad-jump and fixed-load journeys | Existing synthetic browser proof; not real battery acceptance |
| V5 | Practical mobile gym/field capture | Capture components/draft storage tests, offline/reload fixed-load E2E; prior mobile UI review documented in the scoped plan | Engineering ergonomics/retry proof only; real phone/gym/offline acceptance remains unproved |
| V6 | Docs distinguish occurrence/attempt/trial/benchmark | `performance-outcome-evidence.md`, ADR-0023/0034/0046/0047 | Documented; no athlete data required for this criterion |

### Additional WP8.2 operational acceptance

The issue's “Goals and block outcomes” requirement and scoped WP8.2 done condition are also
covered by `BlockReviewService`, `BlockOutcomeReportService`, `blockOutcomeReport`, their tests,
`blockOutcomeArchitecture.test.ts` and `app/tests/e2e/block-evidence-review.pw.ts`.
The latter checks desktop/mobile exports, corrupt frozen evaluation rejection and two relevant
ecological outcomes after 105 unrelated records. #1043 recorded 69 focused tests, typecheck,
ESLint, independent review and `make verify` (8,419 frontend / 1,294 Python / 54 browser tests,
rule shards and latency gates; existing skips). Those are **historical #1043 results**, not new
runs by this docs audit and not proof of real comparable post-block acceptance.

Production route: **Testing → History → Review block evidence → choose pinned evaluation →
inspect report → export CSV/JSON**. Reader/report contracts remain `block-review-reader-v1` /
`block-review-report-v1`. Frozen intent/evaluation identity, hash, protocol/series, declared or
window baseline and target window are authoritative. No recommendation authority or policy bump.

## Limitation trace and startable work

| Limitation | Existing authority | Missing input / safe next boundary |
|---|---|---|
| Weekly-role evidence unsupported | `engine/coverage.ts` exact coverage authority; `blockProcessEvidence` / `KeyRoleEvidence` accepts planned/completed occurrence IDs | Evaluation spec has no frozen occurrence binding. A product decision must define an immutable prospective binding to the authored coverage identity and occurrences. Today's rolling coverage or titles cannot reconstruct it. Current empty role arrays are unsupported, not proof of zero roles. |
| No reliability reader | `progress.ts` / `SeriesReliabilityEstimate` keys estimates by comparison series; `models.ts` / `ReliabilityEstimate` records source/statistic/reference; report input accepts estimates | No persistence/reader authority is established in the reviewed services. Reader-only wiring is independently implementable **after** a reviewed authoritative source, series identity, provenance and availability contract exist. Personal estimation stays OV4.4-gated on real close-spaced comparable repeats and an explicit method decision. A baseline/checkpoint delta is not a reliability estimate. |
| Performed comparison not loaded | `sessions/performedComparison.ts` / `PerformedSessionComparison`; `completedWorkoutView.ts` exposes `structured.comparison`; canonical occurrences own physical-session identity | Review currently reduces occurrence data to completed session references; report input has no performed-comparison field. A bounded additive diagnostic reader is technically separable after deciding frozen planned/execution snapshot identity, scope, partial-source states and export contract. It must not infer weekly-role binding or change verdict authority. |

These are separate follow-up decisions, not evidence that all remaining work is only waiting for
training time. No limitation can be removed by documentation alone. The overall review remains
`insufficient_evidence` while weekly roles are unsupported, even when a metric shows a raw delta.
Missing reliability keeps metric interpretation conservative. Partial/truncated sources never
support “no repeat”, “no symptoms” or other absence claims.

Independently startable now: status reconciliation, real-device capture acceptance and baseline
collection with existing protocols. Real comparable post-block readout requires elapsed training
and later observations. Close-spaced repeatability needs suitable repeats plus its own reviewed
method. OV6.2 requires repeated report usage; OV8 requires multiple prospective comparable blocks
and a separate authority decision. None is silently added to #897's software checkbox scope.

## Exact evidence collection and readout procedure

1. **Agree the prospective evaluation before interpreting outcomes.** Use existing immutable
   intent/evaluation contracts, not a new score: record the chosen block ID/revision/hash, pinned
   evaluation ID/revision/content hash, activation date, each binding's protocol ID/revision,
   metric, comparison key, baseline selector and target window. Record the Warsaw as-of date.
   If the existing product cannot supply a pinned evaluation, retain that as a missing input;
   do not invent an authoring UI or retroactively substitute a newer revision. A late-frozen
   evaluation must be disclosed as retrospective, never relabelled as prospective evidence.
2. **Collect the planned October baseline through Testing.** On 19 October record planned
   reacclimation as `familiarization`; on the athlete's chosen 21/23/25 October measurement
   dates use `baseline`. Follow the selected immutable protocol's instructions and safeguards;
   record its actual revision, setup/device/context, local times, every successful/missed/practice/
   invalid trial and explicit import confirmations. Finish physical work through the ordinary
   runner and save assessment trials until the parent attempt is confirmed `completed`.
   Do not turn interrupted drafts or unknown parents into benchmarks.
3. **Prove capture on the actual phone.** Retain the attempt/execution references privately;
   reload a draft, perform the existing offline-save/reconnect retry flow, and verify retained
   rows plus one completed execution after retry. Check Testing History and Activities for one
   physical occurrence (including any Garmin match). If it duplicates, investigate canonical
   reconciliation rather than deleting evidence. Record device/browser, steps and observed result;
   synthetic tests do not replace this check.
4. **Export and audit the baseline.** Download assessment CSV and diagnostic JSON. Verify exact
   protocol revision, purpose, trial completeness, current correction heads, winning source trial
   and reducer version. A failed heavier strength lift must remain raw. Check same-day Warsaw
   body-mass source/reference only when relative context is present; unavailable stays unavailable.
   Keep lift files, reports and health data private and out of GitHub/Git.
5. **Collect the question-driven repeat after the intended block.** Use `post_block` (or
   `checkpoint` for the scheduled interim repeat) and the identical protocol revision, comparison
   context, equipment/method and fixed external load where applicable. Run dedicated fixed-load
   attempts for ADR-0047; do not repurpose incidental 1RM warm-ups. Changed parser/setup/revision
   creates a different series. Obtain real close-spaced comparable repeats separately if personal
   reliability estimation is requested; neither a sample count nor an estimator is invented here.
6. **Open and export the pinned block review.** At a Warsaw as-of date after the applicable target
   observations, use the production route above. Confirm intent/evaluation hashes and frozen
   baseline/target bindings, current head revisions and completed non-familiarization parents.
   Inspect every source status/count/limitation before reading deltas. Export both CSV and JSON;
   verify they agree on binding, observations and sidecar provenance. Event outcomes must match
   the event/evaluation predicate; the 100 matching / 200 scanned plus sentinel limits remain
   disclosed. Truncation means incomplete evidence, not absence.
7. **Write a human evidence readout.** List baseline/latest dates and values, exact comparable
   identity, raw delta, progress status/reasons and source limitations. Without a sourced series
   reliability estimate, say “raw change, no reliability estimate”; do not call it a reliable gain,
   stability or loss. Record observed process/response/ecological evidence separately. Overall
   verdict remains insufficient under the current reader. Record a human/external-coach adjustment
   note only as interpretation, with no causal claim or automatic selection authority.
8. **Revisit acceptance with the evidence packet.** Attach a private packet reference and a
   non-sensitive completion summary to the canonical OV tracking process. Distinguish observed
   success from unreadable/missing/incompatible data. Keep #897 open until each remaining
   criterion has independent proof or the owner explicitly rescopes it.

## Minimal missing-input list and precise next action

For operational #897 acceptance, supply: (a) an athlete-approved battery schedule and locked
protocol/setup identities; (b) actual completed baseline and later comparable repeat observations
with trial/correction provenance; (c) actual phone/offline/retry and single-occurrence verification;
(d) the exact pinned intent/evaluation packet with frozen windows/baseline and Warsaw as-of date;
(e) assessment and block CSV/JSON exports plus a human readout disclosing partial sources.
No production packet was provided or inspected in this audit.

To remove the three reader limitations, additionally supply explicit prospective frozen role
bindings, a reviewed series-specific reliability source/reader contract, and a bounded
performed-comparison identity/report contract. They are **not** prerequisites for collecting the
baseline or inspecting raw deltas, and lack of them must remain visible.

**Next action:** run the actual-device capture/retry acceptance check and collect the planned
19–25 October baseline with the existing Testing flow; preserve the diagnostic exports privately.
Confirm the pinned evaluation inputs before the later block readout. Wait for the real comparable
repeat rather than reimplementing WP8 or manufacturing a block verdict.

## Verification of this documentation slice

`make verify` selected docs scope against the code baseline above and passed repository hygiene
(including ESLint and mypy) and the coding-agent evaluation corpus. The first run lacked ESLint
in the fresh worktree; installing the existing lockfile dependencies resolved that environment
failure. `git diff --check` and a local assertion for 31 unique matrix rows and existing relative
Markdown link targets passed. An independent read-only subagent traced the three limitation
contracts and reviewed the edited documents; no material contradiction was found, and summary
wording was tightened to avoid implying operational acceptance. That review did not independently
re-audit all 31 criteria. No behavioral/unit/browser suite or real athlete check was rerun for
this docs-only slice. The #1043 counts above remain historical engineering evidence.
