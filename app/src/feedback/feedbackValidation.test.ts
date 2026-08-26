import { describe, expect, it } from 'vitest';
import {
    parseAthleteDecisionLog,
    parseClosedLoopFeedbackRecord,
    parseCounterfactualRegret,
    parseDoseReconciliation,
    parseRecoveryTrajectory,
    parseSubjectiveUtility,
} from './feedbackValidation';

describe('feedbackValidation', () => {
    describe('parseAthleteDecisionLog', () => {
        it('validates a valid athlete decision log', () => {
            const valid = {
                date: '2026-08-26',
                recommendationRef: {
                    recommendationId: 'rec-123',
                    revision: 1,
                },
                action: 'scaled_down',
                reasons: ['feeling_fatigued', 'time_constraint'],
                note: 'Cut final interval short due to hamstring tightness',
                decidedAt: '2026-08-26T07:30:00Z',
            };
            const parsed = parseAthleteDecisionLog(valid);
            expect(parsed.action).toBe('scaled_down');
            expect(parsed.reasons).toEqual(['feeling_fatigued', 'time_constraint']);
        });

        it('rejects invalid action', () => {
            const invalid = {
                date: '2026-08-26',
                recommendationRef: { recommendationId: 'rec-123', revision: 1 },
                action: 'invalid_action',
                reasons: [],
                note: null,
                decidedAt: '2026-08-26T07:30:00Z',
            };
            expect(() => parseAthleteDecisionLog(invalid)).toThrow('Invalid action');
        });

        it('requires a real ISO timestamp with an explicit offset', () => {
            const base = {
                date: '2026-08-26',
                recommendationRef: { recommendationId: 'rec-123', revision: 1 },
                action: 'accepted',
                reasons: [],
                note: null,
            };
            expect(() => parseAthleteDecisionLog({ ...base, decidedAt: '2026-02-30T07:30:00Z' })).toThrow('Invalid decidedAt');
            expect(() => parseAthleteDecisionLog({ ...base, decidedAt: '2026-08-26 07:30:00' })).toThrow('Invalid decidedAt');
        });
    });

    describe('parseDoseReconciliation', () => {
        const validPayload = {
            date: '2026-08-26',
            plannedDurationMin: 60,
            actualDurationMin: 45,
            plannedWorkKj: 750,
            actualWorkKj: 550,
            durationDeltaPct: -25,
            workDeltaPct: -26.67,
            completedZoneDistribution: {
                z1Seconds: 600,
                z2Seconds: 1500,
                z3Seconds: 600,
                z4Seconds: 0,
                z5Seconds: 0,
            },
            holdCompliancePct: 92,
            stepOmissionsCount: 1,
        };

        it('validates a complete dose reconciliation payload', () => {
            const parsed = parseDoseReconciliation(validPayload);
            expect(parsed.plannedDurationMin).toBe(60);
            expect(parsed.actualDurationMin).toBe(45);
            expect(parsed.completedZoneDistribution?.z2Seconds).toBe(1500);
        });

        it('rejects NaN, Infinity, negative zone seconds, and invalid percentages', () => {
            expect(() => parseDoseReconciliation({ ...validPayload, actualDurationMin: Number.NaN })).toThrow('actualDurationMin');
            expect(() => parseDoseReconciliation({ ...validPayload, plannedWorkKj: Number.POSITIVE_INFINITY })).toThrow('plannedWorkKj');
            expect(() => parseDoseReconciliation({
                ...validPayload,
                completedZoneDistribution: { ...validPayload.completedZoneDistribution, z2Seconds: -1 },
            })).toThrow('zone distribution');
            expect(() => parseDoseReconciliation({ ...validPayload, holdCompliancePct: 101 })).toThrow('holdCompliancePct');
            expect(() => parseDoseReconciliation({ ...validPayload, stepOmissionsCount: 1.5 })).toThrow('stepOmissionsCount');
        });

        it('does not silently coerce a malformed optional hold compliance field to null', () => {
            expect(() => parseDoseReconciliation({ ...validPayload, holdCompliancePct: '92' })).toThrow('holdCompliancePct');
        });

        it('rejects percentage deltas that contradict their planned and actual values', () => {
            expect(() => parseDoseReconciliation({
                ...validPayload,
                durationDeltaPct: 0,
            })).toThrow('durationDeltaPct');
            expect(() => parseDoseReconciliation({
                ...validPayload,
                workDeltaPct: -20,
            })).toThrow('workDeltaPct');
        });

        it('defines zero-plan and unavailable-source delta semantics explicitly', () => {
            const zeroDose = parseDoseReconciliation({
                ...validPayload,
                plannedDurationMin: 0,
                actualDurationMin: 0,
                durationDeltaPct: 0,
                plannedWorkKj: 0,
                actualWorkKj: 0,
                workDeltaPct: 0,
            });
            expect(zeroDose.durationDeltaPct).toBe(0);
            expect(zeroDose.workDeltaPct).toBe(0);

            const unboundedDuration = parseDoseReconciliation({
                ...validPayload,
                plannedDurationMin: 0,
                actualDurationMin: 20,
                durationDeltaPct: null,
                plannedWorkKj: 500,
                actualWorkKj: null,
                workDeltaPct: null,
            });
            expect(unboundedDuration.durationDeltaPct).toBeNull();
            expect(unboundedDuration.workDeltaPct).toBeNull();

            expect(() => parseDoseReconciliation({
                ...validPayload,
                plannedDurationMin: 0,
                actualDurationMin: 20,
                durationDeltaPct: 100,
            })).toThrow('durationDeltaPct');
        });
    });

    describe('parseRecoveryTrajectory', () => {
        it('validates all recovery horizons and score bounds', () => {
            const parsed = parseRecoveryTrajectory({
                date: '2026-08-26',
                hours24: { hrvDeltaPct: -5, rhrDeltaBpm: 1, sorenessScore: 3, readinessScore: 70 },
                hours48: { hrvDeltaPct: 1, rhrDeltaBpm: 0, sorenessScore: 2, readinessScore: 82 },
                hours72: { hrvDeltaPct: 3, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
                autonomicReboundState: 'expected',
            });
            expect(parsed.hours48.readinessScore).toBe(82);
        });

        it('rejects non-finite and out-of-range recovery scores', () => {
            const base = {
                date: '2026-08-26',
                hours24: { hrvDeltaPct: -5, rhrDeltaBpm: 1, sorenessScore: 3, readinessScore: 70 },
                hours48: { hrvDeltaPct: 1, rhrDeltaBpm: 0, sorenessScore: 2, readinessScore: 82 },
                hours72: { hrvDeltaPct: 3, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
                autonomicReboundState: 'expected',
            };
            expect(() => parseRecoveryTrajectory({
                ...base,
                hours24: { ...base.hours24, hrvDeltaPct: Number.NaN },
            })).toThrow('hrvDeltaPct');
            expect(() => parseRecoveryTrajectory({
                ...base,
                hours48: { ...base.hours48, readinessScore: 101 },
            })).toThrow('readinessScore');
        });
    });

    describe('parseCounterfactualRegret', () => {
        const validPayload = {
            date: '2026-08-26',
            regretClass: 'overreaching_crash',
            athleteDeclaredRegret: 'should_have_rested',
            confidence: 'high',
            rationales: [
                'Higher-than-recommended dose was followed by persistent 48h suppression.',
                'The athlete also reported that rest would have been preferable.',
            ],
            counterfactualAlternative: 'A lower-dose alternative is the candidate comparison for future prospective calibration.',
        };

        it('validates a counterfactual regret assessment', () => {
            const parsed = parseCounterfactualRegret(validPayload);
            expect(parsed.regretClass).toBe('overreaching_crash');
            expect(parsed.confidence).toBe('high');
        });

        it('rejects malformed optional values instead of silently converting them to null', () => {
            expect(() => parseCounterfactualRegret({ ...validPayload, athleteDeclaredRegret: 'maybe' })).toThrow('athleteDeclaredRegret');
            expect(() => parseCounterfactualRegret({ ...validPayload, counterfactualAlternative: 42 })).toThrow('counterfactualAlternative');
        });

        it('rejects empty rationale strings', () => {
            expect(() => parseCounterfactualRegret({ ...validPayload, rationales: [''] })).toThrow('rationales');
        });
    });

    describe('parseSubjectiveUtility', () => {
        it('enforces 1-5 Likert bounds and helpfulness enum', () => {
            const parsed = parseSubjectiveUtility({
                utilityScore: 5,
                clarityScore: 4,
                coachingHelpfulness: 'very_helpful',
                feedbackNote: null,
            });
            expect(parsed.utilityScore).toBe(5);
            expect(() => parseSubjectiveUtility({
                utilityScore: 6,
                clarityScore: 4,
                coachingHelpfulness: 'very_helpful',
                feedbackNote: null,
            })).toThrow('utilityScore');
        });
    });

    describe('parseClosedLoopFeedbackRecord', () => {
        const baseRecord = {
            date: '2026-08-26',
            recommendationRef: { recommendationId: 'rec-123', revision: 2 },
            decision: {
                date: '2026-08-26',
                recommendationRef: { recommendationId: 'rec-123', revision: 2 },
                action: 'accepted',
                reasons: [],
                note: null,
                decidedAt: '2026-08-26T07:30:00Z',
            },
            doseReconciliation: {
                date: '2026-08-26',
                plannedDurationMin: 60,
                actualDurationMin: 60,
                plannedWorkKj: null,
                actualWorkKj: null,
                durationDeltaPct: 0,
                workDeltaPct: null,
                completedZoneDistribution: null,
                holdCompliancePct: null,
                stepOmissionsCount: 0,
            },
            recoveryTrajectory: null,
            regret: null,
            utility: {
                utilityScore: 4,
                clarityScore: 5,
                coachingHelpfulness: 'helpful',
                feedbackNote: null,
            },
            createdAt: '2026-08-26T07:31:00Z',
            updatedAt: '2026-08-26T07:32:00Z',
        };

        it('validates referential/date consistency across the closed-loop record', () => {
            const parsed = parseClosedLoopFeedbackRecord(baseRecord);
            expect(parsed.recommendationRef.revision).toBe(2);
            expect(parsed.utility?.clarityScore).toBe(5);
        });

        it('rejects mismatched recommendation revisions and reversed timestamps', () => {
            expect(() => parseClosedLoopFeedbackRecord({
                ...baseRecord,
                decision: {
                    ...baseRecord.decision,
                    recommendationRef: { recommendationId: 'rec-123', revision: 1 },
                },
            })).toThrow('recommendationRef mismatch');
            expect(() => parseClosedLoopFeedbackRecord({
                ...baseRecord,
                updatedAt: '2026-08-26T07:30:00Z',
            })).toThrow('updatedAt precedes createdAt');
        });
    });
});
