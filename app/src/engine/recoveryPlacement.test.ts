import { describe, expect, it } from 'vitest';
import {
    CANONICAL_RECOVERY_WORKOUT_IDS,
    checkRollingRecoveryInvariant,
    composeCoverageNeedTier,
    isQualifyingRecoveryIdentity,
    MAX_CONSECUTIVE_NON_RECOVERY_DAYS,
    recoveryNeedTierForCandidate,
    RECOVERY_INTERVAL_DAYS,
    RECOVERY_POLICY_ID,
    resolveRecoveryAuthority,
    resolveRecoveryPlacementState,
} from './recoveryPlacement';
import {
    EVERGREEN_GENERAL_COVERAGE_SET,
    SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
} from '../workouts/event-plan';
import type { CoverageState, WeeklyCoverageRequirement } from './coverage';
import type { SessionTemplate } from './models';

function recoveryRequirement(): WeeklyCoverageRequirement {
    return {
        id: 'coverage_block_build_1_recovery_or_rest_0',
        key: 'recovery_or_rest',
        label: 'Mobility, easy recovery or complete rest',
        requirement: 'required',
        minimumSessions: 1,
        targetSessions: 1,
        completedSessions: 0,
        projectedSessions: 0,
        priority: 'must_have',
        rollingWindowDays: 7,
        windowStart: '2026-09-01',
        windowEnd: '2026-09-14',
        credits: [],
    };
}

function septemberCoverageState(overrides: Partial<CoverageState> = {}): CoverageState {
    return {
        asOfDate: '2026-09-08',
        phase: 'build',
        activeBlockId: 'block_build_1',
        coverageSetId: 'september_cycling_event',
        descriptor: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
        requirements: [recoveryRequirement()],
        ...overrides,
    };
}

