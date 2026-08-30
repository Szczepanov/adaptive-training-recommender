# Respiration elevation as tighten-only training evidence — HA9 implementation addendum

* **Capability owner:** `HA` — this refines
  [`health-anomaly-and-illness-risk-alerting.md`](./health-anomaly-and-illness-risk-alerting.md)
  `HA7`/`HA9`; it is not a parallel capability or status board.
* **Status:** `Active — HA9-R0 through HA9-R2 implemented on 2026-08-30; HA9-R3 collecting evidence`
* **Blocked by:** nothing for the implemented evidence-harness correction and shadow-only
  signal work (`HA9-R0`–`HA9-R2`); any user-visible wording remains blocked by the `HA7` release report,
  and any recommendation change remains blocked by labelled prospective evidence plus a
  separate recorded `tighten-v1` release decision.
* **Unlocks:** an evidence-backed decision on whether personally elevated sleeping
  respiration should explain, cap, or tighten a live training recommendation.
* **Decision basis:** ADR-0024 and ADR-0025. In particular, this plan does **not** revive the
  rejected shortcut of enabling `RespirationStrainPolicy='median-mad-v1'` in production.
* **Replay tool:**
  [`app/scripts/respiration-real-history-replay.mjs`](../../app/scripts/respiration-real-history-replay.mjs).
  It generates the local, uncommitted `artifacts/respiration-real-history-replay/latest/`
  Markdown and JSON reports used below.

## 1. Problem and current evidence

Garmin sleeping respiration is already ingested, persisted with personal 7-day/28-day
median baselines, mapped into the health-anomaly feature set, and available to the latent
training-strain comparison path. None of those facts establishes that the current broad
additive strain candidate should become live.

The updated local replay covers 90 days from 2026-06-02 through 2026-08-30:

* respiration exists on 88/90 input days;
* 62 days remain after the 28-day baseline warm-up;
* 35/62 evaluated snapshots already contain `todayTraining`, which forces the existing
  engine into its post-training recovery behavior and must not dilute the denominator for
  a morning-decision comparison;
* the actionable morning subset is therefore 27 days;
* five evaluated days have both respiration above 13 br/min and at least +1.0 br/min versus
  the personal 28-day median; all five have no Garmin-recorded same-day training;
* the existing engine already returns `modify` or `recover` on all five, so their current
  incremental decision value is explanatory/corroborative rather than a demonstrated mode
  correction;
* the broad `median-mad-v1` candidate changes 4/27 actionable recommendations: three
  `train -> modify` and one `modify -> recover`;
* every flip starts only 0.07–0.12 below an existing mode threshold, so respiration acts as
  a borderline tipping term rather than an independent high-elevation gate;
* all four flips occur at 12.2–12.8 br/min, not on the five high-respiration days;
* every evaluated 28-day respiration MAD is below the current 1.0 br/min scoring floor
  (observed range 0.2224–0.7413), so that heuristic floor—not measured personal
  variability—controls every candidate score;
* 6/27 actionable days receive positive respiration strain while the current value is
  already below the 7-day median; one such resolving day flips `train -> modify`;
* no symptom, illness, healthy-period, or follow-up labels are present in `raw_cache.json`,
  so a false-positive rate is unavailable rather than zero.

This is useful personal evidence: clearly elevated nights align with not training. It is
not yet evidence that the current additive formula isolates the right days or adds value
beyond HRV, RHR, sleep, Body Battery, symptoms, and the athlete's own decision.

## 2. Proposed decisions for plan approval

### D-RESP-1 — do not activate the additive respiration strain candidate

Normal production calls keep `RespirationStrainPolicy='off'`. Do not pass
`'median-mad-v1'` from `Home`, `PlanView`, the planner, or external/authored adjudication.

Reasons:

* the current candidate flips lower, borderline days rather than the empirically high days;
* its denominator is entirely floor-dominated in the available history;
* its chronic term can remain positive while current respiration is resolving;
* false-positive and incremental-value labels do not exist yet.

### D-RESP-2 — represent current elevation as a discrete health signal

Add a pure, versioned `RespirationElevationEvidence` classifier under the health-anomaly
capability. It answers one bounded question:

> Is last night's respiration currently and materially above both the athlete's recent and
> longer personal baseline, with enough data quality to trust the comparison?

