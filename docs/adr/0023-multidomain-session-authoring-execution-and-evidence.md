# ADR-0023: Multidomain Session Authoring, Execution, and Evidence

* **Status:** Accepted
* **Date:** 2026-08-18
* **Proposed:** 2026-08-18
* **Deciders:** Repository owner
* **Related:**
  [ADR-0002](./0002-user-scoped-firestore-isolation.md) (user-scoped collections),
  [ADR-0003](./0003-timezone-semantics-and-d1-step-window.md) (Warsaw date boundaries),
  [ADR-0010](./0010-decision-provenance-and-audit-replay.md) (provenance and audit replay),
  [ADR-0014](./0014-objective-credit-v2-and-honest-load.md) (D-FUSE: evidence before fusion),
  [ADR-0017](./0017-training-intent-profile-and-planning-modes.md) (planning-mode authority),
  [ADR-0019](./0019-externally-authored-plans-and-session-adjudication.md) (external plans),
  [ADR-0020](./0020-subjective-baselines-in-readiness-mode.md) (D-SUBJFLOOR: tissue tightening),
  [ADR-0021](./0021-strength-session-logging-and-intensity-gauges.md) (D-GAUGE, D-SETLOG, D-STRCOST),
  [ADR-0022](./0022-zone-derived-completed-training-credit.md) (measured-candidate precedent)
* **Supersedes:** ADR-0019 **D-SHIM** for newly created source-neutral session decisions after
  their cutover. Historical `ext:` decisions and audits retain the original resolver. ADR-0019
  D-EXT, D-CANDIDATE, D-EXTTIER, D-IMMUT, D-NOPARSE, and D-CRITIQUE remain in force.
* **Implementation plan:**
  [`multidomain-session-authoring-execution-and-evidence.md`](../plans/multidomain-session-authoring-execution-and-evidence.md)

> **Acceptance boundary.** This ADR accepts the domain boundaries, authority order,
> persistence ownership, and evidence gates below. It does not claim that the current code
> implements them, activate any new recommendation input, approve automatic coaching rules,
> or require rewriting historical documents. The living architecture documentation changes
> only when the corresponding code lands.

---

## Context

The repository has four useful but non-composing session paths:

1. the engine workout library (`workouts/`, `engine/templates.ts`) defines catalog workouts,
   parameter bindings, reviewed cost, and reviewed stimulus;
2. external-plan sessions reach adjudication through ADR-0019's deliberately temporary
   synthetic `ext:` `SessionTemplate` shim, while their executable detail remains parallel;
3. the Strength logger records durable gym sets in monolithic array-backed
   `strength_sessions` documents; and
4. the daily subjective check-in records body-region tissue state without durable
   many-session attribution.

Consequently, an imported or athlete-authored session containing strength, Olympic lifts,
sprints, field drills, isometrics, and recovery work has no single executable representation.
The exact instructions shown to the athlete are not yet one immutable replay input; planned
and performed data use different identities depending on source; and native speed, jump,
change-of-direction, or power measurements lack protocol and comparability provenance.

The two source analyses are
[`2026-08-18-authored-composite-session-import-and-execution.md`](../analysis/2026-08-18-authored-composite-session-import-and-execution.md)
and
[`2026-08-18-multidomain-training-system-consolidated-analysis.md`](../analysis/2026-08-18-multidomain-training-system-consolidated-analysis.md).
The existing runner defects and mobile requirements are evidenced separately in
[`2026-08-18-strength-session-ui-ux-review.md`](../analysis/2026-08-18-strength-session-ui-ux-review.md).
They establish the need for a deterministic execution middle, not a second optimizer or a
new universal load score.

This ADR decides:

* the source-neutral executable contract;
* the identities and ownership of definitions, placements, prescriptions, and performed
  work;
* how athlete-authored occurrences interact with the sole planning-mode authority;
* how exact executable content enters recommendation immutability and replay;
* how athlete choices, observations, and response linkage are recorded; and
* which new facts remain evidence-only.

---

## Decisions

### D-MSESSION — one source-neutral executable contract

`SessionDefinition` is the normalized executable-content contract for structured strength,
power, speed, field, conditioning, recovery, skill, and test sessions.

Catalog workouts, external plans, and manually authored content adapt **into** this boundary.
The general runner and performed-entry logger depend on the normalized definition and its
frozen `ExecutionPrescription`; they do not depend on catalog ranking types, external-plan
parsers, or source prose.

