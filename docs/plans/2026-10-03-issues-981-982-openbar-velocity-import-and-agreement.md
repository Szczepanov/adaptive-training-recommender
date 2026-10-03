# Issues #981 → #982 — OpenBar velocity import and WL Analysis agreement report

**Date:** 2026-10-03
**Status:** In progress. OD-1 through OD-6 resolved on 2026-10-03 under the owner's delegated decision authority (see [Resolved decisions](#resolved-decisions)). PR-1 [#987](https://github.com/Szczepanov/adaptive-training-recommender/pull/987) is merged. PR-2/PR-3 implementation and independent review are complete. The OpenBar browser flow and all 20 affected visual cases passed at 360/390/412/1440 px; the full visual run's home loading timeout reproduces on the original checkout. The latest stacked full gate passed static checks, 8,020 frontend unit tests, Python tests, rules, build and simulations; browser E2E had 44 passes, two skips and one failure. A dashboard-readiness wait exposes the existing V6 authored-rest failure (`Start Total Rest` is rendered although the test requires no Start action), reproduced on isolated `main@dfd2cbde` with only that wait added. The 336 focused observation/CLI tests and two performance checks pass. Publication awaits either repair of that baseline failure or explicit permission for draft PRs with red checks. Real-lift checks await owner-provided local file paths.