It does not add directly to `DecisionScoreTelemetry.totalDecisionScore`, does not modify
`metricStrain`, and does not diagnose illness.

Candidate evidence shape:

```ts
type RespirationElevationStatus =
  | 'unavailable'
  | 'normal'
  | 'elevated'
  | 'strongly_elevated'
  | 'resolving';

interface RespirationElevationEvidence {
  status: RespirationElevationStatus;
  currentValue: number | null;
  baseline7dValue: number | null;
  baseline28dValue: number | null;
  deltaVs7d: number | null;
  deltaVs28d: number | null;
  baselineVersion: number | null;
  historyCount: number;
  recentDayCoverage: number;
  reasonCodes: string[];
  policyVersion: string;
}
```

The persisted health-anomaly assessment may retain this bounded derived evidence. The
recommendation audit should reference the immutable assessment revision rather than copy raw
respiration measurements into every recommendation.

### D-RESP-3 — use personal deltas, not an absolute 13 br/min cutoff

`13 br/min` is meaningful in this athlete's current history because the personal center is
lower. It is not a portable population threshold. Shadow policy compares the current value
to the athlete's own 7-day and 28-day medians.

The first replay sweep must evaluate, rather than silently adopt, at least these candidate
boundaries:

| Candidate | `deltaVs28dMedian` | `deltaVs7dMedian` | Intended interpretation |
|---|---:|---:|---|
| E1 | >= 0.75 | >= 0.25 | sensitive exploratory boundary |
| E2 | >= 1.00 | >= 0.50 | current personal-history candidate |
| E3 | >= 1.25 | >= 0.75 | more specific single-night boundary |
| S1 | >= 2.00 | >= 1.00 | strongly elevated candidate |

`E2` exactly separates the five currently high evaluated nights, but that is an in-sample
observation, not permission to ship it. The release report must compare all candidates on
new labelled days and report threshold sensitivity.

### D-RESP-4 — resolving respiration cannot newly tighten training

If the current value is at or below the 7-day median, classify the signal as `resolving` or
`normal`; it cannot independently tighten today's recommendation. This prevents the current
broad candidate's chronic-drift tail from turning a recovered reading into a new training
restriction.

The health-anomaly assessment may still preserve episode continuity and explain that a
recent elevation existed. Explanation and episode continuity are not the same authority as
a current-day training gate.

### D-RESP-5 — training effects are monotonic and bounded

If a later release decision authorizes `tighten-v1`:

* health evidence may only make a decision more conservative;
* respiration alone may at most change `train -> modify` in version 1;
* respiration alone may not change `modify -> recover`;
* a single merely `elevated` night is rationale/shadow evidence only;
* a `strongly_elevated` night or persistent elevation may cap hard/maximal work only when
  the release policy's corroboration requirements are met;
* `possible_illness_or_systemic_stress`, symptoms, or corroborating adverse RHR/HRV may use
  the broader HA9 health gate, but those are health-anomaly state decisions—not a raw
  respiration weight;
* if readiness already returns `modify` or `recover`, respiration records corroboration and
  rationale without applying a second penalty;
* no future forecast day inherits today's signal, and one elevated night does not rewrite
  the week or macrocycle;
* events remain advisory under ADR-0019; the gate reports concern but does not instruct the
  athlete to skip an event.

## 3. Target architecture

```text
Garmin nightly respiration
  -> DailyRecoverySnapshot raw + 7d/28d medians
  -> healthAnomalyFeatures threshold-free evidence
  -> RespirationElevationEvidence (personal-delta classifier)
  -> PhysiologicalAnomalyAssessment + immutable revision
  -> HealthTighteningDirective (off/shadow until release)
  -> shared readiness envelope
       -> catalog/intent-aware selection
       -> external-session adjudication
       -> authored-session adjudication
  -> compact RecommendationAudit reference + replay
```

The health assessment must be composed before a `tighten-v1` recommendation is selected.
The current `App` fire-and-forget shadow call is appropriate for shadow evidence but cannot
become a live gate: it races after decision composition and is deliberately disconnected from
selection.

Refactor the health-anomaly composition boundary so it can:

1. consume the already composed current snapshot/check-in rather than re-reading them;
2. read only the bounded history, travel context, and previous assessment needed for episode
   continuity;
