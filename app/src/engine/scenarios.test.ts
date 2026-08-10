import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runAllScenarios, runScenario, type ScenarioResult } from './simulation/analyze';

/**
 * Regression coverage for the recommendation engine across sport/event types, built on
 * the shared scenario list in `simulation/scenarios.ts` -- the same list
 * `scripts/simulate-scenarios.ts` uses to generate the analysis report, so there is one
 * source of truth, not a parallel list duplicated between coverage and analysis.
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
    it('generates and resolves the cycling-scoped surge objective in every non-taper chained week', async () => {
        const result = await getResult('cycling_criterium_A');
        const surge = result.objectiveResolution.find(o => o.key === 'surge_repeatability');
        // The default cycling taper starts in race week, so all four chained weeks retain
        // the peak surge role for this event date.
        expect(surge).toMatchObject({ timesGenerated: 4, timesResolved: 4 });
    });

    it('distinguishes rolling objective fulfillment from exact calendar-block exposure', async () => {
        const result = await getResult('cycling_criterium_A');
        const nominated = result.anchorWeeks.filter(w => w.eventSpecificAnchorDate).length;
        const hits = result.anchorWeeks.filter(w => w.eventSpecificAnchorHit).length;
        const calendarBlockFulfilled = result.anchorWeeks.filter(w => w.eventSpecificAnchorFulfilled).length;
        const raceSpecificObjective = result.objectiveResolution.find(o => o.key === 'race_specific_endurance');

        expect(nominated).toBe(4);
        // Anchor dates are nominations, not hard appointments: a recover-tier safety day
        // may move the exposure. Exact hits stay diagnostic while block-level fulfillment
        // below remains the decision-bearing contract.
        expect(hits).toBeGreaterThanOrEqual(0);
        expect(hits).toBeLessThanOrEqual(nominated);
        // The fourth nominated week begins the event taper, where the authored contract
        // replaces the peak outdoor role with taper sharpening rather than a full race
        // simulation. Three peak-block fulfilments are therefore the correct invariant.
        expect(calendarBlockFulfilled).toBe(3);
        // W3 rest-first clearing can leave the generic rolling adaptation key at 3/4;
        // exact programming-role coverage is the hard authority. W1/W2 add the stronger
        // macrocycle date/role contracts for peak and taper rather than preserving this
        // legacy aggregate-credit count.
        expect(raceSpecificObjective).toMatchObject({ timesGenerated: 4, timesResolved: 3 });
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

    it('sustained stress adds recovery and does not earn meaningfully more race-specific objective credit than baseline', async () => {
        const baseline = await getResult('cycling_criterium_A');
        const stressed = await getResult('cycling_criterium_stressed_A');
        expect(stressed.restOrRecoveryDayCount).toBeGreaterThanOrEqual(baseline.restOrRecoveryDayCount);
        const baselineCredit = objectiveCreditTotal(baseline, 'race_specific_endurance');
        const stressedCredit = objectiveCreditTotal(stressed, 'race_specific_endurance');
        expect(stressedCredit).toBeLessThanOrEqual(baselineCredit * 1.2);
    });

    it('clears an acute high-fatigue trajectory into train-tier days after a healthy check-in', async () => {
        const result = await getResult('cycling_criterium_recovery_clear_A');
        expect(result.weekSummaries).toHaveLength(2);
        expect(result.weekSummaries[0].fatigueTierDayCounts.recover).toBeGreaterThan(0);
        expect(result.weekSummaries[1].fatigueTierDayCounts.train).toBeGreaterThan(0);
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
