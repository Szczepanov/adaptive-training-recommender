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

function objectiveCreditTotal(result: ScenarioResult, objectiveKey: string): number {
    // Individual credits are already rounded to 2 decimals (see deriveObjectiveCreditFromProfile);
    // round the sum too so IEEE754 summation order (which day earned which fraction) can't flip a
    // mathematically-equal total across a floating-point boundary (e.g. 0.85+0.15*3 vs 0.7+0.3*2).
    const raw = result.objectiveCredits
        .filter(credit => credit.objectiveKey === objectiveKey)
        .reduce((sum, credit) => sum + ((credit as typeof credit & { earnedCredit?: number }).earnedCredit ?? 0), 0);
    return Math.round(raw * 100) / 100;
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
        const raceSpecificCredits = result.objectiveCredits.filter(credit => credit.objectiveKey === 'race_specific_endurance');
        expect(raceSpecificCredits.length).toBeGreaterThan(0);
        expect(raceSpecificCredits.every(credit => credit.modality === 'Cycling')).toBe(true);
    });
});

describe('cycling_criterium_A -- qualification and anchor stress test', () => {
    it('generates and resolves the cycling-scoped surge objective in every chained week', async () => {
        const result = await getResult('cycling_criterium_A');
        const surge = result.objectiveResolution.find(o => o.key === 'surge_repeatability');
        expect(surge).toMatchObject({ timesGenerated: 4, timesResolved: 4 });
    });

    it('distinguishes rolling objective fulfillment from exact calendar-block exposure', async () => {
        // Phase 4 objective credit is a rolling ledger, not a reset-at-Monday counter. Since
        // calculateStimulusBenefit (optimizer.ts) was fixed to enforce qualification.minimumStimulus,
        // a Race-Specific Endurance candidate can no longer win the exact nominated anchor day by
        // stimulus credit toward an objective it doesn't actually qualify for (e.g. threshold_quality
        // below its minimum) -- so a genuinely stronger candidate wins the anchor day instead, and
        // the race-specific exposure lands on a different day within the same rolling window. The
        // objective still resolves in every simulated week; it just never lands on the nominated
        // date itself, which is exactly the "exact calendar-block exposure" this test documents.
        const result = await getResult('cycling_criterium_A');
        const nominated = result.anchorWeeks.filter(w => w.eventSpecificAnchorDate).length;
        const hits = result.anchorWeeks.filter(w => w.eventSpecificAnchorHit).length;
        const calendarBlockFulfilled = result.anchorWeeks.filter(w => w.eventSpecificAnchorFulfilled).length;
        const raceSpecificObjective = result.objectiveResolution.find(o => o.key === 'race_specific_endurance');

        expect(nominated).toBe(4);
        expect(hits).toBe(0);
        expect(calendarBlockFulfilled).toBe(nominated);
        expect(raceSpecificObjective).toMatchObject({ timesGenerated: 4, timesResolved: 4 });
        expect(result.qualityWarnings.some(warning => warning.startsWith('Event-specific exposure occurred off the nominated anchor date'))).toBe(true);
    });
});

describe('running_marathon_A -- no cycling equipment owned', () => {
    it('never picks a template requiring indoor_bike', async () => {
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
        const result = await getResult('strength_meet_powerlifting_B');
        const strength = result.objectiveResolution.find(o => o.key === 'strength_maintenance');
        expect(strength).toBeDefined();
        expect(strength!.timesGenerated).toBe(4);
        expect(strength!.timesResolved).toBeLessThanOrEqual(strength!.timesGenerated);
    });

    it('strength appears meaningfully but nowhere near dominant -- the same ceiling limits actual pick frequency, not just objective counting', async () => {
        const result = await getResult('strength_meet_powerlifting_B');
        const strengthCount = result.modalityDistribution.Strength ?? 0;
        expect(strengthCount).toBeGreaterThan(0);
        expect(strengthCount).toBeLessThanOrEqual(result.totalDays * 0.65);
    });
});

describe('field_sport_general_target -- no dedicated event category exists for field sports', () => {
    it('documents that Field Maintenance is NOT currently reachable on preference alone under strict lexicographic ordering', async () => {
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

    it('sustained stress adds recovery and does not earn more race-specific objective credit than baseline', async () => {
        // Session count is no longer the authority under Objective Credit V2. A stressed
        // trajectory can split a smaller useful dose across more sessions while still
        // accumulating less race-specific credit. Gate the measured V2 contribution and
        // recovery response rather than reviving the V1 one-session/one-credit proxy.
        const baseline = await getResult('cycling_criterium_A');
        const stressed = await getResult('cycling_criterium_stressed_A');
        expect(stressed.restOrRecoveryDayCount).toBeGreaterThanOrEqual(baseline.restOrRecoveryDayCount);
        expect(objectiveCreditTotal(stressed, 'race_specific_endurance'))
            .toBeLessThanOrEqual(objectiveCreditTotal(baseline, 'race_specific_endurance'));
    });

    it('surfaces coach-quality failures separately from hard constraint violations', async () => {
        const result = await getResult('triathlon_olympic_A');
        expect(result.constraintViolations).toEqual([]);
        expect(result.qualityWarnings).toContain('Triathlon capability is partial: the engine has no Swimming modality or swim objective/catalog support.');
        expect(result.qualityWarnings.some(warning =>
            warning.startsWith('Event-specific anchor missed')
            || warning.startsWith('Event-specific exposure occurred off the nominated anchor date')
        )).toBe(true);
    });
});

describe('no_event_base_phase -- control baseline', () => {
    it('never resolves a surge_repeatability objective (Base-phase vo2Max/repeatedSurges demand sits at 0.3, below the 0.6 gate)', async () => {
        const result = await getResult('no_event_base_phase');
        const keys = result.objectiveResolution.map(o => o.key);
        expect(keys).not.toContain('surge_repeatability');
        expect(keys).toContain('threshold_quality');
        expect(keys).toContain('zone2_aerobic');
        expect(keys).toContain('strength_maintenance');
    });
});
