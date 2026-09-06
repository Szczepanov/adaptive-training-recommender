import { describe, expect, it } from 'vitest';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';
import type { SessionDefinition } from '../sessions/models';
import type { ResolvedAvailability } from './schedule';
import type { DailyLedgerResult } from './dailyLedger';
import {
    reassessDependentBundleMember,
    type DependentBundleMemberTarget,
    type PredecessorEvidence,
    type ReassessmentInputRevision,
} from './intradayReassessment';

function createMockDefinition(overrides: Partial<SessionDefinition> = {}): SessionDefinition {
    return {
        schemaVersion: 1,
        id: 'session-pm-1',
        revision: 1,
        title: 'Strength Maintenance',
        intent: 'training',
        dominantModality: 'Strength',
        duration: { min: 45, max: 45 },
        blocks: [
            {
                id: 'b1',
                role: 'main',
                executionMode: 'sequential',
                steps: [
                    {
                        id: 's1',
                        kind: 'exercise',
                        dose: { kind: 'repetition', sets: 4, reps: 10 },
                    },
                ],
            },
        ],
        ...overrides,
    };
}

function createMockReadiness(overrides?: {
    subjective?: Partial<SubjectiveInput>;
    objective?: Partial<EngineObjectiveInput>;
}): DailyReadiness {
    return {
        subjective: {
            readiness: 8,
            sleepQuality: 8,
            fatigue: 3,
            soreness: 2,
            stress: 2,
            motivation: 8,
            timeAvailable: 60,
            painFlag: false,
            preferredModalityToday: null,
            alreadyTrainedToday: true, // Crucial: predecessor was performed today!
            ...overrides?.subjective,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 82,
            sleep_duration_min: 450,
            rhr: 50,
            rhr_7d_avg: 50,
            rhr_delta: 0,
            hrv_weekly_avg: 65,
            hrv_last_night: 65,
            hrv_delta: 0,
            respiration: 14,
            body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0,
            yesterday_training: null,
            today_training: { type: 'running', duration_min: 60, training_effect: 3.0, intensity_tag: 'aerobic' },
            sleep_score_delta_7d: 0,
            rhr_delta_28d: 0,
            hrv_delta_28d: 0,
            sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8.5,
            rhr_stdev_28d: 3.5,
            sleep_score_stdev_28d: 7.8,
            ...overrides?.objective,
        },
    };
}

function createMockContext(): UserContext {
    return {
        goals: { shortTerm: 'general_fitness', midTerm: 'strength', longTerm: 'endurance' },
        constraints: {
            hasCableMachine: true,
            hasFreeWeights: true,
            hasTreadmill: true,
            hasIndoorBike: true,
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Strength', 'Running'],
            conservativeBias: false,
        },
    };
}

function createMockAvailability(): ResolvedAvailability {
    return {
        date: '2026-09-06',
        maxTimeMinutes: 60,
        availableEquipment: ['barbell', 'dumbbell'],
        fixedActivities: [],
        reservedCapacityCost: 0,
        reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        environmentOverride: null,
    };
}

const mockInputRevision: ReassessmentInputRevision = {
    availabilityRevision: 'avail-rev-1',
    completedFactsRevision: 'facts-rev-1',
    checkinRevision: 'checkin-rev-1',
    ledgerRevision: 2,
    placementRevision: 'placement-rev-1',
    postPredecessorConfirmationRevision: 'resp-rev-1',
};

