import { describe, expect, it, vi } from 'vitest';
import type { UserGoal } from '../engine/models';
import type { CompetitionOutcome } from '../observations/models';
import type { OutcomeEvaluationSnapshot, OutcomeEvaluationSpecRevision, OutcomeMetricBinding } from '../outcomes/evaluationSpec';
import {
    CompetitionOutcomeCaptureService,
    deriveCompetitionOutcomeCapture,
    type CompetitionOutcomeCaptureInput,
} from './competitionOutcomeCaptureService';

const goal: UserGoal & { id: string } = {
    id: 'goal-race-1',
    userId: 'user-1',
    category: 'short-term',
    domain: 'endurance',
    title: 'September road race',
    priority: 5,
    status: 'completed',
    targetDate: '2026-09-13',
    eventCategory: 'cycling_event',
    eventPreset: 'road_race',
    eventLifecycle: 'completed',
    targetOutcome: 'Finish in the front half',
    schemaVersion: 1,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-09-13T18:00:00.000Z',
};

const input: CompetitionOutcomeCaptureInput = {
    outcomeId: 'outcome-race-1',
    evaluationId: 'evaluation-race-1',
    occurredAt: '2026-09-13T09:00:00.000Z',
    source: 'manual',
    result: { completed: true, placing: 12, fieldSize: 48, elapsedSeconds: 3012 },
    metrics: { average_power_w: 285 },
    context: { course: 'circuit-a', weather: 'dry' },
    evaluationBindings: [{
        id: 'race-power',
        metricId: 'cycling_tt_20m_mean_power_w',
        role: 'primary',
        expectedDirection: { kind: 'higher_is_better' },
        baseline: { kind: 'declared_observation', observationId: 'baseline-race-power' },
        rationale: 'Declared primary cycling outcome for the next block.',
    }],
    createdAt: '2026-09-13T18:30:00.000Z',
};

describe('deriveCompetitionOutcomeCapture', () => {
    it('builds an event-linked ecological outcome and a draft evaluation for a completed event goal', () => {
        const result = deriveCompetitionOutcomeCapture('user-1', goal, input);

        expect(result.event).toMatchObject({ id: 'goal-race-1', date: '2026-09-13', category: 'cycling_event' });
        expect(result.evaluation.revision).toMatchObject<Partial<OutcomeEvaluationSpecRevision>>({
            id: 'evaluation-race-1',
            revision: 1,
            status: 'draft',
            startDate: '2026-09-13',
            endDate: '2026-09-13',
            sourceRef: { kind: 'event', id: 'goal-race-1' },
            contentHash: '',
        });
        expect(result.evaluation.bindings).toEqual(input.evaluationBindings);
        expect(result.outcome).toMatchObject<Partial<CompetitionOutcome>>({
            id: 'outcome-race-1',
            eventRef: 'goal-race-1',
            sport: 'cycling',
            source: 'manual',
            result: input.result,
            metrics: input.metrics,
            context: input.context,
        });
    });

    it('preserves Garmin activity provenance and rejects non-manual capture without a source reference', () => {
        const garminInput = { ...input, source: 'garmin_activity' as const, sourceRef: 'garmin-activity-123' };
        expect(deriveCompetitionOutcomeCapture('user-1', goal, garminInput).outcome.sourceRef).toBe('garmin-activity-123');

        expect(() => deriveCompetitionOutcomeCapture('user-1', goal, { ...input, source: 'garmin_activity' as const }))
            .toThrow('sourceRef is required for non-manual competition outcomes');
    });

    it('fails closed for a cross-user, non-event, paused, or archived goal', () => {
        expect(() => deriveCompetitionOutcomeCapture('other-user', goal, input)).toThrow('does not belong to user');
        expect(() => deriveCompetitionOutcomeCapture('user-1', { ...goal, eventCategory: null }, input)).toThrow('must have a dated event');
        expect(() => deriveCompetitionOutcomeCapture('user-1', { ...goal, status: 'paused' }, input)).toThrow('must be active or completed');
        expect(() => deriveCompetitionOutcomeCapture('user-1', { ...goal, status: 'archived' }, input)).toThrow('must be active or completed');
    });

    it('uses the actual local outcome date for the frozen evaluation window', () => {
        const result = deriveCompetitionOutcomeCapture('user-1', goal, {
            ...input,
            occurredAt: '2026-09-13T22:30:00.000Z',
        });

        expect(result.evaluation.revision.startDate).toBe('2026-09-14');
        expect(result.evaluation.revision.endDate).toBe('2026-09-14');
    });

    it('requires caller-supplied primary evaluation criteria', () => {
        expect(() => deriveCompetitionOutcomeCapture('user-1', goal, {
            ...input,
            evaluationBindings: [],
        })).toThrow('Outcome evaluation requires at least one metric binding');
    });
});

