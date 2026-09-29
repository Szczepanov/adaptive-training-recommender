import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedGarminActivity } from '../engine/models';
import type { PerformedTrainingOccurrence } from './models';

vi.mock('./repository', () => ({ performedTrainingOccurrenceRepository: { queryActiveInDateWindow: vi.fn() } }));
vi.mock('../services/activityService', () => ({ activityService: { getActivitiesInRange: vi.fn() } }));
vi.mock('../services/sessionExecutionService', () => ({ sessionExecutionService: { getExecution: vi.fn(), getEntries: vi.fn() } }));
vi.mock('../sessions/sessionDefinitionResolver', () => ({ resolveSessionDefinition: vi.fn() }));

const { performedTrainingOccurrenceRepository: repository } = await import('./repository');
const { activityService } = await import('../services/activityService');
const { sessionExecutionService } = await import('../services/sessionExecutionService');
const { resolveSessionDefinition } = await import('../sessions/sessionDefinitionResolver');
const { getTrainingResponseEvidenceInRange } = await import('./trainingResponseEvidence');

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'u1',
        status: 'active',
        localDate: '2026-09-18',
        modality: 'cycling',
        sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'a1' }],
        reconciliation: { state: 'matched' },
        createdAt: '2026-09-18T08:00:00Z',
        updatedAt: '2026-09-18T09:00:00Z',
        ...overrides,
    };
}

function activity(activityId: string): NormalizedGarminActivity {
    return {
        activityId, date: '2026-09-18', type: 'cycling', durationMin: 60,
        trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null,
        activityTrainingLoad: null, intensityTag: 'moderate',
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
    vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([]);
    vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
    vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'MISSING' });
});

