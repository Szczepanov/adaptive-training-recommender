# Allergy / cause-aware symptom reporting — implementation plan

Status: **implemented**. Worktree: `.claude/worktrees/symptom-reporting`,
branch `feat/subjective-symptom-reporting`. See §7 for what shipped and how it differs from
this document's original sketch. The final safety decision is recorded in
[ADR-0032](../adr/0032-cause-aware-subjective-symptom-gating.md).

## 1. The gap, precisely

You've had 2 days of sneezing + runny/stuffed nose and can't log it. This isn't a missing
"symptoms" field in general — the app already has a fairly rich subjective symptom pipeline
(`DailySubjectiveCheckin.illnessSymptoms` boolean → `healthContext.symptoms` detail block with
onset/severity/types). The actual gaps are narrower and land in three places:

1. **Symptom vocabulary is missing exactly your symptoms.**
   [`HealthSymptomType`](../../app/src/engine/healthAnomalyModels.ts) originally only had:
   `sore_throat, congestion, cough, fever_or_chills, headache_or_body_aches, gastrointestinal,
   unusual_fatigue, other`. There was no `sneezing`, and `congestion` only weakly covered a
   stuffy nose — it did not capture a *runny* nose, which is a distinct and common allergy
   symptom.

2. **No way to say "this is allergy, not infection."** The only lever was the top-level
   `illnessSymptoms` boolean, and it was undifferentiated:
   - [`mapCheckinToSubjectiveInput`](../../app/src/engine/adapters.ts) mapped
     `painFlag: checkin.painOrInjury || checkin.illnessSymptoms`, folding "I have hay fever"
     into the exact same flag as a diagnosed injury.
   - [`evaluateEnvelopes`](../../app/src/engine/rules.ts) consumes that `painFlag` as `isPain`,
     activates `clinicalFlagActive`, **restricts Running**, and caps `maxAllowableTier`. Two
     days of sneezing therefore got the same modality restriction and tier cap as a torn
     muscle or undifferentiated illness.
   - [`evaluatePhysiologicalAnomaly`](../../app/src/engine/healthAnomaly.ts) separately records
     whether symptoms were reported as part of the physiological-anomaly state. That subsystem
     must retain observed physiology/context independently of whether the real-time training
     gate is softened.
   - The after-the-fact anomaly explanation flow,
     [`HEALTH_ANOMALY_OUTCOME_EXPLANATIONS`](../../app/src/engine/healthAnomalyOutcome.ts), had
     `illness_symptoms, hard_training_recovery, poor_sleep, alcohol, travel_jetlag, stress,
     heat_dehydration, vaccination_medication, nothing_obvious, other_not_sure` — no allergy
     option, forcing either a false `illness_symptoms` label or a signal-losing
     `other_not_sure`.

3. **Same gap in the athlete-decision-feedback vocabulary.**
   [`ModificationReason`](../../app/src/feedback/feedbackModels.ts), used when logging why an
   athlete scaled down/rejected a recommendation, had `illness_symptoms` and
   `muscle_joint_pain` but no allergy option either. Independent subsystem, same root cause.

## 2. Two phases — a vocabulary fix, and a behavior fix

**Phase 1 (low risk): let the athlete say what's happening.** Add the missing symptom types
and an allergy cause option everywhere the vocabulary is enumerated. By itself this does not
need to change how the engine reacts.

**Phase 2 (decision-affecting): stop treating a narrowly defined allergic-rhinitis-style day
like an injury.** Use the new cause/severity/type detail to soften the
`painFlag`/`clinicalFlagActive` path only when the report is explicit enough to pass a
fail-closed predicate. This changes actual recommendation output, so it requires a policy
version, targeted regression coverage and policy-drift checks. See §5 and ADR-0032.

## 3. Phase 1 — file-by-file

