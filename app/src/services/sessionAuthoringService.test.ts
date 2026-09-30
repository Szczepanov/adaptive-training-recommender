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
import { prepareAuthoredOccurrenceLaunch, prepareCatalogSessionLaunch, prepareExternalPlanSessionLaunch, prepareUnplannedSessionLaunch, resolveScaledLaunchCeilingMinutes } from './sessionAuthoringService';
import type { SessionDefinition } from '../sessions/models';
import type { ExternalPlanSessionV4 } from '../sessions/externalPlanV4';
import type { ExternalPlanSessionV6 } from '../sessions/externalPlanV6';

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

describe('prepareUnplannedSessionLaunch', () => {
    it('generates a secure occurrenceId containing a UUID and saves occurrence', async () => {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'unplanned-1',
            revision: 1,
            title: 'Unplanned workout',
            intent: 'training',
            blocks: [{
                id: 'b1',
                role: 'main',
                executionMode: 'sequential',
                steps: [],
            }],
        };

        const launch = await prepareUnplannedSessionLaunch('u1', definition, '2026-08-19T00:00:00.000Z');

        expect(launch.binding.occurrenceId).toMatch(/^occ-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(services.occurrence.saveOccurrence).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            occurrenceId: launch.binding.occurrenceId,
            authority: 'unplanned_log',
            state: 'active',
        }));
    });
});

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

    it('freezes only the exact v6 reduced definition when adjudication requests scale', async () => {
        const externalPlan = makeV4ExternalPlan();
        const authored = externalPlan.session.definition;
        const reducedDefinition: SessionDefinition = {
            ...authored,
            summary: 'Reduced session',
            duration: { min: 30, max: 30 },
            blocks: authored.blocks.map(block => ({
                ...block,
                steps: block.steps.map(step => ({ ...step, dose: { kind: 'duration', seconds: 90 } })),
            })),
        };
        const v6Session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedDefinition },
        };
        const launch = await prepareExternalPlanSessionLaunch('u1', {
            ...externalPlan,
            session: v6Session,
        }, { useReducedDefinition: true, scaleVolume: 0.5, date: '2026-09-06', now: '2026-09-06T12:00:00.000Z' });

        expect(launch.definition).toEqual(reducedDefinition);
        const saved = services.prescription.savePrescription.mock.calls.at(-1)?.[1];
        expect(saved?.blocks).toEqual(reducedDefinition.blocks);
        expect(saved?.blocks).not.toEqual(authored.blocks);
    });

    it('does not allow scale to launch an older plan without an exact reduced definition', async () => {
        const externalPlan = makeV4ExternalPlan();
        await expect(prepareExternalPlanSessionLaunch('u1', externalPlan, {
            useReducedDefinition: true,
            date: '2026-09-06',
        })).rejects.toThrow(/requires an exact structured reducedDefinition/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('withholds an exact reduced definition that exceeds today\'s scaled duration ceiling', async () => {
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition: SessionDefinition = {
            ...externalPlan.session.definition,
            duration: { min: 30, max: 30 },
        };
        await expect(prepareExternalPlanSessionLaunch('u1', {
            ...externalPlan,
            session: { ...externalPlan.session, scaling: { reducible: true, reducedDefinition } },
        }, { useReducedDefinition: true, scaleVolume: 0.4, date: '2026-09-06' }))
            .rejects.toThrow(/exceeds today's approved duration ceiling/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('requires a current ceiling and checks explicit timed steps against it', async () => {
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition: SessionDefinition = {
            ...externalPlan.session.definition,
            duration: { min: 10, max: 20 },
            blocks: externalPlan.session.definition.blocks.map((block, blockIndex) => blockIndex === 0 ? {
                ...block,
                steps: block.steps.map((step, stepIndex) => stepIndex === 0
                    ? { ...step, dose: { kind: 'duration' as const, seconds: 3600 } }
                    : step),
            } : block),
        };
        const session = { ...externalPlan.session, scaling: { reducible: true, reducedDefinition } };
        await expect(prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, { useReducedDefinition: true }))
            .rejects.toThrow(/execution volume/);
        await expect(prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, {
            useReducedDefinition: true, scaleVolume: 0.4,
        })).rejects.toThrow(/exceeds today's approved duration ceiling/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('rejects non-positive, non-finite, and inflated scaled execution volumes', async () => {
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition: SessionDefinition = {
            ...externalPlan.session.definition,
            summary: 'Reduced session',
            duration: { min: 30, max: 30 },
        };
        const session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedDefinition },
        };

        for (const scaleVolume of [0, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(prepareExternalPlanSessionLaunch('u1', {
                ...externalPlan,
                session,
            }, { useReducedDefinition: true, scaleVolume }))
                .rejects.toThrow(/execution volume/);
        }
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('counts timed work for every authored block round', async () => {
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition: SessionDefinition = {
            ...externalPlan.session.definition,
            duration: { min: 10, max: 20 },
            blocks: externalPlan.session.definition.blocks.map((block, blockIndex) => blockIndex === 0 ? {
                ...block,
                rounds: 3,
                steps: block.steps.map((step, stepIndex) => stepIndex === 0
                    ? { ...step, dose: { kind: 'duration' as const, seconds: 9 * 60 } }
                    : step),
            } : block),
        };
        await expect(prepareExternalPlanSessionLaunch('u1', {
            ...externalPlan,
            session: { ...externalPlan.session, scaling: { reducible: true, reducedDefinition } },
        }, { useReducedDefinition: true, scaleVolume: 0.4 }))
            .rejects.toThrow(/exceeds today's approved duration ceiling/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
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

    // PR-B (#893 WP3.2): exact scaled-execution pins. No policy change -- these prove the
    // binding boundary, not new logic.
    function makeReducedDefinition(base: SessionDefinition): SessionDefinition {
        return {
            ...base,
            summary: 'Reduced session',
            duration: { min: 30, max: 30 },
            blocks: base.blocks.map(block => ({
                ...block,
                steps: block.steps.map(step => ({ ...step, dose: { kind: 'duration', seconds: 90 } })),
            })),
        };
    }

    it('binds a scaled hash that differs from the full-definition hash for the same source', async () => {
        const externalPlan = makeV4ExternalPlan();
        const authored = externalPlan.session.definition;
        const reducedDefinition = makeReducedDefinition(authored);
        const v6Session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedDefinition },
        };

        const scaled = await prepareExternalPlanSessionLaunch('u1', {
            ...externalPlan,
            session: v6Session,
        }, { useReducedDefinition: true, scaleVolume: 0.5, date: '2026-09-06', now: '2026-09-06T12:00:00.000Z' });
        const full = await prepareExternalPlanSessionLaunch('u1', externalPlan, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });

        // Dose identity, not just dose numbers: the exact reduced bytes are frozen, the
        // source stays the same, and the two content-addressed hashes differ.
        expect(scaled.definition).toEqual(reducedDefinition);
        expect(scaled.binding.sessionSource).toEqual(full.binding.sessionSource);
        expect(scaled.binding.prescriptionHash).not.toBe(full.binding.prescriptionHash);
        expect(services.store.get(scaled.binding.prescriptionHash)?.blocks).toEqual(reducedDefinition.blocks);
        expect(services.store.get(full.binding.prescriptionHash)?.blocks).toEqual(authored.blocks);
    });

    it('launches a v5-inherited structured session under proceed with exact source provenance', async () => {
        // v5 reuses the v4 session contract unchanged, so a definition-bearing session
        // without scaling launches through the same canonical path with the same exact
        // source identity -- the regression the schema literal risked.
        const externalPlan = makeV4ExternalPlan();
        const launch = await prepareExternalPlanSessionLaunch('u1', externalPlan, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });

        expect(launch.definition).toEqual(externalPlan.session.definition);
        expect(launch.binding.sessionSource).toEqual({
            kind: 'external_plan',
            planId: 'plan-xyz',
            revision: 2,
            sessionId: 'session-101',
            contentHash: 'c'.repeat(64),
        });
        expect(launch.binding.occurrenceId).toBe('occ-ext-created');
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects scale for a v5-shaped session whose scaling carries only a free-text reducedSummary', async () => {
        // v5 reuses the v4 session contract: scaling may carry reducible/reducedSummary/
        // fallback context, but never an executable reducedDefinition. The free-text
        // summary must never be parsed into steps -- scale fails closed instead.
        const externalPlan = makeV4ExternalPlan();
        const session: ExternalPlanSessionV4 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedSummary: 'Shorter version when tired', minimumUsefulDurationMin: 20 },
        };

        await expect(prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, {
            useReducedDefinition: true,
            scaleVolume: 0.5,
            date: '2026-09-06',
        })).rejects.toThrow(/requires an exact structured reducedDefinition/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('rejects scale when the author marked the session irreducible despite carried reduced bytes', async () => {
        // Import validation already rejects `reducedDefinition` without `reducible: true`;
        // hand-built bytes bypassing the validator must fail at the execution boundary too.
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition = makeReducedDefinition(externalPlan.session.definition);
        const session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: false, reducedDefinition },
        };

        await expect(prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, {
            useReducedDefinition: true,
            scaleVolume: 0.5,
            date: '2026-09-06',
        })).rejects.toThrow(/reducible: true/);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it.each([
        ['id', { id: 'renamed-id' }, /retain the authored session definition id/],
        ['intent', { intent: 'recovery' }, /retain the authored session intent/],
        ['dominantModality', { dominantModality: 'strength' }, /retain the authored dominant modality/],
    ] as const)('rejects a scaled reduced definition that renames the authored %s', async (_field, tamper, message) => {
        // Mirrors `externalPlanV6.ts`'s retention rules at the execution boundary: a
        // reduced form that changes identity is not the coach's reduced form.
        const externalPlan = makeV4ExternalPlan();
        const reducedDefinition: SessionDefinition = {
            ...makeReducedDefinition(externalPlan.session.definition),
            ...tamper,
        };
        const session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedDefinition },
        };

        await expect(prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, {
            useReducedDefinition: true,
            scaleVolume: 0.5,
            date: '2026-09-06',
        })).rejects.toThrow(message);
        expect(services.prescription.savePrescription).not.toHaveBeenCalled();
    });

    it('binds the full definition under proceed even when a reduced form is present', async () => {
        // Guards the `useReducedDefinition ? reduced : full` assignment against a future
        // refactor "preferring" the reduced form: proceed must never bind reduced bytes.
        const externalPlan = makeV4ExternalPlan();
        const authored = externalPlan.session.definition;
        const session: ExternalPlanSessionV6 = {
            ...externalPlan.session,
            scaling: { reducible: true, reducedDefinition: makeReducedDefinition(authored) },
        };

        const withReducedPresent = await prepareExternalPlanSessionLaunch('u1', { ...externalPlan, session }, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });
        const withoutReduced = await prepareExternalPlanSessionLaunch('u1', externalPlan, {
            date: '2026-09-06',
            now: '2026-09-06T12:00:00.000Z',
        });

        expect(withReducedPresent.definition).toEqual(authored);
        expect(withReducedPresent.binding.prescriptionHash).toBe(withoutReduced.binding.prescriptionHash);
        expect(services.store.get(withReducedPresent.binding.prescriptionHash)?.blocks).toEqual(authored.blocks);
    });

    it('never rewrites a frozen prescription when a later revision is prepared for the same plan', async () => {
        // B3 (WP4.1 PR-B slice): revision 2 arrives with new content; re-preparing the
        // revision 1 source still yields the identical hash and leaves the stored
        // revision 1 document untouched (write-once identity, not latest-header).
        const revision1 = makeV4ExternalPlan();
        const first = await prepareExternalPlanSessionLaunch('u1', revision1, {
            date: '2026-09-06',
            now: '2026-09-06T10:00:00.000Z',
        });

        const revision2Definition: SessionDefinition = {
            ...revision1.session.definition,
            title: 'VO2 Max Intervals (harder)',
            summary: '6x3min intervals at 115% FTP',
        };
        const revision2 = {
            ...revision1,
            revision: 3,
            contentHash: 'd'.repeat(64),
            session: { ...revision1.session, definition: revision2Definition },
        };
        const second = await prepareExternalPlanSessionLaunch('u1', revision2, {
            date: '2026-09-06',
            now: '2026-09-06T10:05:00.000Z',
        });
        expect(second.binding.prescriptionHash).not.toBe(first.binding.prescriptionHash);

        const relaunch = await prepareExternalPlanSessionLaunch('u1', revision1, {
            date: '2026-09-06',
            now: '2026-09-06T11:00:00.000Z',
        });
        expect(relaunch.binding.prescriptionHash).toBe(first.binding.prescriptionHash);
        expect(relaunch.binding.occurrenceId).toBe(first.binding.occurrenceId);
        expect(services.store.get(first.binding.prescriptionHash)?.createdAt).toBe('2026-09-06T10:00:00.000Z');
    });

    describe('resolveScaledLaunchCeilingMinutes', () => {
        it('pins the approved gate-duration formula and rejects caller inflation/invalid dose', () => {
            expect(resolveScaledLaunchCeilingMinutes(60, 0.5)).toBe(30);
            expect(resolveScaledLaunchCeilingMinutes(45, 1)).toBe(45);
            expect(() => resolveScaledLaunchCeilingMinutes(60, 0)).toThrow(/execution volume/);
            expect(() => resolveScaledLaunchCeilingMinutes(60, 1.01)).toThrow(/execution volume/);
            expect(() => resolveScaledLaunchCeilingMinutes(Number.NaN, 0.5)).toThrow(/gating duration/);
        });
    });
});
