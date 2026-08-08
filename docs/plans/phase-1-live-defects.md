# Phase 1 — Live defects

* **Status:** **Ready** for 1.1 and 1.3 · **Approved (blocked)** for 1.2
* **Blocked by:** *per work item* —
  **1.1 (F1 injuries)** nothing · **1.3 (F6 rules ratchet)** nothing ·
  **1.2 (F2 objective credit)** requires Phase 0's invariant + credit-regression harness
* **Unlocks:** a correct foundation for the Phase 2–5 cutover
* **Addresses:** F1, F2, F6
* **Rough effort:** 3–4 days

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Blocked by | Summary | Primary files |
|---|:--:|---|---|---|
| 1.1 | `[x]` | — | Structured `InjuryConstraint[]` replaces the dead free-text injury channel (F1) | `app/src/engine/models.ts`, `injuryPolicy.ts` (new), `adapters.ts`, `rules.ts`, `eligibility.ts`, `optimizer.ts`, `services/trainingSettingsService.ts`, `components/TrainingSettings.tsx`, `app/firestore.rules` |
| 1.2 | `[x]` | **Phase 0** | Recognised Garmin sessions earn objective credit from an inferred stimulus vector (F2) | `app/src/engine/completedTraining.ts`, `microcycle.ts`, `trainingHistory.ts` |
| 1.3 | `[x]` | — | Append-only recommendation revisions; decision fields immutable per revision (F6) | `app/firestore.rules`, `app/src/services/recommendationService.ts`, `app/src/components/Home.tsx`, `app/src/emulator/firestoreRules.emulator.test.ts` |

1.1 and 1.3 are independent of each other and of Phase 0 — either can start today.
**1.2 must not start before Phase 0**: it changes objective crediting for every existing
user, and its constants cannot be chosen without the credit-regression harness.

---

## Goal

Fix the three defects where the system's actual behaviour differs from its documented
behaviour for a real user today: an injury gate with no data source, measured training
that earns no objective credit, and audit records a client can rewrite.

## Why this cannot wait for the architecture work

The Phase 2–5 cutover migrates onto whatever foundation exists. Migrating onto an unwired
safety gate and rewritable audit evidence carries both defects forward and makes them
harder to see, because they will then be spread across a larger surface.

---

## `[x]` 1.1 — F1: give injury constraints a real data path

### Current state

`app/src/engine/adapters.ts` — `mapContextFromGoalsAndTrainingSettings`, the only production constructor of `UserContext` —
hardcodes `injuries: []`. Everything downstream is therefore dead in production:

* `optimizer.ts` — `rankCandidatesByUtility`'s "hard safety gating" modality filter
* `rules.ts` `evaluateEnvelopes` — `hasRunningInjury`, and the `isPain && injuries.length > 0` branch
  that is the only writer of `restrictedModalities`
* `planner.ts` — `generateWeekAheadPlan` reads `context.constraints.injuries` and passes it to `rankCandidatesByUtility`; same dead filter, across all 7 forecast days

Consequences worth stating plainly: `SafetyEnvelope.restrictedModalities` is **always**
`[]`, so the `restrictedModalities` filter inside `evaluateTrainingWithIntent` is a no-op and the persisted audit's
`safetyRestrictedModalityCount` is always `0` — the audit records a safety check that
never ran.

Note that `simulation/scenarios.ts`'s `context()` helper *does* pass `injuries`, so the harness exercises
and appears to validate a filter production can never trigger. This is the sharpest
instance of the pattern in the review's §0.

### What already works — do not rebuild it

`TrainingSettings.guardrails` **is** wired end to end:
`eligibility.ts` checks `template.safetyTags.some(tag => settings.guardrails[tag])`
against the four `GuardrailKey`s (`avoid_high_impact`, `avoid_heavy_lower_body`,
`avoid_overhead_pressing`, `avoid_heavy_spinal_loading`), and templates carry
`safetyTags`. Athlete-set guardrails already gate correctly on both paths.

So the gap is narrower than "injuries are unimplemented": there is a working *manual*
guardrail channel and a dead *free-text injury* channel that ADR-0007 §6 calls the hard
safety gate.

### Two options, and the decision

**Option A — delete the dead channel.** Remove `UserContext.constraints.injuries` and its
readers; consolidate on guardrails; amend ADR-0007 §6 to say guardrails are the hard
safety gate. Cheapest, honest, and immediately removes the false `safetyRestrictedModalityCount`.
But guardrails cannot express "no running", cannot expire, and cannot distinguish an
acute injury from a standing preference.

