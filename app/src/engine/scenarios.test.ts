import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario, type ScenarioResult } from './simulation/analyze';

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

    it('never repeats the identical template on 3+ consecutive days within a single week-strip generation', async () => {
        // This is the guarantee anti-stacking (optimizer.ts recentHistory checks) actually
        // provides -- recentHistory is rebuilt fresh from each generateWeekAheadPlan call's
        // own projected days. See maxConsecutiveSameTemplateStreakAcrossWeeks below for the
        // separately-tracked, currently-unguaranteed cross-call case this harness surfaced.
        const result = await getResult(scenario.id);
        expect(result.maxConsecutiveSameTemplateStreakWithinCall).toBeLessThan(3);
    });

    it('does not run away indefinitely across chained week boundaries either, even though it is not strictly guaranteed there', async () => {
        // Real finding from this harness, left unfixed (out of scope for this task):
        // recentHistory has no visibility into real recent history when a fresh week-strip
        // call starts, so a streak CAN span the boundary between two chained calls (unlike
        // within a single call, which is guaranteed above). Loosely bounded here so a
        // regression toward "no anti-stacking effect at all" would still be caught.
        const result = await getResult(scenario.id);
        expect(result.maxConsecutiveSameTemplateStreakAcrossWeeks).toBeLessThanOrEqual(4);
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

    it('DOCUMENTS A REAL FINDING, not ideal behavior: the anchor-day boost rarely wins the actual pick', async () => {
        // The single most significant result this harness found. Once the week's
        // zone2/threshold objectives resolve -- often within the first 1-2 days, since
        // broad-coverage templates like Tempo Ride satisfy both simultaneously via
        // creditObjectivesFromStimulus -- calculateStimulusBenefit collapses to the same
        // 0.2 floor for every remaining candidate that doesn't touch the one leftover
        // objective. Ranking then becomes pure cost-minimization, and the anchor's 1.35x
        // preference multiplier (ANCHOR_ROLE_BOOST, optimizer.ts) is nowhere near enough
        // to make a genuinely more expensive Race-Specific Endurance session beat a cheap
        // Technical Skill/Easy Endurance one. Confirmed directly via a candidate's own
        // topUtilityScore vs runnerUpUtilityScore diagnostics landing within ~2% of each
        // other on the anchor day, with the cheaper non-anchor candidate winning.
        //
        // Recorded here, unfixed, because the real fix needs design thought (should
        // weekly objectives target more than 1 exposure so they resolve less
        // instantly? should the anchor boost be much larger? should benefit not collapse
        // to a flat floor once objectives are resolved on a day deliberately designated as
        // an anchor?) rather than an ad hoc constant tweak. If this ever starts passing on
        // its own, that's a real improvement worth celebrating -- update this test
        // deliberately rather than deleting it.
        const result = await getResult('cycling_gran_fondo_A');
        const anchorHitWeeks = result.anchorWeeks.filter(w => w.eventSpecificAnchorHit).length;
        const nominatedWeeks = result.anchorWeeks.filter(w => w.eventSpecificAnchorDate).length;
        expect(nominatedWeeks).toBeGreaterThan(0); // the mechanism does at least nominate
        expect(anchorHitWeeks).toBeLessThan(nominatedWeeks); // ...but rarely/never wins today
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
        expect(strengthCount).toBeLessThan(result.totalDays * 0.25);
    });
});

describe('field_sport_general_target -- no dedicated event category exists for field sports', () => {
    it('Field Maintenance is at least reachable over a 4-week horizon on preference alone', async () => {
        const result = await getResult('field_sport_general_target');
        expect(result.modalityDistribution.Field ?? 0).toBeGreaterThan(0);
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