3. return the exact assessment revision used by the decision;
4. persist that revision idempotently;
5. preserve the current zero-read/zero-write behavior when policy is `off`;
6. preserve fire-and-forget behavior for `shadow-v1` until live integration is explicitly
   authorized.

## 4. Delivery graph and work items

```text
HA9-R0 replay correctness
  -> HA9-R1 pure elevation classifier
  -> HA9-R2 shadow persistence/reporting
  -> HA9-R3 prospective labels and incremental-value report
  -> HA9-R4 explicit ship/no-ship decision
  -> HA9-R5 shared tighten-only gate
  -> HA9-R6 audit/replay/rules hardening
  -> HA9-R7 rollout and architecture documentation
```

### HA9-R0 — correct and harden the replay harness

**Status:** implemented 2026-08-30. **Behavior change:** none.

Update `app/scripts/respiration-real-history-replay.mjs` and its report contract:

* separate all evaluated rows from actionable morning rows (`todayTraining == null`);
* make 4/27, not 4/62, the primary decision-flip denominator for the current dataset;
* report already-trained rows separately and never count their forced-recovery invariance as
  evidence that a candidate is harmless;
* distinguish absolute display values from personal `Vs7d`/`Vs28d` deltas;
* report the E1/E2/E3/S1 threshold sweep, persistence variants, and resolving tails;
* report how often existing readiness already chose `modify`/`recover` on elevated days;
* report single-signal versus corroborated cases;
* accept optional real check-in and health-outcome input; when labels are absent, emit
  `falsePositiveRate: null` with a limitation instead of inferring healthy;
* keep raw health rows local/ignored and emit only the bounded report needed for review;
* add deterministic fixture tests for denominators, threshold boundaries, and missing labels.

Acceptance evidence:

* the current dataset reports 27 actionable rows and four broad-candidate flips;
* the five E2 high-elevation rows are reported separately and all show no same-day training;
* no current report labels those five as true positives or the lower flips as false positives.

Implementation evidence: `respirationReplayAnalysis.mjs` now owns deterministic denominator,
threshold, persistence, corroboration, resolving-tail, and optional-label summaries. The current
E1/E2/E3/S1 match counts are 6/5/4/3; actionable counts are 5/5/4/3. Every E2/E3/S1 match is
corroborated by existing metric strain and already has a conservative production mode. The
broad additive candidate still flips 4/27 actionable mornings, while false-positive rate is
explicitly `null` because no labels were supplied.

### HA9-R1 — implement the pure personal-elevation classifier

**Status:** implemented 2026-08-30. **Behavior change:** none.

Add `app/src/engine/respirationElevation.ts` with a pure function receiving bounded snapshot
features and a versioned `RespirationElevationPolicy`.

Fail closed when any of these is true:

* current respiration is missing or physiologically invalid;
* `baselineComputationVersion < 3`;
* 7-day or 28-day median is missing;
* history count or recent-day coverage is below policy minimum;
* the measurement is ineligible under identity/source-quality policy;
* date provenance does not match the target Warsaw calendar date.

Do not divide by the current 1.0 br/min training floor. MAD remains useful data-quality and
anomaly-estimator evidence, but the discrete training candidate is defined by explicit
personal deltas until replay justifies a scale-normalized boundary.

Tests cover:

* every E1/E2/E3/S1 boundary immediately below/at/above the threshold;
* old mean-baseline snapshots remain unavailable;
* missing current/7d/28d/history/identity evidence is unavailable, never normal;
* current below 7-day median resolves rather than tightens;
* absolute 13 br/min is not special across athletes with different baselines;
* lower respiration never produces adverse evidence.

### HA9-R2 — add shadow evidence to HA assessment and replay

**Status:** implemented 2026-08-30. **Behavior change:** none.

Tentative files:

| File | Change |
|---|---|
| `healthAnomalyModels.ts` | Add optional bounded respiration-elevation evidence and its policy identity. |
| `healthAnomalyFeatures.ts` | No change was needed: canonical v3+ snapshots already preserve both median baselines; the classifier recomputes bounded deltas from those values. |
| `healthAnomaly.ts` | Attach the classifier result to rationale facts; do not change training or visible wording. |
| `healthAnomalyService.ts` | Persist the bounded evidence in the immutable assessment revision. |
| `healthAnomalyPersistence.ts` | Strictly parse the additive evidence and retain legacy revision compatibility; the bumped HA policy version gives the deterministic revision a new identity. |
| `healthAnomalyReplay.ts` | Render threshold, persistence, corroboration, and resolving-tail comparisons. |
| `firestore.rules` | Allow only a bounded optional map under the existing assessment key allow-list. Strict scalar/policy validation remains in the application parser because expanding the already-large server rule exceeded Firestore's 1,000-expression limit; emulator tests cover the bounded server contract. |

