import { describe, expect, it } from 'vitest';
import {
    MAX_EXPORT_WORKOUTS,
    WORKOUT_DIAGNOSTICS_EXPORT_SCHEMA,
    buildWorkoutDiagnosticsExport,
    type AvailableWorkoutDiagnosticsExport,
    serializeWorkoutDiagnosticsExport,
} from './workoutSourceDiagnosticsExport';
import type { ReconciliationSweepStatus } from './completedWorkoutView';
import { FAILURE_STATE_CODES } from './workoutSourceDiagnostics';
import { garminActivity, garminOnlyView, structuredOnlyView, workoutView } from './workoutSourceDiagnostics.fixtures';

const window = { from: '2026-08-20', toExclusive: '2026-08-27' } as const;
const generatedAt = '2026-08-27T08:00:00.000Z';
type Result = Parameters<typeof buildWorkoutDiagnosticsExport>[0]['result'];
const build = (result: Result, reconciliationSweep: ReconciliationSweepStatus = 'completed') =>
    buildWorkoutDiagnosticsExport({ window, generatedAt, reconciliationSweep, result });
const buildAvailable = (result: Result, reconciliationSweep: ReconciliationSweepStatus = 'completed'): AvailableWorkoutDiagnosticsExport => {
    const exported = build(result, reconciliationSweep);
    if (exported.projection !== 'available') throw new Error('expected an available export');
    return exported;
};

describe('buildWorkoutDiagnosticsExport', () => {
    it('has a stable, versioned schema', () => {
        const exported = buildAvailable({ status: 'available', workouts: [workoutView()] });
        expect(exported.schema).toBe(WORKOUT_DIAGNOSTICS_EXPORT_SCHEMA);
        expect(exported.generatedAt).toBe(generatedAt);
        expect(exported.window).toEqual(window);
        expect(exported.projection).toBe('available');
        expect(Object.keys(exported)).toEqual([
            'schema', 'generatedAt', 'window', 'reconciliationSweep', 'scopeNotes', 'projection', 'totalWorkouts', 'truncated', 'outboxDepth', 'workouts',
        ]);
        expect(Object.keys(exported.workouts[0])).toEqual([
            'performedOccurrenceId', 'localDate', 'startedAt', 'endedAt', 'modality', 'sourceKeys', 'sourceKeyCount',
            'reconciliation', 'reconciliationOutcome', 'reconciliationSweep', 'sourceReads', 'sourceCompleteness', 'outbox', 'states', 'attention',
        ]);
    });

    it('reports all eight states with their issue numbers, reasons and statuses', () => {
        const [entry] = buildAvailable({ status: 'available', workouts: [structuredOnlyView({ sourceReads: { outbox: { status: 'read', queued: 1, failed: 0 } } })] }).workouts;
        expect(Object.keys(entry.states)).toEqual([...FAILURE_STATE_CODES]);
        expect(entry.states.entry_write_unsettled).toEqual({ number: 2, status: 'holds', reasons: ['queued_writes'] });
        expect(entry.states.garmin_activity_absent).toEqual({ number: 3, status: 'holds', reasons: ['no_provider_linked'] });
        expect(entry.states.garmin_detail_unavailable).toEqual({ number: 4, status: 'not_applicable', reason: 'no_garmin_activity' });
        expect(entry.states.reconciliation_no_candidate).toEqual({ number: 6, status: 'holds', reasons: ['no_candidate_after_sweep'] });
    });

    it('orders workouts deterministically, newest first with id as the tie-break, whatever the input order', () => {
        const a = workoutView({ performedOccurrenceId: 'a', localDate: '2026-08-24', startedAt: '2026-08-24T06:00:00.000Z' });
        const b = workoutView({ performedOccurrenceId: 'b', localDate: '2026-08-26', startedAt: '2026-08-26T06:00:00.000Z' });
        const c = workoutView({ performedOccurrenceId: 'c', localDate: '2026-08-26', startedAt: '2026-08-26T06:00:00.000Z' });
        const forward = buildAvailable({ status: 'available', workouts: [a, b, c] }).workouts.map(w => w.performedOccurrenceId);
        const reversed = buildAvailable({ status: 'available', workouts: [c, b, a] }).workouts.map(w => w.performedOccurrenceId);
        expect(forward).toEqual(['b', 'c', 'a']);
        expect(reversed).toEqual(forward);
        expect(serializeWorkoutDiagnosticsExport(buildAvailable({ status: 'available', workouts: [a, b, c] })))
            .toBe(serializeWorkoutDiagnosticsExport(buildAvailable({ status: 'available', workouts: [c, a, b] })));
    });

    it('sorts source keys and excluded keys so output does not depend on attachment order', () => {
        const view = workoutView({
            sourceKeys: ['provider_activity:garmin:act-1', 'structured_execution:exec-1'],
            reconciliation: { state: 'single_source', excludedSourceKeys: ['z-key', 'a-key'] },
        });
        const [entry] = buildAvailable({ status: 'available', workouts: [view] }).workouts;
        expect(entry.sourceKeys).toEqual(['provider_activity:garmin:act-1', 'structured_execution:exec-1']);
        expect(entry.reconciliation.excludedSourceKeys).toEqual(['a-key', 'z-key']);
    });

    it('is bounded: caps workouts and reports the truncation instead of silently dropping', () => {
        const many = Array.from({ length: MAX_EXPORT_WORKOUTS + 25 }, (_, index) =>
            workoutView({ performedOccurrenceId: `pto-${String(index).padStart(4, '0')}`, startedAt: `2026-08-26T06:${String(index % 60).padStart(2, '0')}:00.000Z` }));
        const exported = buildAvailable({ status: 'available', workouts: many });
        expect(exported.workouts).toHaveLength(MAX_EXPORT_WORKOUTS);
        expect(exported.totalWorkouts).toBe(MAX_EXPORT_WORKOUTS + 25);
        expect(exported.truncated).toBe(true);
        expect(serializeWorkoutDiagnosticsExport(exported).length).toBeLessThan(400_000);
    });

    it('caps per-workout source keys but reports the real count', () => {
        const keys = Array.from({ length: 40 }, (_, index) => `provider_activity:garmin:act-${index}`);
        const [entry] = buildAvailable({ status: 'available', workouts: [workoutView({ sourceKeys: keys })] }).workouts;
        expect(entry.sourceKeys.length).toBeLessThanOrEqual(20);
        expect(entry.sourceKeyCount).toBe(40);
    });

    it('aggregates the device-local outbox depth and counts workouts whose receipts could not be read', () => {
        const exported = buildAvailable({
            status: 'available',
            workouts: [
                workoutView({ performedOccurrenceId: 'a', sourceReads: { outbox: { status: 'read', queued: 2, failed: 1 } } }),
                workoutView({ performedOccurrenceId: 'b', sourceReads: { outbox: { status: 'read', queued: 1, failed: 0 } } }),
                workoutView({ performedOccurrenceId: 'c', sourceReads: { outbox: { status: 'unreadable' } } }),
                garminOnlyView({ performedOccurrenceId: 'd' }),
            ],
        });
        expect(exported.outboxDepth).toEqual({ queued: 3, failed: 1, workoutsWithUnreadableReceipts: 1 });
        expect(exported.scopeNotes.join(' ')).toMatch(/this device/i);
    });

    it('reports a failed window projection as state 8 and never as an empty or zero workout list', () => {
        const exported = build({ status: 'projection_failed' });
        expect(exported.projection).toBe('failed');
        expect(exported.totalWorkouts).toBeNull();
        expect(exported.outboxDepth).toBeNull();
        expect(exported.truncated).toBeNull();
        expect(exported.workouts).toBeNull();
        expect(exported.windowState).toEqual({ number: 8, code: 'read_model_projection_failed', status: 'holds' });
    });

    it('does not claim the window is complete: an available-but-empty window is distinct from a failed one', () => {
        const empty = buildAvailable({ status: 'available', workouts: [] });
        expect(empty.projection).toBe('available');
        expect(empty.totalWorkouts).toBe(0);
        expect(empty.workouts).toEqual([]);
    });

    it.each(['completed', 'incomplete', 'failed', 'not_run'] as const)(
        'records the window sweep status (%s) so an empty export is not read as "nothing happened"',
        sweep => {
            expect(buildAvailable({ status: 'available', workouts: [] }, sweep).reconciliationSweep).toBe(sweep);
            expect(build({ status: 'projection_failed' }, sweep).reconciliationSweep).toBe(sweep);
        },
    );
});

