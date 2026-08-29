# Allergy / cause-aware symptom reporting — implementation plan

Status: **proposed, not yet implemented**. Worktree: `.claude/worktrees/symptom-reporting`,
branch `feat/subjective-symptom-reporting`.

## 1. The gap, precisely

You've had 2 days of sneezing + runny/stuffed nose and can't log it. This isn't a missing
"symptoms" field in general — the app already has a fairly rich subjective symptom pipeline
(`DailySubjectiveCheckin.illnessSymptoms` boolean → `healthContext.symptoms` detail block with
onset/severity/types). The actual gaps are narrower and land in three places:

1. **Symptom vocabulary is missing exactly your symptoms.** `HealthSymptomType`
   ([healthAnomalyModels.ts:40-48](app/src/engine/healthAnomalyModels.ts:40)) only has:
   `sore_throat, congestion, cough, fever_or_chills, headache_or_body_aches, gastrointestinal,
   unusual_fatigue, other`. There's no `sneezing`, and `congestion` only weakly covers a stuffy
   nose — it doesn't capture a *runny* nose, which is a distinct and common allergy symptom.

2. **No way to say "this is allergy, not infection."** The only lever is the top-level
   `illnessSymptoms` boolean, and today it is undifferentiated:
   - [adapters.ts:152](app/src/engine/adapters.ts:152) — `painFlag: checkin.painOrInjury ||
     checkin.illnessSymptoms` — folds "I have hay fever" into the exact same flag as a
     diagnosed injury.
   - [rules.ts:744-748](app/src/engine/rules.ts:744) — that `painFlag` (as `isPain`) sets
     `clinicalFlagActive = true`, **restricts Running**, and caps `maxAllowableTier`. Two days
     of sneezing gets the same modality restriction and tier cap as a torn muscle or the flu.
   - [healthAnomaly.ts:445-446](app/src/engine/healthAnomaly.ts:445) — any `symptoms.present`
     marks today's physiological anomaly (elevated RHR/suppressed HRV, etc.) as "explained by
     illness," which pollutes the HA6 evidence dataset if the real cause was pollen, not a
     virus.
   - The after-the-fact anomaly explanation flow (`HEALTH_ANOMALY_OUTCOME_EXPLANATIONS` in
     [healthAnomalyOutcome.ts:1-12](app/src/engine/healthAnomalyOutcome.ts:1)) offers 10 causes
     — `illness_symptoms, hard_training_recovery, poor_sleep, alcohol, travel_jetlag, stress,
     heat_dehydration, vaccination_medication, nothing_obvious, other_not_sure` — again no
     allergy option, forcing either a false `illness_symptoms` label or a signal-losing
     `other_not_sure`.

3. **Same gap in the athlete-decision-feedback vocabulary.** `ModificationReason` in
   [feedbackModels.ts:12-18](app/src/feedback/feedbackModels.ts:12) (used when logging why you
   scaled down/rejected a recommendation) has `illness_symptoms` and `muscle_joint_pain` but no
   allergy option either. Independent subsystem, same root cause.

## 2. Two phases — a vocabulary fix, and an optional behavior fix

**Phase 1 (recommended, low risk): let you say what's happening.** Add the missing symptom
types and an allergy cause option everywhere the vocabulary is enumerated. Zero change to how
the engine reacts — `illnessSymptoms: true` still triggers today's clinical-flag/Running-
restriction path exactly as now. This alone unblocks logging.

**Phase 2 (optional — needs your explicit go-ahead, not bundled by default): stop treating mild
hay fever like an injury.** Use the new cause/severity detail to soften the
`painFlag`/`clinicalFlagActive` gate specifically for mild, purely-upper-respiratory,
allergy-attributed days. This changes actual recommendation output, so it needs a product
decision and a simulation baseline diff, not just a data-model add. See §5.

I'd suggest shipping Phase 1 now regardless of what you decide on Phase 2 — it's what's
actually blocking you today.

## 3. Phase 1 — file-by-file