| # | File | Change |
|---|------|--------|
| 1 | [`healthAnomalyModels.ts`](../../app/src/engine/healthAnomalyModels.ts) | Add `'sneezing'`, `'runny_nose'` to `HealthSymptomType`. |
| 2 | [`healthContextValidation.ts`](../../app/src/engine/healthContextValidation.ts) | Add the same values to `HEALTH_SYMPTOM_TYPES`; `validateSymptoms` derives its type-count bound from that array. |
| 3 | [`firestore.rules`](../../app/firestore.rules) | Extend `hasValidHealthSymptoms` with the two types, update the hardcoded maximum from 8 to 10, add `suspectedCause`, and extend the health-anomaly outcome explanation allow-list. |
| 4 | [`healthAnomalyOutcome.ts`](../../app/src/engine/healthAnomalyOutcome.ts) | Add `'allergy_or_hay_fever'` to `HEALTH_ANOMALY_OUTCOME_EXPLANATIONS`. |
| 5 | [`HealthContextSection.tsx`](../../app/src/components/checkin/HealthContextSection.tsx) | Add `Sneezing` and `Runny nose` to `SYMPTOM_TYPES`. Keep `Congestion` — stuffy, runny and sneezing are useful distinct self-report signals. |
| 6 | [`HealthAnomalyFollowupCard.tsx`](../../app/src/components/HealthAnomalyFollowupCard.tsx) | Add `allergy_or_hay_fever: 'Seasonal allergy / hay fever'` to `EXPLANATION_LABELS`. Its `Record<HealthAnomalyOutcomeExplanation, string>` type keeps the UI mapping exhaustive. |
| 7 | [`feedbackModels.ts`](../../app/src/feedback/feedbackModels.ts) + [`feedbackValidation.ts`](../../app/src/feedback/feedbackValidation.ts) | Add `'allergy_symptoms'` to `ModificationReason` + `VALID_REASONS`, so allergy-driven athlete adjustments do not have to be mislabeled as illness. |

### Naming decisions

- Explanation value: `allergy_or_hay_fever`.
- `sneezing` and `runny_nose` remain separate types, consistent with the existing fine-grained
  symptom vocabulary.

### Tests added/updated

- `healthContextContract.test.ts`, `checkinHealthContext.test.ts` — new symptom/cause values
  round-trip through the health-context contract/parser.
- [`healthContextRules.emulator.test.ts`](../../app/src/emulator/healthContextRules.emulator.test.ts)
  — accepts the allergy-oriented types/cause and rejects invalid or contradictory shapes.
- [`healthAnomalyOutcomeRules.emulator.test.ts`](../../app/src/emulator/healthAnomalyOutcomeRules.emulator.test.ts)
  — accepts `explanation: 'allergy_or_hay_fever'`.
- `healthAnomalyOutcome.test.ts` and `HealthAnomalyFollowupCard.test.tsx` — cover the new
  explanation/label.
- `feedbackValidation.test.ts` — covers the new `ModificationReason`.
- [`adapters.test.ts`](../../app/src/engine/adapters.test.ts) — covers the complete decision
  predicate described in §5/ADR-0032.

A future cross-check test could additionally parse `firestore.rules` and compare its hardcoded
symptom/explanation allow-lists with the TypeScript constants. Rules cannot import TypeScript,
so that remains a manual-sync risk outside the core behavior of this PR.

### Rollout checklist

```bash
cd app && npm run check
cd app && npm run test:rules
node scripts/check-policy-drift.mjs main
```

Because Phase 2 changes recommendation output, scenario simulation is useful additional
regression evidence when available. The PR's GitHub Actions checks are the authoritative final
status for the branch.

## 4. What Phase 1 deliberately does *not* change

- `DailySubjectiveCheckin.illnessSymptoms` remains the top-level athlete report.
- Phase 1 alone does not alter recommendation behavior; the behavior change belongs to Phase 2.
- No retroactive historical check-ins are created as a side effect of adding the vocabulary.

## 5. Phase 2 — cause-aware gating

The behavioral complaint underneath the missing fields was that ticking "illness symptoms"
for a day of mild hay-fever-style sneezing got the same Running restriction and tier cap as a
systemic illness or injury. The implemented rule is intentionally narrower than merely
trusting `suspectedCause: 'allergy'`.

