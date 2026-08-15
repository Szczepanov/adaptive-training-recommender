# External training plan — import schema and scheduling model

> **Status: proposed contract. Nothing in this document is implemented yet.**
> It is the design input for the `externally_planned` planning mode assessed in
> [`analysis/2026-08-15-externally-authored-plan-feasibility.md`](./analysis/2026-08-15-externally-authored-plan-feasibility.md).
> Field names, storage paths, and validation rules are proposals for review, not a
> description of current behaviour. Do not implement against this document until it is
> accepted and a plan exists in [`plans/`](./plans/).

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
    "reducedSummary": "2×12 instead of 3×12, same targets.",
    "reducedDurationMin": 45,
    "minimumUsefulDurationMin": 40,
    "fallback": "If the trainer is unavailable, 60min steady Z2 outdoors instead."
  }
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
| `preferred` | Prefers `preferredDay`, may move within its week. |
| `any_day` | No day preference; place it anywhere in the week. |

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
`DoseVariation`, and it is what turns a `scale` verdict from a multiplier into a real
prescription.

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
say so. Asked for minutes, the authoring AI improvised fractions — `0.5` for a 30-second
VO2 rep, `0.25` for a 15-second sprint touch, `0.17` for a 10-second acceleration. Those
are lossy in a way that matters: `0.17` minutes is 10.2 seconds and `0.33` is 19.8, so the
intended 10s and 20s efforts cannot be recovered from the number. Cycling intervals are
second-granular; a minutes-only step model cannot express the sport.

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

## Storage (proposed)

| Path | Contents |
|---|---|
| `users/{userId}/external_plans/{planId}` | Header, `revision`, `contentHash`, `importedAt`, `supersededFrom`. |
| `users/{userId}/external_plans/{planId}/revisions/{revision}` | The immutable imported document, verbatim. |
| `users/{userId}/external_plans/{planId}/placement/current` | `{ assignments: [{ sessionId, date, status }], updatedAt }` — the mutable overlay. Bounded by `weekCount ≤ 26` and `sessions ≤ 120`, so it stays one small read serving today, tomorrow, and the week-ahead strip. |

`status` is one of `planned` `completed` `moved` `dropped` `superseded`. All paths are
owner-scoped per ADR-0002, validated in `validation.ts` and enforced independently in
`firestore.rules`, following the `validateAuthoredPlanBlock` / `hasValidPlanBlock` pattern.

### Revisions and supersession

Re-importing the same `planId` with a higher `revision` supersedes it **from a chosen date
forward** — by default today. Days already adjudicated keep their persisted
`daily_recommendations` documents and audits unchanged; history is never rewritten. The
import screen should show a diff (sessions added, removed, moved) before the athlete
confirms, because an AI asked to "adjust week 5" will routinely rewrite weeks 1–8.

### Who reschedules

The app **proposes**, the athlete **confirms**. When a session is missed, the placement
overlay is updated according to that session's declared `ifMissed` and `flexibility`, and
the proposal is surfaced — never applied silently. This matches the posture everywhere
else in the engine: a fallback is always labelled as one.

---

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
> - `scaling`: `reducedSummary` (how to cut this session down while keeping its purpose),
>   `reducedDurationMin`, `minimumUsefulDurationMin` (below this, skipping is better than
>   a fragment), `fallback` (advisory author suggestion shown if the equipment or venue is
>   unavailable; it is not an executable substitute).
>
> Do not include travel weeks, illness, or time off — those are handled separately by the
> app's own calendar. Plan as if every scheduled day is available.
>
> Do not encode readiness or autoregulation rules anywhere, including `notes`. The app
> adjudicates each session against that morning's data and owns all green/yellow/red
> decisions. Use `notes` only for context the app cannot know: which power meter is the
> reference, whether wattage targets or RPE take precedence, what block preceded this one.

That last paragraph matters: without it an AI will helpfully invent a deload for a trip it
was told about, and that dose reduction would then be applied twice — once by the plan and
again by the travel block.

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

### Still open

**Is a target event a session?** The generated plan included the race itself as a session —
`intensity: max`, `flexibility: fixed`, on the event date. The app already models events as
`UserEvent`, which is what drives periodization and taper, so an imported race would be a
second representation of the same thing. Two questions follow, and ADR-0019 does not answer
either:

* Should an imported session on an event date be adjudicated at all? Telling an athlete to
  skip a race they have entered is not the same speech act as telling them to skip an
  interval session.
* Does the schema need an explicit marker (`isEvent`, or a `race` intensity/role) so the
  app links the session to its `UserEvent` instead of treating it as prescribed training?

**`reducedSummary` versus `fallback` is blurrier in practice than in the contract.** For its
dress-rehearsal session the plan wrote, in `reducedSummary`, "do not perform a compromised
full simulation — ride easily instead and retry later in the week." That is a substitution
and a deferral, not a reduced dose. The distinction the schema draws between scaling down
and doing something else does not survive contact with sessions whose value is all-or-nothing.