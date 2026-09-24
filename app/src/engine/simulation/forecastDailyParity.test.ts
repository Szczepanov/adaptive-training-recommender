import { describe, expect, it } from 'vitest';
import type { WeeklyObjective } from '../models';
import type { CompletedExposure } from '../trainingHistory';
import { forecastAgedCompletedCredit } from './analyze';

const objective: WeeklyObjective = {
    id: 'strength', key: 'strength_maintenance', title: 'Strength',
    targetExposures: 3, requiredCredit: 3, completedExposures: 0,
    targetStimulus: { maxStrength: 0.7 },
};

function strengthExposure(date: string): CompletedExposure {
    return {
        occurrenceKey: `strength:${date}`,
        date,
        modality: 'Strength', category: 'Full-body Strength',
        costProfile: { systemic: 0.5, cardiovascular: 0, lowerBody: 0.5, upperBody: 0.5, impactTissue: 0, neuromuscular: 0.5 },
        stimulusProfile: { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.8, hypertrophy: 0 },
        stimulusConfidence: 'exact',
        trainingRecordLike: { type: 'Strength', duration_min: 40, training_effect: 0, intensity_tag: '' },
    };
}

describe('forecast completed-credit aging diagnostic', () => {
    const exposures = [strengthExposure('2026-09-09'), strengthExposure('2026-09-12'), strengthExposure('2026-09-14')];

    it('uses the forecast-date rolling lookback while keeping projected picks out of completed credit', () => {
        expect(forecastAgedCompletedCredit(objective, exposures, '2026-09-18', '2026-09-15', 3)).toBe(1.6);
        expect(forecastAgedCompletedCredit(objective, exposures, '2026-09-21', '2026-09-15', 3)).toBe(0.8);
    });

    it('uses daily rolling semantics across block boundaries and never raises original credit', () => {
        const blockObjective = { ...objective, windowStart: '2026-09-12', windowEnd: '2026-09-13' };
        expect(forecastAgedCompletedCredit(blockObjective, exposures, '2026-09-18', '2026-09-15', 3)).toBe(1.6);
        expect(forecastAgedCompletedCredit(blockObjective, exposures, '2026-09-18', '2026-09-15', 0.5)).toBe(0.5);
    });
});
