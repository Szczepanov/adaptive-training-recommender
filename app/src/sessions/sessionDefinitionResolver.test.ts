import { describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type { ExternalTrainingPlan } from '../engine/models';
import type { SessionDefinition } from './models';

const services = vi.hoisted(() => ({
    definition: { getDefinitionRevision: vi.fn() },
    external: { getRevisionState: vi.fn() },
}));

vi.mock('../services/sessionDefinitionService', () => ({ sessionDefinitionService: services.definition }));
vi.mock('../services/externalPlanService', async importOriginal => {
    const actual = await importOriginal<typeof import('../services/externalPlanService')>();
    return { ...actual, externalPlanService: services.external };
});

import { computeContentHash } from '../engine/externalPlanHash';
import { hashSessionDefinition } from './sessionDefinitionHash';
import { resolveSessionDefinition } from './sessionDefinitionResolver';

const manualDefinition: SessionDefinition = {
    schemaVersion: 1, id: 'manual-1', revision: 1, title: 'Manual Session', intent: 'training',
    blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
};

describe('resolveSessionDefinition', () => {
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
});
