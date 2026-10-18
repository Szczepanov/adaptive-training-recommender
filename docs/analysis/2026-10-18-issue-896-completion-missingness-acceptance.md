# #896 completion missingness acceptance audit

**As of:** 2026-10-18. **Runtime baseline:** `cf43c3bb` (includes #1103 and #1120).
The follow-up adds synthetic/browser proof and documentation; no runtime, schema, rules,
policy or UI change. Acceptance findings below depend on the named tests, not device checks.

## Contract finding

#896 explicitly offers two alternatives: derive `completedFraction` where meaningful, **or**
require an explicit athlete report. The shipped sheet uses the second. The #962 refresh
previously described derivation/provenance as mandatory remaining work; that interpretation
was too strong and is corrected here.

`SessionCompletionSheet` starts unanswered and `buildCompletionPayload` emits only selected
answers. `completedFraction` is a coarse athlete report, not a ratio of completed sets.
Canonical planned/performed entries and their completion counts stay separately available.
A reported 100% is disabled and omitted when required work is unfinished. Other fractions
never replace structured counts or diagnostic `deliveredDose.completionRatio`; the latter is
performed-dose evidence, not a derived answer to the completion question. The history test
retains a 75% athlete report alongside a 50% performed-dose ratio without conflating them.

`SessionCompletionEvidence` and `submittedAt` retain the submitted report, with the same
optional values projected into the execution-linked `immediate` SessionResponse. No source
field is needed to distinguish two competing fraction producers because no derived producer
writes `completedFraction`. Introducing one later requires its own denominator, provenance
and conflict contract. Historical values are retained without reclassification or backfill.

## Acceptance ledger

| # | Issue criterion | Evidence / interpretation |
|---|---|---|
| 1 | Untouched form persists no sRPE | `sessionCompletionOptions.test.ts`, `SessionCompletionSheet.test.tsx`; `session-lifecycle.pw.ts` untouched and cleared browser cases inspect server records after page reload, with no `sessionRpe`, fraction or fatigue fact and no immediate response |
| 2 | Explicit sRPE 7 persists 7 | Payload test and browser answered case; the same record preserves fraction 0.75 and explicit fatigue `false` |
| 3 | History/export does not substitute 0/7 for missing sRPE | `legacyStrengthAdapter.test.ts` preserves absent versus historical 7 through both adapters; `canonicalBroadHistory.test.ts` keeps missing diagnostic intensity distinct from explicit 0/7; Context Brief renderers do not consume `sessionRpe` or `completedFraction` and therefore do not invent them |
| 4 | No sRPE-derived calculation without an observation | `canonicalBroadHistory.test.ts` pins absent sRPE to unknown intensity, distinct from explicit observed bands; no whole-session RPE-times-duration load calculation is introduced by these fields |
| 5 | Known incomplete work cannot silently persist 100% | Payload contradiction test, disabled-option component test, and each browser case's incomplete-required-work/disabled-100% assertions |
| 6 | Derived fraction has deterministic provenance | Conditional: not applicable to the selected report-only contract. Performed-dose ratio is separate and does not fill an unanswered report |
| 7 | Structured/report conflict semantics explicit | Structured counts and raw entries remain authoritative for what was logged; the report does not overwrite them. Contradictory 100% is omitted. Diagnostic performed-dose ratio and athlete report remain independent, tested as 0.5 versus 0.75 |
| 8 | Unexpected fatigue missingness documented/tested | #1120 gate/action/adjudication tests, payload tri-state tests and browser untouched/answered/cleared cases. Missing requires an explicit recovery answer for dependent sessions; it is never silently No |
| 9 | Historical records readable | `legacyStrengthAdapter.test.ts` retains observed historical 7 and absence; `sessionCompletionConvergence.test.ts` does not synthesize feedback from a legacy header without canonical completion evidence |
| 10 | Untouched, explicit, partial, abandoned and reloaded evidence covered | Payload/component/browser cases above; convergence tests deserialize partial/zero/missing reports and retry projection; the existing abandoned case performs no projection; terminal-lifecycle tests retain the winning evidence |
| 11 | Brief/history invent no subjective observation | Export/history absence checks above; empty response facts are a service no-op in `sessionResponseService.test.ts`; convergence retry tests preserve absence, 0 and false without falling back to a header/default |

## Scope and residual boundaries

The browser reads use Auth/Firestore emulators and an independent authenticated inspection
client. They prove the real UI-to-persistence path and a subsequent page reload, not phone
storage eviction, cold-offline launch or real Garmin timing. Those remain with #897/#895;
the owner deferred actual-device acceptance on 2026-10-18. This does not waive those gates.

#896's conditional derivation criterion is not a requirement to create a new metric. Further
unilateral composition work belongs to #813; #806 remains deferred to a genuine policy bump.
The next evidence-dependent #919 and #872 gates are unchanged.