Source identity remains explicit and separate from executable content. A source reference
names the immutable input that produced a definition:

```ts
type SessionSourceRef =
    | { kind: 'catalog'; workoutId: string; catalogVersion: string }
    | { kind: 'external_plan'; planId: string; revision: number; sessionId: string; contentHash: string }
    | { kind: 'manual'; definitionId: string; revision: number; contentHash: string };
```

The source reference is a provenance envelope around normalized content, not a recursive
field inside the bytes whose `contentHash` it carries.

The concrete type name is unversioned and contains an integer `schemaVersion`, initially
`1`. Parsers dispatch on that value; they do not cast an unknown version into the current
type. Stable IDs identify the definition, every block, every executable step, every option,
and every companion reference. Reordering or editing content never silently changes those
identities.

Every definition declares an intent:

```ts
type SessionIntent =
    | 'training'
    | 'testing'
    | 'competition'
    | 'rehab_return'
    | 'recovery'
    | 'skill_technical';
```

Intent is executable context, not presentation: a training attempt cannot silently become a
test benchmark, and a recovery companion cannot silently become ordinary conditioning.

The reviewed positive fixtures under `app/src/sessions/fixtures/` are normative examples for
what schema version 1 must express. Their canonical vocabulary uses `schemaVersion`, stable
`id`, `revision`, `intent`, `exerciseRef.kind`, and singular dose discriminants such as
`repetition`, `duration`, and `distance`. The adjacent invalid-case corpus is normative for
what the authoring validator must reject. Generator-only aliases such as `schema`,
`definitionId`, `exerciseRef.state`, and `repetitions` are not a second accepted wire format;
an importer may translate them only before validation and confirmation.

Version 1 is fixture-led and bounded: block roles and group modes, exact-or-range dose,
laterality, typed load, tagged effort/quality, rest, tempo, optionality, logging mode, bounded
choices, measurement protocol references, and companion definition references are included
only to the extent exercised by the reviewed corpus. Unsupported source prose remains inert or
produces an import issue; it does not widen the schema accidentally.

No display string, author note, cue, fallback prose, or imported source text is parsed at
execution time into dose, structure, eligibility, or behavior. A model-assisted import may
create a reviewable draft under ADR-0019 D-NOPARSE, but only the confirmed normalized content
is executable and replayable.

### D-MRECORDS — definition, placement, prescription, and performance have separate ownership

All new persistence is below `users/{userId}/`. The four primary lifecycle records are:

| Record | User-scoped path | Owns | Mutability |
|---|---|---|---|
| Definition header and revision | `session_definitions/{definitionId}` and `revisions/{revision}` | reusable authored content and source identity | header may advance its latest-revision pointer; a revision is write-once |
| Occurrence | `session_occurrences/{occurrenceId}` | Warsaw-local placement, authority, state, and a pinned definition revision/hash | future placement may change through explicit transitions; it never mutates the pinned revision or a past decision |
| Execution prescription | `execution_prescriptions/{prescriptionHash}` | exact normalized steps, targets, allowed choices, and adjudicated modifications offered for one decision/occurrence | write-once and content-addressed |
| Performed execution | `session_executions/{executionId}` and `entries/{entryId}` | lifecycle plus what the athlete actually did | correctable only while in progress; terminal afterward |

These identities are not interchangeable:

* a definition revision can produce many occurrences;
* an occurrence pins one definition revision and never floats to “latest”;
* a new adjudicated variant produces a new prescription hash rather than mutating an old
  snapshot;
* an execution pins one prescription hash when prescribed, or an explicit unplanned source
  reference when no prescription existed; and
* performed entries never mutate the definition, occurrence, prescription, recommendation,
  or audit.

An execution spanning midnight belongs to its Europe/Warsaw start date, consistent with
ADR-0021. Instant timestamps remain ISO instants; calendar ownership is never derived with
UTC date slicing.

Measurement protocols, metric observations, and response links are separate evidence
records because their lifecycles are not any of the four above. They may reference these
records, but do not become nested mutable arrays inside them.

Their user-scoped paths are:

```text
users/{userId}/measurement_protocols/{protocolId}
users/{userId}/measurement_protocols/{protocolId}/revisions/{revision}
users/{userId}/metric_observations/{observationId}
users/{userId}/session_responses/{responseId}
```