describe('export privacy (invariant I6: ids, states, reasons and timestamps only)', () => {
    const canaries = {
        hr: 171234,
        load: 987654,
        exercise: 'CANARY_EXERCISE_NAME',
        title: 'CANARY_SESSION_TITLE',
        actor: 'canary-actor-uid',
        manualReason: 'CANARY manual reason text',
    };
    const richView = workoutView({
        garmin: garminActivity({
            averageHr: canaries.hr,
            maxHr: canaries.hr + 1,
            activityTrainingLoad: canaries.load,
            exerciseSets: [{ setOrder: 0, setType: 'active', exerciseName: canaries.exercise, repetitionCount: 424242, weightKg: 313131 }],
            hrInZones: [{ zone: 1, seconds: 515151 } as never],
            activityResponse: { canary: 'CANARY_TELEMETRY' } as never,
        }),
        structured: {
            title: canaries.title,
            comparison: {} as never,
            steps: [],
            performedRest: 'recorded',
        },
        reconciliation: {
            state: 'matched',
            matcherVersion: 'matcher-v2',
            policyVersion: 'policy-v1',
            confidence: 0.9,
            features: { canaryFeature: 777777 },
            manualDecision: { decision: 'link', actor: canaries.actor, decidedAt: '2026-08-26T08:00:00.000Z', reason: canaries.manualReason },
        },
    });

    it('contains no telemetry, titles, free text, actors or feature values', () => {
        const json = serializeWorkoutDiagnosticsExport(buildAvailable({ status: 'available', workouts: [richView] }));
        for (const canary of [
            String(canaries.hr), String(canaries.load), canaries.exercise, canaries.title, canaries.actor,
            canaries.manualReason, 'CANARY_TELEMETRY', '424242', '313131', '515151', '777777',
        ]) {
            expect(json).not.toContain(canary);
        }
    });

    it('contains no raw-payload field names', () => {
        const json = serializeWorkoutDiagnosticsExport(buildAvailable({ status: 'available', workouts: [richView] }));
        for (const forbidden of [
            'exerciseSets', 'averageHr', 'maxHr', 'hrInZones', 'powerInZones', 'laps', 'activityResponse', 'payload',
            'weightKg', 'features', 'actor', 'title', 'steps', 'comparison', 'token', 'password', 'secret',
        ]) {
            expect(json).not.toContain(`"${forbidden}"`);
        }
    });

    it('keeps the decision and its timestamp, which are the useful part of a manual override', () => {
        const [entry] = buildAvailable({ status: 'available', workouts: [richView] }).workouts;
        expect(entry.reconciliation.manualDecision).toEqual({ decision: 'link', decidedAt: '2026-08-26T08:00:00.000Z' });
    });
});