Prefer an additive optional field under schema version 1 only if old/new revision identity and
rules remain unambiguous. Otherwise bump the health-assessment schema and retain an explicit
legacy reader; do not silently reinterpret an old revision under new policy semantics.

The implementation uses the additive schema-version-1 option. Legacy records without the
field still parse. New assessments use `health-anomaly/ha9-respiration-shadow-v1`, and the
classifier policy is `respiration-elevation/shadow-e2-s1-v1`. Shadow reports now include status
counts, two-night persistence, corroborated versus isolated evidence, and resolving tails.

### HA9-R3 — collect labels and measure incremental value

**Status:** evidence collection active; blocked on enough labelled prospective days/episodes for a release-quality estimate. **Behavior change:** none.

Reuse HA6 outcomes, the decision journal, adherence/completed-session history, and existing
confounder context. Do not treat “no Garmin activity” as an illness label; it is an athlete
decision/outcome that may have many causes.

For each candidate boundary report:

* elevated nights and unique episodes per 30 observed days;
* same-day athlete decision: train as planned / scale / substitute / rest;
* whether existing readiness was already `modify`/`recover`;
* RHR/HRV/sleep/symptom corroboration;
* hard-training, travel, alcohol, heat/dehydration, allergy, vaccination/medication context;
* symptoms and outcome explanations at 24/48/72 hours;
* healthy-period false-alert burden;
* lead time before labelled symptoms;
* isolated-respiration versus multi-signal decision flips;
* resolving-tail days and whether a proposed gate would have remained conservative after the
  athlete considered the event resolved;
* threshold sensitivity for E1/E2/E3/S1 and one-night versus persistent variants.

The release dataset must include both elevated and normal healthy periods. A handful of
high nights with no training is useful evidence but cannot estimate specificity or PPV.

### HA9-R4 — record the release decision

**Status:** blocked by HA9-R3. **Behavior change:** none by itself.

Write a dated analysis document that chooses exactly one:

1. **No ship:** remain shadow; respiration only supports developer evidence.
2. **Explain only:** show personal elevation in visible HA rationale but do not change training.
3. **Corroborated cap:** allow persistent/strong respiration plus defined corroboration to
   cap `train` at `modify`.
4. **Recalibrate:** change candidate boundaries and run a new prospective segment.

The report must name the chosen `RespirationElevationPolicy` and
`HealthTrainingGatePolicy` versions, expected flip burden per 30 actionable mornings, measured
false-alert ceiling, rollback trigger, and decision owner. If it authorizes semantics outside
ADR-0025/HA9, record a new ADR before implementation.

### HA9-R5 — implement the shared tighten-only gate

**Status:** blocked by an HA9-R4 “corroborated cap” decision. **Behavior change:** yes.

Introduce a compact directive rather than passing the whole assessment into ranking:

```ts
interface HealthTighteningDirective {
  action: 'none' | 'cap_hard' | 'require_recovery';
  assessmentRevisionId: string;
  healthPolicyVersion: string;
  gatePolicyVersion: string;
  reasonCodes: string[];
}
```

`require_recovery` is reserved for the broader evidence-backed health-anomaly state; version
1 respiration-only evidence cannot emit it.

Apply the directive to the shared envelope state after
`rules.ts` `evaluateReadinessAndSafetyEnvelope` and before any candidate/session decision.
Internal intent-aware selection, external-session adjudication, and authored-session
adjudication already consume that shared envelope shape; do not add three independent health
rules.

Production composition requirements:

* extend the composed decision input with the immutable assessment revision/directive;
* await the assessment only under explicitly authorized `tighten-v1`;
* do not use a stale persisted same-day assessment when current snapshot/check-in revisions
  differ;
