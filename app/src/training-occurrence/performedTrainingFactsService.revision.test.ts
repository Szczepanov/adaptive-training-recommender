import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVERGREEN_GENERAL_COVERAGE_SET,
    SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
} from '../workouts/event-plan';
import { getPerformedTrainingFactsInRange } from './performedTrainingFactsService';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import type { PerformedTrainingOccurrence } from './models';
import { activityService } from '../services/activityService';
import { activityOverrideService } from '../services/activityOverrideService';
import type { ActivityOverride } from '../engine/models';

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

vi.mock('../services/activityOverrideService', () => ({
    activityOverrideService: { getOverridesSinceState: vi.fn() },
}));

vi.mock('../services/recommendationService', () => ({
    recommendationService: {
        getRecommendationsInRange: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null }),
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

function activityOverride(overrides: Partial<ActivityOverride> = {}): ActivityOverride {
    return {
        activityId: 'act-1', userId: 'user-1', date: '2026-09-01',
        originalType: 'cycling', originalIntensityTag: 'tempo',
        overriddenModality: 'Cycling', overriddenIntensity: 'easy',
        createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
        ...overrides,
    };
}

describe('performed training facts revision scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(activityOverrideService.getOverridesSinceState).mockResolvedValue({ status: 'AVAILABLE', data: {}, revision: null });
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

    it('revises facts for added, changed and removed attached overrides despite a null source revision', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([{
            ...occurrence(), sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }],
        }]);
        const read = () => getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');
        const absent = await read();
        vi.mocked(activityOverrideService.getOverridesSinceState).mockResolvedValue({
            status: 'AVAILABLE', data: { 'act-1': activityOverride() }, revision: null,
        });
        const added = await read();
        vi.mocked(activityOverrideService.getOverridesSinceState).mockResolvedValue({
            status: 'AVAILABLE', data: { 'act-1': activityOverride({ overriddenModality: 'Running' }) }, revision: null,
        });
        const changed = await read();
        vi.mocked(activityOverrideService.getOverridesSinceState).mockResolvedValue({ status: 'AVAILABLE', data: {}, revision: null });
        const removed = await read();

        expect(added.revision).not.toBe(absent.revision);
        expect(changed.revision).not.toBe(added.revision);
        expect(removed.revision).toBe(absent.revision);
        expect(changed.exposures[0]).toMatchObject({ modality: 'Running', evidenceTier: 'athleteClassification' });
        expect(changed.revision).toMatch(/:overrides=[a-f0-9]{64}$/);
    });

    it('keeps override revisions stable across map/order changes, notes and unrelated overrides', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([{
            ...occurrence(), sourceRefs: [
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-2' },
            ],
        }]);
        const first = activityOverride();
        const second = activityOverride({ activityId: 'act-2', overriddenModality: 'Running' });
        const record = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02', {
            activityOverrides: { 'act-1': first, 'act-2': second },
        });
        const map = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02', {
            activityOverrides: new Map([
                ['unrelated', activityOverride({ activityId: 'unrelated', overriddenModality: 'Strength' })],
                ['act-2', second],
                ['act-1', { ...first, notes: 'Private athlete note', updatedAt: '2026-09-01T14:00:00Z' }],
            ]),
        });

        expect(map.revision).toBe(record.revision);
        expect(map.revision).not.toContain('Private athlete note');
        expect(map.revision).not.toContain('unrelated');
        expect(map.exposures).toEqual(record.exposures);
        expect(activityOverrideService.getOverridesSinceState).not.toHaveBeenCalled();
    });
});
