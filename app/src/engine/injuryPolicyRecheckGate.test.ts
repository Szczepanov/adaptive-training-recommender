import { describe, expect, it } from 'vitest';
import {
    deriveCarriedRegionRestrictions,
    RECHECK_CARRY_NOTE,
    resolveEffectiveInjuryConstraintsWithRecheck,
    resolveInjuryPolicy,
} from './injuryPolicy';
import type { InjuryConstraint, RegionTissueResponse } from './models';

/**
 * Issue #680's D-1 one-day pending-recheck gate: a region whose only evidence is D-1's
 * unresolved tissue check-in (no standing InjuryConstraint) would otherwise vanish the
 * moment D-1's data ages out of "today", even with no explicit settled follow-up. This
 * covers the D0 (flare) -> D1 (no follow-up, carries) -> D2 (explicit settled follow-up,
 * lifts) lifecycle directly against the pure resolvers, plus the structural one-day bound
 * and the "today's own data/standing injury always governs" precedence rules.
 */
describe('resolveEffectiveInjuryConstraintsWithRecheck (issue #680 D-1 pending-recheck gate)', () => {
    const D0 = '2026-09-01';
    const D1 = '2026-09-02';
    const D2 = '2026-09-03';

    it('D0->D1 lifecycle: an unfollowed moderate flare on D0 carries into D1 with no response of its own', () => {
        const d0Response: RegionTissueResponse = { region: 'shoulder', morningState: 'moderate' };
        const carriedIntoD1 = deriveCarriedRegionRestrictions(undefined, { shoulder: d0Response }, D0);
        expect(carriedIntoD1).toEqual([{ region: 'shoulder', severity: 'limit' }]);

        const d1Effective = resolveEffectiveInjuryConstraintsWithRecheck(undefined, undefined, D1, carriedIntoD1);
        expect(d1Effective).toEqual([{ region: 'shoulder', severity: 'limit', reviewBy: D1, note: RECHECK_CARRY_NOTE }]);

        const d1Policy = resolveInjuryPolicy(undefined, undefined, D1, carriedIntoD1);
        expect(d1Policy.restrictions.impliedGuardrails).toContain('avoid_overhead_pressing');
        expect(d1Policy.trace.tissueRecheckCarryApplied).toEqual(['shoulder']);
    });

    it('D1->D2: a second silent day does not carry a second time (structural one-day bound)', () => {
        // D1 itself reported nothing for the region (it only received a carry, no raw
        // response of its own) -- deriving D2's candidates from D1's raw tissueResponses
        // (undefined here) must therefore yield no further carry, regardless of what D0
        // originally reported.
        const carriedIntoD2 = deriveCarriedRegionRestrictions(undefined, undefined, D1);
        expect(carriedIntoD2).toEqual([]);

        const d2Effective = resolveEffectiveInjuryConstraintsWithRecheck(undefined, undefined, D2, carriedIntoD2);
        expect(d2Effective).toEqual([]);
    });

    it('D1->D2: an explicit settled follow-up on D1 lifts the restriction rather than carrying it', () => {
        const d1Settled: RegionTissueResponse = {
            region: 'shoulder', morningState: 'normal', painDuringTraining: 'moderate', afterTrainingState: 'mild', nextMorningReaction: 'normal',
        };
        const carriedIntoD2 = deriveCarriedRegionRestrictions(undefined, { shoulder: d1Settled }, D1);
        expect(carriedIntoD2).toEqual([]); // 'monitor' is not a qualifying carry candidate.

        const d2Effective = resolveEffectiveInjuryConstraintsWithRecheck(undefined, undefined, D2, carriedIntoD2);
        expect(d2Effective).toEqual([]);
    });

    it("today's own response for the same region governs over a carried restriction", () => {
        const carried = [{ region: 'shoulder' as const, severity: 'limit' as const }];
        const todaysOwnSettled: RegionTissueResponse = { region: 'shoulder', morningState: 'normal' };
        const effective = resolveEffectiveInjuryConstraintsWithRecheck(undefined, { shoulder: todaysOwnSettled }, D1, carried);
        expect(effective).toEqual([]);
    });

    it('a standing injury already covering the region takes precedence over a carried restriction', () => {
        const standing: InjuryConstraint[] = [{ region: 'shoulder', severity: 'monitor' }];
        const carried = [{ region: 'shoulder' as const, severity: 'limit' as const }];
        const effective = resolveEffectiveInjuryConstraintsWithRecheck(standing, undefined, D1, carried);
        expect(effective).toEqual(standing);
    });

    it('an exclude-severity D0 flare carries into D1 and still excludes Upper-body Strength', () => {
        const d0Severe: RegionTissueResponse = { region: 'shoulder', morningState: 'severe' };
        const carriedIntoD1 = deriveCarriedRegionRestrictions(undefined, { shoulder: d0Severe }, D0);
        expect(carriedIntoD1).toEqual([{ region: 'shoulder', severity: 'exclude' }]);

        const d1Policy = resolveInjuryPolicy(undefined, undefined, D1, carriedIntoD1);
        expect(d1Policy.restrictions.restrictedCategories).toContain('Upper-body Strength');
    });

    it('resolveInjuryPolicy omits tissueRecheckCarryApplied from the trace when no carry applies', () => {
        const policy = resolveInjuryPolicy(undefined, undefined, D1, []);
        expect(policy.trace.tissueRecheckCarryApplied).toBeUndefined();
    });
});
