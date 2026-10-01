# External training plan — import schema and scheduling model

> **Status: implemented contract.** Accepted in
> [ADR-0019](./adr/0019-externally-authored-plans-and-session-adjudication.md) and built in
> [Phase 8](./plans/phase-8-externally-planned-mode.md). Field names, storage paths, and
> validation rules below describe **v1** (`external-plan@1`) current behaviour;
> `app/src/engine/validation.ts` `validateExternalTrainingPlan` is the enforcing authority,
> and where the two disagree the code wins. The round-trip against a real generated plan
> required no schema change. **v2** (`external-plan@2`, M3.6) is documented separately
> below — v1 remains fully importable and this document's v1 sections are otherwise
> unchanged. New copy/paste external-coach imports emit **v6** (`external-plan@6`), which
> inherits v5 and adds an optional exact `scaling.reducedDefinition`. Historical v1–v5 plans
> remain readable; v6 reduced definitions are the only structured scaled form accepted by the
> launch adapter. Home currently withholds scaled Start even for this valid form
> ([#949](https://github.com/Szczepanov/adaptive-training-recommender/issues/949)).

The athlete authors a training plan with a general-purpose AI, which emits JSON against
the schema below. This application imports it, validates it at the persistence boundary,
and adjudicates each session against that morning's Garmin data and subjective check-in.

---

## Two design rules that shape everything else

**1. The plan says *what*, the app owns *when*.**

Sessions carry a week index and a day *preference*, never a computed calendar date. The
plan header carries exactly one absolute date (`startDate`) and everything else is
relative to it.

This is not just a rescheduling convenience. It removes calendar arithmetic from the
authoring AI, which is the single most common way an LLM-generated plan is subtly wrong —
an off-by-one weekday in week 6 is invisible on review and corrupts every date after it.
The AI is good at "week 3, Tuesday, threshold"; it is unreliable at "2026-09-01". Ask it
for the thing it is good at.

**2. The imported artifact is immutable; placement is a separate mutable overlay.**

Once imported, a plan revision is never edited in place — it is content-hashed so a
persisted decision can be replayed against the exact bytes it was made from (ADR-0010).
Missing a session, shifting a week, or accepting an AI revision all write to the
*placement overlay*, or create a new plan revision. Neither mutates history.

---

## The three rescheduling cases are three different mechanisms

Conflating these would be the central design error, because two of the three are already
built and need nothing from this schema.

| Case | Mechanism | Status |
|---|---|---|
| **"There will be travel"** | `AuthoredPlanBlock` at `users/{userId}/plan_blocks/{blockId}` — a dated overlay with independent `volumeScale`/`intensityScale`, applied by `applyPlanningOverlays` regardless of where the plan came from. Day-wide venue/equipment restriction (hotel gym) is `FixedActivity.availabilityContextOverride`. | **Already exists. Reuse verbatim.** Travel is *your calendar*, not the AI's plan — it must not appear in the import schema at all. |
| **"I might miss some days"** | The placement overlay, driven by each session's own declared `flexibility` and `ifMissed`. | New, small. |
| **"The AI will adjust it"** | A new plan **revision** that supersedes the previous one from a chosen date forward. Already-adjudicated days keep their persisted `daily_recommendations` records and audits untouched. | New, small. |

Keeping travel out of the import also means an AI revision cannot silently overwrite your
travel dates, and a travel change does not require re-importing the plan.

---

## Plan document

```jsonc
{
  "schema": "adaptive-training-recommender/external-plan@1",
  "planId": "cycling-build-autumn",   // stable across revisions; identifies the plan
  "revision": 1,                       // increments on each AI adjustment
  "title": "8-week cycling build",
  "startDate": "2026-08-17",           // Monday of week 1, Europe/Warsaw (ADR-0003)
  "weekCount": 8,
  "notes": "Base-to-build. Threshold focus, strength twice weekly.",
  "sessions": [ /* … */ ]
}
```

| Field | Required | Rules |
|---|---|---|
| `schema` | yes | Exact literal. The version tag is how a future schema change stays detectable. |
| `planId` | yes | Slug, 1–64 chars, `[a-z0-9-]`. Stable across revisions — this is what makes supersession work. |
| `revision` | yes | Integer ≥ 1. Must exceed the stored revision for the same `planId`. |
| `startDate` | yes | `YYYY-MM-DD`, must be a Monday, Warsaw-local. Monday gives the imported artifact deterministic conventional training weeks; it is not the engine's rolling microcycle boundary. Placement/critique code translates between them. |
| `weekCount` | yes | 1–26. Rejects the runaway-generation case and bounds the placement document. |
| `sessions` | yes | 1–120 entries. |

Rest days are **not** sessions. A week with four sessions leaves three days open, and the
engine treats an unplanned day as available — it does not need to be told to rest.

---

## Session object

```jsonc
{
  "id": "w1-threshold",              // unique within the plan
  "title": "Threshold 3×12",
  "priority": "key",                 // key | supporting | optional

  "placement": {
    "week": 1,                       // 1..weekCount
    "preferredDay": "tuesday",       // optional
    "flexibility": "preferred",      // fixed | preferred | any_day
    "ifMissed": "reschedule_within_week"
  },

  "gating": {
    "modality": "cycling",
    "intensity": "hard",             // recovery | easy | moderate | hard | max
    "durationMin": 60,
    "durationMax": 75,
    "environment": "indoor",         // indoor | outdoor | either
    "equipment": ["indoor_bike"]
  },

  "objectives": ["threshold_quality"],

  "prescription": {
    "summary": "3×12min at 100–105% FTP, 6min easy between.",
    "steps": [
      { "name": "Warm-up",  "durationMin": 15, "target": "Z1–Z2, build cadence to 95" },
      { "name": "Interval", "durationMin": 12, "target": "100–105% FTP, cadence 85–90",
        "repeat": 3, "recoveryMin": 6,
        "notes": "Hold the last rep only if the first two felt controlled." },
      { "name": "Cool-down", "durationMin": 10, "target": "Z1" }
    ]
  },

  "scaling": {
    "reducible": true,               // false = no useful reduced form; short-of-full defers
    "reducedSummary": "2×12 instead of 3×12, same targets.",
    "reducedDurationMin": 45,
    "minimumUsefulDurationMin": 40,
    "fallback": "If the trainer is unavailable, 60min steady Z2 outdoors instead."
  },

  // Only on the target event itself. Requires flexibility "fixed" and a preferredDay.
  // The app links it to your UserEvent and advises rather than instructs.
  "isEvent": false
}
```

### `gating` — the only block the safety engine reads

These fields exist so an imported session can pass through `evaluateTemplateEligibility`,
the safety envelope, and the mode ceiling exactly as a catalog template does. Closed
enums, deliberately small, chosen for LLM reliability.

| Field | Values |
|---|---|
| `modality` | `cycling` `running` `strength` `field` `mobility` `cross_training` |
| `intensity` | `recovery` `easy` `moderate` `hard` `max` |
| `durationMin` / `durationMax` | Integer minutes, 5–360, `min ≤ max`. Feeds the time-budget gate. |
| `environment` | `indoor` `outdoor` `either` |
| `equipment` | Subset of `free_weights` `cable_machine` `treadmill` `indoor_bike` `pullup_bar`. Empty = none needed. |

**`systemicCost` is deliberately not an input.** Asking an AI for a calibrated 0–1 cost
invites confident nonsense that would silently move the `modify`-mode ceiling. It is
derived from `modality` × `intensity` × duration, using the same conservative
`DEFAULT_COST_BY_MODALITY` precedent that already handles unmatched Garmin activities.

### `priority` and `placement` — how the week compresses

`priority` maps to the existing `ObjectivePriority` ladder (`key` → `must_have`,
`supporting` → `should_have`, `optional` → `nice_to_have`). It tells the app what to
protect when a week loses days.

| `flexibility` | Meaning |
|---|---|
| `fixed` | Must fall on `preferredDay` (a group ride, a test, a class). |
| `preferred` | Prefers `preferredDay`, may move within its week (e.g. if rescheduled or missed). Multiple sessions authored with the same `preferredDay` remain co-located on that date (double training days). |
| `any_day` | No day preference; place it anywhere in the week (spreads to unoccupied days). |

Multiple sessions authored for the same `preferredDay` (e.g. an easy aerobic ride and an upper-body strength session) are placed together on that day as intentional double training days.

| `ifMissed` | Behaviour when the day passes without the session |
|---|---|
| `drop` | Let it go. Correct for a recovery spin — moving it costs more than skipping it. |
| `reschedule_within_week` | Try a later open day in the same week, then drop. |
| `carry_forward` | Push to the next available day even into the following week. Reserve for genuinely key work. |

Per-session `ifMissed` is the point. Whether a missed threshold session should be chased
or written off is exactly the judgement the authoring AI is good at and the app should
not guess. It is also the field most worth reviewing by hand after import.

### `scaling` — the plan author's own regression

When readiness says *train, but less*, `resolveExecutionDose` currently scales duration.
That is blunt. `scaling` lets the plan's author say how their own session should be cut —
`2×12 instead of 3×12` preserves the training purpose in a way that "do 70% of the time"
does not.

This is the external equivalent of the catalog's authored `easierDose`/`harderDose`
`DoseVariation`, and it is what turns a `scale` verdict from a multiplier into an
athlete-facing reduced prescription.

For `external-plan@2`–`@5`, however, `reducedSummary` and `reducedDurationMin` do **not**
constitute a second executable `SessionDefinition`. The runner must not parse free text into
steps, and it must not bind the original full-dose definition under a reduced verdict. Today,
Home therefore shows the adjudicated reduced summary/dose but withholds structured **Start**
for `scale`. V6 may include a full `scaling.reducedDefinition` `SessionDefinition`; when present,
it must retain the authored session id, intent, and dominant modality and is validated through
the same session-definition boundary as the full definition. The authoring adapter can freeze
only that exact reduced definition for a `scale` verdict. Home currently withholds Start for all
scaled external sessions, including valid v6 reduced forms; this integrated launch gap is
tracked by [#949](https://github.com/Szczepanov/adaptive-training-recommender/issues/949).
If the reduced definition is absent, scale has no executable structured form at all.
For `proceed`, the app uses the original definition. Free-text `fallback` remains advisory.

## Revision activation history

Each new immutable revision has an immutable activation record at
`users/{uid}/external_plans/{planId}/activations/{revision}`. It records `effectiveFrom` in
Europe/Warsaw local-date form and the revision content hash. A future-effective revision leaves
its predecessor active before that date. New placement writes are scoped to
`revisions/{revision}/placement/current`; the legacy `placement/current` document is read only
when its embedded revision matches. The mutable plan header is a latest-revision index, not the
historical date-to-revision authority.

A revision is a full replacement for the horizon it declares. Omitted sessions are removed;
they are not implicitly carried forward from an earlier revision. The import preview therefore
shows the effective date and the added, changed, removed, and retained session counts before
confirmation.

`minimumUsefulDurationMin` is the floor below which the session stops being worth doing —
under it, the verdict becomes `defer` or `skip` rather than a pointless fragment.
`fallback` is free text shown when a hard gate (equipment, environment) excludes the
session outright. It is **advisory author intent only**: it is never parsed into an
executable substitute and never bypasses eligibility/safety. If the app offers an
actionable alternative, that alternative is a separate structured candidate that must
pass the normal gates independently.

### `objectives` — optional, but it unlocks the weekly critique

Zero or more of: `threshold_quality` `surge_repeatability` `zone2_aerobic`
`strength_maintenance` `strength_development` `race_specific_endurance` `vo2_max`.

Optional on purpose — requiring it would hurt import reliability, and a coarse mapping can
be derived from `modality` + `intensity`. But supplying it is what lets the existing
microcycle ledger and coverage state review the imported week: *"no strength credit this
week"*, *"three key sessions in four days"*. That advisory layer is the main reason to
keep the engine's planning machinery alive at all, so it is worth asking for.

### `prescription` — displayed, never parsed for meaning

The app renders this and stores it; no gate reads it. `summary` is required, `steps` are
optional. `target` and `notes` are free text — this is where the specificity that
`SessionTemplate` cannot express actually lives.

#### Step duration is second-granular below two minutes

A step carries **either** `durationMin` (integer minutes) **or** `durationSec` (integer
seconds), never both; likewise `recoveryMin` / `recoverySec`. Use the seconds form for
anything under two minutes.

This exists because the first real generated plan needed it eight times and had no way to
say so. Asked for minutes, authoring AIs frequently improvise fractions — `0.5` for a 30-second
VO2 rep, `0.25` for a 15-second sprint touch, `0.33` for a 20-second interval, `0.17` for a 10-second acceleration.
To ensure robustness against AI idiosyncrasies, the import validator auto-normalizes fractional
minutes (\(\text{min} \times 60\)) to integer seconds (`durationSec`, `recoverySec`, `setRecoverySec`)
on import rather than rejecting the plan. Cycling intervals remain second-granular in the saved revision.

```jsonc
{ "name": "VO2 rep", "durationSec": 30, "recoverySec": 15,
  "repeat": 10, "sets": 3, "setRecoveryMin": 4,
  "target": "320–350 W, RPE 8" }
```

#### Repetition has two levels, because sessions do

`repeat` and `recoveryMin`/`recoverySec` describe reps within a set. `sets` and
`setRecoveryMin`/`setRecoverySec` describe sets within the step. Both optional; a step
with only `repeat` is a single set.

Without this, "3 sets of 10 × 30s/15s with 4 min between sets" has to be flattened to
`repeat: 30` with the set structure buried in `notes` — which is what the first real plan
did. A reader (or a UI) then renders "30 × 30s" straight through, which is a materially
harder session than the one the author wrote.

#### The app owns daily adjustment, so the plan should not

Do not encode readiness rules — green/yellow/red policy, "skip quality work if HRV is
down", "extend if fresh" — in `notes` or anywhere else. Adjudicating today's session
against today's readiness is the application's job (ADR-0019 D-CANDIDATE), and a second
policy in the plan can only agree with it by luck.

The first real generated plan put a full autoregulation protocol in the top-level `notes`,
unprompted. It is harmless free text, but two policies that can disagree is exactly the
failure the import path exists to avoid.

`notes` remains the right place for athlete and equipment context that the app genuinely
does not know — which power meter is the reference, that wattage targets are anchors and
RPE overrides them, which prior block this plan follows on from.

---

## Storage

| Path | Contents |
|---|---|
| `users/{userId}/external_plans/{planId}` | Header, `revision`, `contentHash`, `importedAt`, `supersededFrom`. |
| `users/{userId}/external_plans/{planId}/revisions/{revision}` | The immutable validated and normalized imported document. |
| `users/{userId}/external_plans/{planId}/activations/{revision}` | Immutable revision/content-hash binding and `effectiveFrom` date; the date-to-revision authority. |
| `users/{userId}/external_plans/{planId}/revisions/{revision}/placement/current` | The live mutable placement overlay for this revision: `{ assignments: [{ sessionId, date, status }], updatedAt }` plus ownership and revision fields. Bounded by `weekCount ≤ 26` and `sessions ≤ 120`. |
| `users/{userId}/external_plans/{planId}/placement/current` | Legacy read-only fallback, accepted only when its embedded revision matches the requested revision. |

`status` is one of `planned` `completed` `moved` `dropped` `superseded`. All paths are
owner-scoped per ADR-0002, validated in `validation.ts` and enforced independently in
`firestore.rules`, following the `validateAuthoredPlanBlock` / `hasValidPlanBlock` pattern.

### Revisions and supersession

Re-importing the same `planId` with a higher `revision` supersedes it **from a chosen date
forward** — by default today. Days already adjudicated keep their persisted
`daily_recommendations` documents and audits unchanged; history is never rewritten. The
import screen shows a diff (sessions added, changed, removed, retained and placement changes)
before the athlete confirms, because an AI asked to "adjust week 5" can rewrite weeks 1–8.

### Who reschedules

The app **proposes**, the athlete **confirms**. When a session is missed, the placement
overlay is updated according to that session's declared `ifMissed` and `flexibility`, and
the proposal is surfaced — never applied silently. This matches the posture everywhere
else in the engine: a fallback is always labelled as one.

---

## Structured round trip (#893)

The planning Context Brief supplies context and exact persisted identities to the external coach.
The coach returns a complete `external-plan@6` JSON revision. The athlete reviews the diff,
replacement scope, calendar/authority conflicts and **Effective from** date before importing.
The date cannot precede today in Europe/Warsaw; replaying an existing revision with a different
effective date fails closed. An identical service retry makes no new writes, while the import
UI blocks a revision that does not advance the stored revision.

A revision replaces its declared horizon in full: omitted sessions are removed. A tactical
change to today therefore also carries unchanged future intent when it uses the same `planId`.
There is no implicit partial-patch contract. Immutable revision bytes and activation metadata
resolve authority for each date; the latest header is an index. A future-effective successor
leaves its predecessor in authority before the boundary. Revision-scoped placement retains
intentional moves and drops after later imports.

The app adjudicates the selected session against its normal safety, readiness and feasibility
gates. `proceed` uses the full authored definition. The launch adapter accepts `scale` only with
an explicitly authored, validated `scaling.reducedDefinition` retaining the session identity,
intent and dominant modality, within the adjudicated duration ceiling. Home currently blocks
this valid scaled launch ([#949](https://github.com/Szczepanov/adaptive-training-recommender/issues/949)).
Free-text reductions and fallback suggestions cannot become executable doses. The adapters
exclude `skip`, `defer` and advisory event inputs from structured execution. Recommendation writes
on skip and gate-replacement days previously failed due to rules expression-budget and catalog-binding
defects ([#950](https://github.com/Szczepanov/adaptive-training-recommender/issues/950)),
which have been resolved in [#953](https://github.com/Szczepanov/adaptive-training-recommender/issues/953).

Home currently prepares the frozen `ExecutionPrescription` and a scheduled external
`SessionOccurrence` before Start. At Start, the runner binds its `SessionExecution` to the
exact plan/revision/session/content hash. The desired Start-only occurrence boundary remains
open in [#951](https://github.com/Szczepanov/adaptive-training-recommender/issues/951).
`prescriptionHash` identifies the frozen prescription; its `definitionHash` identifies the
normalized full or reduced definition. These are different hashes. A later plan revision does
not replace the prescription used by an existing execution, including an abandoned execution.

Completion reconciles the execution into one canonical `PerformedTrainingOccurrence`. Matching
Garmin/provider evidence enriches that same occurrence on reconciliation; it does not create
another physical workout or overwrite structured execution authority. The V10 browser proof
opens Data → Activities and invokes the real `loadCanonicalActivitiesWindow` service because
the canonical Activities read-model flag is off in the default E2E configuration. It uses real
reconciliation rather than fabricated linkage. Canonical identities distinguish genuine separate
workouts, but completing both imported intraday bundle members through Home remains blocked by
the absent secondary Start card
([#952](https://github.com/Szczepanov/adaptive-training-recommender/issues/952)).

The next planning brief consumes the canonical planned-versus-performed projection. Its bounded
rows retain placement, adjudication, athlete action and performance as separate dimensions,
with occurrence, execution, prescription and performed ids when available. Authored rest can
report unexpected observed work; a day with an active plan but no authored session/rest renders
no round-trip row. Missing activity alone is not a miss. Unreadable evidence is unknown, and an
unreadable replacement archive is reported on the affected row. Service/projector tests pin gate
and manual replacement labels, but integrated skip persistence and manual replacement attribution
remain open: [#950](https://github.com/Szczepanov/adaptive-training-recommender/issues/950) and
[#951](https://github.com/Szczepanov/adaptive-training-recommender/issues/951). A genuine UI manual
replacement currently leaves the authored row at athlete none rather than attributing the
completed replacement.

Executable browser proofs live in
[`external-coach-round-trip.pw.ts`](../app/tests/e2e/external-coach-round-trip.pw.ts),
[`external-plan-revisions.pw.ts`](../app/tests/e2e/external-plan-revisions.pw.ts),
[`external-plan-execution-states.pw.ts`](../app/tests/e2e/external-plan-execution-states.pw.ts)
and the desktop/mobile [`external-verdict.pw.ts`](../app/tests/e2e/external-verdict.pw.ts).
The [#893 proof ledger](./plans/2026-09-29-issue-893-external-coach-round-trip.md#5-revised-acceptance-criteria-and-proof-ledger)
records exact test names, verification status and remaining gaps. V4, V7, V8 and full V9 bundle
completion are issue-linked `test.fixme` regressions; they are not passing proofs. #893 remains
In progress, independently of the active tests' verification results.

## Prompt block

Paste this above the plan request when asking an AI to author or revise a plan.

> Output the plan as a single JSON document and nothing else. Follow this contract exactly.
>
> Top level: `schema` (literal `"adaptive-training-recommender/external-plan@1"`),
> `planId` (lowercase slug, unchanged between revisions of the same plan), `revision`
> (integer, increment when revising), `title`, `startDate` (the Monday week 1 begins,
> `YYYY-MM-DD`), `weekCount`, optional `notes`, and `sessions`.
>
> Do not compute calendar dates for sessions and do not include rest days. Each session
> has `id`, `title`, `priority` (`key`/`supporting`/`optional`), and:
>
> - `placement`: `week` (1-based), optional `preferredDay` (lowercase weekday),
>   `flexibility` (`fixed`/`preferred`/`any_day`), `ifMissed`
>   (`drop`/`reschedule_within_week`/`carry_forward`).
> - `gating`: `modality` (`cycling`/`running`/`strength`/`field`/`mobility`/`cross_training`),
>   `intensity` (`recovery`/`easy`/`moderate`/`hard`/`max`), `durationMin`, `durationMax`
>   (minutes), `environment` (`indoor`/`outdoor`/`either`), `equipment` (subset of
>   `free_weights`, `cable_machine`, `treadmill`, `indoor_bike`, `pullup_bar`).
> - `objectives`: zero or more of `threshold_quality`, `surge_repeatability`,
>   `zone2_aerobic`, `strength_maintenance`, `strength_development`,
>   `race_specific_endurance`, `vo2_max`.
> - `prescription`: `summary`, plus optional `steps`. A step has `name`, `target`, and
>   **either** `durationMin` (integer minutes) **or** `durationSec` (integer seconds) —
>   use seconds for anything under two minutes. Optional: `repeat` and
>   `recoveryMin`/`recoverySec` for reps within a set, `sets` and
>   `setRecoveryMin`/`setRecoverySec` for sets within the step, and `notes`.
> - `isEvent`: `true` only on the target event itself (a race, a test event). An event
>   session must also use `flexibility: "fixed"` with a `preferredDay`. Do not mark
>   ordinary hard sessions as events.
> - `scaling`: `reducible` (boolean; set to `false` when the session has no useful reduced form —
>   e.g. a race simulation or test. When `reducible` is `false`, omit `reducedSummary` and
>   `reducedDurationMin` entirely), `reducedSummary` (how to cut this session down while
>   keeping its purpose; only include when `reducible` is `true`), `reducedDurationMin`
>   (minutes; only include when `reducible` is `true`), `minimumUsefulDurationMin` (below
>   this, skipping is better than a fragment), `fallback` (advisory author suggestion shown
>   if the equipment or venue is unavailable; it is not an executable substitute).
>
> Do not include travel weeks, illness, or time off — those are handled separately by the
> app's own calendar. Plan as if every scheduled day is available.
>
> Do not encode readiness or autoregulation rules anywhere, including `notes`. The app
> adjudicates each session against that morning's data and owns all green/yellow/red
> decisions. Use `notes` only for context the app cannot know: which power meter is the
> reference, whether wattage targets or RPE take precedence, what block preceded this one.
>
> Output as a downloadable JSON file.

That last paragraph matters: without it an AI will helpfully invent a deload for a trip it
was told about, and that dose reduction would then be applied twice — once by the plan and
again by the travel block.

---

## Schema v2 (M3.6)

> **Status: implemented contract.** `app/src/sessions/externalPlanV2.ts`
> `validateExternalTrainingPlanV2` is the enforcing authority. v1 above is unaffected and
> stays fully importable — a v2 plan is a different `schema` literal, not a replacement.

Everything above this section — the plan envelope, `placement`, `gating`, `priority`,
`objectives`, `scaling`, `isEvent`, the two design rules, the three rescheduling
mechanisms, storage layout, and supersession — is **identical** between v1 and v2. The
only thing v2 changes is the session's executable content: `prescription` (free text plus
an optionally-structured flat step list) is replaced by `definition`, a normalized
`SessionDefinition` — the same canonical vocabulary the M0.2 fixture corpus already uses
for catalog and manually-authored sessions (`app/src/sessions/models.ts`).

**Why.** v1's `prescription` adapts into `SessionDefinition` through
`app/src/sessions/externalSessionAdapter.ts`, and that adaptation is lossy by necessity: it
collapses every session into one flat block, and has no source concept of laterality
(per-side/alternating work), option sets (athlete-observed branching), companion sessions,
per-set recovery, or resolved exercise identity — an imported plan could never carry any of
that. A v2 session embeds a `SessionDefinition` directly, so none of it is lost, and no
adapter is needed to execute one.

```jsonc
{
  "id": "w1-threshold",
  "title": "Threshold 3×12",
  "priority": "key",
  "placement": { "week": 1, "preferredDay": "tuesday", "flexibility": "preferred", "ifMissed": "reschedule_within_week" },
  "gating": { "modality": "cycling", "intensity": "hard", "durationMin": 60, "durationMax": 75, "environment": "indoor", "equipment": ["indoor_bike"] },
  "objectives": ["threshold_quality"],

  "definition": {
    "schemaVersion": 1,
    "id": "w1-threshold",
    "revision": 1,
    "title": "Threshold 3×12",
    "summary": "3×12min at 100–105% FTP, 6min easy between.",
    "intent": "training",
    "dominantModality": "cycling",
    "duration": { "min": 60, "max": 75 },
    "blocks": [
      {
        "id": "block-main",
        "role": "main",
        "executionMode": "sequential",
        "steps": [
          {
            "id": "step-interval",
            "kind": "exercise",
            "title": "Interval",
            "exerciseRef": { "kind": "unresolved_free_text", "name": "Interval" },
            "dose": { "kind": "duration", "sets": 3, "seconds": 720 },
            "rest": 360,
            "notes": "Hold the last rep only if the first two felt controlled."
          }
        ]
      }
    ]
  },

  "scaling": {
    "reducible": true,
    "reducedSummary": "2×12 instead of 3×12, same targets.",
    "reducedDurationMin": 45,
    "minimumUsefulDurationMin": 40
  },
  "isEvent": false
}
```

### `definition` — the same contract catalog and manual sessions already use

`definition` is a `SessionDefinition` (`app/src/sessions/models.ts`): `schemaVersion` (1),
`id`, `revision`, `title`, optional `summary`, `intent`
(`training`/`testing`/`competition`/`rehab_return`/`recovery`/`skill_technical`), optional
`dominantModality`, optional `duration` (`{min, max}` minutes), and `blocks`. Each block has
`id`, optional `title`, `role`
(`warmup`/`main`/`cooldown`/`accessory`/`test`/`recovery`), `executionMode`
(`sequential`/`circuit`/`superset`/`density`/`amrap`/`alternating`), and `steps`. A step has
`id`, `kind` (`"exercise"` | `"transition"` | `"rest"`), optional `title`, optional `rest`
(seconds, or `{min, max}` for a range), optional `notes`, and optional `dose`. When `kind` is
`"exercise"`, `exerciseRef` is required — typically `{"kind": "unresolved_free_text", "name": "..."}`
for imported sessions where no catalog identity is known, or `{"kind": "catalog", "exerciseId": "..."}`
when referencing an existing catalog exercise. `dose` is one of:

| `dose.kind` | Fields |
|---|---|
| `repetition` | `sets` (integer), `reps` (integer or `{min, max}`) |
| `duration` | `sets` (optional integer), `seconds` (integer or `{min, max}`) — always seconds, the same second-granularity rule v1's steps follow |
| `distance` | `sets` (optional integer), `meters` (integer or `{min, max}`) |

Unlike v1's flat model, `sets`/`reps` are not artificially split across two step-level
fields (`repeat`/`sets`) — they live together on `dose`. As with v1's `gating`,
**`systemicCost` is deliberately not an input** on `definition` — an authoring AI supplying
one would silently move the `modify`-mode ceiling (ADR-0019 D-EXTTIER) — and
`validateExternalTrainingPlanV2` fails closed on it, along with any other field
`SessionDefinition` doesn't declare (an unrecognized top-level key, e.g. a hallucinated
`stimulusProfile`, is rejected the same way v1's `unknownKeys()` sweep already rejects one
on `gating`/`prescription`).

`SessionDefinition` also supports `laterality`/`optionSets`/`companionSessions` at the step
and block level — a v2 import may use them, though the current prompt block below only
asks for the core vocabulary (blocks, steps, the three `dose` kinds). See the M0.2 fixture
corpus (`app/src/sessions/fixtures/`) for worked examples of the richer vocabulary.

### What does not change

- **Hard gates and adjudication.** `gating` is untouched — a v2 session passes through
  `evaluateTemplateEligibility`, the safety envelope, and the mode ceiling exactly as a v1
  session does.
- **Display, for consumers that expect the flat v1 shape.**
  `Recommendation.externalPrescription` (what `Home.tsx`/`DetailedTodayPlan`/
  `ExternalPlanWeek.tsx` render) keeps its v1 shape regardless of source schema — a v2
  session's `definition.blocks` is flattened into it for display only
  (`app/src/engine/externalSessionProfiles.ts`
  `sessionDefinitionToDisplayPrescription`). The *execution* path
  (`sessionDefinitionResolver.ts`) uses the full-fidelity `definition` directly, never this
  flattened form.
- **Storage, revisions, supersession, the placement overlay** — identical to v1, described
  above.

### Importing v2

The in-app prompt block (`app/src/components/ExternalPlanImport.tsx`,
`AI_PROMPT_TEMPLATE`) is the enforcing copy and asks for `external-plan@6` by default;
this document does not duplicate it verbatim to avoid the two drifting. Paste-in validation
dispatches on the pasted document's own `schema` literal, so existing v1 JSON — including
anything saved from the v1 prompt block above — keeps importing unchanged.

---

## Resolved questions

Settled in [ADR-0019](./adr/0019-externally-authored-plans-and-session-adjudication.md)
§ *Resolved schema questions*, and repeated here so this document does not have to be read
alongside it. Each is cheap to revisit.

| Question | Resolution |
|---|---|
| Week boundaries | **Monday-based** for the imported artifact. The engine's current microcycle is a rolling evaluation-date lookback, so placement and critique must translate between these windows rather than assuming they coincide. |
| `weekCount ≤ 26` / `sessions ≤ 120` | Retained. Keeps the placement overlay a single small read. |
| Default supersession date | **The evaluation date (today).** Deferring to next week would make mid-block corrections useless. |
| `objectives` optional vs. required | **Optional**, with coarse derivation when absent and a post-import prompt inviting confirmation. Requiring it hurts import reliability; omitting it silently would degrade the weekly critique to a guess — so the app asks rather than demands. |
| Performance targets | **Free text** in this phase. Structured zones resolved against `AthletePerformanceProfile` are more useful downstream and materially less reliable to import; revisit once the loop works. |

### Round-trip result (2026-08-15)

The schema has now met a real generated plan: a 21-session, 4-week road-race peak block,
authored from the prompt block below with no hand-editing.

**Zero hard schema errors.** Every enum was correct. Rest days were omitted as instructed.
`flexibility: fixed` was always paired with a `preferredDay`. No `reducedDurationMin`
exceeded its session's `durationMax`. Every session carried a `scaling` block — the least
conventional part of the contract, and the one most expected to be dropped.

**D-RELDATE is validated.** The plan's relative placement resolved to the athlete's real
race date exactly: `startDate` 2026-08-17 (a Monday, as required) plus week 4 Sunday lands
on 2026-09-13. The AI had to get one date right and did; asked to compute twenty-one, it
would very likely not have.

**Three revisions came out of it**, all now folded into the sections above: second-granular
step durations, two-level repetition, and an explicit instruction not to encode
autoregulation policy. Each was invisible to review and obvious within one real plan.

### Resolved from the round-trip

**A target event is a commitment, not a prescribed session** (ADR-0019 **D-EVENT**). A
session may declare `isEvent: true`; it must then also carry `flexibility: "fixed"` and a
`preferredDay`. The app reconciles it onto the existing `FixedActivity` contract — it
occupies the day, contributes cost to the fatigue projection, credits stimulus, and is
never itself recommended. It is adjudicated **for advice only**: clinical flags are
surfaced prominently, but it can never return `skip` or `defer`, because telling an athlete
to skip a race they have entered is not the same speech act as telling them to skip
Tuesday's intervals. If no `UserEvent` exists on the resolved date, the import offers to
link or create one and never fabricates it silently.

**Some sessions do not scale** (ADR-0019 **D-IRREDUCIBLE**). `scaling.reducible` (boolean,
default `true`) declares it. When `false`, `reducedSummary` and `reducedDurationMin` are
ignored entirely and a short-of-full readiness produces `defer` rather than a prescribed
compromise, with `ifMissed` governing re-placement. This keeps three ideas apart that the
original contract conflated into two:

| Situation | Field | Verdict |
|---|---|---|
| Short of full, session scales | `reducedSummary`, `reducedDurationMin` | `scale` |
| Short of full, session does not scale | `reducible: false` | `defer` |
| Equipment or venue unavailable | `fallback` (advisory text only) | `skip` + suggestion |