Protocol revisions and raw observations are immutable. Response-record correction semantics
are defined with their implementation, but no response mutation may rewrite the referenced
canonical check-in value.

### D-MAUTH — destination actions and occurrence authority are distinct

The authoring destination shown to the athlete is not automatically an engine authority.
The persisted outcomes are:

| Athlete action | Persisted result | Recommendation effect |
|---|---|---|
| Save only | definition revision only; **no occurrence** | none |
| Start unplanned | an `unplanned_log` occurrence created at start, then an execution | none; completed work may enter history only through separately accepted history adapters |
| Schedule | a `schedule` occurrence on a Warsaw-local date | calendar visibility only until the athlete explicitly changes its authority |
| Replace recommendation | one active `replace_recommendation` occurrence for that date | owns the primary authored-session adjudication for the date |
| Add another session | an `additional_session` occurrence for that date | preserves the primary recommendation and receives separate same-day adjudication |

`save_only` is therefore not an `OccurrenceAuthority`. `unplanned_log` and `schedule` have no
selection surface: they do not change `Recommendation`, `DailyRecommendation`, decision
equality, audit provenance, or replay. Scheduling alone is not silent activation. An explicit
authority transition is timestamped and applies only to decisions made after it; it never
rewrites a stored recommendation or audit.

`planningMode.ts` remains the sole effective planning-authority resolver. For evaluation date
`D`, it applies this order:

1. resolve an active, valid `replace_recommendation` occurrence for `D`;
2. if one exists, return the date-scoped effective `authored_occurrence` branch and adjudicate
   that occurrence instead of ranking catalog candidates;
3. otherwise resolve ADR-0017/ADR-0019's persisted planning mode exactly as before; and
4. after the primary result is known, adjudicate any `additional_session` occurrences against
   the same clinical, readiness, equipment, time, environment, injury, and same-day stacking
   constraints.

The date-scoped replacement outranks `evergreen`, `event_directed`, and
`externally_planned` for that date only. It does not mutate `TrainingIntentProfile` or
external-plan placement. `additional_session` never changes the effective planning mode and
never becomes a ranked alternative to the primary session.

The authored context records the underlying persisted planning mode for audit and labelled
fallback, but callers do not apply a second source override after `planningMode.ts`. This keeps
one effective authority resolver while preserving the intent that would otherwise have owned
the date.

All authored occurrences retain ADR-0019 D-CANDIDATE's safety property: authored intent does
not bypass a hard gate. If a replacement is excluded or deferred, it is not displayed as
executable. The engine may produce its normal safe fallback, clearly labelled with the
authored-occurrence verdict; it must not silently pretend the authored session passed. An
additional session is executable only if its separate adjudication passes after accounting
for the primary session and already accepted additions.

There may be at most one active replacement for a user/date. A deliberate replacement request
atomically supersedes the previous active occurrence through an audited state transition; the
superseded occurrence is retained. This avoids turning an offline gym-floor choice into a lost
write while still rejecting “latest timestamp wins” as an authority rule. If a read ever
observes two active replacements because a client or legacy write bypassed that transition,
the state is `INVALID` and fails closed rather than choosing arbitrarily.

Additional occurrences are ordered by stable placement order plus `occurrenceId`, and that
exact ordered set is an audit input so same-day stacking can replay deterministically. Hard
clinical, injury, time, equipment, and environment gates may make an additional session
non-executable. Capacity and weekly-spacing critique remains advisory under ADR-0019
D-CRITIQUE: it may warn, but it does not silently cancel or rewrite an athlete-approved
session.

### D-MENTRY — typed per-entry persistence with bounded correction

Performed rows are individual documents below
`users/{userId}/session_executions/{executionId}/entries/{entryId}`. Each entry carries:

* a stable entry ID and parent execution ID;
* the planned step ID, or an explicit unplanned/unresolved marker;
* side/laterality where relevant;
* occurrence time plus `createdAt` and `updatedAt` instants;
* any selected option reference required to interpret the performed action; and
* exactly one discriminated payload, such as repetition/load, duration, distance, sprint,
  change-of-direction, jump/throw, contact count, observation reference, or check-off.

While the parent execution is `in_progress`, a performed entry may be corrected or deleted.
An update preserves the entry ID and `createdAt`; a replacement records `updatedAt`. This is
correction of the athlete's asserted source record, not a derived-value rewrite. Services and
Firestore rules reject correction through another user's parent or after terminal state.