**Option B — formalise injuries as structured constraints that derive guardrails.**
Keeps the ADR-0007 guarantee and makes it real.

> **Decision (2026-08-08): Option B.**
> Option A is cheaper but structurally caps what the system can ever express, and this is
> the safety layer — the one place where paying for expressiveness up front is correct.
> Three specific things Option A cannot do and Option B can: exclude a *modality*
> (guardrails are template-tag scoped, so "no running" is inexpressible); *expire* a
> constraint, so an acute injury does not silently become a permanent restriction; and
> distinguish an injury from a standing preference, which matters because Phase 5.4's
> tissue tracking needs somewhere to attach. Choosing A would mean redoing this work at
> Phase 5 anyway, on top of a schema that had already been simplified in the wrong
> direction.
> Option A remains the documented rollback if Option B proves too large mid-phase.

Add to `TrainingSettings` at `schemaVersion: 3` (already permitted by the type
`schemaVersion: 2 | 3` and by `firestore.rules`, which allows `[2, 3]` — the forward
allowance exists and is currently unusable because `trainingSettingsService.ts`'s `SETTINGS_SCHEMA_VERSION` pins
`SETTINGS_SCHEMA_VERSION = 2`):

```ts
export type BodyRegion =
  | 'knee' | 'achilles' | 'ankle' | 'calf' | 'hamstring' | 'quadriceps'
  | 'adductor_groin' | 'hip' | 'lower_back' | 'shoulder' | 'elbow' | 'wrist';

export interface InjuryConstraint {
  region: BodyRegion;
  severity: 'monitor' | 'limit' | 'exclude';
  /** ISO date; absent = indefinite. Expired entries are ignored, not deleted. */
  reviewBy?: string;
  note?: string;
}
```

Add a **pure** resolver, `app/src/engine/injuryPolicy.ts`:

```ts
export function resolveInjuryRestrictions(injuries: InjuryConstraint[], today: string): {
  restrictedModalities: SessionTemplate['modality'][];
  impliedGuardrails: GuardrailKey[];
  restrictedCategories: SessionTemplate['category'][];
}
```

with an explicit region → restriction table. **Adopted as the implementation default**
— these are conservative engineering mappings, not coaching advice. They are deliberately
biased toward over-restriction: a false exclusion costs one session, a false permission
costs a re-injury. Implement as written; revise only if a coaching review disagrees, and
record the revision in ADR-0007's amendment rather than silently editing the table:

| Region | `exclude` implies | `limit` implies |
|---|---|---|
| knee, achilles, **ankle**, calf | modality `Running`; guardrail `avoid_high_impact` | guardrail `avoid_high_impact` |
| hamstring, quadriceps, adductor_groin, hip | categories `Lower-body Strength`, `Full-body Strength`; guardrail `avoid_heavy_lower_body` | guardrail `avoid_heavy_lower_body` |
| lower_back | guardrails `avoid_heavy_spinal_loading`, `avoid_heavy_lower_body` | `avoid_heavy_spinal_loading` |
| shoulder, elbow, wrist | guardrail `avoid_overhead_pressing`; categories `Upper-body Strength` | `avoid_overhead_pressing` |

`monitor` implies nothing structural — it exists to be surfaced in the UI and to feed
Phase 5's tissue tracking.

**`ankle` is not optional.** The existing `RUNNING_INJURY_PATTERN`
(`/\b(knee|achilles|ankle|leg|run)/`) matches `ankle`, so omitting it from `BodyRegion`
would let this change *remove* an existing running restriction. Every token the old
pattern matched must map to at least the same restriction before the pattern is deleted —
verify that as a migration checklist item, not by inspection.

**Two of those tokens have no body region, and silently dropping them is the failure mode
this paragraph exists to prevent.** `knee`, `achilles` and `ankle` map to `BodyRegion`
members directly. `leg` and `run` do not, and never will — `leg` names no specific tissue
and `run` names an activity, not a body part. Do not invent regions for them. Map them at
the *restriction* level instead:

