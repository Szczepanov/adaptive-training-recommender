import { describe, expect, it } from 'vitest';
import { computeRankingCounterfactual, type RankCandidatesResult, type RankedCandidate } from './optimizer';
import type { SessionTemplate } from './models';

// Issue #458: computeRankingCounterfactual is a pure, read-only reduction over an
// already-completed rankCandidates() result. These fixtures hand-build RankedCandidate
// entries directly rather than exercising the full ranking pipeline, so each case isolates
// exactly one tier-blocking scenario.

function template(id: string, overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id,
        category: 'Easy Endurance',
        modality: 'Cycling',
        durationMin: 30,
        durationMax: 45,
        title: id,
        description: '',
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0.2,
        ...overrides,
    };
}

function candidate(overrides: Partial<RankedCandidate> & { template: SessionTemplate }): RankedCandidate {
    return {
        benefitScore: 1,
        costPenalty: 0,
        utilityScore: 1,
        coverageNeedTier: 3,
        recoveryPreferenceTier: 0,
        benefitTier: 0,
        rationale: '',
        excludedReasons: [],
        ...overrides,
    };
}

function result(accepted: RankedCandidate[], rejected: RankedCandidate[] = []): RankCandidatesResult {
    return { accepted, rejected, all: [...accepted, ...rejected] };
}

describe('computeRankingCounterfactual (issue #458)', () => {
    it('reports no blocking when the utility winner is also the lexicographic selection', () => {
        const a = candidate({ template: template('a'), utilityScore: 2, coverageNeedTier: 1 });
        const b = candidate({ template: template('b'), utilityScore: 1, coverageNeedTier: 2 });
        const out = computeRankingCounterfactual(result([a, b]), 'a')!;

        expect(out.bestUtilityTemplateId).toBe('a');
        expect(out.selectedVsBestUtilityGap).toBe(0);
        expect(out.utilityWinnerBlockedByCoverageTier).toBe(false);
        expect(out.utilityWinnerBlockedByRecoveryTier).toBe(false);
        expect(out.utilityWinnerBlockedByBenefitTier).toBe(false);
    });

    it('flags a coverage-tier block when a higher-utility candidate lost on coverageNeedTier', () => {
        const selected = candidate({ template: template('selected'), utilityScore: 1.0, coverageNeedTier: 0 });
        const higherUtilityBlocked = candidate({ template: template('blocked'), utilityScore: 5.0, coverageNeedTier: 2 });
        const out = computeRankingCounterfactual(result([selected, higherUtilityBlocked]), 'selected')!;

        expect(out.bestUtilityTemplateId).toBe('blocked');
        expect(out.selectedVsBestUtilityGap).toBeCloseTo(4.0);
        expect(out.utilityWinnerBlockedByCoverageTier).toBe(true);
        expect(out.utilityWinnerBlockedByRecoveryTier).toBe(false);
        expect(out.utilityWinnerBlockedByBenefitTier).toBe(false);
        expect(out.selectedAdvancesRequiredRole).toBe(true);
    });

    it('flags a recovery-preference-tier block independently of coverage/benefit tiers', () => {
        const selected = candidate({
            template: template('selected'), utilityScore: 0.5, coverageNeedTier: 2, recoveryPreferenceTier: 0, benefitTier: 1,
        });
        const blocked = candidate({
            template: template('blocked'), utilityScore: 3.0, coverageNeedTier: 2, recoveryPreferenceTier: 1, benefitTier: 1,
        });
        const out = computeRankingCounterfactual(result([selected, blocked]), 'selected')!;

        expect(out.utilityWinnerBlockedByCoverageTier).toBe(false);
        expect(out.utilityWinnerBlockedByRecoveryTier).toBe(true);
        expect(out.utilityWinnerBlockedByBenefitTier).toBe(false);
    });

    it('flags a benefit-tier block and can report multiple simultaneous blocks', () => {
        const selected = candidate({
            template: template('selected'), utilityScore: 0.2, coverageNeedTier: 3, recoveryPreferenceTier: 0, benefitTier: 0,
        });
        const blocked = candidate({
            template: template('blocked'), utilityScore: 9.0, coverageNeedTier: 1, recoveryPreferenceTier: 1, benefitTier: 2,
        });
        const out = computeRankingCounterfactual(result([selected, blocked]), 'selected')!;

        expect(out.utilityWinnerBlockedByCoverageTier).toBe(true);
        expect(out.utilityWinnerBlockedByRecoveryTier).toBe(true);
        expect(out.utilityWinnerBlockedByBenefitTier).toBe(true);
        expect(out.selectedAdvancesRequiredRole).toBe(false);
    });

    it('returns null when the selected template id has no accepted candidate (e.g. recovery fallback)', () => {
        const onlyCandidate = candidate({ template: template('other'), utilityScore: 1 });
        const out = computeRankingCounterfactual(result([onlyCandidate]), 'safe-recovery-fallback');
        expect(out).toBeNull();
    });

    it('reports zero gap and no blocking with exactly one accepted candidate', () => {
        const solo = candidate({ template: template('solo'), utilityScore: 0.7, coverageNeedTier: 2, benefitTier: 3 });
        const out = computeRankingCounterfactual(result([solo]), 'solo')!;

        expect(out.bestUtilityTemplateId).toBe('solo');
        expect(out.bestUtilityScore).toBe(0.7);
        expect(out.selectedVsBestUtilityGap).toBe(0);
        expect(out.utilityWinnerBlockedByCoverageTier).toBe(false);
        expect(out.utilityWinnerBlockedByBenefitTier).toBe(false);
    });
});