The sole allowed terminal transition is from `in_progress` to `completed` or `abandoned`.
After that transition, the execution header and all entries are immutable. Abandonment keeps
partial work. Completion is idempotent and cannot create duplicate response or observation
records on retry.

Legacy ADR-0021 `StrengthSession` array documents remain readable through a pure,
version-neutral adapter. Missing step, side, source, or occurrence facts remain missing; the
adapter does not guess them. No bulk migration is required.

### D-MSNAP — canonical content-addressed prescriptions and reference-only decisions

Executable snapshots use SHA-256 over deterministic, schema-versioned canonical content.
Definition hashes and prescription hashes are different types and domains; one may never be
substituted for the other. Canonicalization fixes key ordering and number/string
representation and excludes transport metadata such as Firestore timestamps and the digest
field itself. Any material executable change—including dose, laterality, optionality,
allowed option, step order, or adjudicated modification—changes the prescription hash.

The write-once document
`users/{userId}/execution_prescriptions/{prescriptionHash}` stores the canonical prescription
content, its schema version, hash algorithm, and source definition hash. Occurrence-specific
authority and decision provenance live in the recommendation binding and audit, not inside the
content-addressed payload; identical canonical executable content may therefore be reused by
more than one occurrence. Firestore rules enforce ownership, top-level shape,
document-ID/digest-field agreement, and create-only semantics. Because rules cannot recompute
SHA-256, the write service computes the digest and every replay independently recomputes and
verifies it. Missing content, unsupported schema, or a mismatch is `INVALID`; replay never
falls back to the current definition or reparses source prose.

New source-neutral recommendation decisions carry reference-only bindings:

```ts
interface RecommendationSessionRef {
    sessionSource: SessionSourceRef;
    occurrenceId: string;
    prescriptionHash: string;
}

interface RecommendationSessionBindings {
    primarySession?: RecommendationSessionRef;
    additionalSessions: RecommendationSessionRef[];
}
```

The bounded `additionalSessions` list contains references, not executable step content. Its
stable order is decision-affecting. Both primary and additional bindings participate in
decision equality, archived revision bytes, provenance, and replay. This closes the otherwise
undefined replay shape for an `additional_session`; a singular `{ occurrenceId,
prescriptionHash }` tuple is insufficient for a day with two executable sessions.

No new `DailyRecommendation` embeds source-neutral block or step lists. Existing versioned
catalog `prescription` fields and ADR-0019 `externalPrescription`/`ext:` audits remain readable
through their historical resolver. After a source adapter's cutover, newly created decisions
use the source-neutral bindings and snapshot; historical documents are never rewritten.

### D-MCHOICE — authored judgment is a bounded athlete choice, not an evaluated rule

An authored branch point contains a stable choice ID, a trigger description, and a bounded
set of stable option IDs whose structured effects are fully represented in the definition.
Free text may explain an option but cannot supply its executable effect.

Version 1 option actions are a closed union:

```ts
type SessionChoiceAction =
    | { kind: 'select_alternative'; targetStepId: string; alternativeId: string }
    | { kind: 'reduce_load_percent'; targetStepId: string; percent: number }
    | { kind: 'reduce_sets'; targetStepId: string; sets: number }
    | { kind: 'reduce_reps'; targetStepId: string; reps: number }
    | { kind: 'omit_step'; targetStepId: string }
    | { kind: 'end_block'; targetBlockId: string }
    | { kind: 'end_session' };
```

Targets must resolve inside the frozen definition and every alternative must itself be
structured and eligible. Unknown action kinds, dangling targets, and actions that purport to
clear a safety constraint are validation failures, not advisory notes.

The runner presents the allowed options at the designated step. The athlete selects one; the
execution records the choice ID, option ID, occurrence time, and reason code or note required
by the definition. The selected option must exist in the frozen prescription. A choice cannot
inject arbitrary replacement content.

Choice records are append-only execution events even while ordinary performed entries remain
correctable. A mistaken choice is corrected by a later event that explicitly supersedes the
earlier event; dependent performed entries continue to name the effective choice. Replay can
therefore reconstruct what the athlete saw and which branch governed each performed action.

No automatic condition evaluator, progression engine, or silent substitution is authorized.
Automatic option selection is a future measured candidate under D-MPOLICY, not a hidden
interpretation of the trigger description.