describe('getTrainingResponseEvidenceInRange', () => {
    it('projects a Garmin-only occurrence as canonical identity with measured-only evidence', async () => {
        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);
        expect(result.evidence[0]).toMatchObject({
            performedOccurrenceId: 'pto-1',
            identity: { level: 'canonical_occurrence', sourceKinds: ['provider_activity'] },
            measuredSources: [{ provider: 'garmin', activityId: 'a1' }],
            sourceCompleteness: { structuredExecution: 'not_linked', providerActivities: 'available' },
        });
    });

    it('attaches an adjacent provider-local day by source ID while retaining the canonical occurrence date', async () => {
        const adjacentActivity = { ...activity('a1'), date: '2026-09-17' };
        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-18', '2026-09-19', [adjacentActivity]);
        expect(result.evidence[0].localDate).toBe('2026-09-18');
        expect(result.evidence[0].measuredSources[0].activity?.date).toBe('2026-09-17');
        expect(result.evidence[0].sourceCompleteness.providerActivities).toBe('available');
    });

    it('keeps one matched workout, source roles, and canonical exercise identity together', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'e1', sessionOccurrenceId: 'so1', prescriptionHash: 'hash1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'a1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: {
                userId: 'u1', executionId: 'e1', sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: 'v1' },
                date: '2026-09-18', state: 'completed', schemaVersion: 1,
                startedAt: '2026-09-18T08:00:00Z', completedAt: '2026-09-18T09:00:00Z', updatedAt: '2026-09-18T09:00:00Z',
            }, revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: {
                schemaVersion: 1, id: 'w1', revision: 1, title: 'Squat', intent: 'training',
                blocks: [{ id: 'main', role: 'main', steps: [{ id: 'step1', kind: 'exercise', title: 'Any title', exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 } }] }],
            } as never,
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([{
            id: 'entry1', executionId: 'e1', stepId: 'step1', completedAt: '2026-09-18T08:30:00Z',
            createdAt: '2026-09-18T08:30:00Z', updatedAt: '2026-09-18T08:30:00Z',
            payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 80 },
        }]);

        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);

        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({
            performedOccurrenceId: 'pto-1',
            identity: { level: 'canonical_occurrence', reconciliationStatus: 'matched', sourceKinds: ['structured_execution', 'provider_activity'] },
            structured: {
                sourceRef: { kind: 'structured_execution', executionId: 'e1', sessionOccurrenceId: 'so1', prescriptionHash: 'hash1' },
                executionId: 'e1', sessionOccurrenceId: 'so1', prescriptionHash: 'hash1', workoutId: 'w1',
                steps: [{
                    stepId: 'step1', exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' },
                    prescribed: { sets: 3, reps: 5 }, sets: [{ payload: { reps: 5, weightKg: 80 } }],
                }],
            },
            measuredSources: [{ provider: 'garmin', activityId: 'a1' }],
        });
    });

    it('preserves the structured occurrence source ref when execution hydration is unavailable', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'e-unavailable', prescriptionHash: 'hash-unavailable' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'a1' },
            ],
        })]);

        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);

        expect(result.evidence[0]).toMatchObject({
            structuredSourceRef: {
                kind: 'structured_execution',
                executionId: 'e-unavailable',
                prescriptionHash: 'hash-unavailable',
            },
            sourceCompleteness: { structuredExecution: 'unavailable' },
        });
        expect(result.evidence[0].structured).toBeUndefined();
    });

    it('preserves every provider recording until a feature-specific selector chooses one', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'provider_activity', provider: 'garmin', activityId: 'a1', deviceId: 'edge-1' },
                { kind: 'provider_activity', provider: 'other', activityId: 'a1' },
            ],
        })]);

        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);

        expect(result.evidence[0].measuredSources.map(source => [source.provider, source.activityId]))
            .toEqual([['garmin', 'a1'], ['other', 'a1']]);
        expect(result.evidence[0].measuredSources[0].sourceRef)
            .toMatchObject({ kind: 'provider_activity', provider: 'garmin', activityId: 'a1', deviceId: 'edge-1' });
        expect(result.evidence[0].measuredSources[1].activity).toBeUndefined();
        expect(result.evidence[0].sourceCompleteness.providerActivities).toBe('ambiguous');
    });

    it('keeps a structured-only occurrence and its performed steps when no Garmin record exists', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [{ kind: 'structured_execution', executionId: 'e1', prescriptionHash: 'hash1' }],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: {
                userId: 'u1', executionId: 'e1', sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: 'v1' },
                date: '2026-09-18', state: 'completed', schemaVersion: 1,
                startedAt: '2026-09-18T08:00:00Z', completedAt: '2026-09-18T09:00:00Z', updatedAt: '2026-09-18T09:00:00Z',
            }, revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w1', revision: 1, title: 'Squat', intent: 'training', blocks: [{ id: 'main', role: 'main', steps: [{ id: 'step1', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 } }] }] } as never,
            revision: null,
        });

        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', []);

        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({
            identity: { level: 'canonical_occurrence', sourceKinds: ['structured_execution'] },
            structured: { steps: [{ exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' } }] },
            measuredSources: [],
            sourceCompleteness: { structuredExecution: 'available', providerActivities: 'not_linked' },
        });
    });

    it('degrades to explicit provider-only evidence when occurrence hydration fails', async () => {
        vi.mocked(repository.queryActiveInDateWindow).mockRejectedValue(new Error('unavailable'));

        const result = await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);

        expect(result).toMatchObject({ occurrenceRead: 'unavailable' });
        expect(result.evidence[0]).toMatchObject({
            identity: { level: 'provider_activity_only' },
            sourceCompleteness: { occurrenceRead: 'unavailable', structuredExecution: 'unavailable' },
            measuredSources: [{ activityId: 'a1' }],
        });
    });

    it('uses the provided activity snapshot without issuing another provider read', async () => {
        await getTrainingResponseEvidenceInRange('u1', '2026-09-01', '2026-09-19', [activity('a1')]);
        expect(activityService.getActivitiesInRange).not.toHaveBeenCalled();
    });
});
