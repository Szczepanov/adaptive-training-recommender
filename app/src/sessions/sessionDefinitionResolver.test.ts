import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type { ExternalTrainingPlan } from '../engine/models';
import type { ExecutionPrescription, SessionDefinition } from './models';

const services = vi.hoisted(() => ({
    definition: { getDefinitionRevision: vi.fn() },
    external: { getRevisionState: vi.fn() },
    prescription: { getPrescription: vi.fn() },
}));

const FAKE_WORKOUT = vi.hoisted(() => ({
    id: 'catalog-workout-1', version: 1, name: 'Fake Catalog Workout', description: 'Test fixture',
    modality: 'cycling', duration: { minimumMin: 30, maximumMin: 60 },
    blocks: [{ id: 'block-1', name: 'Main', role: 'main', steps: [{ id: 'step-1', name: 'Step 1', exerciseId: 'ex-1', notes: [] }] }],
}));

vi.mock('../services/sessionDefinitionService', () => ({ sessionDefinitionService: services.definition }));
vi.mock('../services/externalPlanService', async importOriginal => {
    const actual = await importOriginal<typeof import('../services/externalPlanService')>();
    return { ...actual, externalPlanService: services.external };
});
vi.mock('../services/executionPrescriptionService', () => ({ executionPrescriptionService: services.prescription }));
vi.mock('../workouts/catalog', () => ({ WORKOUTS: [FAKE_WORKOUT] }));

import { computeContentHash } from '../engine/externalPlanHash';
import { hashSessionDefinition } from './sessionDefinitionHash';
import { resolveSessionDefinition } from './sessionDefinitionResolver';

const manualDefinition: SessionDefinition = {
    schemaVersion: 1, id: 'manual-1', revision: 1, title: 'Manual Session', intent: 'training',
    blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
};

