import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DataState } from './dataState';
import type { DailyRecommendation, NormalizedGarminActivity, StrengthSession } from './models';
import { buildTrainingHistorySnapshot, TrainingHistorySourceError } from './trainingHistorySnapshot';

const activities: DataState<NormalizedGarminActivity[]> = {
    status: 'AVAILABLE', revision: 'activity-revision', data: [{
        activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 45,
        trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null, averageHr: 150,
        activityTrainingLoad: 115, intensityTag: 'hard',
    }],
};

const recommendations: DataState<DailyRecommendation[]> = {
    status: 'AVAILABLE', revision: 'recommendation-revision', data: [{
        userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
        category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 2,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
    }],
};

describe('training history snapshot', () => {
    it('creates one revisioned event/exposure view from both bounded sources', () => {
        const snapshot = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z');
        expect(snapshot).toMatchObject({
            revision: 'history-v1:2026-08-07:7:activity-revision:recommendation-revision',
            completedEvents: [{ sources: ['garmin', 'adherence'] }],
            sourceStates: { activities: { status: 'AVAILABLE' }, recommendations: { status: 'AVAILABLE' }, manualTraining: { status: 'MISSING' } },
        });
        expect(snapshot.exposures).toHaveLength(1);
    });

    it('does not turn an unavailable activity query into zero training load', () => {
        const unavailable: DataState<NormalizedGarminActivity[]> = {
            status: 'UNAVAILABLE', operation: 'read activities history', retryable: true,
        };
        expect(() => buildTrainingHistorySnapshot('2026-08-07', 7, unavailable, recommendations)).toThrow(TrainingHistorySourceError);
    });

    // --- S3.2: manualTraining, behind a default-off selector (ADR-0021 D-STRCOST) ---

    const strengthSession: StrengthSession = {
        userId: 'u1', sessionId: 's1', date: '2026-08-06', startedAt: '2026-08-06T18:00:00Z',
        completedAt: '2026-08-06T18:45:00Z', updatedAt: '2026-08-06T18:45:00Z', state: 'completed',
        exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-06T18:10:00Z', gauge: { scale: 'rir', value: 2 } }] }],
        schemaVersion: 1,
    };
    const manualTrainingAvailable: DataState<StrengthSession[]> = { status: 'AVAILABLE', revision: 'manual-revision', data: [strengthSession] };

    it('is bit-identical to pre-S3.2 behaviour when the selector defaults to off, even with real strength data available', () => {
        const withDefaults = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z');
        const withUnusedStrengthData = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', manualTrainingAvailable);
        expect(withUnusedStrengthData).toEqual(withDefaults);
        expect(withUnusedStrengthData.sourceStates.manualTraining).toEqual({ status: 'MISSING' });
        expect(withUnusedStrengthData.exposures).toHaveLength(1); // only the Garmin/adherence exposure, no strength exposure
        // The revision string's shape itself (4 segments), not only its value, is unchanged.
        expect(withUnusedStrengthData.revision).toBe('history-v1:2026-08-07:7:activity-revision:recommendation-revision');
    });

    it('reports the real manualTraining state and adds a strength exposure when included', () => {
        const snapshot = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', manualTrainingAvailable, 'included');
        expect(snapshot.sourceStates.manualTraining).toMatchObject({ status: 'AVAILABLE' });
        expect(snapshot.exposures).toHaveLength(2); // Garmin/adherence exposure plus the strength exposure
        expect(snapshot.exposures.some(exposure => exposure.occurrenceKey === 'strength:s1')).toBe(true);
        expect(snapshot.revision).toContain('manual-revision');
    });

    it('tolerates a genuinely missing manualTraining source when included -- no strength work is a real, non-blocking state', () => {
        const missing: DataState<StrengthSession[]> = { status: 'MISSING' };
        const snapshot = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', missing, 'included');
        expect(snapshot.sourceStates.manualTraining).toEqual({ status: 'MISSING' });
        expect(snapshot.exposures).toHaveLength(1);
    });

    it('throws rather than silently treating a failed manualTraining read as empty, when included', () => {
        const unavailable: DataState<StrengthSession[]> = { status: 'UNAVAILABLE', operation: 'read strength sessions', retryable: true };
        expect(() => buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', unavailable, 'included'))
            .toThrow(TrainingHistorySourceError);
    });

    it('throws on an invalid manualTraining source when included, not just an unavailable one', () => {
        const invalid: DataState<StrengthSession[]> = { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: 'x' }] };
        expect(() => buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', invalid, 'included'))
            .toThrow(TrainingHistorySourceError);
    });

    it('never derives a strength exposure from manualTraining when the selector is off, even if the caller mistakenly passes non-MISSING data', () => {
        const snapshot = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', manualTrainingAvailable, 'off');
        expect(snapshot.exposures).toHaveLength(1);
    });
});

describe('manual-training selector architecture guard', () => {
    // Mirrors rules.test.ts's guard for SubjectiveDriftPolicy: 'off' is bit-identical to
    // pre-S3.2 behaviour and is the only value any production call site may pass. A plain
    // source scan (not an import-graph scanner -- that answers module reachability, not
    // literal argument values) catches the straightforward case: nobody writes the literal
    // string outside a test or a future measurement harness.
    const ENGINE_DIR = __dirname;

    function productionFiles(directory = ENGINE_DIR): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'simulation') return []; // where a future S3.3 harness will legitimately reference 'included'.
                return productionFiles(absolutePath);
            }
            if (!entry.isFile() || !/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
            return [absolutePath];
        });
    }

    it('no non-test engine file outside simulation/ contains the literal \'included\' as a manual-training policy value', () => {
        const offenders: string[] = [];
        for (const file of productionFiles()) {
            const source = readFileSync(file, 'utf8');
            // Matches a quoted 'included' that is not immediately preceded by "'off' | " --
            // i.e. not the ManualTrainingPolicy type declaration itself.
            const valueUsage = source.match(/(?<!'off' \| )'included'/g);
            if (valueUsage) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
