import { describe, expect, it } from 'vitest';
import type { DailyReadiness, DailyRecommendation, UserEvent } from './models';
import { buildFatigueStateFromHistory } from './fatigue';
import { resolveTrainingIntent } from './trainingIntent';
import { exposureFromRecommendation, type CompletedExposure, type TrainingHistoryProvider } from './trainingHistory';

function recommendation(overrides: Partial<DailyRecommendation> = {}): DailyRecommendation {
    return {
        userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
        category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 1,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: '2026-08-07T08:00:00Z', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        ...overrides,
    };
}

const readiness: DailyReadiness = {
    subjective: { readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 3, stress: 3, motivation: 7, timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
    objective: { total_steps: 7000, sleep_score: 80, sleep_duration_min: 450, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 80, last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0, hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7 },
};

describe('training history boundary', () => {
    it('credits followed recommendations by their exact template', () => {
        const exposure = exposureFromRecommendation('2026-08-06', recommendation());
        expect(exposure?.trainingRecordLike.type).toBe('Cycling Moderate Endurance');
        expect(exposure?.trainingRecordLike.duration_min).toBe(40);
    });

    it('gives modified sessions approximate modality and reported-duration credit', () => {
        const exposure = exposureFromRecommendation('2026-08-06', recommendation({
            adherence: { respondedAt: 'x', followed: false, actualModality: 'Cycling', actualDurationMin: 27, skipped: false, notes: null },
        }));
        expect(exposure?.trainingRecordLike).toMatchObject({ type: 'Cycling training', duration_min: 27 });
    });

    it('does not credit skipped or unanswered sessions', () => {
        expect(exposureFromRecommendation('2026-08-06', recommendation({ adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null } }))).toBeNull();
        expect(exposureFromRecommendation('2026-08-06', recommendation({ adherence: { respondedAt: 'x', followed: false, actualModality: null, actualDurationMin: null, skipped: true, notes: null } }))).toBeNull();
    });

    it('uses the injected provider oldest-to-newest and retains decayed earlier load', async () => {
        const exposures: CompletedExposure[] = [
            { date: '2026-08-01', costProfile: { systemic: 0.8, cardiovascular: 0.8, lowerBody: 0.8, upperBody: 0, impactTissue: 0.2, neuromuscular: 0.4 }, trainingRecordLike: { type: 'Cycling Threshold', duration_min: 45, training_effect: 0, intensity_tag: '' } },
            { date: '2026-08-05', costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.1 }, trainingRecordLike: { type: 'Cycling Easy Endurance', duration_min: 30, training_effect: 0, intensity_tag: '' } },
        ];
        const provider: TrainingHistoryProvider = { reconstruct: async () => [...exposures] };
        const intent = await resolveTrainingIntent('u1', [] as UserEvent[], '2026-08-07', readiness, 7, provider);
        expect(intent.history.map(item => item.date)).toEqual(['2026-08-01', '2026-08-05']);
        const withOldLoad = buildFatigueStateFromHistory([exposures[0]], intent.fatigue.internalResponseStrain, '2026-08-07');
        expect(withOldLoad.externalLoadFatigue.lowerBody).toBeGreaterThan(0);
        expect(withOldLoad.externalLoadFatigue.lowerBody).toBeLessThan(exposures[0].costProfile.lowerBody);
    });
});
