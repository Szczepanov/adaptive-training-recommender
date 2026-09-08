import { describe, expect, it } from 'vitest';
import { computeSequencingDiagnostics } from './sequencingMetrics';
import type { ScenarioDecisionTrace } from './analyze';
import type { DimensionalFatigue, RankingCounterfactual, SessionTemplate, WorkoutCostProfile } from '../models';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_FATIGUE: DimensionalFatigue = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

function trace(overrides: Partial<ScenarioDecisionTrace> & {
    date: string;
    weekIndex: number;
    category: SessionTemplate['category'];
    cost?: Partial<WorkoutCostProfile>;
    combinedFatigue?: Partial<DimensionalFatigue>;
}): ScenarioDecisionTrace {
    const { category, cost, combinedFatigue, ...rest } = overrides;
    return {
        readinessTier: 'train',
        mode: 'train',
        selected: {
            templateId: `${category}-${overrides.date}`,
            category,
            modality: 'Cycling',
            durationMin: 60,
            durationMax: 60,
            stimulusProfile: null,
            projectedCost: { ...ZERO_COST, ...cost },
        },
        fatigue: {
            rawExternalLoad: ZERO_FATIGUE,
            clampedExternalLoad: ZERO_FATIGUE,
            internalResponse: ZERO_FATIGUE,
            combined: { ...ZERO_FATIGUE, ...combinedFatigue },
        },
        activeObjectives: [],
        contributorObjectiveChanges: { added: [], dropped: [] },
        fixedActivity: { count: 0, cost: ZERO_COST, stimulus: { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 } },
        rejectionCounts: {},
        utility: { top: 1, runnerUp: null, bestBenefitTemplateId: null, bestBenefitScore: null, selectedBenefitScore: null, selectedVsBestBenefitGap: null },
        rankingAudit: null,
        ...rest,
    };
}

function rankingAudit(overrides: Partial<RankingCounterfactual> & { selectedTemplateId: string }): RankingCounterfactual {
    return {
        coverageNeedTier: 3,
        recoveryPreferenceTier: 0,
        benefitTier: 0,
        utilityScore: 1,
        bestUtilityTemplateId: overrides.selectedTemplateId,
        bestUtilityScore: 1,
        selectedVsBestUtilityGap: 0,
        utilityWinnerBlockedByCoverageTier: false,
        utilityWinnerBlockedByRecoveryTier: false,
        utilityWinnerBlockedByBenefitTier: false,
        selectedAdvancesRequiredRole: false,
        ...overrides,
    };
}

