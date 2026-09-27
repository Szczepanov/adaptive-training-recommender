# Training occurrence TO4 / TO5 shadow evidence — 2026-09-27

## Decision summary

Neither new authority can be qualified for activation yet. The export, derivation,
counterfactual and report tooling that #646 asked for was run on real user data on 2026-09-27
for the authorized account (90-day window: `2026-06-30` to `2026-09-27`).
All 73 Garmin original FIT files were downloaded and decoded in memory with zero failures,
and all 4 merged occurrences in the private review sheet were reviewed and labelled (`correct_merge`).

The record-derived gates passed in that baseline. During this review the FIT export boundary was
hardened further: an explicit `--user-id` now requires the exact active server-side Garmin
`tokenObject`, and rate-limited files remain inside the declared FIT denominator. Because the
recorded baseline predates that mechanical token-binding check, the full cross-user FIT isolation
gate requires a fresh run before any activation decision. Activation of broad canonical completed
history and FIT identity remains blocked regardless:
1. **Broad canonical history (`BLOCKED_NEEDS_MORE_EVIDENCE`):** 22 canonical exposures were
   derived, but 3 occurrences remain unknown (1 multiple provider sources, 2 manual executions
   with non-catalog semantics). Furthermore, because `performedTrainingOccurrences` only covered
   part of the 90-day window, 54 live Garmin activities had no canonical occurrence counterpart
   (`pairedLiveOnly: 54`), creating substantial exposure count and workload deltas. The
   counterfactual sensitivity series showed changed projections across 78 dates (unresolved).
2. **FIT identity (`BLOCKED_NEEDS_MORE_EVIDENCE` / `BLOCKED_NEEDS_ADAPTIVE_IDENTITY`):**
   While 100% of available originals were successfully decoded with 16 semantic definition
   fingerprints and zero repeat mismatches, Adaptive produces no identity comparable with
   `fit-workout-v2`, so FIT fingerprints remain diagnostic.

| Surface | Decision | Reason |
|---|---|---|
| Broad canonical completed history for fatigue, delivered dose, and objective bookkeeping | `BLOCKED_NEEDS_MORE_EVIDENCE` | Canonical derivation derived 22 exposures; 3 occurrences remain unknown (non-catalog structured semantics and multiple provider sources). 54 older live activities lack canonical occurrences. Recommendation counterfactual sensitivity shows 78 changed dates. Remaining capability gaps 1 & 2 apply. |
| FIT fingerprint as reconciliation evidence | `BLOCKED_NEEDS_MORE_EVIDENCE` (TO5 class `BLOCKED_NEEDS_ADAPTIVE_IDENTITY`) | 73/73 originals decoded in memory (16 semantic definition fingerprints, 57 unguided, 0 decode failures). However, Adaptive produces no identity comparable with `fit-workout-v2`, so FIT fingerprints stay diagnostic. |
| Optional Activities policy | `KEEP_CURRENT_AUTHORITY` | No Activities flag change is in scope. |

No recommendation, history or FIT identity authority is activated or widened. PR #331's live
canonical weekly coverage credit is unchanged. Legacy `CompletedTrainingEvent` to
`CompletedExposure` remains the broad fatigue/dose/objective history path.

## Reproduction and provenance

