# Issue #872 — True historical non-history replay for TO4 broad-history evidence

| Field | Value |
|---|---|
| Status | Implementation plan |
| Issue | [#872](https://github.com/Szczepanov/adaptive-training-recommender/issues/872) |
| Parent evidence work | [#646](https://github.com/Szczepanov/adaptive-training-recommender/issues/646), PR #853 |
| Recent prerequisites | PR #877 historical occurrence backfill merged; PR #882 non-catalog exposure derivation merged; PR #883 legacy manual metadata verification is still in review at plan creation |
| Authority impact | None in this issue. TO4 remains shadow/offline evidence only |
| Policy impact | No POLICY_VERSION bump if live behavior is unchanged. Any recommendation-policy delta introduced by this work is a defect or must be split into a separately reviewed policy PR |
| Unlocks | A defensible TO4 evidence rerun and, only if its gates pass, a separate broad canonical-history activation design/PR |

---

## 1. Objective

Replace TO4's static simulation-day recommendation counterfactual with a deterministic, user-scoped historical replay that reconstructs the real non-history decision context for each evaluated date.

The required experiment is:

~~~text
same current engine implementation
same current policy version
same historical date
same recovery/check-in/profile/plan/schedule inputs
same narrow canonical performed-training facts
same previous-day recommendation mode
same progression/external-plan context

PASS A: legacy broad CompletedExposure history
PASS B: canonical broad CompletedExposure history

ONLY broad completed-training history is allowed to differ
~~~

The output must explain every recommendation difference as expected, explainable, or unresolved. A date that cannot be reconstructed honestly must be reported as not replayable rather than filled with current state, defaults, or a simulation fixture.

This issue does **not** activate canonical broad history.

---

## 2. Why the current #872 scope is too narrow

The issue correctly identifies the static reference scenario in app/scripts/training-occurrence-prepare.mjs as the immediate problem, but current production composition has grown beyond the fields named in the issue.

Home currently reaches evaluateTrainingWithIntent through several layers:

1. DecisionComposer builds the date's recovery/check-in/goals/settings/preferences/intent/overlays state.
2. It derives the subjective baseline from prior check-ins and a one-day carried tissue restriction.
3. Home maps the composed input into objective, subjective, context and events.
4. Home loads the previous recommendation mode.
5. Home loads fixed activities and authored plan blocks.
6. Home loads active external-plan state, schedule-window state and intraday member state before deriving external session/rest context.
7. Home loads active confirmed intent blocks and derives progression overrides.
8. Training-intent resolution uses broad CompletedExposure history **and separately** canonical performed-training facts for narrow recency/spacing/coverage behavior.

The current TO4 runner injects a history provider. In trainingIntent.ts an injected provider suppresses the normal performedTrainingFactsService read unless performed facts were already supplied in the prepared snapshot. Therefore the present counterfactual does not exercise the same narrow canonical facts as production.

A correct #872 implementation must solve both problems:

- historical non-history context must be date-specific;
- the two passes must receive identical narrow canonical performed facts so broad history is the only experimental variable.

---

## 3. Non-negotiable experiment contract

### 3.1 Only one variable may change

For every replayable date D, compute a canonical digest over the complete non-history input bundle. The live-history pass and canonical-history pass must assert the same digest before evaluation.

The digest must cover at least:

- date and user scope;
- mapped subjective/objective readiness;
- subjective baseline and carried-region restrictions;
- goals/events and planning context inputs;
- training settings;
- preferences;
- training-intent profile;
- schedule overlays;
- fixed activities supplied to the same-day evaluator;
- authored plan blocks;
- previous recommendation mode;
- external-plan/external-rest context;
- confirmed progression overrides;
- any same-day scheduling context that materially changes the evaluateTrainingWithIntent arguments;
- descriptor-scoped PerformedTrainingFactsSnapshot;
- current POLICY_VERSION and source commit.

The broad history snapshot/revision is deliberately excluded from this digest because it is the experimental variable.

### 3.2 Current-policy counterfactual, not historical-policy replay

#872 must answer:

> Under the current code and policy, what changes if broad history authority is switched from legacy to canonical, holding the athlete's date-specific non-history facts constant?

It must **not** claim to recreate the exact recommendation originally shown on that historical date when that recommendation came from an older policy implementation. Existing recommendation audits are useful provenance and source references, but historical POLICY_VERSION implementations are intentionally not executable by the current bundle.

### 3.3 Missing historical truth fails closed

Never substitute:

- today's settings for historical settings;
- today's preferences for historical preferences;
- the current active goals for goals whose historical state cannot be proven;
- a current plan revision for an older referenced plan revision;
- an empty array for an invalid/unavailable source whose production path would fail closed;
- the simulation reference scenario for a missing real source.

A date with a required unprovable source becomes not_replayable with a stable reason code.

### 3.4 Do not improve the gate by dropping hard dates

The report must include all dates in the declared denominator. notReplayableDates is an activation blocker, not a filter.

---

## 4. Target architecture

Use three layers rather than putting a second copy of Home composition into the evidence script.

~~~text
Firestore/services                         exported private records
       |                                          |
       v                                          v
online source loader                      offline record hydrator
       |                                          |
       +------------------+-----------------------+
                          |
                          v
             shared PURE composition functions
                          |
             HistoricalDecisionInputs
                          |
           +--------------+--------------+
           |                             |
           v                             v
     live broad history           canonical broad history
           |                             |
           +--------------+--------------+
                          |
                   same evaluator
                          |
                          v
             deterministic classified diff
~~~

### 4.1 Pure daily composition

Extract the deterministic part of DecisionComposer.composeDailyDecisionInput into a pure function, suggested location:

- app/src/engine/decisionInputComposition.ts

Suggested contract:

~~~ts
composeDailyDecisionInputFromSources({
  userId,
  date,
  evaluatedAt,
  recoveryState,
  checkinState,
  goalsState,
  trainingSettingsState,
  preferencesState,
  trainingIntentProfileState,
  subjectiveHistoryState,
  scheduleOverlaysState,
}): ComposedDailyDecisionInput
~~~

DecisionComposer remains the online I/O owner: it reads services, supplies the states to the pure function, and returns the result.

The pure function must own the same logic production currently uses for:

- subjective baseline;
- prior-day tissue carry;
- source-state summaries;
- dataQuality;
- data confidence from an explicitly supplied evaluatedAt.

Do not leave one implementation in DecisionComposer and create a similar implementation in TO4.

### 4.2 Pure recommendation-context assembly

Add an offline-callable orchestration boundary, suggested location:

- app/src/engine/historicalDecisionInputs.ts or
- app/src/training-occurrence/offlineContextAssembler.ts

Keep the issue-facing function name if useful:

~~~ts
assembleHistoricalEngineInputs(records, date)
~~~

but return a richer type such as HistoricalDecisionInputs rather than a misleading small EngineInput.

Suggested shape:

~~~ts
interface HistoricalDecisionInputs {
  date: string;
  readiness: {
    subjective: SubjectiveInput;
    objective: ObjectiveInput;
    subjectiveBaseline: SubjectiveBaseline | null;
  };
  context: UserContext;
  events: UserEvent[];
  previousMode?: RecommendationMode;
  fixedActivities: FixedActivity[];
  authoredPlanBlocks: AuthoredPlanBlock[];
  trainingIntentProfile: TrainingIntentProfile | null;
  preferences: UserPreferences | null;
  scheduleOverlays: ScheduleOverlay[];
  externalContext: ExternalPlanContext | null;
  externalRestContext: ExternalRestContext | null;
  progressionOverrides: ProgressionOverride[];
  performedTrainingFacts: PerformedTrainingFactsSnapshot;
  sourceEvidence: HistoricalInputProvenance;
}
~~~

Where practical, extract a shared pure Home helper for the exact arguments sent to evaluateTrainingWithIntent. If a source is UI-only and does not affect that evaluator call, keep it out of this contract.

### 4.3 Pure performed-facts hydration

performedTrainingFactsService.ts already separates Firestore I/O from engine-domain derivation only partially. Extract/share a pure builder that can derive descriptor-scoped performed facts from hydrated records.

Production service and offline evidence must call the same pure derivation.

The offline path must:

1. resolve the same coverage-set descriptor the current training intent will use for D;
2. hydrate occurrences from the exported executions, immutable prescriptions/definitions, activities and recommendations;
3. derive PerformedTrainingFactsSnapshot;
4. attach the exact same facts snapshot to the prepared live and canonical TrainingHistorySnapshot passed into both evaluations.

Add an invariant test that changing only the broad exposure array leaves performedTrainingFacts byte-for-byte identical.

---

## 5. Export schema v2

Bump TrainingOccurrenceRecordExport from schema version 1 to 2. Keep the existing user-scoped, read-only, at-most-366-day contract and artifact-directory protections.

The exporter must capture enough source evidence for every decision date plus required lookback/horizon data.

### 5.1 Required source matrix

| Source | Export requirement | Why |
|---|---|---|
| performedTrainingOccurrences | existing bounded range plus required history lookback | canonical broad history and narrow performed facts |
| activities | existing range + referenced edge activities | canonical/provider hydration |
| session executions / entries / prescriptions / exact definition revisions | existing referenced reads | structured semantics |
| daily_recommendations | main range plus at least D-1 | previousMode; structured ownership/readiness marker; historical audit references |
| daily_recovery_snapshots | decision-date range | objective readiness |
| daily_subjective_checkins | main range plus REFERENCE_SUBJECTIVE_BASELINE_POLICY.longWindowDays before start | today's subjective input, subjective baseline and D-1 tissue carry |
| fixed_activities | range needed by same-day evaluation and active-plan placement; include the same forward horizon Home uses | availability / planning / external placement |
| schedule_overlays | all overlays intersecting the replay range plus required forward horizon | availability and reserved load |
| plan_blocks | all blocks intersecting the replay range/horizon | plan-owned dose and sequencing |
| schedule_window_manifests | date-scoped manifests for replay dates where bundle placement can matter | external intraday placement |
| goals | enough immutable/history evidence to prove date-D active goal state | events/periodization |
| training settings | historical/revision evidence, not a write-triggering migration read | context, equipment, guardrails, injuries |
| preferences | historical/revision evidence | selection/preferences |
| training_intent profile | historical/revision evidence | planning mode/priority |
| intent blocks and exact revisions | blocks covering replay dates | confirmed progression overrides |
| external-plan header/revision/placement evidence | exact immutable revision/hash referenced by date-D recommendation/plan state | external session/rest context |
| external-plan session occurrences needed for bundle member state | date-scoped where relevant | started/existing-binding semantics |

### 5.2 Read semantics

The evidence exporter must never call a service path that can perform first-run migration or any other write. For training settings this means offline export semantics equivalent to peek/read, not getTrainingSettingsState's migration behavior.

All exported documents remain raw private evidence under app/artifacts/training-occurrence and must stay git-ignored.

### 5.3 Temporal proof for mutable records

Some current sources are mutable singleton/state documents and do not automatically prove their historical value.

For every such source, define one of these statuses:

- exact_revision: immutable/versioned historical bytes prove date D;
- stable_across_window: current document can be proven unchanged across the whole evaluated interval;
- persisted_decision_reference: a historical audit identifies the exact immutable revision/hash consumed;
- unprovable: current bytes cannot honestly establish what D used.

A source updated after D is **not** automatically invalid, but it cannot be assumed to equal the old value without version/history evidence.

If goals/settings/preferences/training-intent state changed during the 90-day corpus and the repository did not retain the prior revision, mark affected dates not_replayable. Do not manufacture historical versions.

This may reveal a genuine product-evidence gap. If so, the correct follow-up is prospective immutable decision-context snapshots for future evidence, not weakening #872.

---

## 6. Offline parsing and hydration

### 6.1 Production parsers only

Every exported source that has a production parser/validator must use that parser in the preparation step. Avoid direct type casts.

Cross-user ownership, date identity, revision/hash checks and schema validation must fail closed.

### 6.2 Preserve production missing/invalid semantics

Historical composition needs DataState-like evidence, not only arrays.

Examples:

- a missing schedule-window manifest is the supported legacy no-window state;
- an invalid or retired/coexisting schedule-window representation is not an empty schedule;
- a missing optional preferences profile differs from an invalid profile;
- subjective-history UNAVAILABLE disables relative drift rather than fabricating neutral history;
- required training settings or schedule overlays follow the same fail-closed posture as production.

### 6.3 Explicit evaluatedAt

No Date.now/new Date hidden inside pure replay assembly.

For each historical date use an explicitly documented deterministic evaluatedAt convention, for example the persisted recommendation audit evaluatedAt when available. If that timestamp is absent, choose a fixed date-local deterministic timestamp and flag its provenance.

Because data-confidence staleness may depend on evaluatedAt, this field belongs in the non-history digest.

---

## 7. Replay engine redesign

### 7.1 Replace one static input object with a per-date resolver

Change historyRecommendationCounterfactual.ts from:

~~~text
runHistoryCounterfactualSeries(staticInputs, liveHistory, canonicalHistory, dates)
~~~

to an interface equivalent to:

~~~text
runHistoryCounterfactualSeries({
  dates,
  inputForDate,
  liveHistory,
  canonicalHistory,
})
~~~

Each date either returns:

- replayable + HistoricalDecisionInputs; or
- not_replayable + reason(s).

### 7.2 Snapshot window parity

Do not pass one seven-day exposure slice if production may request wider state evidence.

Build in-memory providers/snapshots that can answer the same windows requested by trainingIntent.ts, including:

- normal operational history;
- athlete-state history when required;
- rolling-load-budget history when required;
- mechanical establishment history when required.

Both providers expose the same observation-span semantics and differ only in whether their CompletedExposure rows are legacy or canonical.

### 7.3 Narrow performed facts are common input

Before the two passes:

1. determine the date's planning context/coverage descriptor;
2. derive the descriptor-scoped canonical performed facts;
3. create the prepared snapshots for both passes with that identical performedTrainingFacts object.

The test must fail if one pass falls back to live Firestore/service reads or if an injected provider causes facts to disappear.

### 7.4 No hidden I/O

The offline replay path must have:

- no browser/React dependency;
- no Firestore;
- no network;
- no current clock;
- no production writes;
- no recommendation persistence.

Make this enforceable with dependency boundaries/tests rather than relying on comments.

### 7.5 Per-date evidence output

Private output should include enough detail to adjudicate a delta without exposing it in committed artifacts:

- date alias;
- non-history input digest;
- performed-facts revision/digest;
- live broad-history revision/digest;
- canonical broad-history revision/digest;
- projected output from each pass;
- changed fields;
- causal history deltas used by classifier;
- automatic classification and reason codes;
- optional human adjudication.

Committed/sanitized output keeps only aggregate counts and non-sensitive reason totals.

---

## 8. Recommendation-delta classification

The current compareRecommendationOutputs helper accepts a field -> classification map. That is too coarse for TO4 activation evidence: selectedTemplate may be expected on one date and unexplained on another.

### 8.1 Classify per date and per changed field

Suggested result:

~~~ts
interface RecommendationFieldAdjudication {
  field: RecommendationProjectionField;
  classification: 'expected' | 'explainable' | 'unresolved';
  reasonCode: string;
  evidenceRefs: string[];
}

interface RecommendationDateAdjudication {
  dateAlias: string;
  classification: 'unchanged' | 'expected' | 'explainable' | 'unresolved';
  fields: RecommendationFieldAdjudication[];
}
~~~

### 8.2 Pre-register automatic reason rules

Do not make "canonical is better" an automatic classification.

Automatic expected/explainable classifications must be tied to deterministic evidence such as:

- duplicate-collapse changed fatigue because legacy counted two source records representing one canonical occurrence;
- structured semantic authority changed modality/stimulus from generic provider interpretation;
- canonical performed duration changed delivered dose using stronger measured evidence;
- a known legacy-only/canonical-only exposure changes a trace value in the direction predicted by the exposure delta.

The classifier should consume machine-readable history/decision trace deltas, not infer reasons from free text.

### 8.3 Human review for residual action changes

Any change to mode, selected template, prescription, dose or guardrail that is not justified by a pre-registered rule remains unresolved and enters a private review sheet.

Labels must be bound to:

- recordsSha256;
- source commit;
- POLICY_VERSION;
- date alias;
- non-history input digest;
- live/canonical history digests.

A label from stale bytes must be rejected.

### 8.4 Never globally bless a field

It must be impossible to make unresolvedDates zero by declaring, for example, all fatigue or selectedTemplate differences "expected".

---

## 9. Evidence report changes

Replace the static-scenario fields with real-history provenance.

Recommended recommendationSeries aggregate:

~~~json
{
  "status": "compared",
  "referenceSource": "historical-user-scoped-inputs-v1",
  "candidateDates": 84,
  "evaluatedDates": 84,
  "notReplayableDates": 0,
  "changedDates": 0,
  "expectedDates": 0,
  "explainableDates": 0,
  "unresolvedDates": 0,
  "changedFieldCounts": {},
  "notReplayableByReason": {},
  "classificationReasonCounts": {},
  "repeatRunIdentical": true
}
~~~

changedDates may of course be non-zero. The gate is explanation/replayability, not forced parity.

The report must state explicitly that it is a **current-policy historical-context counterfactual** and not a recreation of historical policy outputs.

---

## 10. Work breakdown

### TO4-R1 — Freeze the experiment contract with tests

Add failing tests before refactoring:

1. The two passes reject different non-history digests.
2. The two passes reject different performed-facts digests.
3. Injected history cannot silently remove performedTrainingFacts.
4. The same prepared input produces identical output on repeat.
5. A required unprovable historical source becomes not_replayable.
6. No simulation scenario fallback is permitted in real-history mode.

Primary files:

- app/src/training-occurrence/historyRecommendationCounterfactual.test.ts
- app/src/training-occurrence/historyCounterfactual.test.ts
- new offline-context tests

### TO4-R2 — Extract pure DecisionComposer composition

Refactor composer.ts so service reads remain in DecisionComposer and all deterministic source-state -> ComposedDailyDecisionInput logic moves into decisionInputComposition.ts.

Parity tests:

- existing DecisionComposer fixtures produce byte-equivalent composed decision fields;
- today is excluded from subjective baseline;
- only D-1 tissue response can create the carry;
- evaluatedAt is explicit and deterministic;
- missing/invalid/unavailable semantics do not change.

This is a behavior-preserving refactor. simulate:diff must be empty. If not, stop.

### TO4-R3 — Add export schema v2

Extend training_occurrence_export.py with the source matrix in §5.

Requirements:

- one concrete user only;
- no users collection enumeration;
- no writes;
- bounded reads;
- exact referenced immutable revisions where available;
- sufficient subjective-history lookback;
- sufficient forward horizon for schedule/placement context;
- raw output stays inside ignored artifacts.

Add Python tests for ownership, bounds, edge dates, referenced revisions and zero-write behavior.

### TO4-R4 — Parse v2 and assemble per-date source states

Add production-parser-backed hydration in to4EvidencePreparation.ts/offlineContextAssembler.ts.

For each date emit either:

- replayable HistoricalDecisionInputs, or
- not_replayable with one or more reason codes.

Implement temporal proof rules before wiring the replay. Add a private source-coverage report so missing historical provenance is visible immediately.

### TO4-R5 — Share/derive narrow canonical performed facts offline

Extract the minimum pure hydration/derivation logic from performedTrainingFactsService.ts so online and offline paths use the same engine derivation.

Resolve the same coverage descriptor the current training-intent path will consume.

Attach an identical PerformedTrainingFactsSnapshot to both histories.

Tests must cover:

- matched structured + Garmin;
- Garmin-only;
- manual/authored structured execution;
- same-day distinct occurrences;
- readiness-modified recommendation ownership;
- workout variant;
- descriptor mismatch;
- exact same facts digest in live/canonical passes.

### TO4-R6 — Reconstruct the full evaluateTrainingWithIntent call

Wire:

- objective/subjective/context/events;
- previousMode;
- fixed activities;
- plan blocks;
- training intent;
- preferences;
- schedule overlays;
- external session/rest context when reconstructable;
- confirmed progression overrides;
- common narrow performed facts.

Avoid copying Home orchestration branches when a shared pure helper can own them.

Dates whose external-plan or progression revision cannot be proven fail closed.

### TO4-R7 — Per-date replay and classifier

Update runHistoryCounterfactualSeries for date-specific inputs.

Add:

- stable input hashes;
- replayability accounting;
- per-date field classifications;
- reason codes;
- private review rows;
- stale-label rejection.

Remove the static scenario from the normal TO4 real-history command. It may remain only as an explicit synthetic/testing mode.

### TO4-R8 — Real-data rerun and evidence decision

After syncing current main and the #883 outcome:

1. run a fresh 90-day user-scoped export;
2. prepare v2 evidence;
3. review any private unresolved/adjudication rows;
4. repeat from the same prepared bytes and prove deterministic equality;
5. generate the sanitized report;
6. update the dated TO4 analysis/current plan status.

#872 closes only when its replay capability is complete and the real corpus has been honestly evaluated. If mutable historical source state prevents full replay, keep the blocker visible and create the smallest prospective-provenance follow-up instead of weakening the gate.

---

## 11. Suggested PR sequence

Prefer three reviewable PRs rather than one large mixed refactor.

### PR A — shared pure composition

Scope:

- decisionInputComposition.ts;
- optional shared same-day evaluation input assembler;
- DecisionComposer/Home call-site refactor;
- parity tests.

Expected behavior change: none.

POLICY_VERSION: unchanged.

### PR B — evidence export/hydration/replay

Scope:

- export schema v2;
- offlineContextAssembler;
- pure performed-facts hydration;
- date-specific counterfactual runner;
- private/sanitized evidence formats.

Expected live behavior change: none.

POLICY_VERSION: unchanged.

### PR C — classifier + fresh real evidence

Scope:

- deterministic per-date classifier;
- review-label binding;
- real 90-day rerun;
- updated evidence report/status docs.

Expected live behavior change: none.

POLICY_VERSION: unchanged.

A later **TO4 activation PR** is explicitly separate and must include rollout flag/rollback, policy versioning, replay/simulation acceptance and provider-lifecycle blocker review.

---

## 12. Test matrix

### 12.1 Pure composition

- exact composer parity before/after extraction;
- subjective baseline date boundary;
- D-1 carry boundary;
- data-confidence evaluatedAt;
- invalid schedule overlay fails closed;
- missing optional profile retains production semantics;
- training-settings read path does not migrate/write in evidence mode.

### 12.2 Temporal provenance

- immutable exact revision passes;
- stable-across-window source passes when proof is valid;
- mutable singleton updated after D without history => not_replayable;
- deleted/unknown historical goal/profile state => not_replayable;
- current-state substitution is impossible.

### 12.3 Planning context

- D-1 previous mode;
- fixed activity today/tomorrow semantics;
- overlapping schedule overlay;
- overlapping plan block;
- exact external-plan revision/hash;
- authored rest;
- schedule-window missing vs invalid;
- confirmed intent-block revision/progression override.

### 12.4 History experiment isolation

- common non-history digest;
- common performed-facts digest;
- live/canonical history digests differ only when data differ;
- provider requests 7/28-day windows correctly;
- no Firestore/network/current clock;
- no recommendation write;
- identical prepared bytes => identical series.

### 12.5 Classifier

- unchanged;
- one pre-registered expected causal delta;
- explainable reviewed delta;
- unrecognized action delta remains unresolved;
- blanket field classification is unsupported;
- stale labels rejected by hash/version mismatch.

### 12.6 Export/privacy

- cross-user record rejected;
- user collection never enumerated;
- no write methods;
- range/lookback/horizon bounded;
- private artifacts cannot escape ignored artifact root;
- committed report contains only allowed aggregates/aliases.

---

## 13. Verification commands

At minimum:

~~~bash
uv run pytest tests/test_training_occurrence_export.py -q
uv run ruff check .
uv run mypy src/garmin_sync

cd app
npm test -- src/training-occurrence/
npm test -- src/engine/
npm run check
npm run simulate:diff

# private evidence run
npm run evidence:training-occurrence:prepare -- --records artifacts/training-occurrence/raw/records.json
npm run evidence:training-occurrence -- --input artifacts/training-occurrence/prepared-input.json

# repository gate
cd ..
make verify
~~~

The implementation PR descriptions must record the exact focused tests and final make verify result.

---

## 14. Acceptance criteria

### Architecture

- [ ] Production and offline replay share the pure source-state composition logic.
- [ ] Historical replay has no React/browser, Firestore, network, current-clock or write dependency.
- [ ] Same-day recommendation inputs are assembled through shared production semantics rather than a second hand-written engine.
- [ ] Narrow canonical performed facts are identical between the two passes.
- [ ] Broad CompletedExposure history is the only varying decision input.

### Evidence correctness

- [ ] Export schema v2 contains every source required for the replay contract, with bounded user-scoped reads.
- [ ] Every source is production-parsed/validated where a parser exists.
- [ ] Historical mutable state is either proven or marked not_replayable.
- [ ] No static simulation scenario participates in real-history replay.
- [ ] Every candidate date is counted.
- [ ] Every changed output field is classified per date with a stable reason/evidence trail.
- [ ] Human labels are cryptographically bound to the exact evidence revision.

### Real-data gate for declaring capability gap 2 resolved

- [ ] repeatRunIdentical = true.
- [ ] deterministic replay hard gate passes.
- [ ] notReplayableDates = 0 for the declared activation corpus.
- [ ] unresolvedDates = 0 for the declared activation corpus.
- [ ] zero known false-positive merge violations in the reviewed labelled sample.
- [ ] no raw/private payload is committed.

A non-zero changedDates value is acceptable. The purpose is to understand and validate differences, not force canonical history to imitate legacy history.

### Authority boundary

- [ ] Legacy broad history remains live authority throughout #872.
- [ ] No production feature flag is enabled.
- [ ] No POLICY_VERSION bump is made unless an accidental live behavior change is discovered and split out.
- [ ] TO5 FIT identity remains out of scope.
- [ ] Provider refresh/deletion lifecycle requirements from ADR-0034 remain explicit prerequisites to any later TO4 activation review; #872 must not silently declare them solved.

---

## 15. Out of scope

- activating canonical broad history in production;
- changing #882/#883 generic non-catalog cost/stimulus semantics;
- solving the remaining multiple-provider canonical-exposure case;
- activating FIT fingerprints or implementing Adaptive-side TO5 identity;
- changing recommendation ranking/policy;
- redesigning Home UI;
- backfilling invented historical profile/settings/preferences state;
- treating historical recommendations as a gold-standard target;
- provider deletion/revocation and already-linked projection refresh unless separately scoped.

---

## 16. Definition of done

#872 is done when the repository can take one immutable private export and, for every date in the declared corpus, deterministically reconstruct the decision context sufficiently to run the current recommendation engine twice with **only broad history authority swapped**, classify every resulting difference, and prove that the run is reproducible.

Passing #872 does not mean TO4 is active. It means the project finally has evidence strong enough to make a separate TO4 activation decision.