| Legacy token | Migrates to | Rationale |
|---|---|---|
| `knee`, `achilles`, `ankle` | `{ region: <same>, severity: 'limit' }` | Direct region match |
| `leg` | `{ region: 'hamstring', severity: 'limit' }` **plus** modality restriction on `Running` | Unlocalised lower-limb complaint; the only restriction the old pattern actually produced was the running block, so preserve that explicitly rather than guessing a tissue |
| `run` | modality restriction on `Running` only, no region | Names the aggravating activity, not an injury site |

`InjuryConstraint` therefore needs `region` to be **optional** when an explicit
`restrictedModalities` list is present — a legacy `run` entry is a real restriction with
no known site, and forcing a fabricated region would be worse than modelling the gap.

Migration is one-way and lossy in the safe direction (it can over-restrict, never
under-restrict). Flag `leg`/`run` migrations in the UI so the athlete can replace them
with a precise region.

**Migration tests are required for both tokens**, asserting that a settings document
carrying legacy `injuries: ['leg']` and one carrying `injuries: ['run']` each still
produce a running restriction after migration. Without these two cases the migration can
pass every other test while quietly unblocking running for an injured athlete.

**One canonical representation, one derived form.** `UserContext.constraints.injuries`
must not become a second source of truth alongside structured injuries: a settings update
or migration could refresh one and leave the other stale, in the safety layer. So:
`InjuryConstraint[]` is canonical and lives on `TrainingSettings`; `UserContext` carries
the **resolved** output of `resolveInjuryRestrictions` (modalities, categories,
guardrails); the legacy `injuries: string[]` field is **deleted**, not retained in
parallel. `rules.ts` and `optimizer.ts` migrate to the resolved lists in the same change.
A test must assert both evaluation paths derive identical restrictions from one settings
object.

### Work items

1. `models.ts` — add `BodyRegion`, `InjuryConstraint`, and `TrainingSettings.injuries?: InjuryConstraint[]`.
2. `injuryPolicy.ts` — the pure resolver above, fully unit-tested. No Firebase, no I/O.
3. `adapters.ts` / `models.ts` — **delete** `UserContext.constraints.injuries: string[]`
   and replace it with the resolved output of `resolveInjuryRestrictions`. Do not keep the
   legacy field in parallel (see "One canonical representation" above).
4. `rules.ts` `evaluateEnvelopes` — replace `RUNNING_INJURY_PATTERN` (`/\b(knee|achilles|ankle|leg|run)/`,
   which also matches "legal" and "runny") with `resolveInjuryRestrictions`. Populate
   `restrictedModalities` from it.
5. `eligibility.ts` — union `settings.guardrails` with `impliedGuardrails` so injuries
   gate templates on **both** paths without duplicating the check.
6. `optimizer.ts` — in `rankCandidatesByUtility`, replace the substring test
   (`injuryConstraints.some(inj => inj.toLowerCase().includes(lowerMod))`, which relies on
   an injury string happening to contain a modality name) with the resolved modality list.
7. `trainingSettingsService.ts` — bump `SETTINGS_SCHEMA_VERSION` to 3; accept 2 on read
   and default `injuries: []`; write 3.
8. `Preferences.tsx` / `TrainingSettings.tsx` — an editor: region, severity, optional
   review date. Show derived restrictions read-only so the athlete can see what a setting
   actually does.
9. `firestore.rules` — validate the `injuries` array shape (bounded length, enum region,
   enum severity, optional ISO date string).

### Tests

* `injuryPolicy.test.ts` — full region × severity table, plus expiry behaviour.
* `rules.test.ts` — an `exclude` achilles injury removes every `Running` template on the
  readiness path and populates `restrictedModalities`.
* `planner.test.ts` — the same injury holds across all 7 projected days.
* `architecture.test.ts` — a `limit` hamstring injury excludes heavy lower-body work from
  the intent path.
* Regression: `safetyRestrictedModalityCount` in a persisted audit is non-zero when an
  injury is active.

---

## `[x]` 1.2 — F2: Garmin-measured training must earn objective credit

> **Blocked by Phase 0.** This item introduces inferred-stimulus constants and changes
> objective crediting for every existing user. It cannot be validated without the
> invariant suite and the credit-regression harness, and the constants must not be chosen
> before that harness exists — see "Constants are illustrative" below for why that is not
> a formality.

### Current state

Verified empirically: three Garmin activities in the rolling window (120 min hard ride,
60 min strength, 90 min moderate ride) leave every objective at `0/target`.