- Issue: [#646](https://github.com/Szczepanov/adaptive-training-recommender/issues/646)
- Baseline source commit: `1fd23c7c` (`origin/main` merged into the issue branch on 2026-09-27)
- Performed occurrence schema: `1`
- Reconciliation matcher: `matcher-v1`
- Reconciliation policy: `policy-v1`
- Coverage policy: `2026-09-canonical-coverage-credit-v1`
- FIT fingerprint: `fit-workout-v2`
- Engine `POLICY_VERSION`: `2026-09-mechanical-progression-live-wiring-v1` (not changed by this work)
- Corpus window: `2026-06-30` to `2026-09-27` (90 days)
- Real-history denominator: 77 occurrences / 73 Garmin activities / 25 performed training occurrences / 3 executions / 45 recommendations
- Original-FIT denominator: 73 files (73 available, 73 decoded, 0 failures)
- Manually reviewed labelled matches: 4 (all labelled `correct_merge`)

The workflow is documented in [`docs/ops/training-occurrence-evidence.md`](../ops/training-occurrence-evidence.md):
`python -m garmin_sync export-training-occurrence-evidence`, then
`npm run evidence:training-occurrence:prepare`, then `npm run evidence:training-occurrence`.
Every step reads and writes only under the ignored `app/artifacts/training-occurrence/` directory.

## Access authorization and run history

On 2026-09-27, account owner authorization was granted for the target Firebase account and
Garmin data. The bounded 90-day export and in-memory FIT evidence collection were executed.
The committed report intentionally does not retain the Firebase UID:
1. `uv run python -m garmin_sync export-training-occurrence-evidence --user-id <authorized-uid> --days 90 --with-fit`
2. All 4 merged rows in `private-review-sheet.json` were classified by the user:
   - `occ-0054` (2026-09-01): Catalog strength execution + Garmin strength activity -> `correct_merge`
   - `occ-0064` (2026-09-13): Warmup ride + race ride recorded as two consecutive Garmin files -> `correct_merge`
   - `occ-0067` (2026-09-16): Manual strength execution + Garmin strength activity -> `correct_merge`
   - `occ-0074` (2026-09-24): Manual strength execution + Garmin strength activity -> `correct_merge`
3. Preparation was rerun with `--labels artifacts/training-occurrence/labels.json` and the aggregate
   report was generated via `npm run evidence:training-occurrence`. All raw/private files remain
   git-ignored.

## Current authority and code findings

- `app/src/engine/trainingIntent.ts` consumes canonical performed facts for narrow recency,
  spacing and weekly coverage behavior; PR #331's exact role/coverage credit is live.
- Broad history for fatigue, delivered dose and objective bookkeeping still comes from
  `reconcileCompletedTrainingEvents` and `completedEventToExposure` through
  `buildTrainingHistorySnapshot`. That live path does not read `session_executions` at all:
  structured semantics enter live history only through an answered, followed recommendation.
- `canonicalBroadHistory.ts` `deriveCanonicalBroadExposure` evaluates every source reference.
  Garmin-only occurrences use the production Garmin mapper. Completed catalog executions use
  the live followed-exact-template semantics, with Garmin as the measured duration authority
  when linked. Structured identity and modality are never replaced by Garmin's. A synthetic
  parity test shows that a structured + Garmin occurrence produces the same cost, stimulus and
  delivered dose as the live Garmin + followed-recommendation event. Anything else is reported
  as unknown with a named reason rather than guessed. Planned `SessionOccurrence` documents are
  never read, and merged occurrences are excluded.
- `pairLiveAndCanonicalHistory` groups live and canonical rows that share a Garmin activity or
  an owning recommendation and assigns deterministic opaque aliases. A group that is not
  one-to-one keeps one shared alias, so the comparison reports it as ambiguous instead of
  choosing a pair. `computeCanonicalIdentityMetrics` counts source-link conflicts,
  sticky-decision violations, multi-provider and non-Garmin sources, overlapping same-day
  duplicates, and Garmin activities present on only one side.
- `historyRecommendationCounterfactual.ts` runs the production `evaluateTrainingWithIntent`
  twice per date, changing only an in-memory history provider. It projects verdict, mode,
  template, prescription, dose, variant, coverage, sequence, fatigue and guardrails.
- `prepareTo4Evidence` parses records with the production parsers, rejects and counts
  records owned by another user, repeats the derivation to check determinism, and emits only
  aliases, engine-shaped rows and counts.
- `training_occurrence_export.py` `collect_fit_identity_evidence` counts, separately:
  unavailable originals, download failures, rate-limited remainders, decode failures
  (malformed vs unsupported), semantic-definition vs observed-index-fallback vs no-evidence
  fingerprints, repeat-decode mismatches, repeated fingerprints, fingerprints on matched
  structured occurrences, and same-day pairs where FIT would or would not discriminate.
  Repeated fingerprints are not labelled collisions. No FIT fingerprint is compared with a
  `prescriptionHash`.
- ADR-0034 remains marked `Proposed` despite the shipped work. This report records the
  governance mismatch without changing the ADR's status.

## Remaining capability gaps

These are independent of data access and would still block broad-history activation after a
real run:

1. **Non-catalog structured semantics.** Manual/authored, external-plan and `legacy_strength`
   executions stay `unknown`. There is no reviewed mapping from those definitions to production
   cost/stimulus semantics. Any such occurrence in a real corpus keeps its derived field set
   incomplete, so the runner refuses readiness.
2. **Real non-history decision inputs.** The counterfactual uses a fixed simulation reference
   day, because production assembles readiness, check-in, plan, overlays and preferences in the
   UI composition layer (`Home.tsx`), and no read-only offline assembler exists. The series
   measures the engine's sensitivity to the history swap, not the athlete's actual day-by-day
   recommendations. Because history is injected, both passes also skip the live canonical
   `performedTrainingFacts` read (the narrow recency/spacing/coverage cutover) and mechanical
   check-in reads, so those cutovers are not exercised by this comparison.

## Corpus strata and missingness

| Stratum | Real-data count | Synthetic evidence in this work | Status |
|---|---:|---|---|
| Matched structured + Garmin strength / endurance | 2 / 1 | Parity and single-exposure tests (endurance fixture) | Measured on real corpus |
| Structured-only / Garmin-only | 0 / 22 | Adapter and pairing tests | Measured on real corpus |
| Two same-modality workouts on one day | 4 | Same-day-distinct pairing test | Measured on real corpus |
| Manual/authored or imported execution with performed source | 2 | Reported as `unknown` by test | Measured (`w1-thu-upper-maintenance`, `def_full_body_reentry_01`); capability gap 1 |
| Ambiguous candidates; repeated provider sync; manual unlink/keep-separate | 2 | Ambiguous-group and sticky-violation tests | Measured on real corpus (0 sticky violations) |
| Midnight, timezone, or DST boundary | 0 | Stratum is counted by the prep step | Zero occurrences in 90d window |
| Incomplete/failed Garmin detail | 0 | `provider_source_unavailable` test | Zero occurrences in 90d window |
| FIT semantic definitions / index-only / no-workout evidence | 16 / 0 / 57 | Exporter classification tests | Measured on 73 original FIT files |
| Malformed/unsupported FIT | 0 / 0 | Exporter decode-failure tests | 0 malformed / 0 unsupported |

The sample review protocol was applied to all 4 multi-source (merged) occurrences in the
private review sheet (`occ-0054`, `occ-0064`, `occ-0067`, `occ-0074`), all labelled `correct_merge`
(0 false positive merges).

## Hard gates

The prep step evaluates gates automatically when the denominator is non-zero. A gate with a
zero denominator is `not_evaluated`, never a vacuous pass. Gates are measured by re-checking
derived rows against their own sources rather than asserted by construction.

| Hard gate | Result on real corpus | Mechanism |
|---|---|---|
| Zero cross-user evidence leakage | `NOT_EVALUATED` after review hardening | Firestore export was single-UID and prep rejected 0 foreign records, but the recorded FIT run predates the new requirement that explicit `--user-id` bind to that UID's active server-side Garmin `tokenObject`. Re-run under the hardened CLI before treating the combined record + FIT gate as passed. |
| Zero source-to-two-live-occurrence violations | `PASS` | Verified source-key uniqueness over active occurrences (0 duplicate physical candidates) |
| Zero sticky manual unlink / keep-separate violations | `NOT_EVALUATED` | 0 manual decisions in corpus |
| Zero core-sync failures caused by FIT decoder failure | `NOT_EVALUATED` | In-memory shadow decoding only; no sync impact |
| Zero deterministic replay mismatches on identical prepared input | `PASS` | Both independent derivation passes and recommendation counterfactual runs were 100% identical |
| Zero known false-positive automatic merges in labelled sample | `PASS` | All 4 multi-source groups were reviewed and labelled `correct_merge` (0 false positive merges) |
| One matched structured + provider occurrence contributes one exposure | `PASS` | Exactly one canonical row per alias; matched single exposure verified |
| Structured semantic authority is never downgraded by Garmin disagreement | `PASS` | Independent audit verified every structured-derived row preserved catalog workout, template, modality and category |
| Missing canonical detail stays unknown | `PASS` | Independent audit verified all 3 non-derivable occurrences were recorded with explicit reasons (1 multiple provider sources, 2 non-catalog structured semantics) |
| No raw FIT/private production payload committed | `PASS` | Verified by repository gitignore and evidence hygiene |

## TO4 deltas

On the 90-day real corpus:
- **Exposure counts:** 78 live exposures vs 22 canonical exposures (`delta: -56`). This delta
  reflects that `performedTrainingOccurrences` only covered the latter part of the window
  (25 occurrences total), leaving 54 older live Garmin activities with no canonical occurrence
  counterpart (`pairedLiveOnly: 54`).
- **Canonical derivation:** 22 exposures successfully derived; 3 kept as unknown (1 multiple
  provider sources, 2 non-catalog structured executions).
- **Workload totals:**
  - Systemic cost: Live 27.84 vs Canonical 8.41 (`delta: -19.43`)
  - Cardiovascular: Live 28.68 vs Canonical 9.58 (`delta: -19.09`)
  - Lower body: Live 27.53 vs Canonical 8.26 (`delta: -19.27`)
  - Upper body: Live 6.87 vs Canonical 1.60 (`delta: -5.27`)
  - Neuromuscular: Live 19.98 vs Canonical 5.76 (`delta: -14.22`)
- **Delivered dose:** Planned minutes 1912.5 (live) vs 652.5 (canonical); Completed minutes
  4327.5 (live) vs 1203.0 (canonical).
- **Recommendation sensitivity series:** Evaluated across 84 dates against reference scenario
  `evergreen_balanced_four_sessions`. 78 dates showed changed projection outputs (52 template,
  52 prescription, 77 coverage, 78 fatigue, 78 sequence, 38 guardrails). Repeat run was
  100% identical (`repeatRunIdentical: true`). All deltas remain `unresolved` (diagnostic sensitivity
  measurement, not an athlete-replayed verdict).

## TO5 decoder evidence and decision

73 original Garmin FIT files from the 90-day window were examined. These decoder results remain
useful descriptive evidence, but the FIT portion must be rerun under the hardened explicit-user
token binding before it can support the cross-user isolation hard gate:
- **Availability & decoding:** 73/73 available (100%), 73/73 decoded successfully (100%),
  0 download failures, 0 rate limits, 0 malformed files, 0 unsupported files.
- **Fingerprint distribution:** 16 semantic definition fingerprints, 0 observed index fallbacks,
  57 unguided activities (no workout evidence). 1 repeated fingerprint (identical workout executed
  multiple times).
- **Repeat decode stability:** 0 repeat decode mismatches across 146 in-memory decodes (each file
  decoded twice).
- **Discrimination:** Discrimination unchanged for 16 same-day candidate pairs; 0 improved.
  One canonical matched occurrence was enriched with a FIT fingerprint.

TO5 result: `BLOCKED_NEEDS_ADAPTIVE_IDENTITY` for stronger reconciliation use, and
`KEEP_DIAGNOSTIC` for current decoder/fingerprint behavior.

## PR #324 deferred activation blockers

| Deferred item | Classification for proposed TO4/TO5 authority | Reason |
|---|---|---|
| Open-rest crash/reload recovery | `SEPARATE_FOLLOW_UP` | Broad history does not consume performed-rest intervals. Required before actual-rest history can become authoritative. |
| Refresh of already-linked provider projection metadata | `BLOCKING` | Broad canonical history must not depend on stale provider projection facts. |
| Provider source deletion/revocation lifecycle | `BLOCKING` | Source-reference completeness and historical auditability are not established for authoritative broad history. |
| FIT comparable Adaptive correlation/fingerprint gap | `BLOCKING` for FIT identity activation | The current FIT fingerprint cannot be interpreted as an exact Adaptive identity. |

## Review hardening after the baseline run

This review found and corrected two evidence-boundary defects without widening production
authority:

1. Explicit `--user-id` selected the correct Firestore subtree but previously reused legacy
   single-user Garmin token settings for FIT downloads. The CLI now requires that user's active
   server-side `garminConnections/{uid}` record and exact committed `tokenObject`; mismatched,
   inactive or unbound connections fail closed.
2. The preparation step previously set `corpus.originalFitCount = activitiesExamined`, which
   omitted any rate-limited remainder. It now keeps the full requested denominator and the report
   runner validates requested/examined/availability/decode/fingerprint accounting. Any unexamined
   rate-limited remainder blocks FIT readiness.

The committed analysis also removes the concrete Firebase UID; user identifiers are not part of
the reviewable aggregate evidence contract.

## Verification snapshot

See the PR description for the exact commands and results of this revision.

## Follow-up boundary

The real-data baseline is now measured and recorded. The next activation decision needs:
(1) backfill or boundary handling for pre-occurrence historical activities; (2) resolution of
capability gap 1 (reviewing cost/stimulus semantics for manual/authored executions); (3) offline
assembly of real day-by-day non-history inputs (capability gap 2) for true counterfactual replay;
and (4) provider refresh/deletion lifecycle closed for whichever surface is proposed.
A recommendation-affecting change then needs its own `POLICY_VERSION`, replay, simulation,
rollback and feature-flag review.
