import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVERGREEN_GENERAL_COVERAGE_SET,
    SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
} from '../workouts/event-plan';
import { getPerformedTrainingFactsInRange } from './performedTrainingFactsService';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import type { PerformedTrainingOccurrence } from './models';
import { activityService } from '../services/activityService';

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

function occurrence(): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-revision-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-09-01',
        modality: 'Strength',
        sourceRefs: [],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: '2026-09-01T11:00:00Z',
    };
}

describe('performed training facts revision scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [],
            revision: 'activities-rev',
        });
    });

    it('scopes empty snapshot revisions by coverage set', async () => {
        const evergreen = await getPerformedTrainingFactsInRange(
            'user-1',
            '2026-09-02',
            '2026-09-02',
            { coverageSetDescriptor: EVERGREEN_GENERAL_COVERAGE_SET },
        );
        const event = await getPerformedTrainingFactsInRange(
            'user-1',
            '2026-09-02',
            '2026-09-02',
            { coverageSetDescriptor: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET },
        );

        expect(evergreen.revision).toContain(':evergreen_general:');
        expect(event.revision).toContain(':september_cycling_event:');
        expect(evergreen.revision).not.toBe(event.revision);
    });

    it('does not alias non-empty snapshots with identical occurrences but different role vocabularies', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence()]);

        const evergreen = await getPerformedTrainingFactsInRange(
            'user-1',
            '2026-08-31',
            '2026-09-02',
            { coverageSetDescriptor: EVERGREEN_GENERAL_COVERAGE_SET },
        );
        const event = await getPerformedTrainingFactsInRange(
            'user-1',
            '2026-08-31',
            '2026-09-02',
            { coverageSetDescriptor: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET },
        );

        expect(evergreen.exposures).toHaveLength(1);
        expect(event.exposures).toHaveLength(1);
        expect(evergreen.revision).not.toBe(event.revision);
        expect(evergreen.revision).toContain('pto-revision-1:2026-09-01T11:00:00Z');
        expect(event.revision).toContain('pto-revision-1:2026-09-01T11:00:00Z');
    });
});