| # | File | Change |
|---|------|--------|
| 1 | [app/src/engine/healthAnomalyModels.ts](app/src/engine/healthAnomalyModels.ts:40) | Add `'sneezing'`, `'runny_nose'` to the `HealthSymptomType` union. |
| 2 | [app/src/engine/healthContextValidation.ts](app/src/engine/healthContextValidation.ts:19) | Add the same two values to `HEALTH_SYMPTOM_TYPES`. The max-length check at line 135 (`raw.types.length > HEALTH_SYMPTOM_TYPES.length`) is already derived from this array's length, so no separate cap to update here. |
| 3 | [app/firestore.rules](app/firestore.rules:285) | `hasValidHealthSymptoms.types.hasOnly([...])` — add `'sneezing'`, `'runny_nose'`; bump the hardcoded `symptoms.types.size() <= 8` to `<= 10`. Also extend the `data.explanation in [...]` enum at line ~1344 with the new cause value (see row 5). |
| 4 | [app/src/engine/healthAnomalyOutcome.ts](app/src/engine/healthAnomalyOutcome.ts:1) | Add `'allergy_or_hay_fever'` to `HEALTH_ANOMALY_OUTCOME_EXPLANATIONS`. |
| 5 | [app/src/components/checkin/HealthContextSection.tsx](app/src/components/checkin/HealthContextSection.tsx:57) | Add `{ value: 'sneezing', label: 'Sneezing' }` and `{ value: 'runny_nose', label: 'Runny nose' }` to `SYMPTOM_TYPES`. Keep "Congestion" — the three together describe hay fever precisely (stuffy vs. runny vs. sneeze are genuinely distinct and can occur independently). |
| 6 | [app/src/components/HealthAnomalyFollowupCard.tsx](app/src/components/HealthAnomalyFollowupCard.tsx:17) | Add `allergy_or_hay_fever: 'Seasonal allergy / hay fever'` to `EXPLANATION_LABELS`. Because this is a `Record<HealthAnomalyOutcomeExplanation, string>` over the exact union, TypeScript will hard-fail `npm run check` if this is forgotten once row 4 lands — a free safety net, not extra work to verify separately. |
| 7 (optional, separate subsystem) | [app/src/feedback/feedbackModels.ts](app/src/feedback/feedbackModels.ts:12) + [feedbackValidation.ts](app/src/feedback/feedbackValidation.ts:29) | Add `'allergy_symptoms'` to `ModificationReason` + `VALID_REASONS`, so "I scaled this down because of allergies" doesn't have to misreport as `illness_symptoms`. Independent of rows 1-6; can ship in the same PR or later. |

### Naming to confirm before I implement
- Explanation value: `allergy_or_hay_fever` vs. `seasonal_allergy` vs. `allergies` — I lean
  toward `allergy_or_hay_fever` to match the existing style (`heat_dehydration`,
  `vaccination_medication` are already compound).
- Whether to keep `sneezing`/`runny_nose` as two separate types (my preference, consistent with
  the existing fine-grained split of `cough`/`sore_throat`/`congestion` rather than one combined
  `rhinitis` type) or merge them.

### Tests to add/update
- `healthContextDefaults.test.ts`, `healthContextContract.test.ts`,
  `checkinHealthContext.test.ts` — new types round-trip through
  `normalizeHealthContext`/the parser.
- `app/src/emulator/healthContextRules.emulator.test.ts` — accept a doc with
  `types: ['sneezing','runny_nose']`; keep the existing over-length rejection case correct
  against the new cap.
- `app/src/emulator/healthAnomalyOutcomeRules.emulator.test.ts` — accept
  `explanation: 'allergy_or_hay_fever'`.
- `healthAnomalyOutcome.test.ts` — any test iterating `HEALTH_ANOMALY_OUTCOME_EXPLANATIONS`
  picks the new value up automatically; add one explicit case.
- `HealthAnomalyFollowupCard.test.tsx` — label rendering for the new option.
- `decisionInputs.test.ts` / `checkinService.test.ts` — parser round-trip for the two new
  symptom types.
- `wellnessLanguageAudit.test.ts` — re-run as-is to confirm the new copy doesn't trip the
  no-diagnostic-language checks (it audits existing rationale/label strings; new UI-only labels
  should already comply if phrased as self-report, e.g. avoid asserting anything the user didn't
  say).
