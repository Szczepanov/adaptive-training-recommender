import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../engine/simulation/scenarios';
import {
    runHistoryCounterfactualSeries,
    computeHistoricalReplayDigests,
    computeHistoricalHistoryDigest,
    type HistoricalDecisionInputs,
    type HistoricalHistoryPass,
} from './historyRecommendationCounterfactual';

const DATE = '2026-08-10';
const scenario = SCENARIOS.find(candidate => candidate.id === 'evergreen_balanced_four_sessions')!;

function inputs(overrides: Partial<HistoricalDecisionInputs> = {}): HistoricalDecisionInputs {
    const facts = {
        asOfDate: DATE,
        windowDays: 7,
        revision: `canonical-facts-v1:evergreen_general:${DATE}:empty`,
        exposures: [],
        coverageCredits: [],
    };
    const preparedHistorySnapshot: HistoricalDecisionInputs['preparedHistorySnapshot'] = {
        throughDateExclusive: DATE,
        windowDays: 7,
        completedEvents: [],
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'activities-source' },
            recommendations: { status: 'AVAILABLE', revision: 'recommendations-source' },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: `${DATE}T12:00:00.000Z`,
        performedTrainingFacts: facts,
    };
    return {
        userId: 'user-1',
        exportedUserId: 'user-1',
        date: DATE,
        dateAlias: 'date-001',
        evaluatedAt: `${DATE}T12:00:00.000Z`,
        minimumSafetyCheckinStatus: 'complete',
        normalRecommendationEligible: true,
        readiness: scenario.readinessForWeek(0),
        context: scenario.context,
        events: [],
        previousMode: undefined,
        fixedActivities: [],
        authoredPlanBlocks: [],
        trainingIntentProfile: scenario.trainingIntentProfile ?? null,
        preferences: scenario.preferences ?? null,
        externalContext: null,
        externalRestContext: null,
        scheduleOverlays: [],
        confirmedProgressionOverrides: new Map(),
        mechanicalCheckinHistory: [],
        preparedHistorySnapshot,
        ...overrides,
    };
}

async function historyPass(overrides: Partial<HistoricalHistoryPass> = {}): Promise<HistoricalHistoryPass> {
    const pass = {
        revision: 'broad-history-v1',
        exposures: [],
        decisionInputDigest: 'b'.repeat(64),
        experimentRevisionDigest: 'c'.repeat(64),
        performedFactsDigest: 'd'.repeat(64),
        mechanicalCheckinDigest: 'e'.repeat(64),
        ...overrides,
    };
    return { ...pass, digest: overrides.digest ?? await computeHistoricalHistoryDigest(pass.revision, pass.exposures) };
}

async function options(
    value: HistoricalDecisionInputs = inputs(),
    liveOverrides: Partial<HistoricalHistoryPass> = {},
    canonicalOverrides: Partial<HistoricalHistoryPass> = {},
) {
    const provenance = { recordsSha256: 'f'.repeat(64), sourceCommit: 'commit-1', sourceTreeSha256: 'a'.repeat(64), policyVersion: 'policy-1' };
    const digests = await computeHistoricalReplayDigests(value, provenance);
    const [live, canonical] = await Promise.all([
        historyPass({ ...digests, ...liveOverrides }),
        historyPass({ ...digests, ...canonicalOverrides }),
    ]);
    return {
        dates: [DATE],
        inputForDate: () => ({
            status: 'replayable' as const,
            inputs: value,
            live,
            canonical,
        }),
        ...provenance,
    };
}