### D-MOBS — measurements preserve protocol and comparison provenance

A raw `MetricObservation` records the metric definition/version, numeric value, unit,
`observedAt`, source/device, immutable measurement-protocol revision/hash, training-versus-test
intent, validity/quality, comparison-series identity, and its execution/entry/attempt reference.
Units and compatible entry kinds are registry-controlled; arbitrary labels do not become
metrics.

Raw observations are immutable and are never overwritten by a derived value. A derived
observation names its algorithm version and all source observation IDs. Protocol revisions are
also immutable. A material change in timing method, surface, distance, drop height, device, or
other registry-declared context starts a different comparison series.

Invalid, practice, missing-protocol, or incompatible observations remain visible raw evidence
but do not become default benchmarks. Training measurements cannot silently become test
benchmarks. No universal “power,” “athleticism,” or cross-domain performance score is accepted
by this decision.

### D-MRESP — the daily check-in owns tissue state; response records own linkage

`DailySubjectiveCheckin.tissueResponses` remains the sole authoritative store for body-region
tissue values consumed by `injuryPolicy.ts`. New session-response records never copy those
values. They store only:

* occurrence and execution identity;
* response window (`immediate | later_day | next_morning`);
* non-tissue session facts such as session RPE, duration, completion fraction, unexpected
  fatigue, technique note, and free note; and
* references to the canonical check-in date and region fields containing any tissue values.

A tissue value belongs to the Europe/Warsaw check-in date on which it was observed. Immediate
response normally belongs to the session-start date; a next-morning value belongs to the next
Warsaw calendar date and links back to the earlier occurrence. No UTC date slicing is allowed.

Linkage expresses athlete-reported attribution, **not medical causation**. It must support more
than one session on a date and more than one linked region without overwriting an earlier link.
The M1 Strength bridge may temporarily carry one optional `sourceSessionRef` only when exactly
one attribution is known. It must not replace an existing different reference; ambiguous or
multiple attribution remains unlinked until the generalized response record exists. The
singular bridge is compatibility scaffolding, not the permanent cardinality model.

A skipped prompt produces no response record and no tissue value. Missing later or
next-morning data is `unknown`, never “normal,” “passed,” or zero. Favorable response data never
weakens a standing injury constraint; ADR-0020 D-SUBJFLOOR remains unchanged.

### D-MPOLICY — new detail is evidence-only until separately activated

This ADR changes representation and evidence collection, not recommendation coefficients.
The live decision path may consume only already-authorized facts through their existing
authorities: the occurrence authority and immutable prescription selected for the decision,
the current safety/feasibility inputs, and canonical daily tissue state through the existing
tighten-only injury policy.

The following remain default-off and outside selection, gating, cost, stimulus, progression,
or automatic substitution:

* step-derived cost or stimulus profiles for manual/external content;
* performed-entry-derived load, multidomain exposure, and spacing adjustments;
* session-response outcomes or response-driven progression;
* automatic choice resolution; and
* observation-derived readiness, fatigue, or injury claims.

Evidence-only modules must not be imported by selection modules. Each candidate requires its
own dated real-history analysis and explicit ship/defer/reject decision. Shipping also requires
no hard-gate regression, a `POLICY_VERSION` increment, audit/replay coverage, scenario evidence,
and a rollback selector. Code existence, richer logs, or synthetic scenarios alone is not
authorization. A no-ship result completes the measurement work, following ADR-0022.

---

## Compatibility and migration

| Artifact | Historical behavior | New behavior after its cutover | Guarantee |
|---|---|---|---|
| Catalog recommendation | embedded catalog prescription and catalog identity | source-neutral definition/prescription binding when the catalog adapter is adopted | old recommendation versions replay unchanged |
| External-plan decision | synthetic `ext:{planId}:{revision}:{sessionId}` identity plus external-plan hash | external source adapts to `SessionDefinition` and a content-addressed execution prescription | no past audit or placement is rewritten; v1 external plans remain readable |
| External plan v1 | calendar-oriented imported sessions | read-compatible adapter into the source-neutral boundary | adapter cannot invent option sets, laterality, protocols, or exercise identity |
| External plan v2 / manual definition | none | normalized `SessionDefinition` revision | new writes use only the canonical v1 fixture vocabulary |
| Historical `RecommendationAudit` | catalog or `ext:` identity | source-neutral bindings for new decisions | historical verification path is retained indefinitely |
| Strength session v1 | array of `LoggedExercise`/set records | typed entry documents in `session_executions` | permanent pure read adapter; no Firestore write migration |
| Daily tissue response | canonical per-date, per-region check-in values | same canonical values plus separate occurrence/window linkage | no second tissue-value store; absent linkage remains valid historical data |

