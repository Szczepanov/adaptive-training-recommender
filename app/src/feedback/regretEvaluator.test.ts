import { describe, expect, it } from 'vitest';
import { evaluateCounterfactualRegret } from './regretEvaluator';
import type { RecoveryTrajectory } from './feedbackModels';

describe('regretEvaluator', () => {
    it('returns inconclusive when recovery trajectory is null', () => {
        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: false,
            athleteDeclaredRegret: null,
            recoveryTrajectory: null,
        });
        expect(result.regretClass).toBe('inconclusive');
    });

    it('keeps explicitly insufficient recovery telemetry inconclusive', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            hours48: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            hours72: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            autonomicReboundState: 'insufficient_data',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: 'none',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('inconclusive');
        expect(result.confidence).toBe('low');
    });

    it('fails closed when an expected trajectory has no complete outcome observation', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            hours48: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            hours72: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: null, readinessScore: null },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: 'none',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('inconclusive');
        expect(result.rationales.join(' ')).toContain('complete 24h or 48h');
    });

    it('flags overreaching only when a higher-than-recommended decision is followed by corroborated suppression', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: -18, rhrDeltaBpm: 4, sorenessScore: 3, readinessScore: 40 },
            hours48: { hrvDeltaPct: -22, rhrDeltaBpm: 5, sorenessScore: 4, readinessScore: 35 },
            hours72: { hrvDeltaPct: -5, rhrDeltaBpm: 1, sorenessScore: 2, readinessScore: 65 },
            autonomicReboundState: 'suppressed',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'rejected_train_harder',
            prescribedMode: 'scale',
            completedTraining: true,
            athleteDeclaredRegret: 'should_have_rested',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('overreaching_crash');
        expect(result.confidence).toBe('high');
        expect(result.counterfactualAlternative).toContain('candidate comparison');
    });

    it('does not call ordinary post-session suppression an overreaching crash when the athlete followed the recommendation', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: -18, rhrDeltaBpm: 4, sorenessScore: 3, readinessScore: 40 },
            hours48: { hrvDeltaPct: -22, rhrDeltaBpm: 5, sorenessScore: 3, readinessScore: 35 },
            hours72: { hrvDeltaPct: -5, rhrDeltaBpm: 1, sorenessScore: 2, readinessScore: 65 },
            autonomicReboundState: 'suppressed',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: null,
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('inconclusive');
        expect(result.confidence).toBe('low');
    });

    it('flags tissue exacerbation only when symptoms materially worsen from baseline', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 5, readinessScore: 50 },
            hours48: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 5, readinessScore: 45 },
            hours72: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 3, readinessScore: 60 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: null,
            recoveryTrajectory: trajectory,
            initialSoreness: 3,
        });

        expect(result.regretClass).toBe('injury_exacerbation');
        expect(result.confidence).toBe('medium');
        expect(result.rationales.join(' ')).toContain('does not establish');
    });

    it('does not attribute natural symptom worsening to training when rest was accepted', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 5, readinessScore: 50 },
            hours48: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 5, readinessScore: 45 },
            hours72: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 3, readinessScore: 60 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'rest',
            completedTraining: false,
            athleteDeclaredRegret: 'should_have_rested',
            recoveryTrajectory: trajectory,
            initialSoreness: 3,
        });

        expect(result.regretClass).toBe('inconclusive');
        expect(result.rationales.join(' ')).toContain('no completed training');
    });

    it('does not infer tissue exacerbation from unchanged high soreness', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 4, readinessScore: 55 },
            hours48: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 4, readinessScore: 60 },
            hours72: { hrvDeltaPct: 0, rhrDeltaBpm: 0, sorenessScore: 3, readinessScore: 70 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: null,
            recoveryTrajectory: trajectory,
            initialSoreness: 4,
        });

        expect(result.regretClass).toBe('optimal_choice');
    });

    it('requires athlete-declared regret plus 48h freshness before classifying unnecessary forfeiture', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: 5, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
            hours48: { hrvDeltaPct: 4, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
            hours72: { hrvDeltaPct: 3, rhrDeltaBpm: 0, sorenessScore: 1, readinessScore: 90 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'rejected_rest',
            prescribedMode: 'proceed',
            completedTraining: false,
            athleteDeclaredRegret: 'should_have_trained_harder',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('unnecessary_forfeiture');
        expect(result.rationales.join(' ')).toContain('does not prove');
    });

    it('does not infer sustained freshness from null recovery fields', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: 1, readinessScore: 90 },
            hours48: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: 1, readinessScore: 90 },
            hours72: { hrvDeltaPct: null, rhrDeltaBpm: null, sorenessScore: 1, readinessScore: 90 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'rejected_rest',
            prescribedMode: 'proceed',
            completedTraining: false,
            athleteDeclaredRegret: 'should_have_trained_harder',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('inconclusive');
    });

    it('keeps a rested-and-fresh observation inconclusive without athlete-declared regret', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: 5, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
            hours48: { hrvDeltaPct: 4, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
            hours72: { hrvDeltaPct: 3, rhrDeltaBpm: 0, sorenessScore: 1, readinessScore: 90 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'rejected_rest',
            prescribedMode: 'proceed',
            completedTraining: false,
            athleteDeclaredRegret: null,
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('inconclusive');
        expect(result.confidence).toBe('low');
    });

    it('classifies an uneventful accepted recommendation as adequate with bounded confidence', () => {
        const trajectory: RecoveryTrajectory = {
            date: '2026-08-26',
            hours24: { hrvDeltaPct: -5, rhrDeltaBpm: 1, sorenessScore: 2, readinessScore: 75 },
            hours48: { hrvDeltaPct: 2, rhrDeltaBpm: 0, sorenessScore: 1, readinessScore: 85 },
            hours72: { hrvDeltaPct: 4, rhrDeltaBpm: -1, sorenessScore: 1, readinessScore: 90 },
            autonomicReboundState: 'expected',
        };

        const result = evaluateCounterfactualRegret({
            date: '2026-08-26',
            action: 'accepted',
            prescribedMode: 'proceed',
            completedTraining: true,
            athleteDeclaredRegret: 'none',
            recoveryTrajectory: trajectory,
        });

        expect(result.regretClass).toBe('optimal_choice');
        expect(result.confidence).toBe('medium');
        expect(result.rationales.join(' ')).toContain('does not prove');
    });
});