- If row 7 is included: `feedbackValidation.test.ts` for the new `ModificationReason`.
- New cross-check test worth adding: assert `firestore.rules`' hardcoded symptom-type list/size
  and explanation enum stay in sync with `HEALTH_SYMPTOM_TYPES` /
  `HEALTH_ANOMALY_OUTCOME_EXPLANATIONS` — rules can't import TS constants, so this pairing is a
  manual-sync risk today (nothing currently catches drift between them the way
  `decisionJournal.test.ts` guards `SHADOW_VERDICTS` against `externalSession.ts`). A simple
  test that reads `firestore.rules` as text and regex-extracts the enum list, then diffs it
  against the TS constant, would close this permanently rather than just for this change.

### Rollout checklist (Phase 1)
```bash
cd app && npm run check        # TS/ESLint/Vitest/workout catalog
cd app && npm run test:rules   # Firestore emulator rules tests — mandatory, firestore.rules changed
```
Then `make check` before opening a PR per repo convention.

## 4. What Phase 1 deliberately does *not* change

- `DailySubjectiveCheckin.illnessSymptoms` semantics — still the single top-level safety gate,
  unchanged.
- Any recommendation/engine behavior — `rules.ts`, `adapters.ts` untouched in Phase 1.
- No retroactive fix for the 2 days already passed — this only unblocks logging from today
  onward. Backfilling those two days isn't proposed here; say if you want it and I'll size it
  separately (it'd mean writing historical `daily_subjective_checkins` docs by hand for
  yesterday and the day before, which is a data-integrity call worth its own confirmation, not
  a side effect of this feature).

## 5. Phase 2 (optional) — cause-aware gating, only if you want it

The real behavioral complaint underneath the missing fields: right now, ticking
"illness symptoms" for 2 days of mild sneezing gets you the *same* Running restriction and tier
cap as a flu or an injury. If you want that softened specifically for mild,
allergy-attributed, purely-upper-respiratory days:

1. Add `suspectedCause?: 'infectious' | 'allergy' | 'unsure' | null` to `HealthSymptomsCheckin`
   ([healthAnomalyModels.ts:32](app/src/engine/healthAnomalyModels.ts:32)), threaded through
   `healthContextValidation.ts`, `firestore.rules`, and a third chip row in
   `HealthContextSection.tsx` (shown once symptoms are present).
2. In [adapters.ts:152](app/src/engine/adapters.ts:152), change `painFlag` to fold in
   `illnessSymptoms` only when NOT (`suspectedCause === 'allergy'` AND `severity !== 'severe'`
   AND no `fever_or_chills`/`gastrointestinal`/`unusual_fatigue` type reported). Keep
   `painOrInjury` unconditional — that boolean is untouched either way. Doing the judgment call
   here, in the adapter, rather than in `rules.ts`, keeps `evaluateEnvelopes`'s
   `isPain = readiness.subjective.painFlag` contract exactly as simple as it is today.
3. Decide (this is the actual product call, not an engineering one): should an
   allergy-explained physiological anomaly still count as "explained" in `healthAnomaly.ts:445`?
   Probably yes — allergies genuinely can elevate RHR/suppress HRV — but you may want the HA6
   *evidence label* to record cause separately from the real-time *state machine* treatment, so
   future model tuning can tell allergy-explained days from virus-explained days even though
   both currently short-circuit to "explained."
4. Tests: `rules.test.ts`, `adapters.test.ts`, `healthAnomaly.test.ts`,
   `wellnessLanguageAudit.test.ts` (new rationale copy must stay self-reported, not diagnostic —
   e.g. "You're flagging allergy symptoms today" not "You have allergies").
5. Because this changes recommendation output for a real subset of scenarios, run
   `npm run simulate:scenarios && npm run simulate:diff` and
   `node scripts/check-policy-drift.mjs <base-sha>` before merging — this is exactly the kind of
   policy drift those scripts exist to catch.

**Why I'm not just building this by default:** under-restricting someone whose "probably
allergies" is actually early-stage flu is the real failure mode here, and it's a judgment call
about how much slack to give, not something to bake in opportunistically alongside a vocabulary
fix. If you want Phase 2, say so and I'll turn §5 into the same level of file-by-file detail as
§3 before touching code.

## 6. Suggested sequencing

1. Confirm naming (§3) and whether row 7 (feedback vocabulary) is in scope.
2. Implement Phase 1 in this worktree, on `feat/subjective-symptom-reporting`.
3. `npm run check` + `npm run test:rules`, fix any fallout.
4. Decide on Phase 2 separately, as its own follow-up if wanted.