describe('CompetitionOutcomeCaptureService', () => {
    it('loads the event goal, freezes its evaluation, then persists the ecological outcome', async () => {
        const createDraftRevision = vi.fn(async (_userId: string, revision: OutcomeEvaluationSpecRevision, bindings: readonly OutcomeMetricBinding[]) => ({ revision, bindings } as unknown as OutcomeEvaluationSnapshot));
        const getRevision = vi.fn(async () => null);
        const activateRevision = vi.fn(async (_userId: string, evaluationId: string, revision: number) => ({
            revision: { ...deriveCompetitionOutcomeCapture('user-1', goal, input).evaluation.revision, id: evaluationId, revision, status: 'active' as const, activatedAt: '2026-09-13T18:31:00.000Z', contentHash: 'a'.repeat(64) },
            bindings: input.evaluationBindings,
        }));
        const getOutcome = vi.fn(async () => null);
        const createOutcome = vi.fn(async (_userId: string, outcome: CompetitionOutcome) => outcome);
        const service = new CompetitionOutcomeCaptureService({
            loadGoal: vi.fn(async () => goal),
            evaluationService: { getRevision, createDraftRevision, activateRevision },
            outcomeService: { getOutcome, createOutcome },
        });

        await expect(service.capture('user-1', 'goal-race-1', input)).resolves.toMatchObject({
            event: { id: 'goal-race-1' },
            evaluation: { revision: { status: 'active' } },
            outcome: {
                eventRef: 'goal-race-1',
                evaluationRef: { id: 'evaluation-race-1', revision: 1, contentHash: 'a'.repeat(64) },
            },
        });
        expect(createDraftRevision).toHaveBeenCalledOnce();
        expect(activateRevision).toHaveBeenCalledWith('user-1', 'evaluation-race-1', 1);
        expect(createOutcome).toHaveBeenCalledOnce();
        expect(createDraftRevision.mock.invocationCallOrder[0]).toBeLessThan(activateRevision.mock.invocationCallOrder[0]);
        expect(activateRevision.mock.invocationCallOrder[0]).toBeLessThan(createOutcome.mock.invocationCallOrder[0]);
    });

    it('does not write when the requested goal is missing or does not match the requested user', async () => {
        const createDraftRevision = vi.fn();
        const createOutcome = vi.fn();
        const getRevision = vi.fn();
        const getOutcome = vi.fn();
        const service = new CompetitionOutcomeCaptureService({
            loadGoal: vi.fn(async () => null),
            evaluationService: { getRevision, createDraftRevision, activateRevision: vi.fn() },
            outcomeService: { getOutcome, createOutcome },
        });

        await expect(service.capture('user-1', 'missing', input)).rejects.toThrow('Goal missing not found');
        expect(createDraftRevision).not.toHaveBeenCalled();
        expect(createOutcome).not.toHaveBeenCalled();
    });

    it('does not write when the loader returns a goal owned by another user', async () => {
        const createDraftRevision = vi.fn();
        const createOutcome = vi.fn();
        const service = new CompetitionOutcomeCaptureService({
            loadGoal: vi.fn(async () => ({ ...goal, userId: 'other-user' })),
            evaluationService: { getRevision: vi.fn(), createDraftRevision, activateRevision: vi.fn() },
            outcomeService: { getOutcome: vi.fn(), createOutcome },
        });

        await expect(service.capture('user-1', goal.id, input)).rejects.toThrow('does not belong to user');
        expect(createDraftRevision).not.toHaveBeenCalled();
        expect(createOutcome).not.toHaveBeenCalled();
    });

    it('resumes an equivalent capture after the outcome write fails', async () => {
        let persistedEvaluation: OutcomeEvaluationSnapshot | null = null;
        let persistedOutcome: CompetitionOutcome | null = null;
        let failOutcomeWrite = true;
        const getRevision = vi.fn(async () => persistedEvaluation);
        const createDraftRevision = vi.fn(async (_userId: string, revision: OutcomeEvaluationSpecRevision, bindings: readonly OutcomeMetricBinding[]) => {
            persistedEvaluation = { revision, bindings };
            return persistedEvaluation;
        });
        const activateRevision = vi.fn(async (_userId: string, evaluationId: string, revision: number) => {
            const current = persistedEvaluation;
            if (!current) throw new Error('missing evaluation');
            persistedEvaluation = {
                revision: { ...current.revision, id: evaluationId, revision, status: 'active', activatedAt: '2026-09-13T18:31:00.000Z', contentHash: 'b'.repeat(64) },
                bindings: current.bindings,
            };
            return persistedEvaluation;
        });
        const getOutcome = vi.fn(async () => persistedOutcome);
        const createOutcome = vi.fn(async (_userId: string, outcome: CompetitionOutcome) => {
            if (failOutcomeWrite) {
                persistedOutcome = outcome;
                failOutcomeWrite = false;
                throw new Error('transient outcome write failure');
            }
            persistedOutcome = outcome;
            return outcome;
        });
        const service = new CompetitionOutcomeCaptureService({
            loadGoal: vi.fn(async () => goal),
            evaluationService: { getRevision, createDraftRevision, activateRevision },
            outcomeService: { getOutcome, createOutcome },
        });

        await expect(service.capture('user-1', goal.id, input)).rejects.toThrow('transient outcome write failure');
        await expect(service.capture('user-1', goal.id, input)).resolves.toMatchObject({
            outcome: { evaluationRef: { contentHash: 'b'.repeat(64) } },
        });
        expect(createDraftRevision).toHaveBeenCalledOnce();
        expect(activateRevision).toHaveBeenCalledOnce();
        expect(createOutcome).toHaveBeenCalledOnce();
    });

    it('converges concurrent identical captures when create-only writes race', async () => {
        let persistedEvaluation: OutcomeEvaluationSnapshot | null = null;
        let persistedOutcome: CompetitionOutcome | null = null;
        let evaluationReadCount = 0;
        let releaseEvaluationReads!: () => void;
        const evaluationReads = new Promise<void>(resolve => { releaseEvaluationReads = resolve; });
        const getRevision = vi.fn(async () => {
            evaluationReadCount += 1;
            if (evaluationReadCount <= 2) {
                if (evaluationReadCount === 2) releaseEvaluationReads();
                await evaluationReads;
                return null;
            }
            return persistedEvaluation;
        });
        const createDraftRevision = vi.fn(async (_userId: string, revision: OutcomeEvaluationSpecRevision, bindings: readonly OutcomeMetricBinding[]) => {
            if (persistedEvaluation) throw new Error('Outcome evaluation evaluation-race-1@1 already exists');
            persistedEvaluation = { revision, bindings };
            return persistedEvaluation;
        });
        const activateRevision = vi.fn(async (_userId: string, evaluationId: string, revision: number) => {
            if (!persistedEvaluation) throw new Error('missing evaluation');
            persistedEvaluation = persistedEvaluation.revision.status === 'active'
                ? persistedEvaluation
                : {
                    revision: { ...persistedEvaluation.revision, id: evaluationId, revision, status: 'active', activatedAt: '2026-09-13T18:31:00.000Z', contentHash: 'c'.repeat(64) },
                    bindings: persistedEvaluation.bindings,
                };
            return persistedEvaluation;
        });
        let outcomeReadCount = 0;
        let releaseOutcomeReads!: () => void;
        const outcomeReads = new Promise<void>(resolve => { releaseOutcomeReads = resolve; });
        const getOutcome = vi.fn(async () => {
            outcomeReadCount += 1;
            if (outcomeReadCount <= 2) {
                if (outcomeReadCount === 2) releaseOutcomeReads();
                await outcomeReads;
                return null;
            }
            return persistedOutcome;
        });
        const createOutcome = vi.fn(async (_userId: string, outcome: CompetitionOutcome) => {
            if (persistedOutcome) throw new Error('Competition outcome outcome-race-1 already exists');
            persistedOutcome = outcome;
            return outcome;
        });
        const service = new CompetitionOutcomeCaptureService({
            loadGoal: vi.fn(async () => goal),
            evaluationService: { getRevision, createDraftRevision, activateRevision },
            outcomeService: { getOutcome, createOutcome },
        });

        const results = await Promise.all([
            service.capture('user-1', goal.id, input),
            service.capture('user-1', goal.id, input),
        ]);
        expect(results[0].outcome).toEqual(results[1].outcome);
        expect(createDraftRevision).toHaveBeenCalledTimes(2);
        expect(activateRevision).toHaveBeenCalledOnce();
        expect(createOutcome).toHaveBeenCalledTimes(2);
    });
});