**Blocked by:** nothing for #981. [#984](https://github.com/Szczepanov/adaptive-training-recommender/pull/984) (closes #983, `wl-analysis-csv-v2`) is merged, and Szczepanov/openbar#78 (`analyze --observations`) is closed. #982 is blocked by #981.
**Unlocks:** Szczepanov/openbar#79 (formal agreement study). Its pre-registration needs both sources to use the same segmentation rule version, and it needs the #982 report tool.
**Issues:** [#981](https://github.com/Szczepanov/adaptive-training-recommender/issues/981), [#982](https://github.com/Szczepanov/adaptive-training-recommender/issues/982)
**Authority boundary:** evidence only. Imported velocities stay raw trial fields (ADR-0046 D-AT-RAWFIELDS). There is no engine or policy change and no `POLICY_VERSION` bump.
**Governing decisions:** ADR-0046 D-AT-IMPORT (versioned local-only import adapters), ADR-0047 (future fixed-load series identity includes the measurement method)
**Repository baseline:** `main@81cfae57`

---

## 1. Where #984 left us (verified against `main`)

- `wlAnalysisCsv.ts` exports `WL_ANALYSIS_CSV_PARSER_V1` and `WL_ANALYSIS_CSV_PARSER_V2`. `segmentWlReps(frames, parserVersion)` holds the whole segmentation rule:
  - run detection: v > `WL_CONCENTRIC_VELOCITY_THRESHOLD_MPS`;
  - rep threshold: `max(WL_MIN_REP_RISE_CM, WL_MIN_REP_RISE_FRACTION × largest rise)`;
  - completeness: `WL_COMPLETE_DESCENT_FRACTION`;
  - v2 only: `activeWindow` boundary trim, using `WL_BOUNDARY_VELOCITY_FLOOR_MPS` and `WL_BOUNDARY_MAX_TRIM_RISE_CM`.
- **The segmentation rule has no identity of its own.** It is named only through the WL *parser* version. #981 and #982 need the same rule for a different source, so this is the first gap to close.
- `parseWlAnalysisCsv` defaults to v1. `WlAnalysisImportPanel` opts new imports into v2. `proposeWlTrial` writes `wl_parser_version` into the trial context.
- `wlAnalysisImport.ts` mixes WL-specific logic with source-neutral logic:
  - WL-specific: tags, `attempt N`, ambiguous DD/MM dates, chains and bands;
  - source-neutral: `sha256Hex`, `checkWlApplyBlocked`, `wlProposalToDraftRow`, and the field-contract check in `canImportWlAnalysis`.
- No consumer compares raw trial `mean_concentric_velocity_mps` across trials today. The 1RM protocols keep it as raw evidence, and ADR-0047's fixed-load series is not implemented yet (#897 WP6.6). This matters for #981's comparability criterion (D9).

**OpenBar facts the plan relies on** (`validation/schema/analysis-v1.schema.json` and `crates/openbar-core/src/kinematics.rs` on openbar `main@703c097`):

| Fact | Consequence here |
|---|---|
| `schema_version` is the constant `1`, and readers must fail closed on anything else | Strict `=== 1` check |
| `calibration.coordinate_convention` is the constant `reference_centre_x_right_y_up` | Check it and fail closed. Use `y_m` and `vy_mps` as they are (the sign correction in #981 confirms this). |
| `derived.kinematics` is **optional**: the golden fixture has none | Missing kinematics → rejected with an actionable message |
| `identity.source_sha256` is **optional** | See D5 |
| `vy_mps` is a **backward difference** `(y_i − y_{i−1}) / dt`. It is `null` on the first sample and wherever `dt > max_gap_s` or confidence < `min_confidence`. | Each `null` is a continuity break (D3). Velocity is attributed half a frame later than a central difference would put it; record this as a known difference in #982. |
| Lost frames have **no** sample. Gaps up to `max_gap_s` (0.2 s in the #79 runs) are differenced *across*, so velocity is still produced across them. | The importer must detect missing frames from timestamps itself (D3) |
| Timestamps are decoded presentation timestamps. `nominal_fps` and `measured_fps` are metadata only. | Detect gaps from the observed intervals, not from nominal fps |
| Provenance lives in `provenance.tracker.{id, implementation.{implementation, version}}`, `derived.filtered.filter`, `derived.kinematics.{input, method}`, `calibration.{method, method_version, scale}` and `provenance.pipeline.{openbar_version, git_commit}` | Source of the provenance context keys (D7) |
| Python `json.dump` can emit `NaN` and `Infinity` tokens, and `1e999` parses to `Infinity` in JS | Two separate rejection paths (D4) |

---

## 2. Design decisions

### D1 — Give the segmentation rule its own versioned identity

Add `concentric-segmentation-v1` and `concentric-segmentation-v2` as **rule** versions, separate from **source parser** versions:

| Source parser version | Segmentation rule |
|---|---|
| `wl-analysis-csv-v1` | `concentric-segmentation-v1` |
| `wl-analysis-csv-v2` | `concentric-segmentation-v2` |
| `openbar-analysis-v1` | caller-selected; the import panel uses `concentric-segmentation-v2` |

- A WL parser version still fixes its rule, so stored `wl_parser_version` values stay fully interpretable and the WL trial context does not change.
- OpenBar records both `openbar_parser_version` and `openbar_segmentation_rule`. This is the "record the rule version in trial context, exactly as #984 does" requirement from the #981 dependency comment.
- A later rule (`concentric-segmentation-v3`) then needs only a new rule id for OpenBar and a new WL parser version for WL. This follows ADR-0046 D-AT-IMPORT: a semantic change is a new version.

*Rejected:* naming OpenBar's rule `wl-analysis-csv-v2`. It ties a WL-specific name to another source, and the #79 pre-registration would have to cite a WL parser id for OpenBar data.

### D2 — Source-neutral frame series keeps WL units

The neutral frame is the current `WlAnalysisFrame` shape: `{ ordinal, timeS, velocityMps, displacementCm }`.
- OpenBar maps to it with `displacementCm = (y_m − y_m[first sample]) × 100` and `velocityMps = vy_mps`.
- Keeping centimetres means every threshold constant stays numerically identical, and the WL path does no conversion at all. That is the strongest guarantee of byte-for-byte v1/v2 output.
- `×100` floating-point noise can affect classification at a comparison boundary, including both the 10 cm absolute minimum and the `MIN_REP_RISE_FRACTION × largestRise` threshold when that is larger. Do not round. OpenBar parity tests must place converted rises on both sides of each threshold and must not use an exact-boundary case as the cross-unit parity oracle.

### D3 — Gaps: exclude affected reps rather than splitting runs

The issue allows either option. **Decision: exclude**, applied in the OpenBar adapter so the shared segmenter does not change.

1. **Continuity break.** Between two consecutive *usable* samples (finite `vy_mps`), a break exists if either:
   - a sample between them was dropped (its `vy_mps` was `null`); or
   - `dt > OPENBAR_GAP_INTERVAL_FACTOR (1.5) × median(dt)` over all consecutive kinematics samples (this catches frames OpenBar omitted).
2. **Detection** runs over the usable samples as they are, so the segmenter sees a dense series. Detection and the rep threshold are unchanged.
3. **Exclusion.** A detected rep is excluded and kept in the parse output with a reason when:
   - `spans_gap`: a break lies inside its **run**, or on the run's boundary transitions (previous sample → run start, run end → next sample);
   - `touches_series_edge`: the run starts at the first usable sample or ends at the last one. This is the #79 squat case: the seed was placed after the rep had started, so its true start is unknown.
4. Excluded reps count toward `repCount` and the largest-rise threshold, so detection matches what a gap-free series would give. They are **never selectable** for a trial, and #982 lists them rather than dropping them.

Why not split runs at gaps: a gap in the middle of a concentric phase gives two partial runs. Either the larger one still passes the rise threshold and is reported with a truncated ROM and a biased mean (silently wrong), or both fail and the rep disappears (silently dropped). Excluding is fail-closed and visible.

Why exclusion is checked on the *run* and not on the v2 window: detection and completeness both use the run. A break inside the run means the run could be two merged movements, or could hide travel the series never saw.

The rule only exists for OpenBar. WL frames are dense by construction, and WL behaviour must not change.

### D4 — OpenBar parser validation (fail closed, plain language)

`parseOpenBarAnalysis(rawText, segmentationRule)` checks only the subset it consumes. Rust stays the authoritative validator. The rule parameter has **no default**: there are no stored OpenBar trials to keep stable, so every caller must choose.

It rejects:
- invalid JSON, including `NaN` and `Infinity` tokens. The message should say "not a valid OpenBar analysis file", not show a raw `SyntaxError`;
- `schema_version !== 1`;
- `coordinate_convention !== 'reference_centre_x_right_y_up'`;
- missing `derived.kinematics` or empty `samples`;
- in any sample used: a non-finite `timestamp_s`, `y_m`, `vy_mps` (when not null) or `confidence`; this includes `1e999`, which parses to `Infinity`;
- non-increasing timestamps;
- fewer than 2 usable samples;
- a file over 20 MB or more than 100 000 samples. This keeps a phone from freezing; a 2-minute 60 fps clip is about 7 200 samples.

Confidence is **not** re-filtered. OpenBar's `min_confidence` already decides which samples get a velocity. The importer records that parameter rather than second-guessing it.

### D5 — Source video SHA-256 is required

`identity.source_sha256` is optional in the schema. The importer requires it and rejects files without it, because:
- #981 lists it as required provenance;
- it is the key for the same-video guard (D6);
- the openbar#86 workflow always registers it.

Synthetic fixtures carry it.

### D6 — Duplicate guards

- **Hard guard (as for WL):** `sourceRef = openbar-analysis:sha256:<hex of the JSON bytes>`. The ref is rejected if it matches an existing draft row, a stored row, or another file in the same batch. The prefix has no version, matching WL's `wl-analysis-csv:sha256:`.
- **Same-lift guard (blocking within one attempt):** two *different* analyses of the *same* video (for example CSRT and SAM 2) have different file hashes but describe one lift. If `openbar_source_video_sha256` matches another file in the batch, or the context of an existing row or stored trial in that attempt, the import is blocked.
  - Unlike WL D6, which only warns, this check has no false positives: it compares hashes, not similar-looking data.
  - Comparing trackers is #982's job, not a second trial row.
- Mixing WL and OpenBar rows *within one attempt* is allowed. They have different ordinals and are different devices (ADR-0046 raw evidence). An automatic cross-source duplicate check is out of scope, because the two files share no identifier.

### D7 — Trial proposal and provenance context

- `device = { provider: 'OpenBar' }`.
- Validity and success follow the WL convention:
  - an eligible single-rep file gives `valid`, with success pre-filled from ascent completeness and confirmed by the athlete;
  - a file with several eligible reps gives one `practice` trial from the fastest eligible rep.
  - OpenBar has no tags, so there is no accommodating-resistance or attempt-number detection.
- **Load** is not in `analysis-v1`. The proposal carries `loadKg: null`, and Apply stays disabled until every card has a load within the protocol's `load_kg` bounds. Once the athlete enters a valid load into a field labelled in kg, `importReview.loadKgConfirmed` becomes `true` (OD-4). An empty or invalid load is not confirmed. Success and validity confirmation stay as for WL.
- **No date check.** `analysis-v1` has no capture date, and the session date comes from the capture flow (Warsaw/D−1 invariant untouched).
- **Ordinals.** There is no `attempt N` tag, so files are ordered by file name, take the next free ordinals, and are flagged `ambiguousOrder` ("order assumed — confirm"). Capacity and immutability use the shared apply-blocked check.
- **Context keys** (21 at most against the 32-key limit; strings capped at 128 characters):

| Key | Source |
|---|---|
| `openbar_parser_version` | `openbar-analysis-v1` |
| `openbar_segmentation_rule` | D1 |
| `openbar_schema_version` | `schema_version` |
| `openbar_rep_count`, `openbar_eligible_rep_count`, `openbar_selected_rep`, `openbar_rom_cm` | parse |
| `openbar_tracker_id`, `openbar_tracker_implementation`, `openbar_tracker_version` | `provenance.tracker` |
| `openbar_filter_implementation`, `openbar_filter_version` | `derived.filtered.filter` (`null` if unfiltered) |
| `openbar_kinematics_input`, `openbar_kinematics_max_gap_s`, `openbar_kinematics_min_confidence` | `derived.kinematics` |
| `openbar_calibration_method` | `plate_diameter@1` |
| `openbar_metres_per_pixel`, `openbar_plate_diameter_m`, `openbar_calibration_quality` | `calibration` |
| `openbar_source_video_sha256` | `identity.source_sha256` |
| `openbar_version` | `provenance.pipeline.openbar_version` |

Tracker `parameters` are not stored, because they are unbounded. The implementation and version are enough to identify the method. The JSON file hash in `sourceRef` pins everything else.

### D8 — UI: a separate card under the WL card

- A new `OpenBarImportPanel` ("Import OpenBar analysis (JSON)") mounts in `TrialCaptureTable` under the same condition as WL. Rename the field-contract check to a neutral `canImportVelocityFile`, keeping `canImportWlAnalysis` as an alias.
- File-stays-local copy, preview cards, rejection reasons and the Apply/Clear actions mirror the WL panel. Each card adds an *empty* load input and lists excluded reps ("rep 2 not used: tracking gap").
- `WlAnalysisImportPanel` is **not** edited in this work. #984 only just changed its parser path, and its tests and E2E are the safety net.

*Rejected for now:* a single "Import from file" picker that dispatches by file type. It is better UX, but it means refactoring the WL panel at the same time. Record it as a follow-up once both adapters are stable.

### D9 — Comparability (the #981 criterion)

No path compares raw trial velocity today (§1), so "exclude OpenBar from WL trends" cannot fail at the moment. It would only fail once ADR-0047 lands and the method identity is built carelessly. Deliver the guard now:

- Add `velocityMeasurementMethodId(device, context)`: a pure function that turns a trial's provenance into the ADR-0047 `measurement_method_id` (an identifier dimension, so lower-case, trimmed and non-empty):
  - a parser-derived WL row derives the method id from its stored `wl_parser_version`: `wl-analysis-csv-v1` stays v1 and `wl-analysis-csv-v2` stays v2; unknown parser ids fail closed rather than collapsing into either series;
  - an OpenBar row gives `openbar-analysis-v1/concentric-segmentation-v2/<tracker implementation>@<version>/<filter implementation>@<version>`, with `raw` as the final component when unfiltered;
  - a row with no import provenance gives `manual`.
- Tests (implemented with `velocityMeasurementMethodId` in PR-2, where that helper first exists):
  - stored `wl_parser_version=wl-analysis-csv-v1` and `wl-analysis-csv-v2` derive distinct method ids, and those ids produce different `buildComparisonSeries` keys on otherwise identical protocol/context;
  - every OpenBar id differs from every WL id;
  - changing either the tracker or filter implementation **or version** changes the OpenBar id (OD-2);
  - `buildComparisonSeries` gives different keys for the WL and OpenBar method ids on the same protocol and context. This uses the existing `comparability.ts`, with no new comparison rule.
- Document it in `performance-outcome-evidence.md` as the contract WP6.6 must call. No ADR amendment is needed: ADR-0047 decision rule 4 already says the method includes how the value was derived.

---

## 3. Work breakdown

Three PRs in dependency order. Each must pass `make verify` on its own.

### PR-1 — Extract the source-neutral segmenter (refs #981, no behaviour change)

This is kept separate so a reviewer can check the highest-risk seam from #984 (`segmentWlReps` / `activeWindow`) on its own.

1. **Characterisation golden first, before any move.** Add `concentricSegmentation.golden.test.ts`.
   - Build a seeded synthetic corpus of about 200 frame series with a deterministic LCG. Vary rep count, settle tails, slow sticking phases over 1 cm, all-below-floor runs, leading drift, and series that start mid-ascent.
   - Record `segmentWlReps(frames, v1)` and `(frames, v2)` into `app/src/observations/fixtures/concentricSegmentation.golden.json`.
   - Commit the golden **with the pre-refactor code**, so the refactor is checked against outputs captured before it.
2. Add `app/src/observations/concentricSegmentation.ts`:
   - `CONCENTRIC_SEGMENTATION_V1` and `CONCENTRIC_SEGMENTATION_V2`, plus the `ConcentricSegmentationRule` type;
   - the moved constants under neutral names (`CONCENTRIC_VELOCITY_THRESHOLD_MPS`, `MIN_REP_RISE_CM`, …, `BOUNDARY_MAX_TRIM_RISE_CM`);
   - `ConcentricFrame` and `ConcentricRep`, the current WL shapes;
   - `ConcentricRepSegment = ConcentricRep & { runStartIndex, runEndIndex, windowStartIndex, windowEndIndex }`. These are array indices; the OpenBar adapter needs them for D3;
   - `segmentConcentricReps(frames, rule): ConcentricRepSegment[]`, which moves `activeWindow`, run detection, completeness and `round2`/`round3` unchanged.
3. Change `wlAnalysisCsv.ts` to delegate:
   - `WlAnalysisFrame` and `WlAnalysisRep` become aliases;
   - every `WL_*` constant is re-exported under its current name and value;
   - add `WL_PARSER_SEGMENTATION_RULE: Record<WlAnalysisParserVersion, ConcentricSegmentationRule>`;
   - `segmentWlReps` keeps its signature and default v1, maps to the rule, and **strips the index fields**, so `WlAnalysisRep` objects stay deep-equal to today's;
   - `parseWlAnalysisCsv` does not change.
4. New unit tests:
   - the index fields (run indices bracket the window indices; v1 window equals the run);
   - the rule-map pin;
   - an architecture check that `concentricSegmentation.ts` imports nothing (pure leaf). Confirm that the existing `observations/architecture.test.ts` import rules accept the new module.
5. Docs: one sentence in `performance-outcome-evidence.md` (the rule ids and the mapping), and the `AGENTS.md` package map entry for the new module.

**Done when:**
- `git diff main -- app/src/observations/wlAnalysisCsv.test.ts app/src/observations/wlAnalysisImport.test.ts` is empty;
- the golden passes unchanged;
- `npm run typecheck` passes (it uses `tsc -b`; `tsc -p .` checks nothing in `app/`).

### PR-2 — OpenBar `analysis-v1` importer (closes #981)

1. **Fixture builder** `app/src/observations/fixtures/openBarAnalysisFixtures.ts`. It builds a schema-shaped `analysis-v1` object from a velocity profile (timestamps, `y_m` by integration, backward-difference `vy_mps`, `null` on the first sample), with these options:
   - drop samples (lost frames);
   - null velocities;
   - change the convention, schema version or provenance;
   - inject non-finite tokens at the text level.

   Do not copy OpenBar's golden or public fixture. Generate the data instead. A pin test asserts that the builder emits every top-level `required` key of schema v1.
2. **Parser** `app/src/observations/openBarAnalysis.ts`:
   - `OPENBAR_ANALYSIS_PARSER_V1`, `OPENBAR_GAP_INTERVAL_FACTOR`, the size and sample caps;
   - `parseOpenBarAnalysis(rawText, rule)`, which returns `{ parserVersion, segmentationRule, schemaVersion, sourceVideoSha256, provenance…, frames, breaks, reps: OpenBarRep[] }`, with `OpenBarRep = ConcentricRep & { exclusion: null | 'spans_gap' | 'touches_series_edge' }`;
   - it implements D2, D3 and D4 and calls `segmentConcentricReps`.
3. **Shared import core** `app/src/observations/velocityFileImport.ts`. Move the source-neutral pieces from `wlAnalysisImport.ts` under neutral names:
   - `sha256Hex`;
   - `hasVelocityImportSchema` / `canImportVelocityFile`;
   - `checkVelocityImportApplyBlocked`;
   - `velocityProposalToDraftRow(proposal, ordinal, protocol, sourceLabel)`.

   `wlAnalysisImport.ts` re-exports the old names with byte-identical error text (`sourceLabel = 'WL Analysis'`), and its tests stay unchanged.
4. **Mapping** `app/src/observations/openBarAnalysisImport.ts`:
   - `OPENBAR_DEVICE_PROVIDER`, `OPENBAR_CONTEXT_KEYS`, `openBarSourceRefFor`;
   - `proposeOpenBarTrial(file, existingSourceRefs, existingSourceVideoHashes)`;
   - `assignOpenBarOrdinals`;
   - `velocityMeasurementMethodId` (D9). It may live in `velocityFileImport.ts` instead, since it also covers WL.
5. **Panel** `app/src/components/testing/OpenBarImportPanel.tsx`, as in D8:
   - `accept=".json,application/json"`, several files allowed, decoded with `TextDecoder` and parsed locally;
   - the existing-video-hash set is computed in `TrialCaptureTable` from `rows[].context` and `initialTrials[].context`;
   - before writing it, read `docs/standards/ui-ux.md` and `docs/architecture/user-flows.md`. Check the empty, loading, rejected, blocked and applied states, mobile width, labels and `role="alert"`/`role="status"` against them.
6. **Mount** it in `TrialCaptureTable` next to `WlAnalysisImportPanel`, behind `canImportVelocityFile`.
7. **E2E.** Extend `app/tests/e2e/testing-physical-capital.pw.ts` with a back-squat OpenBar import:
   - a synthetic JSON through `setInputFiles`;
   - the load is entered, Apply fills the row, and the provider is shown;
   - one rejection (wrong `coordinate_convention`).

   Refresh and review the Playwright visual fixtures of the capture screen at mobile and desktop widths.
8. **Docs:**
   - `performance-outcome-evidence.md`: an OpenBar adapter bullet with the validation rules, the gap rule (D3), the context keys and the method-id contract (D9);
   - the `AGENTS.md` package map;
   - this plan's status;
   - the `docs/plans/README.md` line.

**Tests that map to #981's acceptance criteria:**

| Criterion | Implemented named test/evidence |
|---|---|
| Valid synthetic `analysis-v1` | `openBarAnalysis.test.ts`: `gives identical rep numbers through WL and OpenBar using %s`; `preserves converted-rise parity around thresholds: %s cm, larger rep %s` covers both rules at 9.99/10.01 cm and 29.99/30.01 cm with a 60 cm largest rise. |
| Unknown schema version rejected | `openBarAnalysis.test.ts`: `rejects unsupported schema_version %s` covers 2, string `"1"` and null. |
| NaN / Inf rejected | `openBarAnalysis.test.ts`: `rejects invalid JSON token %s with plain language`; `rejects 1e999 overflow in %s`. |
| Gap inside a concentric run | `openBarAnalysis.test.ts`: `excludes runs spanning gaps: %j`; `treats an omitted optional velocity as a tracking break`; `keeps reps eligible when a gap lies inside the preceding descent`; `excludes a gap on a run boundary transition (%s)`; `excludes runs truncated at either series edge`. |
| Sign convention | Positive means in the parity test; `rejects other coordinate conventions instead of negating the source`. |
| WL unchanged | `concentricSegmentation.golden.test.ts`: `preserves every v1 and v2 output in the seeded corpus captured before extraction`; empty diff for existing WL parser/import tests and panel source/tests. |
| Provider and provenance keys | `openBarAnalysisImport.test.ts`: `proposes raw velocity evidence with complete scalar provenance and an empty load` asserts provider, every context key, context bounds and `assertObservationContext`. |
| Comparability | `openBarAnalysisImport.test.ts`: `separates WL, OpenBar and manual derivations`; `changes identity when %s changes`; `builds distinct existing comparison-series keys for WL and OpenBar on the same protocol/setup` also asserts WL v1/v2 keys differ; `rejects unknown stored WL parser id %s`. |
| Duplicate guard | `openBarAnalysisImport.test.ts`: `blocks the same file or a different analysis of the same video within an attempt`; panel `keeps a stale preview blocked after another import adds the same video`; physical-capital OpenBar E2E also attempts a second analysis of the applied video. The file-selection loop shares the guard sets within a batch. |
| Panel | `OpenBarImportPanel.test.tsx`: `disables Apply until a valid load is entered (%s)`; `enables Apply for a valid athlete-entered kilogram load`; `shows excluded reps with an actionable tracking-gap note`; `mounts only on open attempts with the velocity-field contract`. `testing-physical-capital.pw.ts`: `physical capital assessment: OpenBar JSON import validates, fills and saves raw evidence`. |

**Manual scenario (aggregates only in the PR):**
- Import one real openbar#86 `analysis-v1` of a lift.
- Cross-check by hand-recomputing one rep's mean `vy_mps` over the reported window from the JSON. OpenBar itself does not compute reps, so the issue's "OpenBar's own output" has to be that recomputation.
- If the same video has a WL CSV, report the paired values. That is a preview of #982.

### PR-3 — Agreement report script (closes #982)

1. **Pure module** `app/src/observations/velocityAgreement.ts`. It is typed, checked by `tsc` and counted in coverage, and no app code imports it. The precedent is `historyCounterfactual.ts`, used by the training-occurrence evidence script.
   - `pairReps(wlReps, openBarReps, { minOverlap, offsetS })`:
     - each source's rep interval is its reported (v2) window, with OpenBar times shifted by an optional per-pair `offsetS` (default 0);
     - pair by temporal IoU of the intervals; pairs need IoU ≥ `minOverlap` (default 0.5, OD-3);
     - matching is greedy one-to-one by IoU descending, with ties broken by WL index and then OpenBar index;
     - the result is `{ paired[], wlOnly[], openBarOnly[], openBarExcluded[] }`, where `openBarExcluded` holds the D3 reps with their reason. **Nothing is dropped.**
   - `agreementStats(differences, magnitudes)` gives:
     - `n`, bias = mean(d), SD (n−1), 95% limits of agreement = bias ± 1.96·SD, mean absolute difference;
     - proportional bias: OLS of d on m = (OpenBar + WL)/2, giving slope, intercept and Pearson r;
     - a scale estimate: the geometric mean of OpenBar/WL, which #79 wants reported separately;
     - when n < 2 (or < 3 for the regression), the value is `null` with the reason `insufficient_n`, never `NaN`.
   - Compute these for mean velocity (primary), peak velocity and ROM (secondary). Give the figures pooled over all reps **and per pair (video)**.
   - Report caveat: reps are nested within videos. Pooled figures are descriptive and do not account for within-video dependence; do not claim that pooling necessarily narrows the limits of agreement. Add a repeated-measures method (Bland–Altman 2007) only if the #79 pre-registration names it as the decision statistic (OD-5).
   - `buildAgreementReport(inputs) → { json, markdown }`:
     - all numbers rounded to 6 decimal places, so the output does not depend on float formatting;
     - keys emitted in a fixed order; arrays sorted by pair label, then WL rep index;
     - LF line endings and a trailing newline;
     - **no** wall-clock time, absolute path or host name;
     - inputs identified by `label` plus the SHA-256 of each file.
2. **CLI** `app/scripts/velocity-agreement-report.mjs`, with `npm run evidence:velocity-agreement`, run as `node --experimental-strip-types`. This is the same form as `evidence:training-occurrence`.
   - Usage: `--pairs <pairs.json> --output <basename> [--segmentation concentric-segmentation-v2] [--min-overlap 0.5] [--force]`.
   - `pairs.json`: `{ "pairs": [{ "label", "wlCsv", "openBarAnalysis", "loadKg", "offsetS"? }] }`. Paths are relative to the pairs file. `loadKg` is metadata and a grouping key only.
   - It parses WL with `parseWlAnalysisCsv(text, <WL parser version for the rule>)` and OpenBar with `parseOpenBarAnalysis(text, rule)`, and **asserts that both report the same segmentation rule** before computing anything. The report header records:
     - the rule;
     - both parser versions;
     - the OpenBar provenance: tracker implementation and version, filter, kinematics parameters, `openbar_version`, `git_commit`;
     - the WL video id;
     - the velocity-method caveat (backward vs WL's central difference, which is unknown).
   - It writes `<basename>.json` and `<basename>.md`, and refuses to overwrite without `--force`. It warns, without failing, when the output lies inside the git work tree, because real lift data must not be committed.
3. **Tests** in `velocityAgreement.test.ts`, mapped to #982's criteria:
   - identical inputs ⇒ every d = 0, bias 0, SD 0, limits 0;
   - constant offset c ⇒ bias = c, SD = 0, slope ≈ 0;
   - proportional scale k (OpenBar = k·WL) ⇒ intercept ≈ 0, slope = 2(k−1)/(k+1), scale estimate = k;
   - a rep in only one source ⇒ listed in `wlOnly` or `openBarOnly`, so the counts add up;
   - mismatched rep counts (3 vs 4), with and without `offsetS`;
   - an OpenBar `spans_gap` rep ⇒ listed in `openBarExcluded`;
   - a rule mismatch between sources ⇒ an error.

   `app/scripts/velocity-agreement-report.test.mjs` (vitest picks up `*.test.mjs`) runs the CLI twice on synthetic temp files and asserts **byte-identical** JSON and Markdown, plus the argument errors.
4. **Docs:**
   - an `AGENTS.md` command-router entry for the script;
   - a short "Agreement report" note in `performance-outcome-evidence.md` (evidence tooling only, no Firestore, no UI);
   - this plan's status.
5. **Manual scenario:** run one real pair locally. Post aggregates only to openbar#79, never the inputs.

---

## 4. Verification per PR

| Check | PR-1 | PR-2 | PR-3 |
|---|:-:|:-:|:-:|
| `cd app && npx vitest run src/observations` (inner loop) | ✓ | ✓ | ✓ |
| `cd app && npm run typecheck` (`tsc -b`) and `npm run lint` | ✓ | ✓ | ✓ |
| Panel component tests + `testing-physical-capital.pw.ts` E2E + visual fixtures (mobile/desktop) | – | ✓ | – |
| `node scripts/check-policy-drift.mjs origin/main` from `app/`, after committing (it ignores uncommitted changes); expected: no drift | ✓ | ✓ | ✓ |
| `make verify` (canonical handoff) | ✓ | ✓ | ✓ |

`make simulate`, the plan-judge and `POLICY_VERSION` are not affected: no engine or policy file changes. If `scripts/verify_repo.py`'s scope detection selects them anyway, report what it ran. Do not edit source while `make verify` is running (known E2E flake).

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| The PR-1 refactor changes WL output in some edge case | Golden captured *before* the move; WL test files must have an empty diff; index fields stripped in the wrapper |
| Variable-frame-rate phone video triggers false gaps (dt jitter > 1.5× median) | Fails closed and visibly ("tracking gap"). Report the `breaks` count in #982. If real files show it, tune `OPENBAR_GAP_INTERVAL_FACTOR` under a new `openbar-analysis-v2`, never in place. |
| Backward-difference vs WL velocity timing biases the pairing or the means | Pair by IoU with a tolerance; state the caveat in the report header; #79 cross-checks one video by hand |
| Seed placed after the first rep (#79 squat) | `touches_series_edge` exclusion; openbar#86 documents "seed before the first rep" |
| Capture screen grows two import cards | Separate card per D8; the unified-picker follow-up is recorded |
| Real lift data committed by accident | The script warns when writing inside the work tree; fixtures are generated only |
| `measurement_method_id` chosen ad hoc when ADR-0047 lands | The D9 helper and tests exist before WP6.6 starts; the architecture doc names it as the contract |

---

## Resolved decisions

Resolved on 2026-10-03 under the owner's delegated decision authority. The IoU choice is an implementation decision; recording it in openbar#79's pre-registration remains a study task, not a completed action.

| # | Decision | Resolution |
|---|---|---|
| OD-1 | Gap rule: exclude or split (D3) | **Exclude**, including series-edge-truncated runs |
| OD-2 | Does the OpenBar method id include tracker and filter? (D9) | **Yes.** CSRT and SAM 2 are different measurement methods, and ADR-0047 rule 4 says never compare across methods. The cost is a new series on each tracker upgrade. |
| OD-3 | Rep pairing overlap threshold (#982) | IoU ≥ 0.5, pre-registered in openbar#79 together with the agreement threshold |
| OD-4 | `loadKgConfirmed` for an athlete-typed OpenBar load | `true` (already explicit); keep the success and validity confirmations |
| OD-5 | Repeated-measures limits of agreement in #982 | Report pooled and per-video figures now, with the caveat. Add Bland–Altman 2007 only if the #79 pre-registration names it as the decision statistic. |
| OD-6 | Same-video, different-file import within an attempt (D6) | **Block** |

## Out of scope (all three PRs)

- Running OpenBar from the app, or any upload.
- Re-scoring stored WL v1 trials.
- Merging OpenBar and WL trends.
- Implementing ADR-0047 (#897 WP6.6).
- Choosing the #79 agreement threshold.
- The unified import picker.
- Any `POLICY_VERSION` or recommendation change.