describe('reassessDependentBundleMember (ADR-0036 D-REASSESS)', () => {
    const target: DependentBundleMemberTarget = {
        sessionId: 'pm-strength',
        definition: createMockDefinition(),
        requestedWindow: { startLocal: '17:00', endLocal: '18:00' },
        afterSessionId: 'am-run',
        minimumSeparationMinutes: 180,
    };

    const healthyPredecessor: PredecessorEvidence = {
        sessionId: 'am-run',
        occurrenceId: 'occ-am-1',
        state: 'completed',
        completedAt: '2026-09-06T10:00:00.000Z',
        response: {
            userId: 'test-user',
            responseId: 'resp-1',
            sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-09-06' },
            occurrenceId: 'occ-am-1',
            window: 'immediate',
            date: '2026-09-06',
            checkinRef: { date: '2026-09-06' },
            sessionRpe: 5,
            completedFraction: 1.0,
            unexpectedFatigue: false,
            createdAt: '2026-09-06T10:05:00.000Z',
            updatedAt: '2026-09-06T10:05:00.000Z',
        },
        tissueResponses: [
            {
                region: 'quadriceps',
                morningState: 'normal',
                afterTrainingState: 'normal',
            },
        ],
    };

    const validLedger: DailyLedgerResult = {
        remainingMinutes: 45,
        remainingSystemicCost: 0.5,
        unresolvedEntries: [],
    };

    it('returns pending when predecessor occurrence is not yet completed', () => {
        const uncompletedPredecessor: PredecessorEvidence = {
            ...healthyPredecessor,
            state: 'active',
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: uncompletedPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('pending');
        expect(result.timingPrerequisiteMet).toBe(false);
        expect(result.predecessorConfirmed).toBe(false);
        expect(result.reason).toContain('has not completed');
    });

    it('returns pending when predecessor completed timestamp is missing', () => {
        const missingTimestampPredecessor: PredecessorEvidence = {
            ...healthyPredecessor,
            completedAt: null,
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: missingTimestampPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('pending');
        expect(result.timingPrerequisiteMet).toBe(false);
        expect(result.reason).toContain('completion timestamp is missing');
    });

    it('returns pending when required separation has not elapsed', () => {
        // Only 120 minutes elapsed since 10:00:00Z (target requires 180m)
        const evaluationInstant = '2026-09-06T12:00:00.000Z';

        const result = reassessDependentBundleMember({
            target,
            predecessor: healthyPredecessor,
            evaluationInstant,
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('pending');
        expect(result.timingPrerequisiteMet).toBe(false);
        expect(result.reason).toContain('Required separation of 180m has not elapsed (120m elapsed');
    });

    it('returns pending when explicit post-predecessor confirmation is missing', () => {
        const unconfirmedPredecessor: PredecessorEvidence = {
            ...healthyPredecessor,
            response: null,
            tissueResponses: [],
        };

        // 300 minutes elapsed (15:00Z vs 10:00Z)
        const evaluationInstant = '2026-09-06T15:00:00.000Z';

        const result = reassessDependentBundleMember({
            target,
            predecessor: unconfirmedPredecessor,
            evaluationInstant,
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('pending');
        expect(result.timingPrerequisiteMet).toBe(true);
        expect(result.predecessorConfirmed).toBe(false);
        expect(result.reason).toContain('Awaiting explicit post-predecessor symptom and response confirmation');
    });

    it('rejects PM session when predecessor reported severe tissue pain', () => {
        const sharpPredecessor: PredecessorEvidence = {
            ...healthyPredecessor,
            tissueResponses: [
                {
                    region: 'hamstring',
                    morningState: 'normal',
                    afterTrainingState: 'severe',
                },
            ],
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: sharpPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('reject');
        expect(result.predecessorConfirmed).toBe(true);
        expect(result.reason).toContain("reported severe/adverse tissue response in region 'hamstring'");
    });

    it('scales PM session when predecessor reported unexpected fatigue', () => {
        const fatiguedPredecessor: PredecessorEvidence = {
            ...healthyPredecessor,
            response: {
                ...healthyPredecessor.response!,
                unexpectedFatigue: true,
            },
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: fatiguedPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('scale');
        expect(result.predecessorConfirmed).toBe(true);
        expect(result.reason).toContain('unexpected fatigue');
        expect(result.scaledDefinition).toBeDefined();
        // Repetition sets scaled down by 0.7 (4 sets * 0.7 = 3 sets)
        const scaledSets = result.scaledDefinition?.blocks[0].steps[0].dose;
        if (scaledSets?.kind === 'repetition') {
            expect(scaledSets.sets).toBe(3);
        }
    });

    it('proceeds despite alreadyTrainedToday being true on morning inputs (bypassing alreadyTrainedOverride)', () => {
        const readinessWithSameDayTraining = createMockReadiness({
            subjective: { alreadyTrainedToday: true },
            objective: { today_training: { type: 'running', duration_min: 60, training_effect: 3.0, intensity_tag: 'aerobic' } },
        });

        const result = reassessDependentBundleMember({
            target,
            predecessor: healthyPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: readinessWithSameDayTraining,
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        // Crucial test: should proceed rather than being tripped into recover mode!
        expect(result.decision).toBe('proceed');
        expect(result.timingPrerequisiteMet).toBe(true);
        expect(result.predecessorConfirmed).toBe(true);
    });

    it('rejects PM session when daily ledger minute capacity is exhausted', () => {
        const exhaustedLedger: DailyLedgerResult = {
            remainingMinutes: 20, // Candidate requires 45m
            remainingSystemicCost: 0.5,
            unresolvedEntries: [],
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: healthyPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: exhaustedLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('reject');
        expect(result.reason).toContain('capacity exhausted');
    });

    it('rejects PM session when daily ledger systemic-cost capacity is exhausted', () => {
        const exhaustedLedger: DailyLedgerResult = {
            remainingMinutes: 60,
            remainingSystemicCost: 0.1, // Candidate (45m strength) requires > 0.3 cost
            unresolvedEntries: [],
        };

        const result = reassessDependentBundleMember({
            target,
            predecessor: healthyPredecessor,
            evaluationInstant: '2026-09-06T15:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: exhaustedLedger,
            acceptedSameDaySystemicCost: 0.2,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('reject');
        expect(result.reason).toContain('capacity exhausted');
    });

    it('evaluates independent session without predecessor requirements when afterSessionId is omitted', () => {
        const independentTarget: DependentBundleMemberTarget = {
            sessionId: 'pm-independent',
            definition: createMockDefinition(),
            requestedWindow: { startLocal: '17:00', endLocal: '18:00' },
        };

        const result = reassessDependentBundleMember({
            target: independentTarget,
            // predecessor omitted entirely
            evaluationInstant: '2026-09-06T17:00:00.000Z',
            readiness: createMockReadiness(),
            context: createMockContext(),
            date: '2026-09-06',
            availability: createMockAvailability(),
            candidateWindowMinutes: 60,
            dailyLedger: validLedger,
            acceptedSameDaySystemicCost: 0.1,
            inputRevision: mockInputRevision,
        });

        expect(result.decision).toBe('proceed');
        expect(result.timingPrerequisiteMet).toBe(true);
    });
});