describe('resolveSessionDefinition', () => {
    beforeEach(() => vi.clearAllMocks());

    it('accepts a manual revision only when its persisted content matches the source hash', async () => {
        const hash = await hashSessionDefinition(manualDefinition);
        services.definition.getDefinitionRevision.mockResolvedValue({ status: 'AVAILABLE', data: manualDefinition, revision: null } satisfies DataState<SessionDefinition>);

        await expect(resolveSessionDefinition('u1', {
            kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: hash,
        })).resolves.toMatchObject({ status: 'AVAILABLE', data: manualDefinition });

        await expect(resolveSessionDefinition('u1', {
            kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: 'different',
        })).resolves.toMatchObject({ status: 'INVALID', issues: [{ code: 'definition-hash-mismatch' }] });
    });

    it('binds a manual source to its stored prescription and rejects a different definition hash', async () => {
        const hash = await hashSessionDefinition(manualDefinition);
        const evaluatedBlocks: ExecutionPrescription['blocks'] = [
            { id: 'evaluated', role: 'main', executionMode: 'sequential', steps: [] },
        ];
        services.definition.getDefinitionRevision.mockResolvedValue({ status: 'AVAILABLE', data: manualDefinition, revision: null } satisfies DataState<SessionDefinition>);
        services.prescription.getPrescription.mockResolvedValue({
            status: 'AVAILABLE', revision: null,
            data: { schemaVersion: 1, prescriptionHash: 'manual-prescription', sessionSource: { kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: hash }, definitionHash: hash, blocks: evaluatedBlocks, createdAt: '2026-08-18T00:00:00Z' },
        } satisfies DataState<ExecutionPrescription>);

        await expect(resolveSessionDefinition('u1', {
            kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: hash,
        }, 'manual-prescription')).resolves.toMatchObject({
            status: 'AVAILABLE', data: { blocks: evaluatedBlocks }, revision: 'manual-prescription',
        });

        services.prescription.getPrescription.mockResolvedValue({
            status: 'AVAILABLE', revision: null,
            data: { schemaVersion: 1, prescriptionHash: 'wrong', sessionSource: { kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: hash }, definitionHash: 'different', blocks: evaluatedBlocks, createdAt: '2026-08-18T00:00:00Z' },
        } satisfies DataState<ExecutionPrescription>);
        await expect(resolveSessionDefinition('u1', {
            kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: hash,
        }, 'wrong')).resolves.toMatchObject({
            status: 'INVALID', issues: [{ code: 'prescription-definition-hash-mismatch' }],
        });
    });

    it('rejects an external source when the stored plan bytes do not match its recorded hash', async () => {
        const plan = {
            schema: 'adaptive-training-recommender/external-plan@1', planId: 'plan-1', revision: 1,
            title: 'Plan', startDate: '2026-08-18', weekCount: 1, sessions: [],
        } as unknown as ExternalTrainingPlan;
        services.external.getRevisionState.mockResolvedValue({ status: 'AVAILABLE', data: plan, revision: '1' } satisfies DataState<ExternalTrainingPlan>);

        await expect(resolveSessionDefinition('u1', {
            kind: 'external_plan', planId: 'plan-1', revision: 1, sessionId: 'missing', contentHash: `${await computeContentHash(plan)}x`,
        })).resolves.toMatchObject({ status: 'INVALID', issues: [{ code: 'external-plan-hash-mismatch' }] });
    });

    describe('catalog source (M3.1)', () => {
        const catalogSource = { kind: 'catalog' as const, workoutId: 'catalog-workout-1', catalogVersion: '1' };
        const storedPrescription: ExecutionPrescription = {
            schemaVersion: 1, prescriptionHash: 'hash-1', definitionHash: 'def-hash-1',
            sessionSource: catalogSource,
            blocks: [{ id: 'evaluated-block', role: 'main', executionMode: 'sequential', steps: [] }],
            createdAt: '2026-08-18T00:00:00Z',
        };

        it('fails closed when no prescriptionHash is supplied, rather than re-deriving from the live catalog', async () => {
            await expect(resolveSessionDefinition('u1', catalogSource)).resolves.toMatchObject({
                status: 'INVALID', issues: [{ code: 'catalog-prescription-hash-required' }],
            });
            expect(services.prescription.getPrescription).not.toHaveBeenCalled();
        });

        it('resolves the stored evaluated prescription blocks, not a live-catalog re-derivation', async () => {
            services.prescription.getPrescription.mockResolvedValue({ status: 'AVAILABLE', data: storedPrescription, revision: null } satisfies DataState<ExecutionPrescription>);

            const result = await resolveSessionDefinition('u1', catalogSource, 'hash-1');
            expect(result.status).toBe('AVAILABLE');
            if (result.status !== 'AVAILABLE') throw new Error('expected AVAILABLE');
            expect(result.data.blocks).toEqual(storedPrescription.blocks);
            expect(result.data.title).toBe('Fake Catalog Workout');
            expect(services.prescription.getPrescription).toHaveBeenCalledWith('u1', 'hash-1');
        });

        it('rejects a content-valid prescription bound to a different catalog source', async () => {
            services.prescription.getPrescription.mockResolvedValue({
                status: 'AVAILABLE', revision: null,
                data: {
                    ...storedPrescription,
                    sessionSource: { kind: 'catalog', workoutId: 'other-workout', catalogVersion: '1' },
                },
            } satisfies DataState<ExecutionPrescription>);

            await expect(resolveSessionDefinition('u1', catalogSource, 'hash-1')).resolves.toMatchObject({
                status: 'INVALID', issues: [{ code: 'prescription-source-mismatch' }],
            });
        });

        it('propagates a missing or corrupted stored prescription instead of falling back', async () => {
            services.prescription.getPrescription.mockResolvedValue({ status: 'MISSING' } satisfies DataState<ExecutionPrescription>);
            await expect(resolveSessionDefinition('u1', catalogSource, 'missing-hash')).resolves.toEqual({ status: 'MISSING' });

            services.prescription.getPrescription.mockResolvedValue({
                status: 'INVALID', issues: [{ code: 'prescription-hash-mismatch', documentPath: 'x' }],
            } satisfies DataState<ExecutionPrescription>);
            await expect(resolveSessionDefinition('u1', catalogSource, 'bad-hash')).resolves.toMatchObject({
                status: 'INVALID', issues: [{ code: 'prescription-hash-mismatch' }],
            });
        });

        it('still rejects an unknown workoutId regardless of prescriptionHash', async () => {
            await expect(resolveSessionDefinition('u1', { kind: 'catalog', workoutId: 'nope', catalogVersion: '1' }, 'hash-1'))
                .resolves.toMatchObject({ status: 'INVALID', issues: [{ code: 'catalog-workout-not-found' }] });
        });

        it('fails closed when the stored catalog version no longer matches the available definition', async () => {
            services.prescription.getPrescription.mockClear();
            await expect(resolveSessionDefinition('u1', {
                kind: 'catalog', workoutId: 'catalog-workout-1', catalogVersion: '2',
            }, 'hash-1')).resolves.toMatchObject({
                status: 'INVALID', issues: [{ code: 'catalog-version-mismatch' }],
            });
            expect(services.prescription.getPrescription).not.toHaveBeenCalled();
        });
    });
});
