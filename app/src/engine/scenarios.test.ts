import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runAllScenarios, runScenario, type ScenarioResult } from './simulation/analyze';

/**
 * Regression coverage for the recommendation engine across sport/event types, built on
 * the shared scenario list in `simulation/scenarios.ts` -- the same list
 * `scripts/simulate-scenarios.ts` uses to generate the analysis report, so there is one
 * source of truth, not a parallel list duplicated between coverage and analysis.
 *
 * Two layers:
 * 1. `describe.each` cross-scenario invariants every scenario must satisfy, regardless of
 *    sport -- the actual coverage multiplier, since a scenario added later to SCENARIOS
 *    automatically gets this for free.
 * 2. Per-scenario `describe` blocks for assertions specific to that sport, including one
 *    scenario (`strength_meet_powerlifting_B`) that deliberately documents a known,
 *    unfixed engine limitation rather than a passing ideal -- so a future change to that
 *    behavior has to touch this test on purpose, not silently drift.
 */

const results = new Map<string, ScenarioResult>();
async function getResult(scenarioId: string): Promise<ScenarioResult> {
    if (results.has(scenarioId)) return results.get(scenarioId)!;
    const scenario = SCENARIOS.find(s => s.id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario id: ${scenarioId}`);
    const result = await runScenario(scenario);
    results.set(scenarioId, result);
    return result;
}

describe.each(SCENARIOS)('cross-scenario invariants: $label', (scenario) => {
    it('never violates an equipment or injury constraint', async () => {
        const result = await getResult(scenario.id);
        expect(result.constraintViolations).toEqual([]);
    });

    it('includes at least one rest or recovery day across the simulated horizon', async () => {
        const result = await getResult(scenario.id);
        expect(result.restOrRecoveryDayCount).toBeGreaterThan(0);
    });

    it('produces the expected number of days with no crash', async () => {
        const result = await getResult(scenario.id);
        expect(result.totalDays).toBe(scenario.weeks * 7);
    });
});

describe('cycling_gran_fondo_A -- baseline, already-covered sport', () => {
    it('cycling dominates the modality distribution', async () => {
        const result = await getResult('cycling_gran_fondo_A');
        const cyclingCount = result.modalityDistribution.Cycling ?? 0;
        expect(cyclingCount).toBeGreaterThan(result.totalDays * 0.3);
    });

    it('does not manufacture a surge_repeatability objective for a low-surge event', async () => {
        const result = await getResult('cycling_gran_fondo_A');
        expect(result.objectiveResolution.map(o => o.key)).not.toContain('surge_repeatability');
    });

    it('derives and completes a protected cycling race-specific objective from high durability demand', async () => {
        const result = await getResult('cycling_gran_fondo_A');
        expect(result.objectiveResolution).toContainEqual(expect.objectContaining({
            key: 'race_specific_endurance', timesGenerated: 4, timesResolved: 4,
        }));
        expect(result.objectiveCredits.filter(credit => credit.objectiveKey === 'race_specific_endurance')).toHaveLength(4);
    });
});

describe('cycling_criterium_A -- qualification and anchor stress test', () => {
    it('generates and resolves the cycling-scoped surge objective in every chained week', async () => {
        const result = await getResult('cycling_criterium_A');
        const surge = result.objectiveResolution.find(o => o.key === 'surge_repeatability');
        expect(surge).toMatchObject({ timesGenerated: 4, timesResolved: 4 });
    });

    it('distinguishes a missed nominated date from a missed weekly event-specific exposure', async () => {
        // The gate prevents broad/non-cycling work from resolving surge_repeatability;
        // it deliberately does not change optimizer ranking policy. In the calibrated
        // scenario, Bike VO2 Intervals can still legitimately outrank the anchor.
        const result = await getResult('cycling_criterium_A');
        const nominated = result.anchorWeeks.filter(w => w.eventSpecificAnchorDate).length;
        const hits = result.anchorWeeks.filter(w => w.eventSpecificAnchorHit).length;
        const fulfilled = result.anchorWeeks.filter(w => w.eventSpecificAnchorFulfilled).length;
        expect(nominated).toBe(4);
        expect(hits).toBe(0);
        expect(fulfilled).toBe(4);
    });
});

describe('running_marathon_A -- no cycling equipment owned', () => {
    it('never picks a template requiring indoor_bike', async () => {
        // Belt-and-suspenders on top of the generic equipment-violation invariant above --
        // asserts the SPECIFIC gap this scenario exists to cover, not just "no violations".
        const result = await getResult('running_marathon_A');
        expect(result.modalityDistribution.Cycling ?? 0).toBe(0);
    });

    it('running is real training, not just an occasional token appearance', async () => {
        const result = await getResult('running_marathon_A');
        expect(result.modalityDistribution.Running ?? 0).toBeGreaterThan(result.totalDays * 0.15);
    });
});

describe('triathlon_olympic_A -- regression for the category-substring bug', () => {
    it('both Cycling and Running receive real representation, not just one modality', async () => {
        const result = await getResult('triathlon_olympic_A');
        expect(result.modalityDistribution.Cycling ?? 0).toBeGreaterThan(0);
        expect(result.modalityDistribution.Running ?? 0).toBeGreaterThan(0);
    });
});

describe('strength_meet_powerlifting_B -- documents a known, unfixed limitation', () => {
    it('the strength_maintenance objective is generated every week but never resolves more than its fixed 1-exposure ceiling', async () => {
        // NOT an assertion of ideal behavior. generateWeeklyObjectives (microcycle.ts)
        // always creates exactly one strength_maintenance objective per rolling window
        // regardless of how strength-dominant the demand profile is -- a real powerlifting
        // block should call for materially more weekly strength volume than this. Recorded
        // here so a future fix to that scaling has to update this test deliberately.
        const result = await getResult('strength_meet_powerlifting_B');
        const strength = result.objectiveResolution.find(o => o.key === 'strength_maintenance');
        expect(strength).toBeDefined();
        expect(strength!.timesGenerated).toBe(4); // once every simulated week
        // Ceiling, not a target: the objective can be resolved at most once per week no
        // matter how strength-focused the athlete's goal is.
        expect(strength!.timesResolved).toBeLessThanOrEqual(strength!.timesGenerated);
    });

    it('strength appears meaningfully but nowhere near dominant -- the same ceiling limits actual pick frequency, not just objective counting', async () => {
        // Documents the real, measured consequence of the ceiling above: with only one
        // strength_maintenance objective ever unresolved per week, the optimizer has
        // little reason to pick Strength again once that objective resolves, even with an
        // explicit preference and a demand profile that's almost entirely neuromuscular.
        const result = await getResult('strength_meet_powerlifting_B');
        const strengthCount = result.modalityDistribution.Strength ?? 0;
        expect(strengthCount).toBeGreaterThan(0);
        expect(strengthCount).toBeLessThanOrEqual(result.totalDays * 0.65);
    });
});

describe('field_sport_general_target -- no dedicated event category exists for field sports', () => {
    it('documents that Field Maintenance is NOT currently reachable on preference alone under strict lexicographic ordering', async () => {
        // NOT an assertion of ideal behavior -- the opposite of what this test asserted
        // before the Phase 3 review fix pass. Preference is Level 6 (soft nudge) in
        // rankCandidates' lexicographic ordering; it can only decide among candidates
        // that are ALREADY tied on Level 1 (objective benefit, within BENEFIT_TIE_BAND).
        // Field's own stimulus profile only weakly overlaps the generic objectives this
        // no-event scenario generates, so its benefit score sits far below a genuinely
        // matching Endurance/Strength candidate's on almost every day -- preference alone
        // can never close that gap, no matter how large the multiplier. It used to
        // "work" only as a side effect of a benefit-floor bug (see calculateStimulusBenefit's
        // Level 4 fix in the Phase 3 review) that occasionally let a weak match's score
        // collapse to the exact same value as a non-matching candidate's, letting cost/
        // preference decide a tie that shouldn't have been a fair fight. Recorded here so
        // a real fix (e.g. a per-modality minimum-exposure floor) has to touch this test
        // on purpose, not silently regress further.
        const result = await getResult('field_sport_general_target');
        expect(result.modalityDistribution.Field ?? 0).toBe(0);
    });

    it('reports when the Field preference has no observable effect against the matched Base baseline', async () => {
        const report = await runAllScenarios();
        expect(report.preferenceSensitivity).toContainEqual(expect.objectContaining({
            preferredModality: 'Field',
            changedPlannedDays: 0,
        }));
    });
});

describe('scenario quality diagnostics', () => {
    it('records every objective-credit source, including today and tomorrow before the forecast strip', async () => {
        const result = await getResult('cycling_criterium_A');
        expect(result.objectiveCredits).toContainEqual(expect.objectContaining({
            objectiveKey: 'threshold_quality',
            modality: 'Cycling',
        }));
        expect(result.objectiveCredits).toContainEqual(expect.objectContaining({
            objectiveKey: 'surge_repeatability',
            modality: 'Cycling',
        }));
        expect(result.qualityWarnings.some(warning => warning.includes('without a projected credit source'))).toBe(false);
    });

    it('runs matched fresh and stressed readiness trajectories instead of relying on one deterministic chain', async () => {
        const report = await runAllScenarios();
        expect(report.readinessSensitivity).toHaveLength(2);
        expect(report.readinessSensitivity.map(result => result.trajectory)).toEqual(['fresh', 'stressed']);
    });

    it('documents that the stressed trajectory currently trains MORE and rests LESS than the baseline (known gap, not the ideal)', async () => {
        // NOT an assertion of ideal behavior -- the opposite of what a stressed-readiness
        // trajectory should do. Root cause: runScenario samples readinessForWeek only
        // ONCE per week (Monday) and projects the other 6 days via
        // generateWeekAheadPlanWithIntent's forecast, whose internalResponseStrain
        // correctly decays across projected days per ADR-0008 (a real dashboard's "today"
        // reading fading as the forecast walks away from it -- see the review fix in
        // planner.ts's generateWeekAheadPlan). That assumption doesn't hold for a scenario
        // that re-asserts the SAME sustained-stress readiness every week without ever
        // re-measuring it mid-week: by the back half of each week the decayed signal no
        // longer reflects the (unchanged) stressed reality, so harder/riskier work
        // re-opens up that a real continuously-stressed user's actual day-by-day
        // dashboard (each day gets its own fresh, still-stressed reading) would keep
        // closed. Fixing this for real means giving the simulation harness a per-day
        // readiness re-evaluation path instead of a once-a-week snapshot + 6-day
        // forecast -- a materially larger change than this fix pass, tracked here so it
        // isn't silently lost and any further regression has to touch this deliberately.
        const report = await runAllScenarios();
        const stressed = report.readinessSensitivity.find(r => r.trajectory === 'stressed');
        expect(stressed).toBeDefined();
        expect(stressed!.restOrRecoveryDayDelta).toBeLessThan(0); // fewer rest days than baseline -- backwards
        expect(stressed!.raceSpecificExposureDelta).toBeGreaterThan(0); // MORE race-specific work -- backwards
    });

    it('surfaces coach-quality failures separately from hard constraint violations', async () => {
        // Anchor-miss count dropped from 4/4 to 2/4 nominated weeks as a direct (and
        // welcome) side effect of the review-fix pass's transitive benefit-tier sort --
        // more reliable tie-breaking means the ranking more often actually lands on the
        // day the weekly-anchor pre-pass nominated. Not a weakened assertion: the
        // mechanism under test here (qualityWarnings surfacing a real, non-fatal coaching
        // gap) is unchanged, only the concrete count improved.
        const result = await getResult('triathlon_olympic_A');
        expect(result.constraintViolations).toEqual([]);
        expect(result.qualityWarnings).toContain('Triathlon capability is partial: the engine has no Swimming modality or swim objective/catalog support.');
        expect(result.qualityWarnings).toContain('Event-specific anchor missed in 2 nominated week(s).');
    });
});

describe('no_event_base_phase -- control baseline', () => {
    it('never resolves a surge_repeatability objective (Base-phase vo2Max/repeatedSurges demand sits at 0.3, below the 0.6 gate)', async () => {
        // threshold_quality DOES still generate in pure Base phase -- DEFAULT_BASE_DEMAND's
        // thresholdPower sits exactly at 0.5, which meets (not just approaches) that
        // objective's own >= 0.5 gate. Confirmed by reading periodization.ts/microcycle.ts;
        // only surge_repeatability's higher 0.6 gate is never crossed unblended.
        const result = await getResult('no_event_base_phase');
        const keys = result.objectiveResolution.map(o => o.key);
        expect(keys).not.toContain('surge_repeatability');
        expect(keys).toContain('threshold_quality');
        expect(keys).toContain('zone2_aerobic');
        expect(keys).toContain('strength_maintenance');
    });
});
