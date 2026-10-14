/**
 * Real reconciliation + authenticated Firestore proofs for issue #895 WP5: the diagnostics
 * projection must tell a genuinely ambiguous candidate (state 7) from "no candidate" (state 6),
 * and a Garmin-only workout must report the structured execution as absent (state 1).
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import type { NormalizedGarminActivity } from '../engine/models';
import type { SessionExecution } from '../sessions/models';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';

// Only application wiring/read boundaries are replaced; reconciliation, the occurrence
// repository and the read-model projection stay real.
const wiring = vi.hoisted(() => ({
    db: undefined as Firestore | undefined,
    executions: [] as SessionExecution[],
    activities: [] as NormalizedGarminActivity[],
}));
vi.mock('../firebase', () => ({ getDb: () => wiring.db }));
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: {
        getExecutionsInRange: async () => ({
            executions: wiring.executions.map((execution) => ({ execution, entries: [] })),
            invalidRecords: 0,
        }),
        getExecution: async (_userId: string, executionId: string) => {
            const data = wiring.executions.find((execution) => execution.executionId === executionId);
            return data ? { status: 'AVAILABLE', data, revision: null } : { status: 'MISSING' };
        },
        getEntries: async () => [],
        getRestEvents: async () => [],
        getDiaryReceipts: () => [],
    },
}));
vi.mock('../sessions/sessionDefinitionResolver', () => ({
    resolveSessionDefinition: async () => ({
        status: 'AVAILABLE',
        data: { schemaVersion: 1, id: 'strength-1', revision: 1, title: 'Strength', intent: 'training', blocks: [] },
        revision: null,
    }),
}));
vi.mock('../services/activityService', () => ({
    activityService: {
        getActivitiesInRange: async () => ({ status: 'AVAILABLE', data: wiring.activities, revision: null }),
    },
}));

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-895-wp5';
const DATE = '2026-09-29';
const START = '2026-09-29T06:52:00.000Z';
const END = '2026-09-29T07:32:00.000Z';

function execution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: USER_ID,
        executionId: 'exec-1',
        occurrenceId: 'planned-1',
        sessionSource: { kind: 'catalog', workoutId: 'strength-1', catalogVersion: '1' },
        date: DATE,
        startedAt: START,
        completedAt: END,
        updatedAt: END,
        state: 'completed',
        schemaVersion: 1,
        ...overrides,
    };
}

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'act-1',
        date: DATE,
        startedAt: '2026-09-29T06:53:00.000Z',
        endedAt: '2026-09-29T07:33:00.000Z',
        type: 'strength_training',
        durationMin: 40,
        trainingEffectAerobic: null,
        trainingEffectAnaerobic: null,
        averageHr: null,
        activityTrainingLoad: null,
        intensityTag: 'moderate',
        exerciseSets: [{ setOrder: 0, setType: 'active', exerciseName: 'squat', repetitionCount: 5, weightKg: 100 }],
        ...overrides,
    };
}

emulatorDescribe('Workout source diagnostics against real reconciliation (#895 WP5)', () => {
    let testEnvironment: RulesTestEnvironment;
    let repo: (typeof import('../training-occurrence/repository'))['performedTrainingOccurrenceRepository'];
    let reconciliation: typeof import('../training-occurrence/reconciliationService');
    let readModel: typeof import('../training-occurrence/activitiesReadModelService');
    let diagnostics: typeof import('../training-occurrence/workoutSourceDiagnostics');

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-895-wp5-diagnostics',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        wiring.db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
        repo = (await import('../training-occurrence/repository')).performedTrainingOccurrenceRepository;
        reconciliation = await import('../training-occurrence/reconciliationService');
        readModel = await import('../training-occurrence/activitiesReadModelService');
        diagnostics = await import('../training-occurrence/workoutSourceDiagnostics');
    });
    beforeEach(() => {
        wiring.executions = [];
        wiring.activities = [];
    });
    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });
    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    async function views(sweep: 'completed' | 'failed' | 'not_run' = 'completed'): Promise<CompletedWorkoutView[]> {
        return readModel.getCompletedWorkoutsInRange(USER_ID, DATE, '2026-09-30', undefined, { reconciliationSweep: sweep });
    }

    function stateOf(view: CompletedWorkoutView) {
        return diagnostics.projectWorkoutSourceDiagnostics(view).states;
    }

    it('reports a real ambiguous Garmin candidate as state 7 -- and not as state 6 -- while the execution is absent (state 1)', async () => {
        // Two equally plausible structured sessions compete for one Garmin recording.
        await repo.createOrGetForSource(USER_ID, reconciliation.structuredExecutionToFacts(execution(), 'strength'));
        await repo.createOrGetForSource(
            USER_ID,
            reconciliation.structuredExecutionToFacts(execution({ executionId: 'exec-2' }), 'strength'),
        );
        wiring.executions = [execution(), execution({ executionId: 'exec-2' })];
        wiring.activities = [activity()];
        const result = await reconciliation.reconcileGarminActivity(USER_ID, activity());
        expect(result.outcome).toBe('ambiguous');
        // A genuinely completed sweep, so "completed" below is true rather than assumed.
        const sweep = await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');
        expect(sweep).toMatchObject({ activitiesReadable: true, sourceErrors: 0 });

        const allViews = await views();
        const garminView = allViews.find((view) => view.sourceKeys.includes('provider_activity:garmin:act-1'));
        expect(garminView).toBeDefined();
        const states = stateOf(garminView!);
        expect(states.reconciliation_ambiguous).toEqual({ status: 'holds', reasons: ['competing_or_weak_candidates'] });
        expect(states.reconciliation_no_candidate).toEqual({ status: 'clear' });
        expect(states.session_execution_absent).toEqual({ status: 'holds', reasons: ['no_execution_linked'] });
        expect(states.garmin_activity_absent).toEqual({ status: 'clear' });
        expect(diagnostics.projectWorkoutSourceDiagnostics(garminView!).reconciliationOutcome)
            .toEqual({ status: 'observed', outcome: 'ambiguous' });
        expect(diagnostics.projectWorkoutSourceDiagnostics(garminView!).attention).toContain('reconciliation_ambiguous');

        // The competing structured sessions stay `single_source` in storage, but they must not be
        // told "no candidate was found" while their Garmin counterpart is recorded as ambiguous.
        const structuredViews = allViews.filter((view) => view.sourceBadge.hasStructured);
        expect(structuredViews).toHaveLength(2);
        for (const view of structuredViews) {
            expect(view.reconciliation.state).toBe('single_source');
            expect(stateOf(view).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason: 'counterpart_ambiguous' });
        }
    });

    it('reports a structured-only workout with no candidate as state 6 -- distinct from state 7', async () => {
        wiring.executions = [execution()];
        await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');

        const [view] = await views();
        const states = stateOf(view);
        expect(states.reconciliation_no_candidate).toEqual({ status: 'holds', reasons: ['no_candidate_after_sweep'] });
        expect(states.reconciliation_ambiguous).toEqual({ status: 'clear' });
        expect(states.garmin_activity_absent).toEqual({ status: 'holds', reasons: ['no_provider_linked'] });
        expect(states.session_execution_absent).toEqual({ status: 'clear' });
        expect(diagnostics.projectWorkoutSourceDiagnostics(view).reconciliationOutcome)
            .toEqual({ status: 'observed', outcome: 'created_single_source' });
    });

    it('does not claim "no candidate" when the sweep did not complete', async () => {
        wiring.executions = [execution()];
        await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');

        const [failed] = await views('failed');
        expect(stateOf(failed).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason: 'sweep_failed' });
        const [notRun] = await views('not_run');
        expect(stateOf(notRun).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason: 'sweep_not_run' });
    });

    it('reports a Garmin-only workout as having no structured execution (state 1) and a clear Garmin record', async () => {
        wiring.activities = [activity()];
        await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');

        const [view] = await views();
        const states = stateOf(view);
        expect(states.session_execution_absent).toEqual({ status: 'holds', reasons: ['no_execution_linked'] });
        expect(states.entry_write_unsettled).toEqual({ status: 'not_applicable', reason: 'no_execution_linked' });
        expect(states.garmin_activity_absent).toEqual({ status: 'clear' });
        expect(states.garmin_detail_unavailable).toEqual({ status: 'clear' });
        // Expected single-source facts are explained but do not raise a notice.
        expect(diagnostics.projectWorkoutSourceDiagnostics(view).attention).toEqual([]);
    });

    it('reports a matched structured + Garmin workout as complete', async () => {
        wiring.executions = [execution()];
        wiring.activities = [activity()];
        await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');

        const [view] = await views();
        expect(view.sourceBadge).toEqual({ hasStructured: true, hasProvider: true, providers: ['garmin'] });
        const states = stateOf(view);
        expect(states.session_execution_absent).toEqual({ status: 'clear' });
        expect(states.garmin_activity_absent).toEqual({ status: 'clear' });
        expect(states.reconciliation_no_candidate).toEqual({ status: 'clear' });
        expect(states.reconciliation_ambiguous).toEqual({ status: 'clear' });
        expect(states.read_model_projection_failed).toEqual({ status: 'clear' });
        expect(diagnostics.projectWorkoutSourceDiagnostics(view).attention).toEqual([]);
    });

    it('reports a linked execution whose document is gone as state 1 (document missing), not as a read failure', async () => {
        wiring.executions = [execution()];
        await reconciliation.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');
        wiring.executions = []; // the execution document disappears after reconciliation

        const [view] = await views();
        const states = stateOf(view);
        expect(states.session_execution_absent).toEqual({ status: 'holds', reasons: ['execution_document_missing'] });
        expect(states.read_model_projection_failed).toEqual({ status: 'clear' });
    });
});