1. [`HealthSymptomsCheckin`](../../app/src/engine/healthAnomalyModels.ts) adds
   `suspectedCause?: 'infectious' | 'allergy' | 'unsure' | null`, threaded through
   [`healthContextValidation.ts`](../../app/src/engine/healthContextValidation.ts),
   [`firestore.rules`](../../app/firestore.rules), persistence, and the check-in UI.
2. [`mapCheckinToSubjectiveInput`](../../app/src/engine/adapters.ts) softens the
   `illnessSymptoms` contribution to `painFlag` only when **all** are true:
   - `healthContext.symptoms.present === true`;
   - `suspectedCause === 'allergy'`;
   - severity is explicitly `mild` or `moderate`;
   - symptom types are present and non-empty;
   - every type is one of `congestion`, `runny_nose`, `sneezing`.
3. Missing/`null` severity, missing types, `severe`, `infectious`, `unsure`, or any broader
   symptom (`sore_throat`, `cough`, `fever_or_chills`, `headache_or_body_aches`,
   `gastrointestinal`, `unusual_fatigue`, `other`) keeps the previous conservative illness
   behavior. A future symptom type is conservative automatically until explicitly reviewed.
4. `painOrInjury` remains unconditional. Allergy attribution can never loosen a tissue/injury
   restriction.
5. The judgment stays in the adapter. [`evaluateEnvelopes`](../../app/src/engine/rules.ts)
   retains its simple `isPain = readiness.subjective.painFlag` contract.
6. Physiological anomaly evidence remains orthogonal: the exception changes today's training
   gate, not the observed measurements and not an illness/allergy diagnosis.

### Why fail closed?

The meaningful failure mode is under-restricting someone whose self-attributed "allergy" is an
early infection or an airway condition. IOC guidance explicitly distinguishes infective and
non-infective respiratory illness in athletes, while EAACI guidance emphasizes accurate
diagnosis and the possible coexistence of allergic rhinitis with asthma/exercise-induced
bronchoconstriction. The app does not yet model enough respiratory red flags to safely relax
cough/sore-throat/other presentations. ADR-0032 records that evidence and the resulting product
boundary.

## 6. Suggested sequencing

The implementation followed this sequence:

1. Add the symptom/cause vocabulary and persistence validation.
2. Add outcome/feedback vocabulary and UI support.
3. Add the adapter behavior behind an explicit fail-closed predicate.
4. Add targeted decision and Firestore-rule tests.
5. Add `adapters.ts` to the policy-drift decision-affecting file set and bump `POLICY_VERSION`.
6. Deep-review the safety predicate, harden missing-detail and symptom-shape behavior, and record
   the final decision in ADR-0032.

## 7. What actually shipped

Both phases shipped together (naming: `allergy_or_hay_fever`; feedback reason included).
Phase 2 remains entirely inside `adapters.ts::mapCheckinToSubjectiveInput` via
`isAllergyLikeSymptomDay`, with `rules.ts` untouched.

The review pass made two important hardening changes beyond the original sketch:

- **Missing severity is no longer fail-open.** `null`/absent severity cannot clear the illness
  safety gate; it must be explicitly `mild` or `moderate`.
- **A positive nasal-symptom allow-list replaces the original systemic-symptom blacklist.**
  Symptom types must be present and every type must be `congestion`, `runny_nose`, or
  `sneezing`. This prevents `headache_or_body_aches`, `other`, cough/sore throat and future
  schema additions from silently qualifying.

The review also closed the policy-drift coverage gap exposed by this feature:

- `app/src/engine/adapters.ts` is now in `decisionAffectingFiles`.
- `POLICY_VERSION` is `2026-08-allergy-symptom-gating-v1`.
- [ADR-0032](../adr/0032-cause-aware-subjective-symptom-gating.md) records the final safety
  policy and evidence rationale.

The initial implementation passed the full app and Firestore-rule suites before review. The
post-review branch must pass the PR's GitHub Actions checks; those checks remain the
source-of-truth rather than embedding a permanently stale test count in this design document.