The migration is version-aware and forward-only. A source switches to the new write path only
after its adapter, persistence, rules, audit, and replay tests land together. Mixed historical
versions are expected. Failure to resolve an old or new artifact is surfaced as a typed data
state; it is never repaired by guessing current content.

Dependency direction is part of compatibility. Session and observation domain modules do not
import selection/ranking modules; engine adapters may import session types; and new
session/observation UI and services may consume domain types but not optimizer policy. The
legacy `Home.tsx` composition boundary is not silently refactored by this ADR.

---

## Consequences

### Positive

* One runner can execute catalog, imported, and manual mixed-domain sessions without importing
  ranking or parser internals.
* Definition intent, date placement, the exact prescription shown, and performed work remain
  independently revisioned and attributable.
* Reference-only recommendation bindings preserve Firestore document headroom while making
  primary and additional sessions replayable.
* Native measurements and delayed response can accumulate useful evidence without silently
  changing engine policy.
* Historical `ext:` audits and v1 Strength data remain valid without a risky bulk rewrite.

### Negative

* More document identities and reads are required than in the monolithic Strength model.
* Content addressing needs canonical serialization plus application-level digest verification;
  Firestore rules alone cannot prove that bytes match a SHA-256 document ID.
* Same-day replacement and additions require deterministic conflict handling and more audit
  surface than a single recommendation.
* Keeping tissue values canonical while linkage is many-to-many requires a separate response
  seam rather than one convenient embedded session reference.

### Guardrails retained

* user-scoped paths and ownership checks from ADR-0002;
* Europe/Warsaw calendar ownership from ADR-0003;
* immutable decision provenance and replay from ADR-0010;
* normal safety and feasibility gates from ADR-0019 D-CANDIDATE;
* raw performed-data and tagged-gauge semantics from ADR-0021; and
* evidence-before-policy discipline from ADR-0014, ADR-0020, ADR-0021, and ADR-0022.

---

## Alternatives considered

**Keep extending the synthetic `SessionTemplate` shim.** Rejected. ADR-0019 explicitly made
that a bounded compromise until a second non-catalog consumer appeared. Manual definitions and
a general runner are that consumer, and synthetic catalog identities cannot honestly own rich
execution content.

**Store the executable snapshot inside `daily_recommendations/{date}`.** Rejected. It repeats
the variable nested-array validation weakness of v1 Strength, increases document-size pressure,
and duplicates identical immutable content across archived revisions. A verified hash reference
provides exact replay without those costs.

**Use one singular recommendation tuple for every authored session.** Rejected. It cannot
represent an `additional_session` beside the primary recommendation. A bounded, ordered list of
reference-only bindings is the minimum replayable shape.

**Treat Save only as an occurrence authority.** Rejected. Saving reusable content does not place
it on a date. Conflating the two creates a phantom occurrence and makes “stored” look like
“scheduled.”

**Rank every scheduled occurrence automatically.** Rejected for version 1. Calendar placement
is not selection consent, and it would give a partially implemented occurrence an engine
surface before recommendation immutability and replay land. The athlete explicitly promotes a
scheduled occurrence to replacement/additional authority when that is intended.

**Apply a source override after `planningMode.ts` resolves the day.** Rejected. It preserves the
underlying mode label but creates a second effective authority outside ADR-0017's single
resolver. The authored-occurrence context records the underlying mode and remains the one branch
callers consume.

**Embed a singular source session inside each tissue value.** Rejected as the permanent model.
Two sessions can affect one region on one day, and association is not proof of causation. The
check-in owns the value; response records own attribution and window linkage.

**Evaluate authored condition prose automatically.** Rejected. The repository has no evidence
for those thresholds, and parsing prose at execution would break determinism. Bounded athlete
choices preserve authored intent and generate evidence without pretending a rule exists.

**Create one cross-domain load or athleticism score.** Rejected. Strength, sprint, jump, field,
and tissue observations retain native meaning. Any future engine mapping is a measured candidate,
not a persistence primitive.