Chain: `completedTraining.ts:candidateEventFromGarmin` sets
`estimatedStimulus: ZERO_STIMULUS` → `completedEventToExposure` attaches
`stimulusProfile` whenever `modality !== 'Unknown'`, including the all-zero vector →
`microcycle.ts:buildMicrocycleState` routes any exposure with `stimulusProfile && modality`
to `creditObjectivesFromStimulus`, which needs `stimulusCoverage >= 0.6`.

The inversion is the bug: an unrecognised activity type gets `modality: undefined`, falls
through to `updateMicrocycleProgress`'s keyword matcher, and **does** get credit.

### The keyword fallback is NOT the intended destination

An earlier draft of this plan said to omit the all-zero profile "so Garmin-only events
fall through to the fallback path". **That was wrong and is corrected here.**

The review's own F7 shows the keyword matcher is directionally broken. For a recognised
hard ride, `completedEventToExposure` builds `trainingRecordLike.type = "Cycling hard"`.
If that string reaches `updateMicrocycleProgress` (`updateMicrocycleProgress`), it credits:

* `threshold_quality` — because the string contains `hard`; **and**
* `zone2_aerobic` — because the string contains `cycling`.

So routing recognised Garmin sessions to the fallback would trade today's false negative
for a **false positive with double credit** on a single ride. That is not an improvement.

The correct framing:

1. An all-zero stimulus vector means **unknown**, not "a valid structured vector that
   happens to be zero". The guard exists to stop the engine treating unknown as known.
2. Recognised Garmin sessions get a **coarse inferred stimulus vector** carrying an
   evidence/confidence marker. This is the intended credit path.
3. Keyword matching is **legacy last-resort compatibility only** — for genuinely
   unrecognised activity types with no other signal. It should shrink over time, not grow.

### Fix

**(a) Make "unknown" distinguishable from "zero".**
In `completedEventToExposure`, attach `stimulusProfile` only when the vector carries
signal:

```ts
const hasStimulus = Object.values(event.estimatedStimulus ?? {}).some(v => (v ?? 0) > 0);
```

Modality is still attached when known — it is needed for qualification checks and ranking
context regardless of whether a stimulus vector exists. Only the *stimulus* is withheld.

**(b) Give recognised Garmin activities a real coarse stimulus — the actual fix.**
Add `DEFAULT_STIMULUS_BY_MODALITY: Record<CompletedModality, Record<CompletedTrainingIntensity, WorkoutStimulusProfile>>`
alongside the existing `DEFAULT_COST_BY_MODALITY`, and use it in
`candidateEventFromGarmin`. Intensity comes from the existing `intensityFromGarmin`
(training effect ≥ 3 → hard, ≥ 1.5 → moderate).

With (b) in place, (a) rarely fires for recognised modalities — which is the point. (a) is
a correctness guard, not a routing mechanism.

**"Recognised modality, but no stimulus available" must not be a reachable state.** The
type is a total `Record<CompletedModality, Record<CompletedTrainingIntensity, …>>`, so
every recognised modality/intensity pair has an entry and TypeScript rejects the table if
one is missing. That is deliberate: were the state reachable, a known `"Cycling hard"`
event would fall through to the keyword matcher and pick up exactly the double credit
D-KWD exists to prevent. **Do not** widen the type to `Partial<Record<…>>` or add a
lookup fallback — the totality of this table is the guarantee. Add a test asserting the
table is total (every `CompletedModality` × `CompletedTrainingIntensity` cell present and
non-zero) so the guarantee fails loudly at test time rather than at credit time if a
future modality is added to the union without a stimulus row.

### Constants are illustrative — the test comes first

An earlier revision of this plan published a table as "adopted starting values" while
simultaneously requiring implementation to verify it later. **The published table failed
that verification.** Worked through against today's credit function:

`stimulusCoverage` is `Σ(target × stimulus) / Σ(target)`, so for a single-axis objective
it reduces to the candidate's own value on that axis.

| Objective | `targetStimulus` | Proposed `moderate` value | Coverage | ≥ 0.6? |
|---|---|---|---|---|
| `zone2_aerobic` | `{ aerobicCapacity: 0.8 }` | 0.70 | 0.70 | **yes** |
| `threshold_quality` | `{ thresholdDevelopment: 0.9 }`, min 0.6 | 0.60 | 0.60 | **yes** (and clears qualification exactly) |

