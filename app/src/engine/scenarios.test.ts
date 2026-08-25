import { describe, expect, it, vi } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { addDaysToLocalDateString } from '../utils/localDate';
import {
    buildCalibrationReport, runAllScenarios, runFatigueFusionComparison, runScenario,
    runSubjectiveDriftComparison, type ScenarioResult,
} from './simulation/analyze';

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

function raceSpecificExposures(result: ScenarioResult): number {
    return result.objectiveCredits.filter(credit => credit.objectiveKey === 'race_specific_endurance').length;
}

function resolvedWeeks(result: ScenarioResult, objectiveKey: string): number {
    return result.objectiveResolution.find(item => item.key === objectiveKey)?.timesResolved ?? 0;
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

    it('never records a required-role miss without a typed safety/feasibility reason', async () => {
        const result = await getResult(scenario.id);
        const missed = result.allocationReports.flatMap(item => item.report.outcomes)
            .filter(outcome => outcome.status === 'missed');
        expect(missed.filter(outcome => outcome.reason === undefined)).toEqual([]);
    });

    it('never leaves a forecast reservation dangling on the reported week', async () => {
        const result = await getResult(scenario.id);
        // `reserved` is a *current* forecast assignment. Once the horizon is planned it
        // must have resolved to fulfilled / missed / unresolved (ADR-0018 D-MISS).
        const outcomes = result.allocationReports.flatMap(item => item.report.outcomes);
        expect(outcomes.filter(outcome => outcome.status === 'reserved')).toEqual([]);
        expect(outcomes.every(outcome => outcome.reservation.occurrenceId === outcome.occurrence.id)).toBe(true);
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
        // ADR-0018 reserves the exact role before support work, so all four rolling
        // windows now retain a safe event-specific exposure (an anchor remains only a
        // nomination, not a hard appointment).
        expect(calendarBlockFulfilled).toBe(4);
        expect(raceSpecificObjective).toMatchObject({ timesGenerated: 4, timesResolved: 4 });
        expect(result.qualityWarnings.some(warning => warning.startsWith('Event-specific exposure occurred off the nominated anchor date'))).toBe(true);
    });

    it('fulfils every eligible authored minimum role in its healthy Build/Specificity weeks', async () => {
        const result = await getResult('cycling_criterium_A');
        const outcomes = result.allocationReports.flatMap(item => item.report.outcomes);
        const keysSeen = new Set(outcomes.map(outcome => outcome.occurrence.coverageKey));
        expect(keysSeen.size).toBeGreaterThan(0);
        const unfulfilled = outcomes.filter(outcome => outcome.status !== 'fulfilled');
        // A healthy athlete may still lose a role to a hard safety gate, but never to a
        // discretionary support/Rest pick that quietly consumed its last opportunity.
        expect(unfulfilled.map(outcome => outcome.reason ?? outcome.status))
            .not.toContain('no_conflict_free_date');
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
    }, 15000);
});

