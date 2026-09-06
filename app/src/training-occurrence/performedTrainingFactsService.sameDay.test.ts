import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getPerformedTrainingFactsInRange,
    getPerformedTrainingFactsThroughToday,
} from './performedTrainingFactsService';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import type { PerformedTrainingOccurrence } from './models';
import { activityService } from '../services/activityService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import type { NormalizedGarminActivity } from '../engine/models';
import type { SessionExecution } from '../sessions/models';

// ADR-0036 (H4) D-LEDGER/D-REASSESS need today's own already-completed work. This file
// verifies the one real gap identified for H4: `getPerformedTrainingFactsInRange`'s
// `[from, to)` convention structurally excludes `toDateExclusive` (today, for every
// current caller). Same-day identity/dedup is a separate, already-proven concern (see
// `reconciliationService.test.ts`'s same-day fixtures) -- this file only exercises the
// read/hydration boundary.

vi.mock('./repository', () => ({
    performedTrainingOccurrenceRepository: {
        queryActiveInDateWindow: vi.fn(),
    },
}));

vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: {
        getExecution: vi.fn(),
    },
}));

vi.mock('../services/activityService', () => ({
    activityService: {
        getActivitiesInRange: vi.fn(),
    },
}));

vi.mock('../sessions/sessionDefinitionResolver', () => ({
    resolveSessionDefinition: vi.fn().mockResolvedValue({ status: 'MISSING' }),
}));

const TODAY = '2026-09-06';

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-today-1',
        userId: 'user-1',
        status: 'active',
        localDate: TODAY,
        modality: 'Strength',
        sourceRefs: [],
        reconciliation: { state: 'single_source' },
        createdAt: `${TODAY}T06:00:00.000Z`,
        updatedAt: `${TODAY}T07:00:00.000Z`,
        ...overrides,
    };
}

function garminActivity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'act-today-1',
        date: TODAY,
        type: 'strength_training',
        durationMin: 45,
        averageHr: 120,
        trainingEffectAerobic: 1.5,
        trainingEffectAnaerobic: 0.5,
        activityTrainingLoad: 60,
        intensityTag: 'moderate',
        startedAt: `${TODAY}T06:00:00.000Z`,
        endedAt: `${TODAY}T06:45:00.000Z`,
        ...overrides,
    };
}

function sessionExecution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: 'user-1',
        executionId: 'exec-today-1',
        sessionSource: { kind: 'manual', definitionId: 'test-def', revision: 1, contentHash: 'a'.repeat(64) },
        date: TODAY,
        startedAt: `${TODAY}T06:00:00.000Z`,
        completedAt: `${TODAY}T06:40:00.000Z`,
        updatedAt: `${TODAY}T06:40:00.000Z`,
        state: 'completed',
        schemaVersion: 1,
        ...overrides,
    };
}

describe('getPerformedTrainingFactsThroughToday (ADR-0036 H4 same-day verification)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
    });

    it('hydrates a same-day Garmin-sourced occurrence, surviving startedAt/endedAt for later elapsed-separation use', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
            occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-today-1' }] }),
        ]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity()], revision: null });

        const snapshot = await getPerformedTrainingFactsThroughToday('user-1', TODAY, TODAY);

        // The repository call must actually include today, not stop the day before it.
        expect(repository.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', TODAY, TODAY);
        expect(snapshot.exposures).toHaveLength(1);
        expect(snapshot.exposures[0]).toMatchObject({
            performedOccurrenceId: 'pto-today-1',
            localDate: TODAY,
            startedAt: `${TODAY}T06:00:00.000Z`,
            endedAt: `${TODAY}T06:45:00.000Z`,
            sourceKinds: ['provider_activity'],
        });
    });

    it('hydrates a same-day structured-execution-sourced occurrence', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
            occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-today-1' }] }),
        ]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: sessionExecution(), revision: null });

        const snapshot = await getPerformedTrainingFactsThroughToday('user-1', TODAY, TODAY);

        expect(snapshot.exposures).toHaveLength(1);
        expect(snapshot.exposures[0]).toMatchObject({
            performedOccurrenceId: 'pto-today-1',
            startedAt: `${TODAY}T06:00:00.000Z`,
            endedAt: `${TODAY}T06:40:00.000Z`,
            durationMin: 40,
            sourceKinds: ['structured_execution'],
        });
    });

    it('hydrates one exposure, not two, for a same-day occurrence with both a structured and a Garmin source', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
            occurrence({
                sourceRefs: [
                    { kind: 'structured_execution', executionId: 'exec-today-1' },
                    { kind: 'provider_activity', provider: 'garmin', activityId: 'act-today-1' },
                ],
            }),
        ]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: sessionExecution(), revision: null });
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity()], revision: null });

        const snapshot = await getPerformedTrainingFactsThroughToday('user-1', TODAY, TODAY);

        expect(snapshot.exposures).toHaveLength(1);
        expect(snapshot.exposures[0].sourceKinds.sort()).toEqual(['provider_activity', 'structured_execution']);
    });

    it('leaves getPerformedTrainingFactsInRange itself unchanged: today passed as the exclusive boundary still excludes today (current production behavior, e.g. trainingIntent.ts)', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence()]);

        await getPerformedTrainingFactsInRange('user-1', '2026-09-01', TODAY);

        // toDateExclusive === TODAY means today itself is outside the window -- this is
        // exactly what every existing production caller does today, and this wrapper
        // does not change that contract.
        expect(repository.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', '2026-09-01', '2026-09-05');
        // The mocked repository still returns the occurrence regardless of the args it
        // was called with (it's a stub), so assert the *called-with* range directly above
        // rather than the exposures -- this test's whole point is the argument boundary.
    });
});