describe('runHistoryCounterfactualSeries', () => {
    it('rejects different non-history digests before evaluating either pass', async () => {
        const pair = await options(inputs(), {}, { decisionInputDigest: 'different' });
        await expect(runHistoryCounterfactualSeries(pair)).rejects.toThrow('decisionInputDigest_mismatch');
    });

    it('rejects different narrow performed-facts digests', async () => {
        const pair = await options(inputs(), {}, { performedFactsDigest: 'different' });
        await expect(runHistoryCounterfactualSeries(pair)).rejects.toThrow('performedFactsDigest_mismatch');
    });

    it('hashes the actual date inputs and experiment provenance before either pass', async () => {
        const pair = await options();
        const resolved = pair.inputForDate();
        if (resolved.status !== 'replayable') throw new Error('fixture must be replayable');
        const changedInput = {
            ...resolved.inputs,
            minimumSafetyCheckinStatus: 'incomplete',
        };
        await expect(runHistoryCounterfactualSeries({
            ...pair,
            inputForDate: () => ({ ...resolved, inputs: changedInput }),
        })).rejects.toThrow('decisionInputDigest_mismatch');
        await expect(runHistoryCounterfactualSeries({ ...pair, sourceCommit: 'different-commit' }))
            .rejects.toThrow('experimentRevisionDigest_mismatch');
        await expect(runHistoryCounterfactualSeries({ ...pair, sourceTreeSha256: 'b'.repeat(64) }))
            .rejects.toThrow('experimentRevisionDigest_mismatch');
    });

    it('rejects a changed broad-history revision whose caller kept the old digest', async () => {
        const pair = await options();
        const resolved = pair.inputForDate();
        if (resolved.status !== 'replayable') throw new Error('fixture must be replayable');
        await expect(runHistoryCounterfactualSeries({
            ...pair,
            inputForDate: () => ({
                ...resolved,
                live: { ...resolved.live, revision: 'changed-revision' },
            }),
        })).rejects.toThrow('liveHistoryDigest_mismatch');
    });

    it('fails closed when injected history would suppress an absent performed-facts read', async () => {
        const value = inputs({
            preparedHistorySnapshot: { ...inputs().preparedHistorySnapshot, performedTrainingFacts: null },
        });
        await expect(runHistoryCounterfactualSeries(await options(value))).rejects.toThrow('performed_training_facts_not_prepared');
    });

    it('reports an unprovable source as not replayable without a simulation fallback', async () => {
        const result = await runHistoryCounterfactualSeries({
            ...await options(),
            inputForDate: () => ({ status: 'not_replayable', dateAlias: 'date-001', reasonCodes: ['mutable_profile_unprovable'] }),
        });
        expect(result).toMatchObject({
            candidateDates: 1,
            evaluatedDates: 0,
            notReplayableDates: 1,
            notReplayableByReason: { mutable_profile_unprovable: 1 },
        });
    });

    it('propagates unexpected date-input assembly failures instead of disguising them as history gaps', async () => {
        const pair = await options();
        await expect(runHistoryCounterfactualSeries({
            ...pair,
            inputForDate: () => {
                throw new Error('assembler_contract_regression');
            },
        })).rejects.toThrow('assembler_contract_regression');
    });

    it('repeats deterministically and preserves the same wider provider requests in both passes', async () => {
        const base = inputs();
        const pair = await options({
            ...base,
            trainingIntentProfile: { ...base.trainingIntentProfile!, priorities: ['endurance'] },
        });
        const first = await runHistoryCounterfactualSeries(pair);
        const second = await runHistoryCounterfactualSeries(pair);
        expect(second).toEqual(first);
        expect(first).toMatchObject({ candidateDates: 1, evaluatedDates: 1, changedDates: 0, unresolvedDates: 0 });
        expect(first.evaluations[0].providerRequests).toContain(`snapshot:${DATE}:28`);
    });

    it('rejects stale review labels and has no field-wide classification input', async () => {
        const pair = {
            ...await options(),
            reviewLabels: [{
                recordsSha256: 'f'.repeat(64), sourceCommit: 'commit-1', sourceTreeSha256: 'a'.repeat(64), policyVersion: 'policy-1',
                dateAlias: 'D001', field: 'fatigue' as const,
                nonHistoryInputDigest: 'b'.repeat(64), liveHistoryDigest: 'a'.repeat(64), canonicalHistoryDigest: 'a'.repeat(64),
                classification: 'expected' as const, reasonCode: 'reviewed', evidenceRefs: ['history-comparison'],
            }],
        };
        await expect(runHistoryCounterfactualSeries(pair)).rejects.toThrow('stale_or_unmatched_recommendation_label');
    });
});
