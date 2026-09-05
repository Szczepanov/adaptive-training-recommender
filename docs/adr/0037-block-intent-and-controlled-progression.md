# ADR-0037: Block Intent and Controlled Progression

* **Status:** Accepted
* **Date:** 2026-09-05
* **Deciders:** Codex, under the repository owner's request to take the H5 decision
* **Implementation:** Unstarted; this decision does not activate runtime behavior.
* **Related:** [ADR-0017](./0017-training-intent-profile-and-planning-modes.md),
  [ADR-0016](./0016-adaptation-credit-and-weekly-coverage.md),
  [ADR-0023](./0023-multidomain-session-authoring-execution-and-evidence.md),
  [ADR-0033](./0033-sports-knowledge-registry.md),
  [ADR-0034](./0034-canonical-performed-training-occurrence-and-multisource-reconciliation.md),
  [ADR-0035](./0035-explicit-rest-day-authoring.md),
  ADR-0036 / H4 intraday allocation as proposed in
  [PR #404](https://github.com/Szczepanov/adaptive-training-recommender/pull/404),
  [evaluation plan](../plans/cycling-primary-hybrid-evaluation.md),
  [implementation handoff](../plans/cycling-primary-hybrid-implementation-handoff.md).

> **Integration dependency:** H5 preserves the H4 allocation of `external-plan@4` and
> therefore allocates H5 to v5. PR #404 is the concrete H4 dependency while ADR-0036 has
> not yet landed on the target branch. Before H5 import implementation is accepted, rebase
> or otherwise reconcile this branch with the landed ADR-0036 artifact and inherited v4
> contract. Do not silently reuse v4 for H5 or implement v5 against an inferred H4 contract.

## Context and code evidence

`TrainingIntentProfile` owns broad priorities and weekly session commitment.
`planSchedule.ts` `PlanBlock` owns phase/date/load scales; `PlanObjectiveDefinition`
already binds objectives and separate credit/coverage requirements to a block. A
`primary_developmental` role or `strength_maintenance` objective is useful existing
semantics, but is not a complete per-objective intent, evidence and progression contract.

`evergreenStrategy.ts` `AdaptationDoseRequirement` already separates dose, floor semantics,
priority, substitutions and knowledge references. `AthleteTrainingState` currently reports
recent exposure and a training-age proxy with inference quality; these do not establish
that all completed work was tolerated. Historical expertise, recent completed exposure,
response evidence, availability and ambition must remain different facts.

`coverage.ts` maintains exact programming-role coverage separately from stimulus credit.
`responses/outcome.ts` `deriveSessionOutcome` provides passed/caution/reactive/unknown
evidence and `hasFollowUpData`; an immediate-only result cannot establish later tolerance.
`observations/progress.ts` checks protocol/series comparability and measurement noise.
`outcomes/evaluationSpec.ts` already provides immutable evaluation bindings and hashes;
`blockOutcome.ts` reports on_track/mixed/off_track/insufficient_evidence.

The living [outcome architecture](../architecture/performance-outcome-evidence.md)
explicitly keeps those reports outside automatic selection. Its current verdict thresholds
are reporting policy, not progression gates. `athleteEvidencePolicy.ts` already implements
tighten-only subjective/recovery/tissue refinements and safety-monotonicity checks. H5
must not turn these into permission to relax restrictions or infer fast recovery.

This decision concerns software authority and evidence handling. It prescribes no personal
training block, maintenance percentage, progression increment or clinical threshold.
Numerical coaching rules need their own applicable knowledge provenance and validation.

## Options considered

1. **Infer develop/maintain from profile priority or phase.** Rejected: importance, expected
   adaptation and phase are independent. Strength can be important while its block intent
   is maintenance; development need not imply a higher weekly commitment.
2. **Explicit block objectives plus bounded, confirmed change proposals.** Accepted:
   separates intent, delivered work, tolerance and outcomes while retaining plan authority.
3. **Automatically progress whenever readiness or an outcome verdict is favorable.**
   Deferred: neither is sufficient evidence of tolerated dose or causal effectiveness.
   This would also cross the existing outcome-to-selection boundary without a validated rule.

## Decision

### D-INTENT — block-owned objectives, profile-owned commitment

Introduce a versioned block-intent contract compiled into the existing `PlanDefinition`
and objective/coverage boundaries. Do not create a new planning mode or parallel planner.
`planningMode.ts` remains the effective-mode authority. The athlete profile continues to
own weekly commitment and durable priorities; a block cannot silently change either.

Each block has a stable id, revision/source identity, bounded date interval, objective
list and review contract. Each objective carries:

- stable objective id, typed sport/adaptation scope and existing objective/coverage mapping;
- explicit `intent: develop | maintain`, independently of its priority;
- dose envelope in an existing supported unit, with floor semantics and knowledge lineage;
- protected exact roles/session references and explicitly allowed structured substitutions;
- a success criterion and review timing, with a pinned outcome evaluation reference when
  a supported metric/protocol is available;
- entry prerequisites, hold/reduce/redirect criteria and optional progression contract.

`develop` means an intended improvement; `maintain` means intended preservation within
declared bounds. Neither value grants a default numerical dose, clinical clearance or a
guaranteed physiological effect. A maintenance objective may have high priority. Goals
without suitable outcome measures are allowed as process-only intent and must be reported
as unverified physiological outcomes, not translated into an invented performance metric.

Require at least one objective and unique ids. Reject overlapping active intent blocks
within the same plan timeline, dangling mappings, unsupported dose units, nonfinite or
negative doses and inverted bounds. Travel/taper/rest remain their existing distinct
overlays/authorities and do not become competing intent blocks. Missing block intent on
legacy plans retains existing behavior; do not infer a newly persisted intent from labels.

### D-SCHEMA — retain previous import contracts

Add optional plan-level `intentBlocks` only in
`adaptive-training-recommender/external-plan@5`, inheriting the v4 intraday and v3 rest
contracts unchanged. v1/v2/v3/v4 stay immutable and reject the new field. Absence of
`intentBlocks` retains the inherited contract, with no implicit progression capability.

Authored block boundaries use relative `{ week, day }` endpoints, inclusive and within
`weekCount`; `startDate` remains the plan's sole absolute date. Application-owned manual
block authoring uses the same validated internal contract and Warsaw-local dates, through
an explicitly versioned persistence schema. A resolved block retains its authored source.

Block content identity is the digest of the versioned canonical replay payload defined by
D-REPLAY, not an ad-hoc subset of fields. Preserve one increasing revision sequence per
`planId` across schemas and chosen-date-forward supersession. Activated block revisions are
immutable; edits create a new revision. Definition/prescription and evaluation snapshots
keep their own existing identities. Do not mutate a session definition because its block
intent changed.

v5 is a cumulative contract, not a reason to enable unsupported v4 windows. Import support
requires inherited validation and authority handling; an implementation lacking a used
capability must reject the artifact explicitly, never ignore its fields. Single-session
manual block design/reporting does not depend on H4 runtime release.

### D-DOSE — resolve intent through existing dose and safety authorities

For generated plans, explicit block intent feeds the existing evidence-to-dose-to-capacity
path. A reviewed mapping must connect every supported intent to dose policy and exact
coverage; missing mappings produce an unsupported-intent diagnostic rather than a guessed
multiplier. Preserve structured-event and demand-derived paths; do not fabricate events.

For externally authored plans, sessions remain the selection authority. Validate/report
their compatibility with block intent; do not regenerate the imported week to satisfy a
new block target. A contradiction in fixed authored prescriptions and declared hard dose
bounds fails activation. Runtime shortfalls caused by safety or real capacity are reported
as misses, never repaired by adding unsafe work or silently lowering the recorded target.

Hard safety/injury/readiness gates, actual time/equipment, protected rest and applicable
taper ceilings still constrain every session. A declared minimum cannot force training
past a ceiling. Protection reserves a role when feasible; it never grants immunity from
these gates. Block targets remain distinct from actual delivered dose and from measured
adaptation. A safely reduced strength session can serve maintenance intent only through
the existing validated dose/coverage mapping; its completion alone does not prove muscle
or strength preservation.

Substitutions name typed candidates or explicit approved mappings with dose/role criteria.
No free-text or modality similarity creates exact coverage. An added hard ride may replace
a compatible quality commitment once it has qualified typed identity and sufficient dose;
otherwise record a conflict for review. Do not stack extra quality automatically, and do
not erase the performed ride merely because it cannot satisfy a protected role. Testing
and competition occupy the same time/load budget and canonical occurrence accounting as
training. H4's ledger applies when intraday sessions are used.

### D-CHANGE — one bounded progression experiment at a time

Progression is an explicit proposal to change future authored dose, not a readiness mode.
At most one **confirmed active** progression experiment is allowed per athlete across active
blocks in the initial release. Several objectives may develop while only one variable is
being deliberately tested. This is a product rule for interpretable review, not causal proof.
Pending proposals are not active experiments and do not acquire the singleton slot; they may
coexist until one is confirmed, rejected, superseded or withdrawn.

An enabled progression contract must specify:

- a stable target objective/session/step binding;
- one typed variable supported by the prescription model, its unit, current value,
  permitted range and finite positive increment, with knowledge/product-policy lineage;
- an observation window, minimum comparable completed exposures and required follow-up
  coverage, including how conflicting or stale evidence prevents advancement;
- review cadence, entry conditions, continuation/exit criteria and a bounded reduction
  alternative or explicit redirect-to-review outcome.

No generic free-text formulas, arbitrary executable field paths or unregistered threshold
defaults. Validators must verify unit/target compatibility and that each proposed value
fits the authored bounds. A contract with no reviewed evidence criteria cannot enable
progression. The proposal changes one independent variable; derived duration/load effects
must be recalculated and shown. It cannot smuggle in increased frequency, intensity and
volume as three unrelated changes under one label.

Use canonical performed work and pinned prescription comparison to establish what was
actually delivered. Resolve linked response/tissue evidence through existing authorities.
Missing follow-up, incomplete work or mixed evidence is not successful tolerance. Evidence
must correspond to the current dose/target and be available as of review; later syncs or
edited observations create a new review, never rewrite the earlier evidence snapshot.

The pure review produces one of:

| Review action | Meaning |
|---|---|
| `advance_proposal` | Every declared prerequisite passes; one bounded increase may be reviewed. |
| `hold` | Retain authored dose, subject to normal daily gates; includes insufficient evidence. |
| `reduce_proposal` | Evidence supports a bounded reduction for future prescriptions. |
| `redirect` | Stop this progression experiment and review objective, modality or constraints. |

Adverse safety evidence takes precedence over a favorable outcome. Missing/conflicting
evidence blocks advancement; boundary-at-maximum yields hold/exit, not another increment.
Hold never authorizes repeating an unsafe dose: immediate runtime tightening/defer still
occurs through the existing gates. Daily scaling does not silently edit future plan intent.

### D-AUTHORITY — proposals require confirmation; outcomes stay observational

Initial release supports authored intent and report-only progression reviews. A subsequent
bounded delivery step may let the athlete confirm a concrete proposal with before/after
dose, tradeoffs, source evidence and affected future sessions. Confirmation creates a new
plan/definition revision through the existing authoring boundary; it is not a direct write
from outcome reporting into selection. Recheck current source revision, constraints and
capacity at confirmation; stale or duplicate confirmations cannot apply an increment twice.

Confirmation/activation is also the atomic uniqueness boundary for the one-experiment rule.
H5c must maintain one athlete-scoped active-experiment claim/sentinel whose identity is
independent of block storage. Confirmation runs in a Firestore transaction (or an equivalent
serializable compare-and-set mechanism) that reads the singleton claim and the expected
source revision before writing. In the same atomic unit it must either:

1. observe no competing non-terminal claim, validate the proposal against the still-current
   source revision, write the resulting forward-only revision/activation records and acquire
   the claim for that experiment; or
2. fail deterministically without activating the proposal or applying any dose revision.

A claim owned by a different non-terminal experiment produces an explicit
`active_progression_experiment_exists` conflict. A stale source binding produces a separate
stale-confirmation conflict. The implementation must never establish uniqueness by querying
active block/proposal collections and then creating an experiment outside the same atomic
operation; that check can race across blocks.

Repeated confirmation of the same proposal is idempotent and returns/reuses the existing
activation rather than applying another increment. Terminal/cancelled/redirected experiments
release the singleton only with a compare-and-clear transaction that verifies the stored
experiment/claim identity still matches; a delayed cleanup from an older experiment must
not clear a newer claim. Failure after validation but before commit must leave neither an
orphan claim nor a partially activated revision.

No unattended progression, automatic threshold relaxation, inferred clinical clearance or
automatic weekly-commitment increase is accepted. The current outcome architecture's
no-automatic-selection rule remains intact. Keep report/proposal derivation outside engine
selection, with no new runtime outcome dependency in optimizer/planner/rules. An accepted
proposal later enters as ordinary authored input and still passes normal gates.

Generalizable numerical policy references ADR-0033 claim ids/versions. Athlete-specific
observations remain identity-scoped in the existing evidence boundary, never copied into
global knowledge as a scientific conclusion. Existing tighten-only safety monotonicity
remains mandatory. An automatic coaching rule would need a separate evidence-backed ship
decision, measured replay/prospective validation and explicit activation scope.

### D-EVALUATE — success criteria are prospective and protocol-aware

Reuse `OutcomeEvaluationSnapshot`, observations/protocols and block/process reports rather
than creating another outcome store or testing registry. Freeze evaluation references,
baseline selection, comparison protocol, target window and practical thresholds at block
activation. Process-only objectives must not force a fake primary metric into an outcome
spec that currently requires one. Unsupported strength/muscle measures require separate
registry/protocol work before a physiological success claim is possible.

Maintenance needs an explicit acceptable range/decline tolerance in a supported outcome
binding. `unclear_within_noise` or absence of detected decline alone does not prove
maintenance. Report evidence adequacy, dose/role delivery, tolerance and outcome separately;
do not change historical `BlockVerdict` meanings to manufacture an H5 success verdict.
Development success likewise needs comparable outcome evidence, not simply target adherence.

Changed protocol/device/series, absent baseline, inadequate reliability or outcome coverage
must remain non-comparable/insufficient evidence under existing measurement rules. A test
result cannot automatically alter FTP or translate airbike output into bicycle performance.
Do not move goalposts after observing results: revisions start a new evaluation segment
with visible rationale. Preserve policy, planning mode, block/plan revision and progression
step segments; when H4 is active, retain intraday decision identities rather than collapsing
AM/PM context into the current one-recommendation-per-date segmentation.

Reports describe observed association. Neither one-variable tracking nor an `on_track`
result establishes that the plan or app caused improvement. Entry and end-of-block review
can lead to hold, an explicitly authored next block or redirect; no automatic block rollover.

### D-REPLAY — immutable evidence, exhaustive semantic hashing and confirmed change lineage

Version user-scoped block/proposal persistence and enforce ownership, valid transitions
and immutable activated content in Firestore rules. Retain block id/revision/hash, plan and
session definition/prescription bindings, effective dates, policy/knowledge versions,
canonical completed-fact revisions and ids, response/tissue snapshots, observation and
protocol revisions, evaluation hash, evidence as-of time, action/reasons and before/after
values. Confirmation records actor, timestamp, proposal id and resulting revision.

The block digest MUST be computed from a versioned canonical semantic projection, initially
`TreatmentIntentReplayPayloadV1` (name illustrative at ADR level). The projection is the
replay identity for authored block behavior and MUST contain every field capable of changing
allocation, adjudication, progression or evaluation semantics, including at minimum:

- replay-payload schema/version and source plan identity, source schema/revision/provenance;
- the `TrainingIntentProfile` revision or a canonical snapshot of it (`priorities` and every
  `weeklyCommitment` field), pinned at evaluation time -- these are read into allocation and
  capacity decisions but are not themselves part of the block/plan contract, so a profile
  edit made after evaluation must not silently change what an already-replayed decision is
  checked against;
- stable block id/revision and effective relative/absolute bounds used by resolution;
- each objective's stable id, typed sport/adaptation scope, coverage mapping, `intent`,
  priority where authored, dose envelope/unit/floor semantics and knowledge lineage;
- protected exact roles/session references and the complete typed substitution/fallback
  policy, including any dose/role qualification criteria;
- success criteria, outcome/evaluation references, practical tolerances and review timing;
- entry prerequisites plus hold/reduce/redirect conditions;
- the complete progression contract: target binding, variable/unit/current value, permitted
  range/increment, observation window, exposure/follow-up requirements, cadence, continuation
  and exit rules, reduction alternative and transition criteria; and
- any future authored field whose value can change engine, review or evaluation behavior.

The mapping is exhaustive by rule, not by the examples above. Adding a behavior-affecting
field is incomplete until the replay projection, digest input and mismatch fixtures are
updated. Fields proven to be display-only/derived may be excluded, but the exclusion must be
explicit and tested so presentation edits do not accidentally become semantic identity.

Canonicalization must be deterministic before hashing: materialize semantic defaults rather
than depending on parser omission behavior; normalize supported units and null/optional
representations; use stable object-key ordering; sort semantically unordered collections by
stable identity; and preserve list order only where order itself changes behavior. Include
the replay-payload version in the digest input. The implementation may reuse the repository's
established deterministic serializer/hash utility; it must not depend on incidental
JavaScript object insertion order. A replay format change that alters interpretation of an
existing payload requires a new replay-payload version rather than silently reinterpreting V1.

Replay compares the pinned canonical payload/hash and all external immutable bindings used
by the review. Any missing or mismatching user/source/profile-revision/effective-bound/
intent/protected-role/substitution/success-criterion/review-timing/prerequisite/progression/
unit/target/evaluation binding is unreplayable; do not substitute today's evidence, today's
profile, or today's criteria. Corrections supersede reports/proposals visibly. Historical
prescriptions, audits and completed work
remain unchanged. Activation changes require policy-version review/bump, schema/validation,
rule tests and architecture updates alongside the implementation.

## Delivery and deterministic acceptance

1. **H5a: intent authoring and validation.** Implement versioned block contracts and typed
   mappings; prove legacy behavior and safety/capacity precedence. Import v5 depends on
   inherited v3/v4 capabilities actually used; manual/report-only groundwork can start now.
   Before v5 import acceptance, H4/ADR-0036 from PR #404 must be concretely present in the
   branch history/contracts rather than reconstructed from discussion context.
2. **H5b: evidence and report-only review.** Reuse canonical work, follow-up responses and
   outcome reports; implement hold/advance/reduce/redirect derivation with frozen inputs.
   Requires verified evidence linkage, not just the existence of a completed session.
3. **H5c: confirmed bounded revisions.** Add review UI, transactional singleton activation,
   atomic/idempotent confirmation, forward-only revisions and replay. This depends on H5a/H5b
   acceptance, not on enabling experimental personalization. Unattended progression remains
   deferred.

The acceptance matrix must prove:

- develop/maintain is independent of priority; unknown intent preserves legacy behavior;
  old schemas reject new fields; v5 hash/revision/supersession semantics remain monotonic;
- canonical replay hashing changes when each behavior-relevant authored field changes,
  including source identity/revision, effective bounds, intent, protected roles, substitution
  rules, success criteria, review timing, prerequisites and every progression-rule field;
  deterministic reordering of maps/semantically unordered collections does not change the
  digest, while behaviorally meaningful ordering does; display-only changes do not alter it;
- invalid ranges/units/references/overlaps and unsupported dose mappings fail explicitly;
  protected roles cannot bypass safety, rest, taper or actual capacity;
- fresh wearables or extra windows cannot raise weekly commitment; exact qualified event
  replacement avoids duplicate quality while unqualified free text cannot invent coverage;
- reduced strength work may meet a declared maintenance process target without claiming
  measured preservation; development adherence alone cannot claim performance improvement;
- incomplete/adverse/missing-follow-up evidence blocks advance, despite favorable outcome
  metrics; canonical execution/provider duplicates count once and partial work is retained;
- one eligible proposal changes one variable within bounds; maximum value holds/exits;
  two parallel confirmations for different experiments yield exactly one activation and one
  deterministic singleton conflict; no query-then-create race can activate both;
- repeated confirmation of the same proposal is idempotent; a stale source revision cannot
  activate; stale compare-and-clear cleanup cannot release a newer experiment's claim; failed
  transactions leave no orphan claim or partial authored revision;
- protocol/series changes, absent reliability and missing baseline remain non-comparable or
  insufficient; tests consume budget; outcome and intent revisions preserve earlier criteria;
- no report/proposal grants automatic selection authority; confirmed changes pass common
  gates; athlete evidence cannot weaken existing safety envelopes or standing restrictions;
- replay fixtures reject tampering/mismatch for each canonical semantic field and all pinned
  external bindings; cross-user writes fail, amendments preserve history, and H4 integration
  retains distinct intraday evidence where applicable.

Run focused tests, frontend checks/build, Firestore rules, architecture boundary tests,
simulation/diff and policy drift checks when behavior lands. Add targeted execution/review
fixtures exposing tolerance and comparable outcomes before judge evaluation; no baseline
promotion follows merely from a passing unit test. This documentation-only decision needs
no runtime test run or policy bump.

## Consequences

H5 design is accepted with explicit intent and controlled, confirmed progression. The
system can express cycling development alongside strength maintenance without treating
available time, past expertise or favorable readiness as permission to expand training.
The cost is richer authored contracts, reviewed dose mappings, a transactional
active-experiment invariant and immutable semantic replay lineage. Automatic personalization and
personal M00/M01 prescription remain separate; current athlete inputs are still required
for the latter.
