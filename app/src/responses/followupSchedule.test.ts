import { describe, expect, it } from 'vitest';
import { relevantFollowupRegions, resolvePendingNextMorningFollowups } from './followupSchedule';

describe('relevantFollowupRegions', () => {
    it('maps back_squat-style tissueDemand/safetyTags to knee', () => {
        const regions = relevantFollowupRegions([{ tissueDemand: ['knee_extensor', 'hip_extensor'], safetyTags: ['knee_swelling'] }]);
        expect(regions).toContain('knee');
        expect(regions).toContain('hip');
    });

    it('maps a field sprint drill to hamstring/calf-relevant regions', () => {
        const regions = relevantFollowupRegions([{ tissueDemand: ['posterior_chain', 'calf'], safetyTags: ['acute_hamstring_pain', 'worsening_achilles_pain'] }]);
        expect(regions).toEqual(expect.arrayContaining(['calf', 'hamstring', 'achilles']));
    });

    it('returns empty for an exercise with no tissue/safety tags', () => {
        expect(relevantFollowupRegions([{}])).toEqual([]);
    });

    it('returns empty for no exercises at all (e.g. an easy aerobic session)', () => {
        expect(relevantFollowupRegions([])).toEqual([]);
    });

    it('does not guess a region for an unrecognized tag', () => {
        expect(relevantFollowupRegions([{ tissueDemand: ['some_future_tag_nobody_mapped_yet'] }])).toEqual([]);
    });

    it('deduplicates and sorts regions across multiple exercises', () => {
        const regions = relevantFollowupRegions([
            { tissueDemand: ['knee_extensor'] },
            { tissueDemand: ['knee_extensor'] },
            { safetyTags: ['acute_hamstring_pain'] },
        ]);
        expect(regions).toEqual(['hamstring', 'knee']);
    });

    it('is case-insensitive', () => {
        expect(relevantFollowupRegions([{ tissueDemand: ['KNEE_EXTENSOR'] }])).toEqual(['knee']);
    });
});


describe('resolvePendingNextMorningFollowups', () => {
    const executionRef = { kind: 'execution' as const, id: 'exec-yesterday', date: '2026-09-29' };

    it('does not re-open a follow-up from normal tissue data merely because session linkage remains', () => {
        const pending = resolvePendingNextMorningFollowups({
            knee: {
                region: 'knee',
                morningState: 'normal',
                nextMorningReaction: 'normal',
                sourceSessionRef: executionRef,
            },
        }, undefined);

        expect(pending).toEqual([]);
    });

    it('keeps a morning-only moderate response due under the engine tissue-severity semantics', () => {
        const pending = resolvePendingNextMorningFollowups({
            shoulder: { region: 'shoulder', morningState: 'moderate' },
        }, undefined);

        expect(pending).toEqual([{ region: 'shoulder' }]);
    });

    it('includes relevant regions derived from a completed session even without a manual tissue flag', () => {
        const pending = resolvePendingNextMorningFollowups(
            undefined,
            undefined,
            [{ sessionRef: executionRef, regions: ['hip', 'knee'] }],
        );

        expect(pending).toEqual([
            { region: 'hip', sessionRef: executionRef },
            { region: 'knee', sessionRef: executionRef },
        ]);
    });

    it('uses the current-day next-morning answer to close the same region across due sources', () => {
        const pending = resolvePendingNextMorningFollowups(
            { knee: { region: 'knee', morningState: 'moderate', sourceSessionRef: executionRef } },
            { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } },
            [{ sessionRef: executionRef, regions: ['knee'] }],
        );

        expect(pending).toEqual([]);
    });

    it('deduplicates a manual and session-derived candidate for the same execution and region', () => {
        const pending = resolvePendingNextMorningFollowups(
            { knee: { region: 'knee', morningState: 'moderate', sourceSessionRef: executionRef } },
            undefined,
            [{ sessionRef: executionRef, regions: ['knee', 'hip'] }],
        );

        expect(pending).toEqual([
            { region: 'knee', sessionRef: executionRef },
            { region: 'hip', sessionRef: executionRef },
        ]);
    });

    it('coalesces multiple session candidates for the same region into one prompt', () => {
        const secondExecutionRef = { kind: 'execution' as const, id: 'exec-yesterday-2', date: '2026-09-29' };

        const pending = resolvePendingNextMorningFollowups(
            undefined,
            undefined,
            [
                { sessionRef: executionRef, regions: ['knee'] },
                { sessionRef: secondExecutionRef, regions: ['knee'] },
            ],
        );

        expect(pending).toEqual([{ region: 'knee' }]);
    });

    it('coalesces a source-less manual tissue flag with a session-derived candidate', () => {
        const pending = resolvePendingNextMorningFollowups(
            { knee: { region: 'knee', morningState: 'moderate' } },
            undefined,
            [{ sessionRef: executionRef, regions: ['knee'] }],
        );

        expect(pending).toEqual([{ region: 'knee', sessionRef: executionRef }]);
    });

    it('preserves explicit manual attribution when another session also touches the region', () => {
        const secondExecutionRef = { kind: 'execution' as const, id: 'exec-yesterday-2', date: '2026-09-29' };

        const pending = resolvePendingNextMorningFollowups(
            { knee: { region: 'knee', morningState: 'moderate', sourceSessionRef: executionRef } },
            undefined,
            [{ sessionRef: secondExecutionRef, regions: ['knee'] }],
        );

        expect(pending).toEqual([{ region: 'knee', sessionRef: executionRef }]);
    });
});