* keep `off` bit-identical and preserve current shadow behavior;
* do not project today's directive into next-day branches or future planner days;
* if the required live health input is unavailable, fail closed to the existing readiness
  result—not to fabricated normal physiology and not to an unexplained new restriction.

### HA9-R6 — provenance, replay, Firestore, and policy drift

**Status:** blocked by HA9-R5. **Behavior change:** part of the same atomic release.

Add compact `HealthTighteningAudit` provenance to `Recommendation.decisionTrace` and
`RecommendationAudit`:

* health assessment revision ID and content identity/hash;
* health/gate policy versions;
* pre-gate and post-gate mode/tier;
* action and bounded reason codes;
* no raw payloads, notes, or duplicated health history.

Update `provenance.ts`, `replay.ts`, persistence validation, and Firestore rules so a changed
decision cannot replay without the exact immutable health assessment it referenced. Add the
new recommendation `POLICY_VERSION` to historical versions when superseded.

Production activation and audit/rules changes ship atomically; there must be no deployment in
which recommendations change but provenance silently omits why.

### HA9-R7 — rollout, rollback, and living documentation

**Status:** blocked by HA9-R5/HA9-R6.

Rollout order:

1. `off` — unchanged production behavior;
2. `shadow-v1` — classifier/reporting only;
3. `visible-v1` — only if HA7 separately authorizes wording;
4. `tighten-v1` for the intended user/environment after HA9-R4;
5. review after the first 14 and 30 actionable mornings, then per rolling 30-day window.

Rollback is one configuration change back to `visible-v1` or `shadow-v1`; old recommendation
and assessment revisions remain immutable and readable. Roll back immediately if the reviewed
unnecessary-tightening rate exceeds HA9-R4's ceiling, source/identity eligibility regresses,
or replay cannot reproduce a changed recommendation.

Update:

* `docs/architecture/health-anomaly-shadow.md` when live composition exists;
* `docs/architecture/recommendation-engine.md` when the shared envelope gains the health gate;
* the canonical HA plan status and next-agent handoff;
* operational feature-flag and rollback documentation.

## 5. Cross-path acceptance criteria

The implementation is not complete unless all of these hold:

1. `off` and `shadow-v1` produce byte-equivalent recommendation decisions to current
   production.
2. A normal or resolving respiration signal never tightens training.
3. Respiration-only version 1 can produce `train -> modify` but never `modify -> recover`.
4. No health path can produce `recover -> modify/train` or `modify -> train`.
5. If existing readiness is already equally/more conservative, the mode is unchanged and
   only corroboration/rationale is recorded.
6. Internal catalog, external plan, and authored occurrence paths consume one shared directive
   and agree on the effective envelope.
7. Events remain advisory.
8. Future planner days do not inherit current-day health evidence.
9. Missing/invalid/stale/identity-ineligible respiration cannot fabricate normal or adverse
   training authority.
10. Every changed recommendation names the health gate in rationale and has replayable audit
    provenance.
11. User isolation remains under `users/{APP_USER_ID}/...`; no default user or root recovery
    path is introduced.
12. Warsaw local-date semantics are preserved for snapshot, assessment, history, and decision
    dates.

## 6. Verification commands

Evidence-only work:

```bash
node app/scripts/respiration-real-history-replay.mjs
cd app && npm test -- --run src/engine/healthAnomalyFeatures.test.ts src/engine/healthAnomalyReplay.test.ts
cd app && npm run typecheck
cd app && npm run lint
```

Any live decision change additionally requires:

```bash
cd app && npm run check
cd app && npm run test:rules
cd app && npm run simulate:scenarios
cd app && npm run simulate:diff
cd app && node scripts/check-policy-drift.mjs <base-sha>
cd app && npm run build
```

Review the semantic simulation diff, all mode flips in the prospective replay, and exact
audit replay—not only command exit codes—before enabling `tighten-v1`.

## 7. Explicit non-goals

This addendum does not:

* diagnose respiratory infection, asthma, allergy, or any specific condition;
* treat “no training” as proof that a high respiration night was pathological;
* use an absolute population cutoff as the primary rule;
* activate Garmin Training Readiness, stress, or other correlated composites as extra
  additive penalties;
* authorize the current 1.0 br/min MAD floor;
* infer labels from free-text notes;
* loosen a recommendation because respiration is low;
* ship visible alerts or training changes merely because the classifier and tests exist.
