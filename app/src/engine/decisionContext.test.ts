import { describe, expect, it } from 'vitest';
import { buildInfo } from '../buildInfo';
import type { SameDayRecommendationInputs } from './sameDayRecommendation';
import type { PerformedTrainingFactsSnapshot } from './performedTrainingFacts';
import {
    createDecisionContext,
    validateDecisionContext,
    type CreateDecisionContextInput,
} from './decisionContext';

const identity = { userId: 'athlete-1', date: '2026-09-28', recommendationRevision: 2 };

function evaluatorInputs(): SameDayRecommendationInputs {
    return {
        userId: identity.userId,
        date: identity.date,
        readiness: { subjective: {}, objective: {} } as never,
        context: { goals: { shortTerm: 'race', midTerm: '', longTerm: '' } } as never,
        events: [] as never[],
        fixedActivities: [] as never[],
        authoredPlanBlocks: [] as never[],
        trainingIntentProfile: null,
        preferences: null,
        externalPlan: null,
        externalRest: null,
        scheduleOverlays: [],
        confirmedProgressionOverrides: new Map([['z', 2], ['a', 1]]),
    };
}

function facts(): PerformedTrainingFactsSnapshot {
    return { asOfDate: identity.date, windowDays: 14, revision: 'facts-r1', exposures: [], coverageCredits: [] };
}

function input(overrides: Partial<CreateDecisionContextInput> = {}): CreateDecisionContextInput {
    return {
        ...identity,
        evaluatedAt: '2026-09-28T08:30:00.000Z',
        minimumSafetyStatus: 'complete',
        evaluatorInputs: evaluatorInputs(),
        performedTrainingFacts: facts(),
        mechanicalCheckinHistory: [],
        ...overrides,
    };
}