One moderate ride would therefore have resolved **both** objectives — precisely the
double-credit failure this plan says must not happen, and the same failure mode the
keyword matcher produces. Publishing constants and deferring their validation is the
practice F11 exists to criticise; doing it inside the fix for F2 was worse.

**Therefore: no constants are adopted here.** The numbers below are *illustrative shape
only* — conservative, aerobic-weighted, rising threshold and surge with intensity:

| Intensity | `aerobicCapacity` | `thresholdDevelopment` | `surgeRepeatability` |
|---|---|---|---|
| easy | ~0.75 | low | ~0 |
| moderate | ~0.70 | **below the 0.6 credit floor** | low |
| hard | ~0.55 | high | high |

**First implementation task, before any constant is chosen:** a table-driven test over
every `modality × intensity × objective` combination asserting, for each cell, exactly
which objectives it credits. Choose the constants to satisfy that table. The load-bearing
assertion is that no single inferred exposure resolves two objectives that represent
different training intentions — `zone2_aerobic` and `threshold_quality` in particular.

This is the concrete reason 1.2 is blocked on Phase 0: the credit-regression harness is
what makes the table checkable, and without it the constants would again be chosen by
assertion.

Mark whatever is chosen as provisional in a comment citing this plan; Phase 4 replaces it
with the evidence hierarchy.

**(c) Carry confidence.** Add `stimulusConfidence: 'exact' | 'inferred' | 'unknown'` to
`CompletedExposure`. `exact` for adherence-confirmed catalog templates, `inferred` for
(b), `unknown` where no vector exists. Phase 4's evidence hierarchy builds directly on
this field; adding it now costs nothing and prevents a second migration.

### Interaction to check

Fix (b) makes Garmin rides start resolving objectives. That lowers `urgency` in
`resolveTrainingIntent`, which lowers `plannedDose`, which changes `executionDose`.
**Re-run the Phase 0 invariant suite and read the semantic diff before merging.**

### Tests

* `completedTraining.test.ts` — a Garmin-only cycling event produces a non-zero stimulus
  profile with `stimulusConfidence: 'inferred'`.
* `completedTraining.test.ts` — an unknown-modality event produces **no structured
  stimulus profile** (`stimulusConfidence: 'unknown'`). This is deliberately *not* the
  same as "earns no credit": it still reaches the legacy keyword fallback, which may award
  compatibility credit. Assert the two separately — one test that no structured profile is
  produced, one that the intended fallback credit is preserved — so this change neither
  introduces false-positive keyword credit nor silently removes existing compatibility
  credit.
* `microcycle.test.ts` — the F2 probe, promoted to a real test: three Garmin sessions
  resolve `zone2_aerobic` and `strength_maintenance`.
* `microcycle.test.ts` — **regression against the false-positive risk**: a generic
  `"Cycling hard"` record does **not** resolve both `zone2_aerobic` and
  `threshold_quality` unless the inferred structured stimulus independently supports
  both. This is the test that keeps the fix from overshooting.
* `microcycle.test.ts` — an adherence-confirmed exposure still uses the exact template
  profile in preference to the modality default (evidence ordering holds).

---

## `[x]` 1.3 — F6: make recommendation records actually immutable

### Current state

`app/firestore.rules` comments the document as "audit evidence and intentionally
immutable", but `allow update` pins only `createdAt`. A client may rewrite `templateId`,
`mode`, `rationale`, `recommendationAudit` or `candidateScores`. And because the audit
requirement is conditional on `schemaVersion == 3`, a v3 document can be rewritten as v1
and stripped of its audit entirely.

### Decide the lifecycle first — the ratchet is blocked on it

Pinning decision fields breaks a legitimate flow. `Home.tsx` recomputes today's
recommendation on **every** dashboard load and calls `saveRecommendation`, which
`setDoc(..., { merge: true })`s the newly computed `templateId` / `mode` / `rationale`
over the existing `{date}` document. Recomputation can legitimately change the answer
within a day — the athlete completes a session at noon, `alreadyTrainedToday` flips, mode
becomes `recover`. With naive field pinning that write is **rejected**, and the UI then
shows a recommendation the persisted audit contradicts. That is worse than the gap being
fixed.

Two lifecycles are viable:

* **(A) First write wins.** The first persisted recommendation for a date is
  authoritative; later loads replay it rather than re-deciding. Simple, but freezes a
  morning decision that has since become wrong, and discards a real second decision.