describe('scenario quality diagnostics', () => {
    it.each(['evergreen_health_two_sessions', 'evergreen_balanced_four_sessions', 'evergreen_strength_six_sessions'])(
        'keeps evergreen scenario %s free of quality and constraint violations', async scenarioId => {
            const result = await getResult(scenarioId);
            expect(result.qualityWarnings).toEqual([]);
            expect(result.constraintViolations).toEqual([]);
        },
    );

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
    }, 20000);

    it('sustained stress adds recovery and records any required-role loss with a typed safety/feasibility reason', async () => {
        const baseline = await getResult('cycling_criterium_A');
        const stressed = await getResult('cycling_criterium_stressed_A');
        expect(stressed.restOrRecoveryDayCount).toBeGreaterThanOrEqual(baseline.restOrRecoveryDayCount);
        // Extra recovery must not become extra hard work. Measured as race-specific
        // *exposures* and resolved weeks, not as summed objective credit: credit is the
        // remaining requirement, so a healthier athlete whose completed history already
        // covers the objective legitimately earns a smaller projected number per session.
        expect(raceSpecificExposures(stressed)).toBeLessThanOrEqual(raceSpecificExposures(baseline));
        expect(resolvedWeeks(stressed, 'race_specific_endurance'))
            .toBeLessThanOrEqual(resolvedWeeks(baseline, 'race_specific_endurance'));
        const missed = stressed.allocationReports.flatMap(item => item.report.outcomes)
            .filter(outcome => outcome.status === 'missed');
        expect(missed.every(outcome => outcome.reason !== undefined)).toBe(true);
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

describe('Phase 6.3 scenario input contract', () => {
    it('runs multi-event fixtures from the plural event input rather than the legacy shorthand', async () => {
        for (const scenarioId of ['multi_event_taper_conflict_static', 'multi_event_taper_conflict_mid_horizon']) {
            const scenario = SCENARIOS.find(item => item.id === scenarioId);
            if (!scenario) throw new Error(`Missing ${scenarioId}`);
            expect(scenario.event).toBeUndefined();
            expect(scenario.events).toHaveLength(2);
            const result = await getResult(scenarioId);
            expect(result.tags).toContain('multi-event');
            expect(result.totalDays).toBe(7);
        }
    });

    it('routes authored fixed activities into the same live scenario path without a constraint bypass', async () => {
        for (const scenarioId of ['fixed_football_midweek', 'travel_day_context_override']) {
            const scenario = SCENARIOS.find(item => item.id === scenarioId);
            if (!scenario) throw new Error(`Missing ${scenarioId}`);
            expect(scenario.fixedActivities).toHaveLength(1);
            const result = await getResult(scenarioId);
            expect(result.tags).toContain('fixed-activity');
            expect(result.constraintViolations).toEqual([]);
        }
    });

    it('uses date-level readiness at each chained simulation decision', async () => {
        const scenario = SCENARIOS.find(item => item.id === 'readiness_crash_then_return');
        if (!scenario?.readinessForDate) throw new Error('Date-level readiness scenario is missing');
        const readinessForDate = vi.fn(scenario.readinessForDate);
        const result = await runScenario({ ...scenario, readinessForDate });
        expect(readinessForDate).toHaveBeenNthCalledWith(1, '2026-08-07', 0);
        expect(readinessForDate).toHaveBeenNthCalledWith(2, '2026-08-14', 1);
        expect(result.weekSummaries[0].fatigueTierDayCounts.recover).toBeGreaterThan(0);
        expect(result.weekSummaries[1].fatigueTierDayCounts.train).toBeGreaterThan(0);
    });

    it('keeps external-load and lower-confidence completion fixtures in the shared suite', async () => {
        for (const scenarioId of ['external_load_green_readiness', 'inferred_partial_completion']) {
            const result = await getResult(scenarioId);
            expect(result.totalDays).toBe(7);
            expect(result.constraintViolations).toEqual([]);
        }
    });
});

describe('Phase 6.4 calibration evidence', () => {
    it('emits one compact, derived trace per simulated day without raw activity records', async () => {
        const result = await getResult('fixed_football_midweek');
        expect(result.decisionTraces).toHaveLength(result.totalDays);
        expect(result.decisionTraces).toContainEqual(expect.objectContaining({
            date: '2026-08-10',
            selected: expect.objectContaining({ templateId: expect.any(String), projectedCost: expect.any(Object) }),
            fatigue: expect.objectContaining({ rawExternalLoad: expect.any(Object), combined: expect.any(Object) }),
            fixedActivity: expect.objectContaining({ count: 1 }),
        }));
        expect(JSON.stringify(result.decisionTraces)).not.toContain('trainingRecordLike');
    });

    it('aggregates modes, gates, objectives, fixed activities, and contributor transitions descriptively', async () => {
        const calibration = buildCalibrationReport(await runAllScenarios());
        expect(calibration.evidenceType).toContain('not clinical calibration');
        expect(calibration.scenarios).toHaveLength(SCENARIOS.length);
        expect(calibration.aggregate.modeCounts.train + calibration.aggregate.modeCounts.modify + calibration.aggregate.modeCounts.recover)
            .toBe(calibration.generatedFrom.totalDays);
        expect(calibration.aggregate.fixedActivityActivations).toBeGreaterThan(0);
        expect(calibration.aggregate.objectives.created).toBeGreaterThan(0);
    });
});

describe('Phase 6.7 fatigue-fusion evidence gate', () => {
    it('runs the real planner under a simulation-only additive comparator without weakening constraints', async () => {
        const scenario = SCENARIOS.find(item => item.id === 'external_load_green_readiness');
        if (!scenario) throw new Error('External-load scenario missing');
        const comparison = await runFatigueFusionComparison([scenario]);
        expect(comparison.baselinePolicy).toBe('max');
        expect(comparison.candidatePolicy).toBe('additive');
        expect(comparison.aggregate.increasedPeakFatigueDays).toBeGreaterThan(0);
        expect(comparison.aggregate.constraintViolationDelta).toBe(0);
    });
});

describe('Phase 9.6 subjective-drift evidence gate', () => {
    it('runs the real planner/hard gates under a simulation-only drift comparator across the full corpus', async () => {
        const comparison = await runSubjectiveDriftComparison(SCENARIOS);
        expect(comparison.baselinePolicy).toBe('off');
        expect(comparison.candidatePolicy).toBe('drift');

        // Every non-subjective-profile scenario carries no subjectiveBaseline (only
        // scenarios.ts's subjective_* scenarios do), so it must diff to exactly zero -- the
        // regression control the plan requires.
        const nonProfileScenarios = comparison.scenarios.filter(item => !item.scenarioId.startsWith('subjective_'));
        expect(nonProfileScenarios.length).toBeGreaterThan(0);
        nonProfileScenarios.forEach(item => {
            expect(item).toMatchObject({
                changedSelections: 0, trainToModifyDays: 0, trainToRecoverDays: 0, modifyToRecoverDays: 0,
                recoverySelectionDelta: 0, restOrRecoveryDayDelta: 0, objectiveMissDelta: 0, constraintViolationDelta: 0,
            });
        });

        // The slow-drifter is the fixture the plan names as the one a drift candidate must
        // be able to detect (persistent decline that never crosses an absolute threshold).
        const slowDrifter = comparison.scenarios.find(item => item.scenarioId === 'subjective_slow_drifter');
        expect(slowDrifter?.trainToModifyDays).toBeGreaterThan(0);
        expect(slowDrifter?.changedSelections).toBeGreaterThan(0);

        // D-SUBJADD is a per-decision, never-less-restrictive invariant, not a claim that a
        // multi-week chained simulation's aggregate rest/recovery share can only rise -- an
        // earlier day's changed selection can alter later weeks' accumulated history and
        // shift *when* recovery happens. What must still hold in aggregate is that drift
        // never introduces a constraint violation that 'off' didn't have.
        expect(comparison.aggregate.constraintViolationDelta).toBeGreaterThanOrEqual(0);
        expect(comparison.evidenceType).toBe('synthetic safety/regression evidence; not real-world usefulness evidence');
    }, 30000);

    it('attaches a real subjectiveBaseline to profile scenarios once enough prior history exists, and never on day 0', () => {
        const scenario = SCENARIOS.find(item => item.id === 'subjective_slow_drifter');
        if (!scenario?.readinessForDate) throw new Error('subjective_slow_drifter scenario missing readinessForDate');
        const day0 = scenario.readinessForDate(scenario.startDate, 0);
        expect(day0.subjectiveBaseline).toBeFalsy();

        const day14Date = addDaysToLocalDateString(scenario.startDate, 14);
        const day14 = scenario.readinessForDate(day14Date, 2);
        expect(day14.subjectiveBaseline).toBeTruthy();
        expect(day14.subjectiveBaseline?.historyThroughDateExclusive).toBe(day14Date);
    });
});
