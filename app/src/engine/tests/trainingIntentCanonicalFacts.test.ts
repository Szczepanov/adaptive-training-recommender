import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    preparedPerformedFactsForCoverageSet,
    resolveTrainingIntent,
} from '../trainingIntent';
import { getPerformedTrainingFactsInRange } from '../../training-occurrence/performedTrainingFactsService';
import type { DailyReadiness } from '../models';
import type { TrainingHistorySnapshot } from '../trainingHistorySnapshot';
import type { PerformedTrainingFactsSnapshot } from '../performedTrainingFacts';

vi.mock('../firestoreTrainingHistory', () => ({
    firestoreTrainingHistoryProvider: {
        reconstruct: vi.fn().mockResolvedValue([]),
        getSnapshot: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../training-occurrence/performedTrainingFactsService', () => ({
    getPerformedTrainingFactsInRange: vi.fn(),
}));

function readiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 8,
            sleepQuality: 8,
            fatigue: 2,
            soreness: 2,
            stress: 3,
            motivation: 8,
            timeAvailable: 60,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 85,
            sleep_duration_min: 450,
            rhr: 48,
            rhr_7d_avg: 49,
            rhr_delta: -1,
            hrv_weekly_avg: 55,
            hrv_last_night: 57,
            hrv_delta: 2,
            respiration: 13,
            body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0,
            yesterday_training: null,
            today_training: null,
            sleep_score_delta_7d: 0,
            rhr_delta_28d: 0,
            hrv_delta_28d: 0,
            sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8,
            rhr_stdev_28d: 3,
            sleep_score_stdev_28d: 8,
        },
    };
}

function preparedHistory(): TrainingHistorySnapshot {
    return {
        throughDateExclusive: '2026-09-02',
        windowDays: 7,
        completedEvents: [],
        exposures: [],
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'activities-rev' },
            recommendations: { status: 'AVAILABLE', revision: 'recommendations-rev' },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: '2026-09-02T05:00:00Z',
        revision: 'history-v1:test',
    };
}

function canonicalFacts(revision: string): PerformedTrainingFactsSnapshot {
    return {
        asOfDate: '2026-09-02',
        windowDays: 7,
        revision,
        exposures: [],
        coverageCredits: [],
    };
}

describe('training intent canonical facts + prepared history snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getPerformedTrainingFactsInRange).mockResolvedValue(
            canonicalFacts('canonical-facts-v1:evergreen_general:2026-08-26:2026-09-02:empty'),
        );
    });

    it('accepts descriptor-scoped canonical revisions and rejects another coverage set', () => {
        const evergreen = canonicalFacts('canonical-facts-v1:evergreen_general:2026-08-26:2026-09-02:empty');
        const event = canonicalFacts('canonical-facts-v1:september_cycling_event:2026-08-26:2026-09-02:empty');

        expect(preparedPerformedFactsForCoverageSet(evergreen, 'evergreen_general')).toBe(evergreen);
        expect(preparedPerformedFactsForCoverageSet(event, 'evergreen_general')).toBeNull();
    });

    it('retains noncanonical revision strings for deterministic injected fixtures', () => {
        const fixture = canonicalFacts('fixture-rev-1');
        expect(preparedPerformedFactsForCoverageSet(fixture, 'evergreen_general')).toBe(fixture);
    });

    it('does not let a legacy prepared history snapshot suppress the live canonical occurrence read', async () => {
        const snapshot = preparedHistory();

        const intent = await resolveTrainingIntent(
            'user-1',
            [],
            '2026-09-02',
            readiness(),
            7,
            undefined,
            snapshot,
        );

        expect(getPerformedTrainingFactsInRange).toHaveBeenCalledTimes(1);
        expect(getPerformedTrainingFactsInRange).toHaveBeenCalledWith(
            'user-1',
            '2026-08-26',
            '2026-09-02',
            { coverageSetDescriptor: expect.objectContaining({ id: 'evergreen_general' }) },
        );
        expect(intent.performedTrainingFacts?.revision).toContain('canonical-facts-v1:evergreen_general:');
    });

    it('reuses a matching canonical snapshot without a duplicate live read', async () => {
        const facts = canonicalFacts('canonical-facts-v1:evergreen_general:2026-08-26:2026-09-02:empty');
        const snapshot = { ...preparedHistory(), performedTrainingFacts: facts };

        const intent = await resolveTrainingIntent(
            'user-1',
            [],
            '2026-09-02',
            readiness(),
            7,
            undefined,
            snapshot,
        );

        expect(getPerformedTrainingFactsInRange).not.toHaveBeenCalled();
        expect(intent.performedTrainingFacts).toBe(facts);
    });

    it('refetches live facts when prepared canonical facts were derived for another coverage set', async () => {
        const snapshot = {
            ...preparedHistory(),
            performedTrainingFacts: canonicalFacts(
                'canonical-facts-v1:september_cycling_event:2026-08-26:2026-09-02:empty',
            ),
        };

        const intent = await resolveTrainingIntent(
            'user-1',
            [],
            '2026-09-02',
            readiness(),
            7,
            undefined,
            snapshot,
        );

        expect(getPerformedTrainingFactsInRange).toHaveBeenCalledTimes(1);
        expect(intent.performedTrainingFacts?.revision).toContain('canonical-facts-v1:evergreen_general:');
    });
});
