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
| `startDate` | yes | `YYYY-MM-DD`, must be a Monday, Warsaw-local. Weeks are Monday-based to match the microcycle window. |
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
session outright.

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
> - `prescription`: `summary`, plus optional `steps` with `name`, `durationMin`, `target`,
>   and optional `repeat`, `recoveryMin`, `notes`.
> - `scaling`: `reducedSummary` (how to cut this session down while keeping its purpose),
>   `reducedDurationMin`, `minimumUsefulDurationMin` (below this, skipping is better than
>   a fragment), `fallback` (what to do instead if the equipment or venue is unavailable).
>
> Do not include travel weeks, illness, or time off — those are handled separately by the
> app's own calendar. Plan as if every scheduled day is available.

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
| Week boundaries | **Monday-based**, matching the rolling microcycle window. |
| `weekCount ≤ 26` / `sessions ≤ 120` | Retained. Keeps the placement overlay a single small read. |
| Default supersession date | **The evaluation date (today).** Deferring to next week would make mid-block corrections useless. |
| `objectives` optional vs. required | **Optional**, with coarse derivation when absent and a post-import prompt inviting confirmation. Requiring it hurts import reliability; omitting it silently would degrade the weekly critique to a guess — so the app asks rather than demands. |
| Performance targets | **Free text** in this phase. Structured zones resolved against `AthletePerformanceProfile` are more useful downstream and materially less reliable to import; revisit once the loop works. |

### Still open

**The schema has not yet met a real generated plan.** [Phase 8](./plans/phase-8-externally-planned-mode.md)
makes one round-trip a precondition of its first work item, because a schema reviewed only
by reading will be wrong in ways that review does not surface. Expect revision; the
`schema` version tag exists for exactly that.