describe('ADR-0038 recovery placement state and identity (RP0)', () => {
    describe('policy constants', () => {
        it('declares exact ADR-0038 interval and maximum non-recovery streak constants', () => {
            expect(RECOVERY_POLICY_ID).toBe('policy.load_recovery.weekly_recovery_placement_v1');
            expect(RECOVERY_INTERVAL_DAYS).toBe(7);
            expect(MAX_CONSECUTIVE_NON_RECOVERY_DAYS).toBe(6);
        });
    });

    describe('authority resolution', () => {
        it('uses product_policy fallback for plan-less athletes without fake plan IDs', () => {
            const res = resolveRecoveryAuthority(null);
            expect(res.authority).toBe('product_policy');
            expect(res.coverageSetId).toBe('evergreen_general');
            expect(res.phase).toBe('general');
            expect(res.descriptor.id).toBe(EVERGREEN_GENERAL_COVERAGE_SET.id);
        });

        it('does not treat descriptor presence alone as active authored recovery authority', () => {
            const res = resolveRecoveryAuthority(septemberCoverageState({ requirements: [] }));
            expect(res.authority).toBe('product_policy');
            expect(res.coverageSetId).toBe('evergreen_general');
            expect(res.phase).toBe('general');
        });

        it('does not use a stale authored recovery requirement when the role is inactive in the phase', () => {
            const res = resolveRecoveryAuthority(septemberCoverageState({ phase: 'race' }));
            expect(res.authority).toBe('product_policy');
            expect(res.coverageSetId).toBe('evergreen_general');
            expect(res.phase).toBe('general');
        });

        it('uses authored_coverage authority when active coverage has a recovery_or_rest requirement', () => {
            const res = resolveRecoveryAuthority(septemberCoverageState());
            expect(res.authority).toBe('authored_coverage');
            expect(res.coverageSetId).toBe('september_cycling_event');
            expect(res.phase).toBe('build');
            expect(res.descriptor.id).toBe('september_cycling_event');
        });
    });

    describe('exact qualifying recovery identity', () => {
        it('qualifies canonical recovery identities under product policy', () => {
            for (const workoutId of CANONICAL_RECOVERY_WORKOUT_IDS) {
                expect(isQualifyingRecoveryIdentity(workoutId)).toBe(true);
            }
        });

        it('qualifies mapped engine templates', () => {
            expect(isQualifyingRecoveryIdentity('rest_01')).toBe(true);
            expect(isQualifyingRecoveryIdentity('mob_01')).toBe(true);
            expect(isQualifyingRecoveryIdentity('mob_02')).toBe(true);
        });

        it('rejects unmapped templates or generic non-recovery categories', () => {
            expect(isQualifyingRecoveryIdentity('end_easy_01')).toBe(false);
            expect(isQualifyingRecoveryIdentity('str_full_01')).toBe(false);
            expect(isQualifyingRecoveryIdentity('unmapped_mobility_template')).toBe(false);
            expect(isQualifyingRecoveryIdentity({ id: 'unknown_session' })).toBe(false);
        });
    });

    describe('local-date deadline arithmetic and state resolution', () => {
        it('calculates dueByDate as R + 7 for known recovery date', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-07',
                latestQualifyingRecoveryDate: '2026-09-01',
            });

            expect(state.policyId).toBe(RECOVERY_POLICY_ID);
            expect(state.historicalState).toBe('known');
            expect(state.referenceKind).toBe('qualifying_recovery');
            expect(state.referenceDate).toBe('2026-09-01');
            expect(state.dueByDate).toBe('2026-09-08');
            expect(state.isDueToday).toBe(false);
            expect(state.isOverdue).toBe(false);
            expect(state.daysUntilDue).toBe(1);
            expect(state.reason).toBe('recovery_not_due');
        });

        it('flags isDueToday on R + 7', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-08',
                latestQualifyingRecoveryDate: '2026-09-01',
            });

            expect(state.dueByDate).toBe('2026-09-08');
            expect(state.isDueToday).toBe(true);
            expect(state.isOverdue).toBe(false);
            expect(state.daysUntilDue).toBe(0);
            expect(state.reason).toBe('recovery_due_today');
        });

        it('flags isOverdue past R + 7', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-09',
                latestQualifyingRecoveryDate: '2026-09-01',
            });

            expect(state.dueByDate).toBe('2026-09-08');
            expect(state.isDueToday).toBe(false);
            expect(state.isOverdue).toBe(true);
            expect(state.daysUntilDue).toBe(-1);
            expect(state.reason).toBe('recovery_overdue');
        });
    });

    describe('bootstrap reference semantics', () => {
        it('uses bootstrap date B as deadline reference B + 7 when history is unknown', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-05',
                bootstrapDate: '2026-09-01',
            });

            expect(state.historicalState).toBe('unknown');
            expect(state.referenceKind).toBe('bootstrap');
            expect(state.referenceDate).toBe('2026-09-01');
            expect(state.dueByDate).toBe('2026-09-08');
            expect(state.isDueToday).toBe(false);
            expect(state.isOverdue).toBe(false);
            expect(state.daysUntilDue).toBe(3);
            expect(state.reason).toBe('recovery_bootstrap_reference');
        });

        it('does not count bootstrap date as recovery credit', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-08',
                bootstrapDate: '2026-09-01',
            });

            // On B + 7 with no recovery since bootstrap, state is due.
            expect(state.isDueToday).toBe(true);
            expect(state.latestQualifyingRecoveryDate).toBeNull();
        });

        it('replaces bootstrap reference when a real qualifying recovery occurs', () => {
            // Suppose a recovery occurred on 2026-09-04 before the bootstrap deadline of 2026-09-08.
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-05',
                bootstrapDate: '2026-09-01',
                latestQualifyingRecoveryDate: '2026-09-04',
            });

            expect(state.historicalState).toBe('known');
            expect(state.referenceKind).toBe('qualifying_recovery');
            expect(state.referenceDate).toBe('2026-09-04');
            expect(state.dueByDate).toBe('2026-09-11'); // 2026-09-04 + 7
            expect(state.daysUntilDue).toBe(6);
        });

        it('is idempotent across repeated daily recomputation with stable bootstrap date', () => {
            const b = '2026-09-01';
            const day1 = resolveRecoveryPlacementState({ asOfDate: '2026-09-02', bootstrapDate: b });
            const day2 = resolveRecoveryPlacementState({ asOfDate: '2026-09-03', bootstrapDate: b });
            const day3 = resolveRecoveryPlacementState({ asOfDate: '2026-09-04', bootstrapDate: b });

            expect(day1.dueByDate).toBe('2026-09-08');
            expect(day2.dueByDate).toBe('2026-09-08');
            expect(day3.dueByDate).toBe('2026-09-08');
            expect(day1.referenceDate).toBe(b);
            expect(day2.referenceDate).toBe(b);
            expect(day3.referenceDate).toBe(b);
        });

        it('reports no_authoritative_history when neither recovery nor bootstrap is available', () => {
            const state = resolveRecoveryPlacementState({ asOfDate: '2026-09-05' });
            expect(state.historicalState).toBe('unknown');
            expect(state.referenceKind).toBeNull();
            expect(state.referenceDate).toBeNull();
            expect(state.dueByDate).toBeNull();
            expect(state.reason).toBe('no_authoritative_history');
        });
    });

    describe('tier calculation and composition', () => {
        const restCandidate: Partial<SessionTemplate> = { id: 'rest_01' };
        const workCandidate: Partial<SessionTemplate> = { id: 'end_easy_01' };

        it('returns tier 2 for qualifying recovery with slack', () => {
            const state = resolveRecoveryPlacementState({
                asOfDate: '2026-09-06',
                latestQualifyingRecoveryDate: '2026-09-01',
            });
            expect(recoveryNeedTierForCandidate(restCandidate as SessionTemplate, state)).toBe(2);
        });

        it('returns tier 1 for qualifying recovery on due day or overdue', () => {
            const dueState = resolveRecoveryPlacementState({
                asOfDate: '2026-09-08',
                latestQualifyingRecoveryDate: '2026-09-01',
            });
            expect(recoveryNeedTierForCandidate(restCandidate as SessionTemplate, dueState)).toBe(1);

            const overdueState = resolveRecoveryPlacementState({
                asOfDate: '2026-09-09',
                latestQualifyingRecoveryDate: '2026-09-01',
            });
            expect(recoveryNeedTierForCandidate(restCandidate as SessionTemplate, overdueState)).toBe(1);
        });

        it('returns tier 3 for non-recovery candidates regardless of due state', () => {
            const dueState = resolveRecoveryPlacementState({
                asOfDate: '2026-09-08',
                latestQualifyingRecoveryDate: '2026-09-01',
            });
            expect(recoveryNeedTierForCandidate(workCandidate as SessionTemplate, dueState)).toBe(3);
        });

        it('does not promote recovery before durable history or bootstrap authority exists', () => {
            const unknownState = resolveRecoveryPlacementState({ asOfDate: '2026-09-08' });
            expect(unknownState.reason).toBe('no_authoritative_history');
            expect(recoveryNeedTierForCandidate(restCandidate as SessionTemplate, unknownState)).toBe(3);
        });

        it('never returns tier 0', () => {
            const overdueState = resolveRecoveryPlacementState({
                asOfDate: '2026-09-15',
                latestQualifyingRecoveryDate: '2026-09-01',
            });
            const tier = recoveryNeedTierForCandidate(restCandidate as SessionTemplate, overdueState);
            expect(tier).not.toBe(0);
            expect(tier).toBe(1);
        });

        it('preserves tier 0 programming authority under composeCoverageNeedTier', () => {
            // If authored coverage has a tier 0 programming requirement, recovery urgency (tier 1) never overrides it.
            expect(composeCoverageNeedTier(0, 1)).toBe(0);
            // Tier 1 recovery beats tier 2 and tier 3 discretionary work.
            expect(composeCoverageNeedTier(2, 1)).toBe(1);
            expect(composeCoverageNeedTier(3, 1)).toBe(1);
            // Slack tier 2 recovery beats tier 3 work.
            expect(composeCoverageNeedTier(3, 2)).toBe(2);
        });
    });

    describe('rolling recovery invariant check', () => {
        it('passes when at least one recovery occurs in every 7-day window', () => {
            const dates = [
                '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
                '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08',
                '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
                '2026-09-13', '2026-09-14',
            ];
            // Recoveries placed on days 07 and 14.
            const recoveryDates = new Set(['2026-09-07', '2026-09-14']);
            const result = checkRollingRecoveryInvariant(dates, recoveryDates);
            expect(result.compliant).toBe(true);
            expect(result.maxConsecutiveNonRecoveryDays).toBe(6);
            expect(result.violations).toHaveLength(0);
        });

        it('fails with violation when 7 consecutive days pass without recovery', () => {
            const dates = [
                '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
                '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08',
            ];
            // Only day 01 was recovery; 7 consecutive non-recovery days follow (02-08).
            const recoveryDates = new Set(['2026-09-01']);
            const result = checkRollingRecoveryInvariant(dates, recoveryDates);
            expect(result.compliant).toBe(false);
            expect(result.maxConsecutiveNonRecoveryDays).toBe(7);
            expect(result.violations).toHaveLength(1);
            expect(result.violations[0]).toEqual({
                windowStart: '2026-09-02',
                windowEnd: '2026-09-08',
                nonRecoveryCount: 7,
            });
        });

        it('counts each local date once even when multiple exposures exist on one date', () => {
            const dates = [
                '2026-09-01', '2026-09-02', '2026-09-03',
                '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-06',
            ];
            const result = checkRollingRecoveryInvariant(dates, new Set());
            expect(result.compliant).toBe(true);
            expect(result.maxConsecutiveNonRecoveryDays).toBe(6);
            expect(result.violations).toHaveLength(0);
        });

        it('excludes pre-bootstrap dates and the bootstrap reference date from evaluation', () => {
            const dates = [
                '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
                '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01',
                '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
                '2026-09-06', '2026-09-07',
            ];
            // Bootstrap is 2026-09-01. Prior dates and B itself are excluded; recovery occurs on B + 6.
            const recoveryDates = new Set(['2026-09-07']);
            const result = checkRollingRecoveryInvariant(dates, recoveryDates, '2026-09-01');
            expect(result.compliant).toBe(true);
            expect(result.violations).toHaveLength(0);
        });

        it('evaluates the first bootstrap window exactly as B + 1 through B + 7', () => {
            const dates = [
                '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
                '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08',
            ];
            const result = checkRollingRecoveryInvariant(dates, new Set(), '2026-09-01');
            expect(result.compliant).toBe(false);
            expect(result.maxConsecutiveNonRecoveryDays).toBe(7);
            expect(result.violations).toEqual([{
                windowStart: '2026-09-02',
                windowEnd: '2026-09-08',
                nonRecoveryCount: 7,
            }]);
        });
    });
});
