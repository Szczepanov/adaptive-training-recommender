# ADR-0035: Explicit Rest-Day Authoring in External Plans

* **Status:** Proposed
* **Date:** 2026-09-05
* **Deciders:** Repository owner
* **Source analysis:** H3 investigation, [cycling-primary hybrid evaluation plan](../plans/cycling-primary-hybrid-evaluation.md); [PR #401](https://github.com/Szczepanov/adaptive-training-recommender/pull/401)

## Context

Both implemented external-plan schema versions intentionally treat omission as an
unplanned date. `external-plan@1` and `external-plan@2` therefore cannot distinguish:

1. **no authored instruction for this date** — the current, valid evergreen-fallback case;
2. **authored protected rest** — a deliberate instruction not to schedule discretionary
   training on this date.

That distinction matters in taper, deload and recovery placement. Today, both states are
indistinguishable and an omitted date in `externally_planned` mode resolves to the normal
labelled evergreen fallback (`externalFallback: true` in `planningMode.ts`). Strong
readiness can therefore produce a training recommendation on a date the plan author
actually intended to keep free.

This is not a readiness defect. `evaluateReadinessAndSafetyEnvelope` correctly answers a
different question: whether the athlete should `train`, `modify` or `recover` from current
health/readiness inputs. Authored rest is **plan intent**, not evidence that the athlete is
physiologically in `recover` mode. The implementation must keep those authorities
separate.

The existing external-plan contract also has an important calendar invariant that any
solution must preserve: the plan header owns the single absolute `startDate`; authored
session placement is week/weekday-relative. This deliberately keeps calendar arithmetic
inside the application rather than asking an authoring AI to compute absolute dates.

### Why this needs a decision, not a resolver fix

H3 confirmed that the existing unplanned-date fallback, missed-session replacement,
external-event reconciliation and immutable plan revision/replay contracts are built and
tested. Adding protected rest introduces **new import-side planning authority**: an
external artifact would gain the ability to close a date to normal discretionary
planning. ADR-0019 established the precedent that new import authority is explicit and
versioned rather than silently added to an existing contract.

### Evidence scope

This ADR is a repository domain/contract decision. It does **not** depend on another
product's calendar semantics, and it makes no physiological claim about how often an
athlete should rest. The requirement follows from the repository's own distinction between
an authored instruction and absence of instruction, plus its immutable/versioned import
contract. External-product observations may remain useful product research, but they are
not evidence required to justify this architecture decision.

## Options considered

### Option A — Widen `AuthoredPlanBlock.phase` to include `'rest'`

Reuse the existing travel-block mechanism: `phase: 'travel' | 'rest'`, applied through
`applyPlanningOverlays` with `volumeScale: 0`.

**Rejected as insufficient on inspection.** `applyPlanningOverlays` scales the
`PlannedDose { volume, intensity }` target; it is not a candidate-category gate. A zero
volume target therefore does not guarantee that candidate ranking cannot still produce an
Easy Endurance, Mobility or other normal recommendation. This would create a schema value
that reads as protected rest without actually providing protected-rest semantics.

### Option B — A plan-level relative `restDays` directive in `external-plan@3`

Introduce the capability only in the next external-plan schema revision. `external-plan@3`
keeps the v2 `definition`-based session contract unchanged and adds a plan-level list of
fixed rest directives parallel to `sessions[]`:

```jsonc
{
  "schema": "adaptive-training-recommender/external-plan@3",
  "planId": "cycling-build-autumn",
  "revision": 2,
  "title": "4-week cycling build",
  "startDate": "2026-10-05",
  "weekCount": 4,
  "restDays": [
    { "id": "w1-friday-rest", "week": 1, "day": "friday" }
  ],
  "sessions": [ /* v2 definition-based sessions, unchanged */ ]
}
```

A rest directive is deliberately **relative**, not `restDates: ["YYYY-MM-DD"]`. This
preserves the existing "one absolute `startDate`; the app owns calendar arithmetic"
contract and avoids reintroducing the off-by-one/date-calculation risk that relative
session placement was designed to remove. The stable directive `id` also gives audit and
replay a durable source identity without pretending rest is a session occurrence.

#### v3 validation and compatibility

If Option B is accepted:

- `external-plan@1` and `external-plan@2` remain immutable. Their validators and accepted
  fields do **not** gain `restDays` and continue rejecting unknown fields exactly as today.
- Version dispatch recognizes `external-plan@3` explicitly. The v3 validator inherits the
  v2 session contract and validates `restDays` separately.
- A compatibility boundary may normalize v1/v2 to an empty internal rest-directive list
  **after** schema dispatch. That is an internal representation convenience, not a silent
  expansion of either historical schema.
- Each rest directive `id` must be unique within the plan; each `(week, day)` pair may
  occur at most once; `week` must be within `1..weekCount`; `day` uses the same lowercase
  weekday vocabulary as session placement.
- A fixed external session and an authored rest directive cannot own the same relative
  date. That contradiction should fail import rather than rely on runtime precedence.
- Preferred/`any_day` placement and missed-session replacement must treat resolved rest
  dates as blocked placement targets.
- The immutable plan content hash includes the rest directives, so changing rest intent
  requires a new plan revision just like changing a session prescription.
- `revision` remains **one monotonically increasing sequence per stable `planId` across all
  supported schema literals**. Import compares the incoming revision with the highest
  stored revision for that `planId`, not with a schema-version-local counter. For example,
  stored v2 revision 7 may be superseded by v3 revision 8; after revision 8 is stored, any
  v1/v2/v3 artifact at revision 8 or lower is stale and cannot supersede it. The schema tag
  never resets the revision sequence.
- v3 inherits the existing chosen-date-forward supersession rule: an accepted higher
  revision applies from the confirmed supersession date forward (defaulting to today),
  while already adjudicated daily recommendations and audits remain bound to the prior
  plan revision/content hash. Introducing v3 must not rewrite history.

#### Day-resolution semantics

The external-plan boundary should resolve a date into one of three source states before
normal externally-planned fallback logic runs:

- `session` — an external session is placed on the date;
- `rest` — a v3 rest directive resolves to the date;
- `unplanned` — neither is present.

Only `unplanned` activates the existing labelled evergreen fallback. `rest` must not be
represented as `externalFallback: true`, because the plan did supply an instruction.
Whether this is implemented by extending `resolvePlanningContext` or by a small sibling
resolver is an implementation detail; the observable three-state contract is not.

#### Readiness and recommendation semantics

Authored rest must not fabricate physiological state:

- `evaluateReadinessAndSafetyEnvelope` still computes `train` / `modify` / `recover` from
  readiness and safety inputs and its result remains observable/auditable unchanged.
- Hard clinical/safety restrictions and hard calendar availability remain higher
  authorities than authored plan intent.
- In the normal recommendation path, an authored rest directive then suppresses ordinary
  generated work and resolves the planning outcome to the canonical Rest recommendation
  (`getCanonicalRestTemplate()`), with an explicit authored-rest reason/source.
- A travel/load overlay may coexist with authored rest. On the default rest path there is
  no discretionary training dose to scale; if the athlete explicitly overrides rest and
  requests training, normal availability, travel, readiness and safety gates apply to that
  requested work.

This is intentionally **not** "force readiness mode to `recover`." A well-recovered athlete
can have a `train` readiness verdict while the plan still recommends rest for sequencing
or taper reasons. Keeping both facts is more truthful and makes audit/replay easier to
interpret.

#### Athlete override

Protected rest changes the application's default recommendation, not the athlete's agency.
An explicit same-day athlete request may override the authored-rest planning gate, but the
override must be visible and auditable and must still pass all safety, clinical,
availability, equipment and readiness constraints. There is no silent automatic override
because wearable/readiness data look favorable.

#### Persistence, audit and replay

The persisted decision should carry enough source identity to reproduce why the date was
closed to discretionary planning, at minimum:

- `planId`;
- plan revision;
- immutable plan content hash;
- rest directive `id`;
- resolved plan-local date;
- an authored-rest reason/source label distinct from physiological `recover` and from
  `externalFallback`.

Replay may apply authored rest only when **every persisted source-identity field matches**
the loaded immutable artifact and the directive re-resolved from it: `planId`, revision,
content hash, rest directive `id`, and resolved plan-local date. Any mismatch fails closed
as unreplayable; replay must not infer rest from session absence or substitute a different
directive/date from the same plan.

Because this capability changes the recommendation on a date that previously fell through
to evergreen planning, implementation requires a `POLICY_VERSION` bump plus matching
validation, persistence/rules, placement, audit/replay and recommendation tests.

### Option C — Represent rest inside `sessions[]` (`isRest: true`)

Add an `isRest: true` session flag, mutually exclusive with `isEvent`, and reuse the normal
session placement/missed-session machinery.

**Rejected as the recommended representation.** It reuses placement code, but it stretches
`ExternalPlanSession` to represent the deliberate absence of a session. A rest directive
has no training duration, equipment requirement, stimulus, execution dose or adherence
occurrence. Forcing those non-concepts through session contracts makes downstream
execution and occurrence semantics less source-neutral and increases the chance that rest
is accidentally counted as performed training.

## Recommendation

Adopt **Option B** if the repository owner accepts this ADR: add relative plan-level
`restDays` only in `adaptive-training-recommender/external-plan@3`, inheriting v2 session
semantics unchanged. Do not broaden v1/v2 validators and do not encode rest as a synthetic
readiness `recover` verdict or as a fake training session.

Before implementation is complete, the following contracts need deterministic tests:

- v1/v2 remain byte/validation-compatible and reject the new field;
- v3 accepts valid relative rest directives and rejects duplicate/out-of-range/conflicting
  directives;
- revision ordering is monotonic across schema versions for a stable `planId`: stored v2
  revision 7 accepts v3 revision 8, while any later v1/v2/v3 import at revision 8 or lower
  is rejected as stale; chosen-date-forward supersession leaves earlier adjudicated
  recommendations/audits bound to their original revision;
- rest dates are excluded from `any_day` and missed-session replacement targets;
- an authored-rest date does not activate evergreen fallback;
- an unplanned v1/v2/v3 date still activates the current labelled fallback;
- readiness output is unchanged by authored rest while the default planning outcome is
  canonical Rest;
- an explicit athlete override remains safety/availability/readiness adjudicated and is
  auditable;
- persistence/replay records the plan/revision/content-hash/directive/date identity, and
  replay fails closed if **any** of those persisted fields (including directive `id` or
  resolved plan-local date) does not match the loaded immutable plan;
- `POLICY_VERSION` and persistence/rules coverage are updated with the behavior change.

No production code changes are made by this ADR; repository-owner sign-off is required
before implementation.

## Consequences

**Positive.** Closes the H3 semantic gap without corrupting readiness semantics or session
occurrence identity. Preserves the external-plan calendar invariant and gives taper/deload
rest an explicit, replayable source fact.

**Negative.** A new schema revision and new planning authority require validator,
placement, persistence, audit/replay, UI and policy-version work. This is intentionally not
an "optional field on v2" shortcut.

**Neutral.** Existing `external-plan@1` and `external-plan@2` artifacts behave exactly as
today. Plans without a rest directive continue to distinguish only placed session versus
unplanned fallback.

## Alternatives considered and rejected

**Treat a favorable `recover`-mode outcome as sufficient protection.** Rejected: readiness
is physiological/clinical decision input, while authored rest is plan intent. Conflating
them makes a taper rest day contingent on morning wearable data and makes audit state
misleading.

**Use absolute `restDates: ["YYYY-MM-DD"]`.** Rejected: it violates the existing external-
plan rule that `startDate` is the sole absolute date and reintroduces author-side calendar
arithmetic that the week/weekday placement model intentionally removed.

**Infer rest from an unusually light week or an omitted date.** Rejected: absence of an
instruction is already a valid, intentional state that triggers evergreen fallback.
Inferring rest would silently change every existing imported plan without an explicit
opt-in.