* **(B) Append-only revisions.** Decision fields are immutable *per revision*; a changed
  decision creates a new one. The latest revision is what the UI and adherence refer to.

> **Recommendation: (B).** A same-day recomputation after a completed session is a real,
> correct decision, not a correction of the morning's — and the morning's was also really
> shown to the athlete. (A) would have to discard one of the two, and whichever it
> discards, the audit stops matching what the user saw. Adherence semantics also stay
> intact under (B): it attaches to the date, resolving to the latest revision.
>
> **Shape.** `users/{userId}/daily_recommendations/{date}` remains the *current* decision
> and gains a monotonic `revision: number` (first write = `1`). Superseded decisions are
> archived at `users/{userId}/daily_recommendations/{date}/revisions/{revision}`, where the
> document ID is the **prior** revision number as a string. A decision change is one atomic
> batch: create the archive doc for `resource.data.revision`, and set the current doc to
> `revision + 1`.

**The archive write is enforced by rules, not by client good behaviour.**

An earlier revision of this plan claimed Firestore rules could not verify the prior state
was copied, and left it as a client-side batch obligation. **That was wrong**, and it
mattered: it would have left a malicious or buggy client free to overwrite the current
recommendation without preserving the prior audit — destroying precisely the integrity
property this work item exists to establish. Rules can validate another document's
*post-write* state in the same batch or transaction via `getAfter()` / `existsAfter()`.

```text
function decisionFieldsChanged() {
  return request.resource.data.templateId    != resource.data.templateId
    ||   request.resource.data.templateTitle != resource.data.templateTitle
    ||   request.resource.data.category      != resource.data.category
    ||   request.resource.data.modality      != resource.data.modality
    ||   request.resource.data.mode          != resource.data.mode
    ||   request.resource.data.rationale     != resource.data.rationale
    ||   request.resource.data.prescription  != resource.data.prescription;
}

// Bind the lookup once with `let` -- each distinct getAfter() is a document access and
// rules cap those per request (10 single-document / 20 multi-document or batched).
function archivesPriorRevision(userId, date) {
  let priorPath = /databases/$(database)/documents/users/$(userId)/daily_recommendations/$(date)/revisions/$(string(resource.data.revision));
  let prior = getAfter(priorPath).data;
  return prior.revision      == resource.data.revision
    &&   prior.templateId    == resource.data.templateId
    &&   prior.templateTitle == resource.data.templateTitle
    &&   prior.category      == resource.data.category
    &&   prior.modality      == resource.data.modality
    &&   prior.mode          == resource.data.mode
    &&   prior.rationale     == resource.data.rationale
    &&   prior.prescription  == resource.data.prescription
    &&   (!('recommendationAudit' in resource.data)
          || prior.recommendationAudit == resource.data.recommendationAudit);
}
```

Update rule for `daily_recommendations/{date}`:

* **Decision changed** → require `request.resource.data.revision == resource.data.revision + 1`
  **and** `archivesPriorRevision(userId, date)`. The archive must match the *pre-update*
  document field for field, so a missing, mismatched or fabricated archive is rejected.
* **Decision unchanged** (adherence answer, or adding `adjustment`) → require `revision`
  unchanged and no archive write. Routine updates must stay cheap; demanding an archive for
  an adherence tick would make the common path expensive and push clients toward working
  around it.

Rules for `daily_recommendations/{date}/revisions/{revision}`: **create-only** for the
owner, never update, never delete, and `request.resource.data.revision` must equal the
document ID cast to a number.

**Residual limit, stated accurately this time:** rules constrain the archive's content and
its existence-after-write, but cannot compel a client to write a new decision at all. That
is not a gap — a client that never writes simply leaves the record unchanged.

**`prescription` is decision evidence** and must be pinned per revision alongside the
other decision fields — the earlier `decisionFieldsUnchanged()` sketch omitted it.

### Fix

Once (B) is chosen, add these helpers to the `daily_recommendations` update rule:

```text
function schemaRatchets() {
  return request.resource.data.schemaVersion >= resource.data.schemaVersion;
}

function decisionFieldsUnchanged() {
  return request.resource.data.templateId    == resource.data.templateId
    &&  request.resource.data.templateTitle  == resource.data.templateTitle
    &&  request.resource.data.category       == resource.data.category
    &&  request.resource.data.modality       == resource.data.modality
    &&  request.resource.data.mode           == resource.data.mode
    &&  request.resource.data.rationale      == resource.data.rationale
    &&  request.resource.data.createdAt      == resource.data.createdAt;
}
```

