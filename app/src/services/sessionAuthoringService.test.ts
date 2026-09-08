import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recommendation } from '../engine/models';
import type { ExecutionPrescription } from '../sessions/models';

const services = vi.hoisted(() => {
    const store = new Map<string, ExecutionPrescription>();
    return {
        store,
        prescription: {
            savePrescription: vi.fn(async (_userId: string, prescription: ExecutionPrescription) => {
                if (store.has(prescription.prescriptionHash)) {
                    // write-once semantics matching ExecutionPrescriptionService.savePrescription
                    return;
                }
                store.set(prescription.prescriptionHash, prescription);
            }),
        },
        occurrence: {
            saveOccurrence: vi.fn().mockResolvedValue(undefined),
            getOccurrence: vi.fn().mockImplementation(async (userId: string, occurrenceId: string) => ({
                status: 'AVAILABLE' as const,
                data: {
                    userId,
                    occurrenceId,
                    date: '2026-09-06',
                    authority: 'external_plan' as const,
                    externalPlanRef: {
                        planId: 'plan-xyz',
                        revision: 2,
                        sessionId: 'session-101',
                        contentHash: 'c'.repeat(64),
                    },
                    state: 'scheduled' as const,
                    createdAt: '2026-09-06T12:00:00.000Z',
                    updatedAt: '2026-09-06T12:00:00.000Z',
                },
            })),
            getOrCreateExternalPlanOccurrence: vi.fn().mockImplementation(async (userId, date, ref) => ({
                userId,
                occurrenceId: 'occ-ext-created',
                date,
                authority: 'external_plan',
                externalPlanRef: ref,
                state: 'scheduled',
                createdAt: '2026-09-06T12:00:00.000Z',
                updatedAt: '2026-09-06T12:00:00.000Z',
            })),
        },
    };
});

vi.mock('./executionPrescriptionService', () => ({ executionPrescriptionService: services.prescription }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: services.occurrence }));

import { resolveWorkoutPrescription } from '../workouts/prescription';
import { prepareAuthoredOccurrenceLaunch, prepareCatalogSessionLaunch, prepareExternalPlanSessionLaunch } from './sessionAuthoringService';
import type { SessionDefinition } from '../sessions/models';
import type { ExternalPlanSessionV4 } from '../sessions/externalPlanV4';

beforeEach(() => {
    services.store.clear();
    services.prescription.savePrescription.mockClear();
    services.occurrence.saveOccurrence.mockClear();
    services.occurrence.getOccurrence.mockClear();
    services.occurrence.getOrCreateExternalPlanOccurrence.mockClear();
});

function makeTestPrescription(templateId: string) {
    const rec = {
        date: '2026-08-18',
        template: {
            id: templateId,
            name: 'Full Body Maintenance',
            modality: 'strength',
            role: 'anchor',
            category: 'full_body_strength',
            durationMin: 45,
            durationMax: 60,
        },
    } as unknown as Recommendation;

    return resolveWorkoutPrescription(rec, 'test-user', '2026-08-18')!;
}

describe('prepareCatalogSessionLaunch (M3.1/M3.4)', () => {
    it('saves a write-once prescription and returns a catalog binding with no occurrence', async () => {
        const presc = makeTestPrescription('str_full_01');
        const launch = await prepareCatalogSessionLaunch('u1', presc);

        expect(launch.binding.sessionSource).toEqual({
            kind: 'catalog', workoutId: presc.workoutId, catalogVersion: String(presc.workoutVersion),
        });
        expect(launch.binding.occurrenceId).toBeUndefined();
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(services.occurrence.saveOccurrence).not.toHaveBeenCalled();
        expect(services.prescription.savePrescription).toHaveBeenCalledTimes(1);
        const [, saved] = services.prescription.savePrescription.mock.calls[0];
        expect(saved.prescriptionHash).toBe(launch.binding.prescriptionHash);
        expect(saved.sessionSource).toEqual(launch.binding.sessionSource);
        expect(saved.blocks).toEqual(launch.definition.blocks);
    });

    it('is idempotent: composing the same prescription twice produces the same hash', async () => {
        const presc = makeTestPrescription('str_upper_01');
        const first = await prepareCatalogSessionLaunch('u1', presc);
        const second = await prepareCatalogSessionLaunch('u1', presc);
        expect(second.binding.prescriptionHash).toBe(first.binding.prescriptionHash);
    });
});

