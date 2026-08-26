import { describe, expect, it } from 'vitest';
import {
    parseAthleteDecisionLog,
    parseCounterfactualRegret,
    parseDoseReconciliation,
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
    });

    describe('parseDoseReconciliation', () => {
        it('validates a complete dose reconciliation payload', () => {
            const payload = {
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
            const parsed = parseDoseReconciliation(payload);
            expect(parsed.plannedDurationMin).toBe(60);
            expect(parsed.actualDurationMin).toBe(45);
            expect(parsed.completedZoneDistribution?.z2Seconds).toBe(1500);
        });
    });

    describe('parseCounterfactualRegret', () => {
        it('validates a counterfactual regret assessment', () => {
            const payload = {
                date: '2026-08-26',
                regretClass: 'overreaching_crash',
                athleteDeclaredRegret: 'should_have_rested',
                confidence: 'high',
                rationales: [
                    'Trained at threshold despite 2-day autonomic suppression',
                    'Next 48h HRV suppressed by -2.5 sigma',
                ],
                counterfactualAlternative: 'Prescribing an active recovery spin would have preserved 72h adaptation.',
            };
            const parsed = parseCounterfactualRegret(payload);
            expect(parsed.regretClass).toBe('overreaching_crash');
            expect(parsed.confidence).toBe('high');
        });
    });
});