`recommendationAudit` needs care: `Home.tsx` writes the record once with the audit
attached, and `handleAdjustSession` re-saves the same base recommendation with an added
`adjustment`. So `adjustment` **must** stay mutable, and the audit must be write-once —
absent-then-set is legal, set-then-changed is not:

```text
function auditWriteOnce() {
  return !('recommendationAudit' in resource.data)
    || request.resource.data.recommendationAudit == resource.data.recommendationAudit;
}
```

Verify against `recommendationService.saveRecommendation`'s `setDoc(..., { merge: true })`
semantics before landing — `merge: true` means `request.resource.data` is the merged
result, so unmentioned fields compare equal, which is what these rules assume.

### Tests (extend `src/emulator/firestoreRules.emulator.test.ts`)

* rejects an update that changes `templateId` **without** the matching archive write
* rejects a decision change whose archive document exists but has **mismatched** fields
* rejects a decision change that archives under the **wrong revision number**
* rejects `revision` not incrementing by exactly 1 on a decision change
* rejects any update or delete of an existing `revisions/{revision}` document
* rejects `schemaVersion` 3 → 1
* rejects removing or altering `recommendationAudit` once set
* **allows** setting `adherence` on an existing document
* **allows** adding `adjustment` to an existing document
* **allows** first-time attachment of `recommendationAudit`

**Make a skipped rules suite a failure, not a pass.** The suite is `describe.skip` unless
`FIRESTORE_EMULATOR_HOST` is set, so `npm run test:rules` can exit 0 having executed none
of the immutability tests — the security suite would appear green while testing nothing.
Add a guard test *outside* the conditional block that fails when the emulator host is
absent in CI (and reports a clear setup error locally), plus an assertion on the expected
rule-test count so a silently-shrinking suite is caught.

---

## Acceptance criteria

- [ ] `injuries: []` no longer appears in `adapters.ts`; an active injury changes the
      recommendation on the readiness path, the intent path, and all 7 projected days
- [ ] `safetyRestrictedModalityCount` is non-zero in a persisted audit when an injury is active
- [ ] `RUNNING_INJURY_PATTERN` deleted
- [ ] three Garmin-only sessions resolve at least two weekly objectives
- [ ] the inversion is gone: a *recognised* Garmin session earns credit from its inferred
      structured stimulus (`stimulusConfidence: 'inferred'`), and an *unrecognised* one
      produces no structured profile (`'unknown'`) while retaining whatever legacy
      fallback credit it earns today. "No structured profile" must not be read as "no
      credit" — the two outcomes are asserted by separate tests
- [ ] emulator suite covers field tampering, schema downgrade, audit removal, and the
      three legal-update cases
- [ ] simulation baseline regenerated and the delta reviewed in the PR description

## Risks & rollback

* **1.2 changes recommendations for every existing user immediately** — more objectives
  resolve, so `plannedDose` drops and the optimizer stops chasing them. This is the
  intended correction, but it is a behaviour change; ship it behind the baseline diff and
  read it before merging.
* **1.3 could break the adjust-session save path** if `merge: true` semantics differ from
  the assumption above. The emulator tests are the guard; write the three "allows" cases
  first and watch them fail before the rules change lands.
* **1.1 Option B is the larger change.** Option A remains the rollback: delete the dead
  channel and amend ADR-0007. Either outcome is better than the status quo, in which the
  ADR states a guarantee the code cannot deliver. Trigger for falling back: if the
  `TrainingSettings` v3 migration or the settings UI turns out to be more than ~2 days,
  ship Option A and reopen Option B as part of Phase 5.4, where the tissue model needs
  the same schema anyway.

## Out of scope

Local tissue-state tracking (Phase 5), evidence-hierarchy stimulus inference (Phase 4),
dose-sensitive cost (Phase 4). 1.2 deliberately ships a coarse lookup table rather than
waiting for the full model.

## Docs to update

* **ADR-0007** — amend §6 to describe the implemented structured injury model, and to
  record that the region → restriction table is a conservative engineering default open
  to coaching revision
* **ADR-0002 or a new ADR** — `trainingSettings` schema v3
* `README.md` — the training-settings table gains an Injuries row
* `docs/analysis/2026-08-08-architecture-review.md` — mark F1/F2/F6 resolved with commit refs