describe('decision context record', () => {
    it('captures immutable composition inputs without broad history', async () => {
        const source = input({
            evaluatorInputs: {
                ...evaluatorInputs(),
                preparedHistorySnapshot: { completedEvents: [{ id: 'broad-history-secret' }], exposures: [{ id: 'history-secret' }] },
            } as never,
        });
        const record = await createDecisionContext(source);
        expect(record.evaluatorInputs?.confirmedProgressionOverrides).toEqual([['a', 1], ['z', 2]]);
        expect(record.appSource).toEqual({ gitSha: buildInfo.gitSha, dirty: buildInfo.dirty });
        expect(record.captureVersion).toBe('same-day-capture-v1');
        expect(record).not.toHaveProperty('historyProvider');
        expect(record).not.toHaveProperty('preparedHistorySnapshot');
        expect(record.evaluatorInputs).not.toHaveProperty('historyProvider');
        expect(record.evaluatorInputs).not.toHaveProperty('preparedHistorySnapshot');
        (source.evaluatorInputs?.context as { goals: { shortTerm: string } }).goals.shortTerm = 'changed';
        source.performedTrainingFacts?.exposures.push({ performedOccurrenceId: 'later' } as never);
        expect(record.evaluatorInputs?.context.goals.shortTerm).toBe('race');
        expect(record.performedTrainingFacts?.exposures).toEqual([]);
        await expect(validateDecisionContext(record, identity)).resolves.toEqual(record);
    });

    it('stores only mechanical progression signals and omits free text and source refs', async () => {
        const record = await createDecisionContext(input({
            mechanicalCheckinHistory: [{
                date: identity.date,
                checkin: {
                    soreness: 6,
                    painOrInjury: false,
                    painFlag: true,
                    illnessSymptoms: false,
                    notes: 'private free text',
                    tissueResponses: {
                        knee: {
                            region: 'knee', morningState: 'mild', painDuringTraining: 'normal',
                            sourceSessionRef: { kind: 'execution', id: 'private', date: identity.date },
                        },
                    },
                } as never,
            }],
        }));
        expect(record.mechanicalCheckinHistory).toEqual([{
            date: identity.date,
            checkin: {
                soreness: 6, painOrInjury: true, illnessSymptoms: false,
                tissueResponses: { knee: { morningState: 'mild', painDuringTraining: 'normal' } },
            },
        }]);
        expect(record.mechanicalCheckinHistory?.[0].checkin).toMatchObject({ painOrInjury: true });
        expect(record.mechanicalCheckinHistory?.[0].checkin).not.toHaveProperty('notes');
        await expect(validateDecisionContext(record, identity)).resolves.toEqual(record);
    });

    it('hashes identical content identically despite input key and Map insertion order', async () => {
        const first = await createDecisionContext(input());
        const reordered = evaluatorInputs();
        reordered.confirmedProgressionOverrides = new Map([['a', 1], ['z', 2]]);
        reordered.context = {
            goals: { longTerm: '', midTerm: '', shortTerm: 'race' },
        } as never;
        const second = await createDecisionContext(input({ evaluatorInputs: reordered }));
        expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(second.contentHash).toBe(first.contentHash);
    });

    it('fails closed for foreign identity, malformed fields, extra fields, and tampering', async () => {
        const record = await createDecisionContext(input());
        await expect(validateDecisionContext(record, { ...identity, userId: 'other' })).rejects.toThrow();
        await expect(validateDecisionContext(record, { ...identity, date: '2026-09-27' })).rejects.toThrow();
        await expect(validateDecisionContext(record, { ...identity, recommendationRevision: 3 })).rejects.toThrow();
        await expect(validateDecisionContext({ ...record, extra: true }, identity)).rejects.toThrow();
        await expect(validateDecisionContext({ ...record, evaluatorInputs: { ...record.evaluatorInputs, historyProvider: {} } }, identity)).rejects.toThrow();
        await expect(validateDecisionContext({ ...record, evaluatorInputs: { ...record.evaluatorInputs, events: {} } }, identity)).rejects.toThrow();
        await expect(validateDecisionContext({ ...record, policyVersion: 'changed' }, identity)).rejects.toThrow();
        await expect(createDecisionContext(input({ evaluatorInputs: { ...evaluatorInputs(), userId: 'other' } }))).rejects.toThrow();
        await expect(createDecisionContext(input({ performedTrainingFacts: { ...facts(), asOfDate: '2026-09-27' } }))).rejects.toThrow();
    });

    it('records an incomplete minimum-safety gate without evaluator inputs', async () => {
        const gateIdentity = { ...identity, recommendationRevision: 0 };
        const record = await createDecisionContext(input({
            recommendationRevision: 0,
            minimumSafetyStatus: 'incomplete', evaluatorInputs: null, performedTrainingFacts: null,
            mechanicalCheckinHistory: undefined,
        }));
        expect(record.evaluatorInputs).toBeNull();
        expect(record).not.toHaveProperty('mechanicalCheckinHistory');
        await expect(validateDecisionContext(record, gateIdentity)).resolves.toEqual(record);
        await expect(createDecisionContext(input({ minimumSafetyStatus: 'incomplete' }))).rejects.toThrow();
        await expect(createDecisionContext(input({
            recommendationRevision: 0,
            minimumSafetyStatus: 'incomplete', evaluatorInputs: null,
            performedTrainingFacts: facts(), mechanicalCheckinHistory: undefined,
        }))).rejects.toThrow();
        await expect(createDecisionContext(input({ performedTrainingFacts: null }))).rejects.toThrow();
    });

    it('rejects a context larger than the reserved Firestore payload budget', async () => {
        const evaluator = evaluatorInputs();
        evaluator.readiness = {
            subjective: {}, objective: { oversized: 'x'.repeat(900 * 1024) },
        } as never;
        await expect(createDecisionContext(input({ evaluatorInputs: evaluator })))
            .rejects.toThrow('Decision context exceeds Firestore payload limit');
    });
});