describe('computeSequencingDiagnostics (issue #458)', () => {
    describe('residual-fatigue collision (§4.1)', () => {
        it('normalizes by cost so a tiny session does not look problematic despite high fatigue', () => {
            const t = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Mobility/Recovery',
                cost: { systemic: 0.01 }, combinedFatigue: { systemic: 0.9 },
            });
            const out = computeSequencingDiagnostics([t]);
            expect(out.residualFatigueCollision.perDay[0].collision).toBeCloseTo(0.9, 6);
        });

        it('reports zero (not NaN) for a genuinely zero-cost day', () => {
            const t = trace({ date: '2026-01-01', weekIndex: 0, category: 'Rest', combinedFatigue: { systemic: 0.8 } });
            const out = computeSequencingDiagnostics([t]);
            expect(out.residualFatigueCollision.perDay[0].collision).toBe(0);
            expect(Number.isNaN(out.residualFatigueCollision.perDay[0].collision)).toBe(false);
        });

        it('computes the weighted-average formula across dimensions and names top contributors', () => {
            const t = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Hard Endurance',
                cost: { systemic: 0.6, lowerBody: 0.4 },
                combinedFatigue: { systemic: 0.2, lowerBody: 0.8 },
            });
            const out = computeSequencingDiagnostics([t]);
            // (0.6*0.2 + 0.4*0.8) / (0.6+0.4) = (0.12 + 0.32) / 1.0 = 0.44
            expect(out.residualFatigueCollision.perDay[0].collision).toBeCloseTo(0.44, 6);
            expect(out.residualFatigueCollision.perDay[0].topDimensions[0]).toBe('lowerBody');
        });
    });

    describe('adjacent cost-vector overlap (§4.2)', () => {
        it('is zero when consecutive quality days share no cost dimension', () => {
            const a = trace({ date: '2026-01-01', weekIndex: 0, category: 'Hard Endurance', cost: { lowerBody: 0.8, cardiovascular: 0 } });
            const b = trace({ date: '2026-01-02', weekIndex: 0, category: 'Hard Endurance', cost: { lowerBody: 0, cardiovascular: 0.8 } });
            const out = computeSequencingDiagnostics([a, b]);
            expect(out.adjacentCostOverlap.perPair).toHaveLength(1);
            expect(out.adjacentCostOverlap.perPair[0].overlap).toBe(0);
        });

        it('is skipped across a recovery day (recovery breaks the adjacency)', () => {
            const a = trace({ date: '2026-01-01', weekIndex: 0, category: 'Hard Endurance', cost: { lowerBody: 0.8 } });
            const rest = trace({ date: '2026-01-02', weekIndex: 0, category: 'Rest' });
            const b = trace({ date: '2026-01-03', weekIndex: 0, category: 'Hard Endurance', cost: { lowerBody: 0.8 } });
            const out = computeSequencingDiagnostics([a, rest, b]);
            expect(out.adjacentCostOverlap.perPair).toHaveLength(0);
        });

        it('reports high overlap for two adjacent high-lower-body-cost days', () => {
            const a = trace({ date: '2026-01-01', weekIndex: 0, category: 'Full-body Strength', cost: { lowerBody: 0.9 } });
            const b = trace({ date: '2026-01-02', weekIndex: 0, category: 'Full-body Strength', cost: { lowerBody: 0.9 } });
            const out = computeSequencingDiagnostics([a, b]);
            expect(out.adjacentCostOverlap.perPair[0].lowerBodyOverlap).toBeGreaterThan(0.4);
            expect(out.adjacentCostOverlap.maxLowerBodyOverlap).toBe(out.adjacentCostOverlap.perPair[0].lowerBodyOverlap);
        });
    });

    describe('quality-session spacing (§4.3)', () => {
        it('reports min/median gap and adjacent-day count across a known sequence', () => {
            const dates = ['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
            const traces = dates.map((date, i) => trace({ date, weekIndex: 0, category: i % 2 === 0 ? 'Hard Endurance' : 'Easy Endurance' }));
            // Quality days: 01-01, 01-05, 01-07 (indices 0, 2, 4). Gaps: 4, 2.
            const out = computeSequencingDiagnostics(traces);
            expect(out.qualitySpacing.gapsDays).toEqual([4, 2]);
            expect(out.qualitySpacing.minGapDays).toBe(2);
            expect(out.qualitySpacing.medianGapDays).toBe(3);
            expect(out.qualitySpacing.adjacentQualityDayCount).toBe(0);
        });

        it('counts an adjacent-quality-day streak of length 3', () => {
            const traces = ['2026-01-01', '2026-01-02', '2026-01-03'].map(date =>
                trace({ date, weekIndex: 0, category: 'Hard Endurance' }));
            const out = computeSequencingDiagnostics(traces);
            expect(out.qualitySpacing.adjacentQualityDayCount).toBe(2);
            expect(out.qualitySpacing.longestQualityStreak).toBe(3);
        });

        it('reports null gap fields when fewer than two quality days exist', () => {
            const traces = [trace({ date: '2026-01-01', weekIndex: 0, category: 'Easy Endurance' })];
            const out = computeSequencingDiagnostics(traces);
            expect(out.qualitySpacing.minGapDays).toBeNull();
            expect(out.qualitySpacing.medianGapDays).toBeNull();
        });
    });

    describe('hard-day concentration & recovery placement (§4.4)', () => {
        it('flags recovery placed immediately after a high-collision day', () => {
            const hard = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Hard Endurance',
                cost: { systemic: 0.9 }, combinedFatigue: { systemic: 0.9 },
            });
            const rest = trace({ date: '2026-01-02', weekIndex: 0, category: 'Rest' });
            const out = computeSequencingDiagnostics([hard, rest]);
            expect(out.hardDayConcentration.weekly[0].recoveryAfterHighCollisionCount).toBe(1);
        });

        it('flags recovery while fatigue is low and feasible objective work remains', () => {
            const rest = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Rest', combinedFatigue: {},
                activeObjectives: [{ key: 'aerobic_base' as never, completedCredit: 0, projectedCredit: 0, requiredCredit: 2 }],
            });
            const out = computeSequencingDiagnostics([rest]);
            expect(out.hardDayConcentration.weekly[0].recoveryWhileFatigueLowAndWorkFeasibleCount).toBe(1);
        });

        it('does not flag recovery-while-feasible when all objectives are already satisfied', () => {
            const rest = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Rest', combinedFatigue: {},
                activeObjectives: [{ key: 'aerobic_base' as never, completedCredit: 2, projectedCredit: 2, requiredCredit: 2 }],
            });
            const out = computeSequencingDiagnostics([rest]);
            expect(out.hardDayConcentration.weekly[0].recoveryWhileFatigueLowAndWorkFeasibleCount).toBe(0);
        });

        it('groups weekly concentration by weekIndex', () => {
            const week0 = trace({ date: '2026-01-01', weekIndex: 0, category: 'Hard Endurance' });
            const week1 = trace({ date: '2026-01-08', weekIndex: 1, category: 'Hard Endurance' });
            const out = computeSequencingDiagnostics([week0, week1]);
            expect(out.hardDayConcentration.weekly.map(w => w.weekIndex)).toEqual([0, 1]);
            expect(out.hardDayConcentration.weekly[0].hardDayCount).toBe(1);
            expect(out.hardDayConcentration.weekly[1].hardDayCount).toBe(1);
        });
    });

    describe('opportunity-cost / sequence-regret (§4.5)', () => {
        it('aggregates zero opportunity cost when every day matched its utility winner', () => {
            const t = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Easy Endurance',
                rankingAudit: rankingAudit({ selectedTemplateId: 'x' }),
            });
            const out = computeSequencingDiagnostics([t]);
            expect(out.opportunityCost.utilityWinnerBlockedCount).toBe(0);
            expect(out.opportunityCost.meanBlockedUtilityGap).toBe(0);
        });

        it('aggregates a blocked day and attributes it to the correct tier', () => {
            const t = trace({
                date: '2026-01-01', weekIndex: 0, category: 'Easy Endurance',
                rankingAudit: rankingAudit({
                    selectedTemplateId: 'selected', bestUtilityTemplateId: 'blocked',
                    selectedVsBestUtilityGap: 2.5, utilityWinnerBlockedByCoverageTier: true,
                }),
            });
            const out = computeSequencingDiagnostics([t]);
            expect(out.opportunityCost.utilityWinnerBlockedCount).toBe(1);
            expect(out.opportunityCost.meanBlockedUtilityGap).toBeCloseTo(2.5);
            expect(out.opportunityCost.maxBlockedUtilityGap).toBeCloseTo(2.5);
            expect(out.opportunityCost.blockedByTier).toEqual({ coverage: 1, recovery: 0, benefit: 0 });
        });

        it('ignores days with no rankingAudit (e.g. the safe-recovery fallback)', () => {
            const t = trace({ date: '2026-01-01', weekIndex: 0, category: 'Rest', rankingAudit: null });
            const out = computeSequencingDiagnostics([t]);
            expect(out.opportunityCost.daysWithRankingAudit).toBe(0);
            expect(out.opportunityCost.utilityWinnerBlockedCount).toBe(0);
        });
    });

    it('produces deterministic output for identical input', () => {
        const traces = ['2026-01-01', '2026-01-02', '2026-01-03'].map((date, i) =>
            trace({ date, weekIndex: 0, category: i === 1 ? 'Rest' : 'Hard Endurance', cost: { lowerBody: 0.5 }, combinedFatigue: { lowerBody: 0.5 } }));
        const first = computeSequencingDiagnostics(traces);
        const second = computeSequencingDiagnostics(traces);
        expect(first).toEqual(second);
    });
});
