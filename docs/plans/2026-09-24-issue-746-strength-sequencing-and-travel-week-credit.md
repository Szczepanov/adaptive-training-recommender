# Issue #746 — Day-2 strength after lower-body strain, and Week-2 strength under travel

| | |
|---|---|
| **Status** | `Implemented` — D1–D4 delivered in the issue #746 implementation PR |
| **Source** | [issue #746](https://github.com/Szczepanov/adaptive-training-recommender/issues/746) (AI Plan Judge, three cases at 8.8/10) |
| **Blocked by** | None; WP3.0 evidence is recorded in the linked analysis below |
| **Unlocks** | Nothing downstream; closes #746 |
| **Baseline** | `main` @ `324e2694`, delivered under `POLICY_VERSION = 2026-09-strength-deferral-forecast-credit-aging-v1` |

## 1. Verdict on the issue

Both findings reproduced as reported on the baseline (`324e2694`) and are now resolved by WP1, WP2, and WP3. **Neither mechanism the issue originally proposed was the one that produced them,**
and two of its premises did not hold:

1. The proposed "increase the Day-2 `lowerBody` tie-breaker penalty" **cannot** change Day 2. `str_full_03` wins
   Day 2 on the **coverage-need tier** (a lexicographic key ranked above utility), not on a tie-breaker. The
   ranking audit reports `utilityWinnerBlockedByCoverageTier: true`: `end_easy_04` has utility 1.16 against
   `str_full_03`'s 0.44.
2. The proposed "swap Day 2 and Day 3" is **illegal under a registered rule** in both Part-1 cases. With the
   criterium on Day 4, `str_full_03` on Day 3 violates `spacing.strength_key_cycling_adjacency`
   (`ANCHOR_PROTECTION_VIOLATION`; `Full-body Strength` counts as heavy lower-body by category). Day 2 is the
   *only* legal Week-1 slot for strength in those plans. The premise "without losing any weekly objective
   credit" therefore does not hold for `judge_subj_soreness` (see §4, E1+E2).
3. The Week-2 travel gap does **not** involve `planningOverlays.ts` or a travel-overlay reservation. The corpus
   case is a static context patch applied to all 14 days (its "3-day" label is wrong). The actual causes
   are a **forecast credit-accounting defect** plus a **coverage-set gap**. When the athlete re-plans day by
   day (the production path), the engine already schedules `str_full_02` on Day 10 and Day 12 of the same
   scenario, with a maximum same-template streak of 3.

## 2. Reproduction (baseline, `npm run build:plan-judge-corpus`)

| Case | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---|---|---|---|---|---|---|
| `judge_subj_neutral` | end_easy_01 | **str_full_03** | end_easy_04 | end_crit_surges_01 | mob_01 | end_hard_02 | rest_01 |
| `judge_subj_soreness` (soreness 8) | rest_01 | **str_full_03** | end_easy_01 | end_crit_surges_01 | end_easy_04 | end_hard_02 | rest_01 |
| `judge_concurrent_heavy_lower` | end_easy_01 | **str_full_03** | rest_01 | end_crit_surges_01 | end_easy_04 | end_hard_02 | rest_01 |

`judge_mode_travel_overlay`, Week 2 (D8–D14): `end_easy_05` ×6, then `mob_travel_flow_01`. Counting Day 7
there are 7 consecutive `end_easy_05` days, and Week 2 has no strength and no rest day. The analyzer already
emits the quality warning `Same-template streak reached 7 days.`

## 3. Root-cause analysis

### 3.1 Day 2 is not chosen by the planner

In the `weekly_forecast` simulation (`simulation/analyze.ts` `runScenario`), Day 1 is
`evaluateTrainingWithIntent` and Day 2 is `evaluateNextDayPlanWithIntent(...).branches.yellow`. Only Days 3–7
come from `planner.ts` `generateWeekAheadPlan`, and that function treats Days 1–2 as fixed seeds
(`seedDates` are excluded from the weekly-role allocator). Day 2 therefore gets no allocator look-ahead,
no viability check (`preservesAllocation`), and no anchor awareness. `rules.ts` never passes `anchorRole` or
`adjacentToAnchor` into the ranking.

### 3.2 Strength wins Day 2 by coverage tier, and dose reduction is asymmetric

`rankCandidates` sorts lexicographically: coverage-need tier → recovery-preference tier → benefit tier →
utility. The yellow branch is a `modify` day:

- `str_full_03` still maps to the required `primary_strength` role at its reduced dose. `coverageNeedTierForTemplate`
  returns tier 1.
- The Zone 2 ride is shortened by `resolveTimeCapDoseAdjustment`. `coverageKeysForExposure` then withholds
  `aerobic_volume`, because `hasRequiredAerobicDose` fails, so the ride falls to tier 3.

`aerobic_volume` has a dose floor. `primary_strength` has none. So **on every `modify` day with an unmet
primary-strength role, strength wins over everything that is not a tier-0/1 role**. That covers all three
Day-2 cases, including the neutral one.

### 3.3 The soreness case: Day 2 cannot see Day 1's check-in

`buildNextDayScenarios` builds the yellow branch from fixed synthetic values (soreness 6, fatigue 6, …).
Today's check-in is discarded. In `judge_subj_soreness`, Day 2's inputs are therefore identical to the
neutral case and produce the same pick.

Days 3+ *do* carry today's check-in. `generateWeekAheadPlan` seeds `internalStrain` from today's readiness,
and `projectFatigueForRankingDate` decays it with `decayFatigue` (lower-body half-life 48 h). The soreness
floor of 0.88 still contributes 0.44 on Day 3. **Day 2 is the only forecast day that forgets today's measured
internal strain.** That is an internal inconsistency, not a physiology claim.

Heavy-lower Day 2 differs: combined lower-body fatigue is 0.637, from external residual load. That value is
real and visible on Day 2, but only the utility cost penalty (`calculateFatigueCostPenalty`) consumes it, and
utility is subordinate to the coverage tier.

### 3.4 Why Day 2 is the only legal Week-1 strength slot

Nominated anchors are event-specific on 08-09 (D3) and quality on 08-11 (D5). With `str_full_03` fixed on D2,
the criterium cannot sit on D3 (0–1-day adjacency), so it lands on D4 ("off the nominated anchor date"
warning) and VO2 lands on D6. After that, D3, D5 and D7 are each adjacent to key cycling work. The judge's
swap would move strength to D3, directly before the D4 criterium. So the current D2 strength *already*
displaces the nominated D3 anchor, and moving it would require re-planning the anchors, not a swap.

### 3.5 Travel Week 2: two mechanisms

1. **Coverage-set gap.** In `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`, `primary_strength` lists only
   `strength_full_body_maintenance_01` (engine `str_full_03`, requires `free_weights`). Under a
   no-equipment patch the required role is unfulfillable. The bodyweight identity `strength_bodyweight_full_body_01`
   (`str_full_02`) is listed only under optional `compact_strength`. `EVERGREEN_SESSION_COVERAGE` already
   includes it in `primary_strength`, explicitly as "the zero-equipment floor".
2. **Forecast credit never expires (root cause of the streak).** `prepareWeekAheadPlanSeed` and
   `resolveTrainingIntent` build the week's microcycle from completed exposures in `[today−7, today)`.
   `reconcileObjectivesForDate` then carries that completed credit unchanged across the whole forecast,
   through `creditMemory` and by key. At the Week-2 start (08-14), `strength_maintenance` shows
   `completedCredit 1/1` from Week-1's 08-09/08-11 sessions. It stays "resolved" through 08-20, although
   the daily path's rolling window `[D−7, D)` expires it by 08-19. With strength resolved and a focus event,
   `rankCandidates` applies the ×0.20 strength multiplier. The only same-template repetition control,
   `usedYesterday` ×0.2, acts on **utility**, below the benefit tier. So it is inert when the repeated template
   is alone in its benefit tier, as `end_easy_05` is here.

Rolling-daily execution of the same scenario (daily re-plan, performed = recommended):
`mob_01 | str_full_02 | end_easy_05 | str_full_02 | end_easy_05 | mob_travel_flow_01 | end_easy_05 | end_easy_05 | end_easy_05 | str_full_02 | end_easy_05 | str_full_02 | end_easy_05 | mob_travel_flow_01`.
**The streak is an artefact of the forecast diverging from the engine's own daily behaviour.**

## 4. Prototype evidence

Throwaway, env-gated patches, run against the full 96-case judge corpus and then reverted. "Footprint" means
cases whose 14-day plan changed.

| Exp. | Change | Target outcome | Footprint | Objective resolution / load |
|---|---|---|---|---|
| E1 | Primary-strength candidate in a heavy-lower strength category → tier 3 when combined `lowerBody` ≥ 0.6 | heavy-lower: `end_easy_01 \| mob_01 \| end_crit_surges_01 \| end_easy_04 \| str_full_03 \| rest_01 \| end_hard_02`. Week-1 strength kept (D5); forced D3 rest gone; criterium back on the nominated anchor. Soreness unchanged. | 47/96 (mostly Week-2 Day 2 `str_full_03`→`str_upper_01` with Week-2 reshuffle) | no case resolves fewer objectives; hard sessions 174→170; systemic 453.9→433.8; rest/mobility days 346→377 |
| E1+E2 | + yellow/red branch internal strain floored at today's strain decayed 24 h | soreness: D2 `end_easy_01`, D3 `end_easy_01`. **Week-1 strength lost** (no legal slot) | +3 cases vs E1 (`judge_subj_soreness`, `judge_conflict_sore_legs_great_hrv`, `judge_work_exhausting_extended`) | unchanged vs E1 |
| E3 | Add `strength_bodyweight_full_body_01` to event `primary_strength` (ungated) | travel Week 2 gains `str_full_02` only on D14; streak 6; Week 1 gets 3 bodyweight sessions | 4/96, incl. **loaded→bodyweight swap with weights available** (`judge_pref_45min`) | one case resolves fewer objectives |
| E4 | Forecast ages completed objective credit to each forecast date's `[D−7, today)` window | travel Week 2: `… end_easy_05 ×4 \| str_full_02 \| rest_01 \| str_full_02 \| rest_01`; streak 4 | 40/96 (Week-2 D12–D14) | hard sessions 174→140; the harness `objectiveResolution` tally is no longer comparable (see WP3.0) |

Reading: E1 is a clean fix for the heavy-lower case, with no loss of objective resolution, but its footprint is
large. E2 is needed only for the soreness case, and it costs Week-1 strength there. E3 alone is blunt and does
not fix the streak. E4 fixes the travel week the way the daily path does, but it shifts many Week-2 forecasts.
For example, neutral Week-2 D14 VO2 → easy, because re-earning expired Zone 2 credit on D12/D13 pushes D14
projected peak fatigue to 0.617, which is `modify`. It needs its own design pass before shipping.

## 5. Recommended design

Split into two PRs. Each bumps `POLICY_VERSION` (I5), because each can change a recommendation.

### WP1 — Residual lower-body deferral of primary strength (Part 1, core)

In `optimizer.ts` `rankCandidates`, a candidate whose authored coverage tier is 0/1 **only** because it
advances `primary_strength` is demoted to tier 3 ("no role urgency today"). This applies when:

- its category is in `HEAVY_LOWER_BODY_STRENGTH_CATEGORIES`, and
- the ranking date's `fatigueState.combinedFatigue.lowerBody` ≥ a new constant
  `RESIDUAL_LOWER_BODY_STRENGTH_DEFERRAL_THRESHOLD`. The proposed value is 0.6, deliberately equal to
  `PROJECTED_FATIGUE_MODIFY_THRESHOLD`; decision D4.

Properties:

- It never grants or removes exact coverage credit. The role stays open for a later feasible date, and
  `weeklyAllocation.ts` stays authoritative on reserved dates (`exactReserved` filtering in
  `generateWeekAheadPlan` is untouched).
- `Upper-body Strength` is unaffected, because it is not in the heavy-lower categories.
- It applies uniformly to Day 1, Day 2 and unreserved forecast days, because they all share `rankCandidates`.
- Add a rationale suffix, "(Primary strength deferred: residual lower-body fatigue …)", and include the
  deferral in `computeRankingCounterfactual` output via the existing tier fields.

### WP2 — Next-day branch carries today's measured internal strain (Part 1, soreness)

In `rules.ts` `buildNextDayScenarios`, compute `decayFatigue(computeInternalResponseStrain(todayReadiness), 24)`.
Thread it as an explicit, typed field on `NextDayScenario`, not a hidden readiness property, into
`evaluateTrainingWithIntent`. `trainingIntent.ts` `resolveTrainingIntent` then uses the element-wise max of the
branch's own internal strain and the carried value.

- It applies to the **yellow and red** branches only (decision D2). Green remains the explicit "fully recovered
  tomorrow" hypothetical.
- It does not apply on the single-plan path, which already substitutes its own recovery readiness.
- Rationale to register: this is consistency with how Days 3+ already treat today's strain
  (`projectFatigueForRankingDate`), using the already-registered half-lives
  (`fatigue.dimension_half_lives`). It introduces no new physiological constant.

WP1+WP2 together satisfy the Part-1 acceptance criterion for both cases. In the soreness case, Week-1 primary
strength is then **honestly missed**. The allocation report records `missed`, and strength resumes on D9/D13.
Decision D1 covers whether to instead preserve resistance exposure with the upper/trunk fallback.

### WP3 — Forecast objective-credit aging (Part 2, root cause)

**WP3.0 — design spike (required before code).**

- Define forecast objective windows: for forecast date D, completed credit counts only exposures in
  `[D−7, today)`; projected credit from forecast picks is unchanged.
- Decide how plan-derived objectives with block-scoped `windowStart`/`windowEnd` interact with this.
- Add a **forecast/daily parity** diagnostic to `simulation/analyze.ts`: per-date objective state and picks,
  weekly forecast vs rolling-daily execution of the same scenario. Measure parity before and after E4-style
  aging across the corpus.
- Document that the `objectiveResolution` tally currently counts prior-week completions toward the new week.
- Exit criterion: parity improves and the Week-2 quality-session shifts are explained. If not, fall back to
  **WP3-alt**.

**WP3.1 — implementation.**

- Add `completedExposures` to `WeekAheadPlanSeed`, populated from `intent.history` in
  `generateWeekAheadPlanWithIntent`.
- In `generateWeekAheadPlan`, `evaluateForecastDate` recomputes completed credit per objective after
  `reconcileObjectivesForDate`. Use `buildMicrocycleState` / `creditObjectivesFromStimulus`, the same
  creditor as the daily path, over the aged window. Only ever *lower* completed credit, and recompute
  `completedExposures` with `projectCompatibilityExposures(completed + projected, target)`. (The first E4
  prototype got this wrong and wiped projected credit.)

**WP3-alt (fallback, narrow).**

- Add `strength_bodyweight_full_body_01` to the event set's `primary_strength` as an **availability
  fallback** identity. It counts only on dates where no loaded primary identity is equipment-feasible,
  mirroring `availabilityFallbackRole: 'aerobic_endurance'` on `end_easy_05`.
- This guarantees ≥1 bodyweight strength per rolling week under no-equipment travel, but it does not fix the
  streak mechanism.

### Rejected

| Proposal | Why not |
|---|---|
| Larger `lowerBody` tie-breaker / cost penalty (issue §1) | Utility is below the coverage tier, so it cannot move Day 2 (§3.2) |
| Swap D2/D3 as a rule | Violates `spacing.strength_key_cycling_adjacency` before the D4 criterium (§3.4) |
| Consecutive-template penalty after 3 `end_easy_05` days (issue §2) | Treats a symptom. The existing repetition penalty is inert for a structural reason (§3.5), and production already avoids the streak. A new variety rule would be new decision authority with no evidence behind it |
| Ungated bodyweight primary identity (E3) | Swaps loaded for bodyweight strength when weights exist, and over-doses Week 1 |

## 6. Decisions and chosen route

The issue #746 implementation uses the recommended options: **D1a**, an explicit
Week-1 primary-strength miss in the high-soreness case; **D2**, carried strain in
yellow/red branches only; **D3**, WP3 forecast-credit aging after the WP3.0
[parity spike](../analysis/2026-09-24-issue-746-forecast-credit-parity.md); and
**D4**, the 0.6 combined lower-body threshold. The issue's three acceptance
cases are delivered together in one PR as requested. Optional WP4 remains a
separate design proposal.

The alternatives considered before these decisions were:

- **D1 — Soreness Week-1 strength.** (a) Accept the honest miss (recommended; resistance resumes on D9), or
  (b) add a lower-body-deferral support fallback that gives `upper_body_trunk` identities tier-2 urgency, like
  `symptomCompatibleStrengthSupportPolicy`. Option (b) makes D2 `str_upper_01` instead of the easy spin the judge
  asked for. A third option, (c), is a low-load full-body "flush" as an *active-recovery* choice that earns no
  strength credit. §11 covers it.
- **D2 — Branch carry scope.** Yellow/red only (recommended), or all three branches.
- **D3 — Part 2 route.** WP3 behind the WP3.0 spike (recommended), or ship WP3-alt now and file WP3 as a
  separate issue.
- **D4 — Deferral threshold and signal.** Use 0.6 on combined `lowerBody` (E1: 47/96 footprint). Alternatively,
  evaluate the signal as max(external residual, *carried real* internal strain), excluding the yellow branch's
  synthetic soreness contribution. That may shrink the Week-2 Day-2 reshuffle, but it is untested and must be
  measured before choosing.

## 7. Implementation steps

### PR-A (WP1 + WP2)

1. **Tests first (RED).**
   - `optimizer.test.ts`: tier 1 below the threshold, tier 3 at/above it for `str_full_03`; `str_upper_01`
     unaffected; non-primary strength unaffected; the rationale names the deferral.
   - `rules.test.ts`: yellow/red internal strain ≥ decayed today strain for soreness 8; green unchanged; the
     single-plan path unchanged; no carry when today's strain is lower than the branch's.
   - A planner test: a reserved primary-strength date is unaffected.
2. **Knowledge lineage (I4, ADR-0033).**
   - Two product-policy claims in `optimizerScoringKnowledge.ts` / `loadIntensityRecoveryKnowledge` (or
     `subjectiveReadinessKnowledge.ts` for WP2): `policy.optimizer.residual_lower_body_strength_deferral_v1`
     and `policy.forecast.next_day_internal_strain_carry_v1`.
   - Coverage items in `knowledgeCoverage.ts`: `optimizer.residual_lower_body_strength_deferral` and
     `forecast.next_day_branch_strain_carry`.
   - Pins in `optimizerScoringPolicyAlignment.test.ts` (and the relevant alignment test for WP2). Add the
     claim-ID mapping in `knowledgeCoverage.test.ts`.
3. **Implement (GREEN)** as in §5. Type `NextDayScenario.carriedInternalStrain` explicitly.
4. **Invariants.** Extend `scripts/check-plan-judge-invariants.mjs`: for `judge_concurrent_heavy_lower` and
   `judge_subj_soreness`, D2 is not in `HEAVY_LOWER_BODY_STRENGTH_CATEGORIES` when D3 is Rest or Easy
   Endurance.
5. **Policy and docs.**
   - Bump `POLICY_VERSION` (for example `2026-09-residual-lower-body-strength-deferral-v1`). Verify with
     `node scripts/check-policy-drift.mjs 324e2694`.
   - Update `docs/architecture/recommendation-engine.md`: the coverage tier section and the next-day branches.

### PR-B (WP3.0 → WP3.1, or WP3-alt)

1. Spike: the parity diagnostic plus a written note in `docs/analysis/`, then decide on WP3 vs WP3-alt.
2. Tests:
   - A planner test: Week-2 forecast credit expires by `D−7`, projected credit is preserved, and credit is
     never raised.
   - A regression fixture for the travel week: ≥1 `str_full_02` in D8–D14, max same-template streak < 7 (target ≤ 4).
3. Extend `check-plan-judge-invariants.mjs` for the travel case over all 14 days, not only the first 3. Fix the
   corpus label: "14-day" not "3-day" in `build-plan-judge-corpus.mjs` and `ai-judge/edges.mjs`.
4. Update harness metric docs (`objectiveResolution` semantics). Bump `POLICY_VERSION`.

### Gates (both PRs)

`make check`; `make simulate`; `cd app && npm run simulate:plan-judge`; the policy-drift check;
read `simulate:diff` output (advisory). Refresh baselines only after reviewing the diffs
(`simulate:update-baseline`, `judge:update-baseline`), and record the footprint in the PR.

## 8. Revised acceptance criteria

- [x] `judge_concurrent_heavy_lower`: no heavy-lower strength on D2. Week-1 primary strength is still
      fulfilled (E1 shape: D5).
- [x] `judge_subj_soreness`: no heavy-lower strength on D2. Week-1 primary strength is either an explicit
      `missed` allocation outcome (D1a) or upper/trunk support (D1b). The issue's "no credit lost" is not achievable.
- [x] `judge_mode_travel_overlay`: ≥1 `str_full_02` in D8–D14 and no same-template streak ≥ 7.
      Under WP3, the target is ≤ 4 with a rest day in Week 2.
- [x] No judge case resolves fewer objectives, *or* each decrease is explained by the WP3 tally-semantics
      change.
- [x] `make check`, `make simulate`, `npm run simulate:plan-judge`, and the policy-drift check pass.

## 9. Risks

| Risk | Mitigation |
|---|---|
| WP1 fires on ~half the corpus (normal accumulated `lowerBody` sits near 0.6) and shifts load toward recovery (+31 rest/mobility days) | Review the `make simulate` aggregate bounds; evaluate the D4 signal variant; the prototype showed no loss of objective resolution |
| Chronically high lower-body load could make WP1 defer primary strength repeatedly | The allocator still reserves on feasible dates; add a scenario test with persistent `lowerBody` ≥ 0.6 asserting the role is reserved or reported `missed`, never silently dropped |
| WP2 changes what the athlete sees for tomorrow's yellow/red branches | Branch labels already describe moderate/low readiness; rationale text states that residual strain was carried |
| WP3 changes forecast semantics broadly (E4: 40/96, hard sessions 174→140) | The WP3.0 spike and parity diagnostic come first; WP3-alt is the fallback |

## 10. Related findings (out of scope)

- The next-day and today evaluators are **anchor-blind**: `rules.ts` never passes `anchorRole` or
  `adjacentToAnchor`. So the D2 pick can displace a nominated D3 anchor (§3.4).
- Unfulfillable objectives (race-specific, threshold, surge under a no-bike travel patch) keep
  `unresolvedObjectives` non-empty. That disables `optimizer.recovery_streak_heuristics` for the whole travel week.
- The `fatigue.internal_response_model` coverage text says "systemic is 0.4 subjective fatigue +0.3 HRV +0.3 sleep".
  `computeInternalResponseStrain` actually computes 0.3 fatigue + 0.25 HRV + 0.25 sleep + 0.2 Body Battery.
  This is registry drift that no alignment test catches.

## 11. Addendum — a very-low-volume full-body session under high soreness

**Question.** When soreness is high (≥ 8), should the engine still prescribe a very-low-volume full-body session
to "flush" the soreness, instead of rest or an easy spin?

### Evidence

| Finding | Source | Implication |
|---|---|---|
| Light concentric exercise cut soreness and tenderness by ~40% immediately after the bout. The effect was temporary, with no effect on recovery of strength, range of motion or damage markers | Zainuddin et al. 2006, *Appl Physiol Nutr Metab* (PMID 16604130) | Real, short-lived symptom relief; not faster recovery |
| 10 min of light elastic-band exercise at 48 h relieved soreness about as much as massage | Andersen et al. 2013, *J Strength Cond Res* 27(12) | Light *resistance-type* movement works as acute analgesia |
| Active recovery gave a small-to-large reduction in DOMS; massage was stronger | Dupuy et al. 2018, *Front Physiol* (PMC5932411) | Supports "move gently" over strict rest for symptoms, with modest effect size |
| Active recovery helped jump performance at 24 h only; no clear effect at 48–72 h or on CK; heterogeneity > 75% | Hou, Yin & Qiao 2026, *Healthcare* network meta-analysis | Evidence is weak and short-lived |
| Repeating eccentric work (50% MVC) 2 and 4 days after a damaging bout did not worsen damage or slow recovery | Nosaka & Newton 2002, *J Strength Cond Res* (PMID 11834116) | Light work while sore is tissue-safe |
| Soreness correlates only weakly with damage markers | Nosaka, Newton & Sacco 2002, *Scand J Med Sci Sports* | A soreness score is a poor proxy for tissue state; do not treat it as a damage gauge |
| Joint-position and force sense are impaired for 24–72 h after damage | Knee proprioception after EIMD, *Int J Sports Med* 2010 | Avoid heavy, ballistic or technically demanding loaded lifts; low load is fine |
| Strength is maintained at very low volume only if **intensity (load)** is kept | Spiering et al. 2021, *J Strength Cond Res* 35(5) | A low-load flush is **not** a strength-maintenance dose |
| Lactate clears within ~1 h and does not cause DOMS | Cheung, Hume & Maxwell 2003, *Sports Med* 33:145; PMID 27409551 | "Flush" is only a metaphor; the benefit is pain relief (exercise-induced hypoalgesia), not clearance |
| Severe pain with weakness, dark urine, swelling or fever is not ordinary DOMS | CHAMP exertional-rhabdomyolysis guidance; *Sports Health* clinical review (PMC4065559) | High soreness needs a red-flag caveat, not a workout |

### Conclusion

A light full-body movement session under high soreness is **defensible as active recovery**. It is safe for the
tissue and gives temporary pain relief. It is **not** a way to keep the strength stimulus, and it does not speed
recovery. For the engine, that means:

- It belongs in `Mobility/Recovery`. It may earn `recovery_or_rest` coverage but never `primary_strength` or
  `strength_maintenance` credit (Spiering: maintenance needs load).
- It is admissible on recover-band days. `rules.ts` maps soreness ≥ 8 to `recover`, and the candidate filter
  allows only Rest and Mobility/Recovery there, so a Mobility/Recovery flush is reachable without a new gate.
  Existing `preferredRecoveryStyle` / `recoveryPreferenceTier` logic decides rest vs. flush; add no new ranking
  rule.
- Proposed dose: 15–20 min at RPE ≤ 3, bodyweight or band only. One or two sets of 12–15 controlled, concentric-biased
  reps across squat-to-box, hip hinge, incline push-up, band row and glute bridge, plus 5 min of easy movement.
  No loaded eccentrics, jumps or ballistic work.
- Rationale copy should state "temporary soreness relief; no strength credit". At soreness ≥ 9, it should add a
  red-flag line (weakness, dark urine, swelling, fever → stop and seek medical advice). Clinical copy needs
  the same review as other safety text.

### Related finding

Catalog workouts declare `eligibility.maximumSoreness`: primary full-body strength 6, bodyweight full-body 7,
upper/trunk 8, recovery mobility 9. **No engine code reads it.** `planningCandidate.ts` consumes only
`minimumDaysAfterHardLowerBody`. The authored intent matches this addendum: loaded full-body strength is
inappropriate above soreness 6. Enforcing these ceilings would be a broad change (many quality-cycling workouts
declare 5–6), and the values are unregistered product policy, not physiology (Nosaka 2002). It needs its own
claim, coverage item, alignment test and simulation review. File it separately.

### If adopted (optional WP4)

1. Author a `recovery_full_body_flush_01` workout in `workouts/catalog/recovery.ts` (`maximumSoreness: 9`) and an
   engine template in `templates.ts` (category `Mobility/Recovery`, systemicCost about 0.1, lowerBody about 0.1).
   Map it only to `recovery_or_rest` in both coverage sets.
2. Register an evidence claim (light-exercise analgesia with no recovery acceleration) and a product-policy claim
   (flush is recovery-only with no strength credit), plus a coverage item and an alignment test asserting it
   earns no strength coverage key or strength-objective credit.
3. Tests: admissible at soreness 8 in `recover`; excluded with `painFlag`, illness or red flag; never fulfils
   `primary_strength`.
4. `POLICY_VERSION` bump plus plan-judge and simulation review. Expected footprint: recover-band days of
   athletes with `active` or `mixed` recovery style.
