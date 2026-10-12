/** Real authenticated reconciliation/transaction proofs for issue #895 WP4. */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, type Firestore } from 'firebase/firestore';
import type { NormalizedGarminActivity } from '../engine/models';
import type { SessionExecution } from '../sessions/models';
import { sourceKeyForRef } from '../training-occurrence/sourceIdentity';

// Only application wiring/read boundaries are replaced; reconciliation and Firestore stay real.
const wiring = vi.hoisted(() => ({
    db: undefined as Firestore | undefined,
    executions: [] as SessionExecution[],
    activities: [] as NormalizedGarminActivity[],
}));
vi.mock('../firebase', () => ({ getDb: () => wiring.db }));
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: {
        getExecutionsInRange: async () => ({
            executions: wiring.executions.map((execution) => ({
                execution,
                entries: [],
            })),
            invalidRecords: 0,
        }),
    },
}));
vi.mock('../services/activityService', () => ({
    activityService: {
        getActivitiesInRange: async () => ({
            status: 'AVAILABLE',
            data: wiring.activities,
            revision: null,
        }),
    },
}));
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-895-ordering';
const DATE = '2026-09-29';
const START = '2026-09-29T06:52:00.000Z';
const END = '2026-09-29T07:32:00.000Z';
const FINGERPRINT = 'fit-workout-v2:0123456789abcdef0123456789abcdef';
function execution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: USER_ID,
        executionId: 'exec-1',
        occurrenceId: 'planned-1',
        sessionSource: {
            kind: 'catalog',
            workoutId: 'strength-1',
            catalogVersion: '1',
        },
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
        ...overrides,
    };
}
emulatorDescribe('Training-occurrence arrival ordering (#895 WP4)', () => {
    let testEnvironment: RulesTestEnvironment;
    let repo: (typeof import('../training-occurrence/repository'))['performedTrainingOccurrenceRepository'];
    let service: typeof import('../training-occurrence/reconciliationService');
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-895-reconciliation-ordering',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        wiring.db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
        repo = (await import('../training-occurrence/repository')).performedTrainingOccurrenceRepository;
        service = await import('../training-occurrence/reconciliationService');
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
    async function sweep() {
        await service.reconcileDateRangeForUser(USER_ID, DATE, '2026-09-30');
    }
    async function persisted() {
        const snapshots = await Promise.all(
            ['performedTrainingOccurrences', 'performedOccurrenceSourceLinks'].map((name) =>
                getDocs(collection(wiring.db!, 'users', USER_ID, name)),
            ),
        );
        return snapshots.map((snapshot) =>
            snapshot.docs
                .map((document) => ({ id: document.id, ...document.data() }))
                .sort((a, b) => a.id.localeCompare(b.id)),
        );
    }
    async function expectConverged(survivorId: string, structured = execution(), provider = activity()) {
        const active = await repo.queryActiveInDateWindow(USER_ID, DATE, DATE);
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({
            performedOccurrenceId: survivorId,
            status: 'active',
            localDate: DATE,
            modality: 'strength',
            startedAt: structured.startedAt,
            endedAt: structured.completedAt,
        });
        expect(active[0].sourceRefs).toHaveLength(2);
        for (const key of [
            `structured_execution:${structured.executionId}`,
            `provider_activity:garmin:${provider.activityId}`,
        ]) {
            expect((await repo.getBySourceKey(USER_ID, key))?.performedOccurrenceId).toBe(survivorId);
        }
        const beforeRetry = await persisted();
        await sweep();
        await sweep();
        expect(await persisted()).toEqual(beforeRetry);
    }
    it.each(['structured-first', 'provider-first'] as const)(
        '%s retains its first exposed identity across retries and sweeps',
        async (order) => {
            const first =
                order === 'structured-first'
                    ? await service.reconcileStructuredCompletion(USER_ID, execution(), 'strength')
                    : await service.reconcileGarminActivity(USER_ID, activity());
            expect(first.outcome).toBe('created_single_source');
            const second =
                order === 'structured-first'
                    ? await service.reconcileGarminActivity(USER_ID, activity())
                    : await service.reconcileStructuredCompletion(USER_ID, execution(), 'strength');
            expect(second.outcome).toBe('attached_auto_link');
            wiring.executions = [execution()];
            wiring.activities = [activity()];
            await expectConverged(first.occurrence!.performedOccurrenceId);
        },
    );
    it('late provider detail refreshes the same source before the sweep converges single-source duplicates', async () => {
        const first = await service.reconcileGarminActivity(
            USER_ID,
            activity({ startedAt: undefined, endedAt: undefined, type: 'other' }),
        );
        expect(first.outcome).toBe('created_single_source');
        const second = await service.reconcileStructuredCompletion(USER_ID, execution(), 'strength');
        expect(second.outcome).toBe('created_single_source');
        expect(await repo.queryActiveInDateWindow(USER_ID, DATE, DATE)).toHaveLength(2);
        wiring.executions = [execution()];
        wiring.activities = [
            activity({
                fitWorkoutFingerprint: FINGERPRINT,
                fitWorkoutFingerprintKind: 'semantic_definition',
            }),
        ];
        await sweep();
        await expectConverged(first.occurrence!.performedOccurrenceId);
        expect(
            (await repo.getBySourceKey(USER_ID, 'provider_activity:garmin:act-1'))?.sourceRefs.find(
                (ref) => ref.kind === 'provider_activity',
            ),
        ).toMatchObject({
            fitWorkoutFingerprint: FINGERPRINT,
            fitWorkoutFingerprintKind: 'semantic_definition',
        });
    });
    it('same-ID device update enriches the provider record without eroding facts or rewriting identical retries', async () => {
        const first = await service.reconcileGarminActivity(USER_ID, activity({ endedAt: undefined }));
        const updated = activity({
            endedAt: '2026-09-29T07:40:00.000Z',
            durationMin: 47,
            fitWorkoutFingerprint: FINGERPRINT,
            fitWorkoutFingerprintKind: 'semantic_definition',
        });
        const result = await service.reconcileGarminActivity(USER_ID, updated);
        expect(result.outcome).toBe('already_linked');
        expect(result.occurrence).toMatchObject({
            performedOccurrenceId: first.occurrence!.performedOccurrenceId,
            endedAt: updated.endedAt,
        });
        expect(result.occurrence?.sourceRefs).toHaveLength(1);
        expect(result.occurrence?.sourceRefs[0]).toMatchObject({
            fitWorkoutFingerprint: FINGERPRINT,
        });
        wiring.activities = [updated];
        const beforeRetry = await persisted();
        await sweep();
        await sweep();
        expect(await persisted()).toEqual(beforeRetry);
        await service.reconcileGarminActivity(USER_ID, activity({ startedAt: undefined, endedAt: undefined }));
        const known = await repo.getBySourceKey(USER_ID, 'provider_activity:garmin:act-1');
        expect(known?.endedAt).toBe(updated.endedAt);
        expect(known?.sourceRefs[0]).toMatchObject({
            fitWorkoutFingerprint: FINGERPRINT,
        });
    });
    it('late offline execution attaches to the updated device identity and remains authoritative on provider refresh', async () => {
        const first = await service.reconcileGarminActivity(USER_ID, activity());
        await service.reconcileGarminActivity(USER_ID, activity({ endedAt: '2026-09-29T07:40:00.000Z' }));
        wiring.executions = [execution()];
        wiring.activities = [activity({ endedAt: '2026-09-29T07:40:00.000Z' })];
        await sweep();
        wiring.activities = [
            activity({
                startedAt: '2026-09-29T06:50:00.000Z',
                endedAt: '2026-09-29T07:45:00.000Z',
                type: 'cycling',
            }),
        ];
        await sweep();
        await expectConverged(first.occurrence!.performedOccurrenceId);
    });
    it('two genuine same-day workouts retain distinct identities and their own provider links', async () => {
        const otherFingerprint = 'fit-workout-v2:fedcba9876543210fedcba9876543210';
        const morning = execution({
            fitWorkoutFingerprint: FINGERPRINT,
            fitWorkoutFingerprintKind: 'semantic_definition',
        });
        const evening = execution({
            executionId: 'exec-2',
            occurrenceId: 'planned-2',
            startedAt: '2026-09-29T18:00:00.000Z',
            completedAt: '2026-09-29T18:40:00.000Z',
            fitWorkoutFingerprint: otherFingerprint,
            fitWorkoutFingerprintKind: 'semantic_definition',
        });
        const first = await service.reconcileStructuredCompletion(USER_ID, morning, 'strength');
        const second = await service.reconcileStructuredCompletion(USER_ID, evening, 'strength');
        wiring.executions = [morning, evening];
        wiring.activities = [
            activity({
                fitWorkoutFingerprint: FINGERPRINT,
                fitWorkoutFingerprintKind: 'semantic_definition',
            }),
            activity({
                activityId: 'act-2',
                startedAt: evening.startedAt,
                endedAt: evening.completedAt!,
                fitWorkoutFingerprint: otherFingerprint,
                fitWorkoutFingerprintKind: 'semantic_definition',
            }),
        ];
        await sweep();
        await sweep();
        expect(await repo.queryActiveInDateWindow(USER_ID, DATE, DATE)).toHaveLength(2);
        for (const [id, executionId, activityId] of [
            [first.occurrence!.performedOccurrenceId, 'exec-1', 'act-1'],
            [second.occurrence!.performedOccurrenceId, 'exec-2', 'act-2'],
        ]) {
            expect(
                (await repo.getBySourceKey(USER_ID, `structured_execution:${executionId}`))?.performedOccurrenceId,
            ).toBe(id);
            expect(
                (await repo.getBySourceKey(USER_ID, `provider_activity:garmin:${activityId}`))?.performedOccurrenceId,
            ).toBe(id);
        }
        const beforeRetry = await persisted();
        await sweep();
        expect(await persisted()).toEqual(beforeRetry);
    });
    it.each(['missing timestamps', 'competing candidates'] as const)(
        '%s remains durably ambiguous after enrichment and sweeps',
        async (scenario) => {
            if (scenario === 'missing timestamps') {
                await service.reconcileGarminActivity(USER_ID, activity({ startedAt: undefined, endedAt: undefined }));
            } else {
                await repo.createOrGetForSource(USER_ID, service.structuredExecutionToFacts(execution(), 'strength'));
                await repo.createOrGetForSource(
                    USER_ID,
                    service.structuredExecutionToFacts(execution({ executionId: 'exec-2' }), 'strength'),
                );
            }
            const result =
                scenario === 'missing timestamps'
                    ? await service.reconcileStructuredCompletion(USER_ID, execution(), 'strength')
                    : await service.reconcileGarminActivity(USER_ID, activity());
            expect(result.outcome).toBe('ambiguous');
            wiring.executions = [execution()];
            wiring.activities = [activity()];
            await sweep();
            await sweep();
            expect(await repo.queryActiveInDateWindow(USER_ID, DATE, DATE)).toHaveLength(
                scenario === 'missing timestamps' ? 2 : 3,
            );
            const ambiguousKey =
                scenario === 'missing timestamps' ? 'structured_execution:exec-1' : 'provider_activity:garmin:act-1';
            expect((await repo.getBySourceKey(USER_ID, ambiguousKey))?.reconciliation.state).toBe('ambiguous');
        },
    );
    it.each(['link', 'unlink', 'keep_separate'] as const)(
        'manual %s survives source enrichment, retry and repeated sweeps',
        async (decision) => {
            const structuredFacts = service.structuredExecutionToFacts(execution(), 'strength');
            const providerFacts = service.garminActivityToFacts(activity());
            const { occurrence: structured } = await repo.createOrGetForSource(
                USER_ID,
                structuredFacts,
                decision === 'keep_separate'
                    ? {
                          state: 'single_source',
                          manualDecision: { decision, actor: USER_ID, decidedAt: END },
                          excludedSourceKeys: ['provider_activity:garmin:act-1'],
                      }
                    : undefined,
            );
            const { occurrence: provider } = await repo.createOrGetForSource(
                USER_ID,
                providerFacts,
                decision === 'keep_separate'
                    ? {
                          state: 'single_source',
                          manualDecision: { decision, actor: USER_ID, decidedAt: END },
                          excludedSourceKeys: ['structured_execution:exec-1'],
                      }
                    : undefined,
            );
            if (decision !== 'keep_separate') {
                await repo.mergeOccurrences(USER_ID, structured.performedOccurrenceId, provider.performedOccurrenceId, {
                    state: 'matched',
                    manualDecision: {
                        decision: 'link',
                        actor: USER_ID,
                        decidedAt: END,
                    },
                });
                if (decision === 'unlink')
                    await repo.unlinkSource(
                        USER_ID,
                        structured.performedOccurrenceId,
                        sourceKeyForRef(providerFacts.sourceRef),
                        USER_ID,
                    );
            }
            const before = await repo.queryActiveInDateWindow(USER_ID, DATE, DATE);
            wiring.executions = [execution()];
            wiring.activities = [
                activity({
                    endedAt: '2026-09-29T07:40:00.000Z',
                    fitWorkoutFingerprint: FINGERPRINT,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }),
            ];
            await sweep();
            await sweep();
            const after = await repo.queryActiveInDateWindow(USER_ID, DATE, DATE);
            expect(after).toHaveLength(decision === 'link' ? 1 : 2);
            for (const original of before) {
                expect(
                    after.find((value) => value.performedOccurrenceId === original.performedOccurrenceId)
                        ?.reconciliation,
                ).toEqual(original.reconciliation);
                for (const ref of original.sourceRefs)
                    expect((await repo.getBySourceKey(USER_ID, sourceKeyForRef(ref)))?.performedOccurrenceId).toBe(
                        original.performedOccurrenceId,
                    );
            }
            expect(
                (await repo.getBySourceKey(USER_ID, 'provider_activity:garmin:act-1'))?.sourceRefs.find(
                    (ref) => ref.kind === 'provider_activity',
                ),
            ).toMatchObject({ fitWorkoutFingerprint: FINGERPRINT });
            const beforeRetry = await persisted();
            await sweep();
            expect(await persisted()).toEqual(beforeRetry);
        },
    );
    it('concurrent same-source enrichment retains independent new facts under the transactional claim', async () => {
        const first = await service.reconcileGarminActivity(
            USER_ID,
            activity({ startedAt: undefined, endedAt: undefined }),
        );
        const results = await Promise.all([
            service.reconcileGarminActivity(USER_ID, activity()),
            service.reconcileGarminActivity(
                USER_ID,
                activity({
                    startedAt: undefined,
                    endedAt: undefined,
                    fitWorkoutFingerprint: FINGERPRINT,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }),
            ),
        ]);
        expect(results.map((result) => result.outcome)).toEqual(['already_linked', 'already_linked']);
        const stored = await repo.getBySourceKey(USER_ID, 'provider_activity:garmin:act-1');
        expect(stored).toMatchObject({
            performedOccurrenceId: first.occurrence!.performedOccurrenceId,
            startedAt: activity().startedAt,
            endedAt: activity().endedAt,
        });
        expect(stored?.sourceRefs).toHaveLength(1);
        expect(stored?.sourceRefs[0]).toMatchObject({
            fitWorkoutFingerprint: FINGERPRINT,
        });
    });
});
