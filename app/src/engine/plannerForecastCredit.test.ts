import { describe, expect, it } from 'vitest';
import type { MicrocycleState, WeeklyObjective } from './models';
import type { CompletedExposure } from './trainingHistory';
import { ageCompletedObjectiveCreditForForecastDate, prepareWeekAheadPlanSeed } from './planner';
import { projectCompatibilityExposures } from './microcycle';
import { createEmptyFatigue } from './fatigue';

const objective: WeeklyObjective = {
    id: 'strength', key: 'strength_maintenance', title: 'Strength maintenance',
    targetExposures: 2, requiredCredit: 2, completedCredit: 0.8,
    projectedCredit: 0.8, completedExposures: 2,
    targetStimulus: { maxStrength: 0.7 },
    windowStart: '2026-08-12', windowEnd: '2026-09-12',
};

function strengthExposure(date: string): CompletedExposure {
    return {
        occurrenceKey: `strength:${date}`, date,
        modality: 'Strength', category: 'Full-body Strength',
        costProfile: { systemic: 0.5, cardiovascular: 0, lowerBody: 0.5, upperBody: 0.5, impactTissue: 0, neuromuscular: 0.5 },
        stimulusProfile: { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.8, hypertrophy: 0 },
        stimulusConfidence: 'exact',
        trainingRecordLike: { type: 'Strength', duration_min: 40, training_effect: 0, intensity_tag: '' },
    };
}

function microcycle(overrides: Partial<WeeklyObjective> = {}): MicrocycleState {
    return { windowStartDate: '2026-08-14', objectives: [{ ...objective, ...overrides }] };
}

describe('forecast completed-credit aging (#746)', () => {
    const historical = [strengthExposure('2026-08-09')];

    it('expires completed credit at D−7 and preserves projected credit and compatibility exposures', () => {
        const before = ageCompletedObjectiveCreditForForecastDate(microcycle(), historical, '2026-08-16', '2026-08-14').objectives[0];
        expect(before.completedCredit).toBe(0.8);
        expect(before.projectedCredit).toBe(0.8);

        const after = ageCompletedObjectiveCreditForForecastDate(microcycle(), historical, '2026-08-17', '2026-08-14').objectives[0];
        expect(after.completedCredit).toBe(0);
        expect(after.projectedCredit).toBe(0.8);
        expect(after.completedExposures).toBe(projectCompatibilityExposures(0.8, 2));
    });

    it('never raises an unclassified carried objective, preserving contributor-only daily semantics', () => {
        const lower = ageCompletedObjectiveCreditForForecastDate(
            microcycle({ completedCredit: 0.3 }), historical, '2026-08-16', '2026-08-14',
        ).objectives[0];
        expect(lower.completedCredit).toBe(0.3);
    });

    it('rebuilds governing objective credit from historical facts when the forecast definition changes', () => {
        const rebuilt = ageCompletedObjectiveCreditForForecastDate(
            microcycle({ completedCredit: 0, projectedCredit: 0, completedExposures: 0 }),
            historical,
            '2026-08-16',
            '2026-08-14',
            [],
            new Set(['strength']),
        ).objectives[0];
        expect(rebuilt.completedCredit).toBe(0.8);
        expect(rebuilt.completedExposures).toBe(projectCompatibilityExposures(0.8, 2));
    });

    it('drops stale carried projection credit when a governing objective definition no longer qualifies it', () => {
        const stricter = microcycle({
            completedCredit: 0.8,
            projectedCredit: 0.8,
            completedExposures: 2,
            qualification: { minimumStimulus: { maxStrength: 0.95 } },
        });
        const priorPick = strengthExposure('2026-08-15');
        const rebuilt = ageCompletedObjectiveCreditForForecastDate(
            stricter,
            historical,
            '2026-08-16',
            '2026-08-14',
            [{
                occurrenceKey: priorPick.occurrenceKey!,
                date: priorPick.date,
                stimulus: priorPick.stimulusProfile!,
                modality: priorPick.modality,
                category: priorPick.category,
            }],
            new Set(['strength']),
        ).objectives[0];
        expect(rebuilt.completedCredit).toBe(0);
        expect(rebuilt.projectedCredit).toBe(0);
        expect(rebuilt.completedExposures).toBe(0);
    });

    it('keeps future forecast picks out of actual completed credit', () => {
        const result = ageCompletedObjectiveCreditForForecastDate(
            microcycle(), [...historical, strengthExposure('2026-08-15')], '2026-08-17', '2026-08-14',
        ).objectives[0];
        expect(result.completedCredit).toBe(0);
        expect(result.projectedCredit).toBe(0.8);
    });

    it('preserves a precredited seed when no matching completed history was supplied', () => {
        const seed = prepareWeekAheadPlanSeed(microcycle(), createEmptyFatigue('2026-08-14'), '2026-08-14');
        expect(seed.completedExposures).toBeUndefined();
        expect(seed.microcycle.objectives[0].completedCredit).toBe(0.8);
    });

    it('restores projected stimulus that was capped before historical credit expired', () => {
        const previouslyCapped = microcycle({
            requiredCredit: 1, targetExposures: 1, completedCredit: 0.8,
            projectedCredit: 0.2, completedExposures: 1,
        });
        const priorPick = strengthExposure('2026-08-15');
        const result = ageCompletedObjectiveCreditForForecastDate(
            previouslyCapped, historical, '2026-08-17', '2026-08-14', [{
                occurrenceKey: priorPick.occurrenceKey!, date: priorPick.date,
                stimulus: priorPick.stimulusProfile!, modality: priorPick.modality,
                category: priorPick.category,
            }],
        ).objectives[0];
        expect(result.completedCredit).toBe(0);
        expect(result.projectedCredit).toBe(0.8);
        expect(result.completedExposures).toBe(projectCompatibilityExposures(0.8, 1));
    });
});