describe('prepareAuthoredOccurrenceLaunch (M3.3)', () => {
    it('stores a distinct content-addressed prescription while retaining the source definition hash', async () => {
        const source = {
            kind: 'manual' as const,
            definitionId: 'manual-1',
            revision: 2,
            contentHash: 'a'.repeat(64),
        };
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'manual-1',
            revision: 2,
            title: 'Scaled strength',
            intent: 'training',
            blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [
                { id: 'squat', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 } },
            ] }],
        };

        const launch = await prepareAuthoredOccurrenceLaunch('u1', source, 'occ-1', definition, '2026-08-19T00:00:00.000Z');

        expect(launch.binding).toMatchObject({ sessionSource: source, occurrenceId: 'occ-1' });
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(launch.binding.prescriptionHash).not.toBe(source.contentHash);
        const lastSave = services.prescription.savePrescription.mock.calls.at(-1);
        expect(lastSave).toBeDefined();
        const saved = lastSave![1];
        expect(saved.sessionSource).toEqual(source);
        expect(saved.definitionHash).toBe(source.contentHash);
        expect(saved.blocks).toEqual(definition.blocks);
    });
});

describe('prepareExternalPlanSessionLaunch (ADR-0036 H4)', () => {
    function makeV4ExternalPlan(overrides?: Partial<SessionDefinition>): {
        planId: string;
        revision: number;
        contentHash: string;
        session: ExternalPlanSessionV4;
    } {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'ext-session-1',
            revision: 1,
            title: 'VO2 Max Intervals',
            summary: '5x3min intervals at 115% FTP',
            intent: 'training',
            dominantModality: 'cycling',
            duration: { min: 60, max: 60 },
            blocks: [{
                id: 'main',
                role: 'main',
                executionMode: 'sequential',
                steps: [
                    { id: 'interval-1', kind: 'exercise', title: 'Work', exerciseRef: { kind: 'catalog', exerciseId: 'cycling-work' }, dose: { kind: 'duration', seconds: 180 } },
                ],
            }],
            ...overrides,
        };

        return {
            planId: 'plan-xyz',
            revision: 2,
            contentHash: 'c'.repeat(64),
            session: {
                id: 'session-101',
                title: 'VO2 Max Intervals',
                priority: 'key',
                placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' },
                gating: {
                    modality: 'cycling',
                    intensity: 'hard',
                    durationMin: 60,
                    durationMax: 60,
                    environment: 'indoor',
                    equipment: ['indoor_bike'],
                },
                definition,
            },
        };
    }

    it('saves a write-once prescription and returns an external_plan binding with no occurrence', async () => {
        const externalPlan = makeV4ExternalPlan();
        const launch = await prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, '2026-09-06T12:00:00.000Z');

        expect(launch.binding.sessionSource).toEqual({
            kind: 'external_plan',
            planId: 'plan-xyz',
            revision: 2,
            sessionId: 'session-101',
            contentHash: 'c'.repeat(64),
        });
        expect(launch.binding.occurrenceId).toBeUndefined();
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(services.occurrence.saveOccurrence).not.toHaveBeenCalled();

        const lastSave = services.prescription.savePrescription.mock.calls.at(-1);
        expect(lastSave).toBeDefined();
        const [savedUserId, savedPrescription] = lastSave!;
        expect(savedUserId).toBe('u1');
        expect(savedPrescription.prescriptionHash).toBe(launch.binding.prescriptionHash);
        expect(savedPrescription.sessionSource).toEqual(launch.binding.sessionSource);
        expect(savedPrescription.blocks).toEqual(externalPlan.session.definition.blocks);
        expect(savedPrescription.displayMetadata).toEqual({
            title: 'VO2 Max Intervals',
            summary: '5x3min intervals at 115% FTP',
            intent: 'training',
            dominantModality: 'cycling',
            duration: { min: 60, max: 60 },
        });
        expect(savedPrescription.createdAt).toBe('2026-09-06T12:00:00.000Z');
    });

    it('creates and binds an external-plan occurrence when date is provided in options', async () => {
        const externalPlan = makeV4ExternalPlan();
        const launch = await prepareExternalPlanSessionLaunch('u1', externalPlan, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });

        expect(launch.binding.sessionSource.kind).toBe('external_plan');
        expect(launch.binding.occurrenceId).toBe('occ-ext-created');
        expect(services.occurrence.getOrCreateExternalPlanOccurrence).toHaveBeenCalledWith(
            'u1',
            '2026-09-06',
            {
                planId: 'plan-xyz',
                revision: 2,
                sessionId: 'session-101',
                contentHash: 'c'.repeat(64),
            },
            {
                placementOrder: undefined,
                windowBinding: undefined,
                now: '2026-09-06T12:00:00.000Z',
            },
        );
    });

    it('rejects a date-only launch when existing occurrence is in a terminal state', async () => {
        const externalPlan = makeV4ExternalPlan();
        services.occurrence.getOrCreateExternalPlanOccurrence.mockResolvedValueOnce({
            userId: 'u1',
            occurrenceId: 'occ-ext-completed',
            date: '2026-09-06',
            authority: 'external_plan',
            externalPlanRef: {
                planId: 'plan-xyz',
                revision: 2,
                sessionId: 'session-101',
                contentHash: 'c'.repeat(64),
            },
            state: 'completed',
            createdAt: '2026-09-06T12:00:00.000Z',
            updatedAt: '2026-09-06T12:00:00.000Z',
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        })).rejects.toThrow(/does not match the launch source/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('validates and binds a supplied external-plan occurrence before persisting the prescription', async () => {
        const externalPlan = makeV4ExternalPlan();
        const launch = await prepareExternalPlanSessionLaunch('u1', externalPlan, {
            occurrenceId: 'occ-ext-existing',
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });

        expect(services.occurrence.getOccurrence).toHaveBeenCalledWith('u1', 'occ-ext-existing');
        expect(services.occurrence.getOrCreateExternalPlanOccurrence).not.toHaveBeenCalled();
        expect(launch.binding.occurrenceId).toBe('occ-ext-existing');
        expect(services.prescription.savePrescription).toHaveBeenCalledTimes(1);
    });

    it('rejects a supplied occurrence whose external source identity does not match', async () => {
        const externalPlan = makeV4ExternalPlan();
        services.occurrence.getOccurrence.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                userId: 'u1',
                occurrenceId: 'occ-ext-wrong',
                date: '2026-09-06',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-xyz',
                    revision: 2,
                    sessionId: 'different-session',
                    contentHash: 'c'.repeat(64),
                },
                state: 'scheduled',
                createdAt: '2026-09-06T12:00:00.000Z',
                updatedAt: '2026-09-06T12:00:00.000Z',
            },
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            occurrenceId: 'occ-ext-wrong',
            date: '2026-09-06',
        })).rejects.toThrow(/does not match the launch source/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('rejects a supplied occurrence from a different recommendation date', async () => {
        const externalPlan = makeV4ExternalPlan();
        services.occurrence.getOccurrence.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                userId: 'u1',
                occurrenceId: 'occ-ext-existing',
                date: '2026-09-05',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-xyz',
                    revision: 2,
                    sessionId: 'session-101',
                    contentHash: 'c'.repeat(64),
                },
                state: 'scheduled',
                createdAt: '2026-09-05T12:00:00.000Z',
                updatedAt: '2026-09-05T12:00:00.000Z',
            },
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            occurrenceId: 'occ-ext-existing',
            date: '2026-09-06',
        })).rejects.toThrow(/expected 2026-09-06/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('rejects a supplied occurrence that is already in completed state', async () => {
        const externalPlan = makeV4ExternalPlan();
        services.occurrence.getOccurrence.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                userId: 'u1',
                occurrenceId: 'occ-ext-completed',
                date: '2026-09-06',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-xyz',
                    revision: 2,
                    sessionId: 'session-101',
                    contentHash: 'c'.repeat(64),
                },
                state: 'completed',
                createdAt: '2026-09-06T12:00:00.000Z',
                updatedAt: '2026-09-06T12:00:00.000Z',
            },
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            occurrenceId: 'occ-ext-completed',
            date: '2026-09-06',
        })).rejects.toThrow(/does not match the launch source/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('rejects a supplied occurrence that is in skipped state', async () => {
        const externalPlan = makeV4ExternalPlan();
        services.occurrence.getOccurrence.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                userId: 'u1',
                occurrenceId: 'occ-ext-skipped',
                date: '2026-09-06',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-xyz',
                    revision: 2,
                    sessionId: 'session-101',
                    contentHash: 'c'.repeat(64),
                },
                state: 'skipped',
                createdAt: '2026-09-06T12:00:00.000Z',
                updatedAt: '2026-09-06T12:00:00.000Z',
            },
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            occurrenceId: 'occ-ext-skipped',
            date: '2026-09-06',
        })).rejects.toThrow(/does not match the launch source/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('applies a summary override before hashing and persistence', async () => {
        const externalPlan = makeV4ExternalPlan();
        const launch = await prepareExternalPlanSessionLaunch(
            'u1',
            externalPlan,
            'Alternative execution summary',
        );

        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        const lastSave = services.prescription.savePrescription.mock.calls.at(-1);
        const savedPrescription = lastSave![1];
        expect(savedPrescription.displayMetadata?.summary).toBe('Alternative execution summary');
    });

    it('is idempotent: preparing the same external plan session twice produces the same hash and preserves write-once persistence', async () => {
        const externalPlan = makeV4ExternalPlan();
        const first = await prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, '2026-09-06T10:00:00.000Z');
        const second = await prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, '2026-09-06T11:00:00.000Z');
        expect(second.binding.prescriptionHash).toBe(first.binding.prescriptionHash);

        const stored = services.store.get(first.binding.prescriptionHash);
        expect(stored).toBeDefined();
        // Verifies write-once persistence: the second invocation did not overwrite the original record
        expect(stored?.createdAt).toBe('2026-09-06T10:00:00.000Z');
    });

    it('produces the same content-addressed binding for concurrent launches with different timestamps', async () => {
        const externalPlan = makeV4ExternalPlan();
        const firstTime = '2026-09-06T10:00:00.000Z';
        const secondTime = '2026-09-06T10:05:00.000Z';

        const [first, second] = await Promise.all([
            prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, firstTime),
            prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, secondTime),
        ]);

        expect(first.binding.prescriptionHash).toBe(second.binding.prescriptionHash);
        expect(services.prescription.savePrescription).toHaveBeenCalledTimes(2);

        // Content hashing is asynchronous, so concurrent callers have no invocation-order
        // guarantee. First-commit persistence is covered by ExecutionPrescriptionService's
        // transaction tests; this launch-layer test only owns binding determinism.
        expect(services.store.size).toBe(1);
    });

    it('omits volatile createdAt from the prescription hash payload', async () => {
        const externalPlan = makeV4ExternalPlan();
        const first = await prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, '2026-01-01T00:00:00.000Z');
        const second = await prepareExternalPlanSessionLaunch('u1', externalPlan, undefined, '2026-12-31T23:59:59.999Z');
        expect(second.binding.prescriptionHash).toBe(first.binding.prescriptionHash);
    });

    it('rejects target-event sessions because they are advisory fixed-activity inputs', async () => {
        const externalPlan = makeV4ExternalPlan();
        externalPlan.session.isEvent = true;

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan)).rejects.toThrow(/target events are advisory/i);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
        expect(services.occurrence.saveOccurrence).not.toHaveBeenCalled();
    });

    it('defensively throws if definition fails validation', async () => {
        // An invalid definition with empty title
        const externalPlan = makeV4ExternalPlan({
            title: '',
        });

        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan)).rejects.toThrow();
    });
});
