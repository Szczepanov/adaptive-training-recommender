import { describe, expect, it } from 'vitest';
import {
    validateIntradayDecisionRecord,
    intradayDecisionReplayErrors,
    type IntradayDecisionRecord,
    type IntradayDecisionStatus,
    type IntradayDecisionVerdictOutcome,
} from './intradayDecision';
import { POLICY_VERSION } from './policy';
import { EXTERNAL_PLAN_SCHEMA_V4, type ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';
import type { ExternalTrainingPlan } from './models';

function sampleRecord(overrides: Partial<IntradayDecisionRecord> = {}): IntradayDecisionRecord {
    return {
        id: 'decision-1',
        userId: 'athlete-1',
        date: '2026-09-06',
        asOf: '2026-09-06T08:00:00.000Z',
        policyVersion: POLICY_VERSION,
        schemaVersion: 1,
        status: 'provisional',
        supersededDecisionId: null,
        occurrenceId: 'occ-1',
        sessionId: 'session-am',
        windowId: 'window-morning',
        bundleId: 'bundle-sunday',
        orderInBundle: 0,
        predecessorExecutionId: null,
        predecessorOccurrenceId: null,
        reassessmentInputRevision: {
            availabilityRevision: 'avail-rev-1',
            completedFactsRevision: 'facts-rev-1',
            checkinRevision: 'checkin-rev-1',
            ledgerRevision: 'ledger-rev-1',
            placementRevision: 'placement-rev-1',
        },
        bundlePlacement: {
            bundleId: 'bundle-sunday',
            outcome: 'placed',
            bindings: [
                {
                    sessionId: 'session-am',
                    windowId: 'window-morning',
                    boundStartLocal: '08:00',
                    boundEndLocal: '09:00',
                    startInstant: '2026-09-06T06:00:00.000Z',
                    endInstant: '2026-09-06T07:00:00.000Z',
                },
            ],
        },
        ledgerSnapshot: {
            ceilings: {
                dailyMinuteCeiling: 90,
                dailySystemicCostCeiling: 0.8,
            },
            entries: [],
        },
        verdict: {
            decision: 'proceed',
            reasons: ['Capacity fits morning window'],
        },
        ...overrides,
    };
}

function samplePlanV4(): ExternalTrainingPlanV4 {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'plan-1',
        revision: 1,
        title: 'Hybrid Plan',
        startDate: '2026-09-01',
        weekCount: 2,
        restDays: [],
        sessions: [
            {
                id: 'session-am',
                title: 'Morning Easy',
                priority: 'key',
                placement: { preferredDay: 'sunday', week: 1, flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'running', intensity: 'easy', durationMin: 30, durationMax: 60, environment: 'outdoor', equipment: [] },
                definition: {
                    schemaVersion: 1,
                    id: 'def-1',
                    revision: 1,
                    title: 'Morning Easy',
                    intent: 'training',
                    blocks: [],
                },
                intraday: {
                    bundleId: 'bundle-sunday',
                    order: 0,
                    window: { startLocal: '08:00', endLocal: '09:30' },
                },
            },
        ],
    };
}

describe('intradayDecision validation and replay', () => {
    it('validates a valid record and preserves its fields', () => {
        const record = sampleRecord();
        const validated = validateIntradayDecisionRecord(record);
        expect(validated).toEqual(record);
    });

    it('rejects malformed records and invalid dates', () => {
        expect(() => validateIntradayDecisionRecord(null)).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({ ...sampleRecord(), date: 'invalid-date' })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({ ...sampleRecord(), asOf: 'not-a-date' })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({ ...sampleRecord(), schemaVersion: 2 as unknown as 1 })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({ ...sampleRecord(), status: 'bogus' as unknown as IntradayDecisionStatus })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({ ...sampleRecord(), orderInBundle: -1 })).toThrow(RangeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            ledgerSnapshot: { ceilings: { dailyMinuteCeiling: -10, dailySystemicCostCeiling: 0.5 }, entries: [] },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            verdict: { decision: 'unknown' as unknown as IntradayDecisionVerdictOutcome, reasons: [] },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            bundlePlacement: { bundleId: 'b1', outcome: 'placed', bindings: [] },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            bundlePlacement: { bundleId: 'b1', outcome: 'placed', bindings: 'not-an-array' as unknown as [] },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            bundlePlacement: { bundleId: 'b1', outcome: 'placed', bindings: [{ sessionId: 's1' }] as unknown as [] },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            bundlePlacement: { bundleId: 'b1', outcome: 'infeasible' },
        })).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord({
            ...sampleRecord(),
            bundlePlacement: { bundleId: 'b1', outcome: 'infeasible', reason: '' },
        })).toThrow(TypeError);
    });

    it('accepts a non-null predecessor pair (a dependent bundle member)', () => {
        const record = sampleRecord({ predecessorExecutionId: 'exec-am-1', predecessorOccurrenceId: 'occ-am-1' });
        const validated = validateIntradayDecisionRecord(record);
        expect(validated.predecessorExecutionId).toBe('exec-am-1');
        expect(validated.predecessorOccurrenceId).toBe('occ-am-1');
    });

    it('rejects a record missing predecessorExecutionId/predecessorOccurrenceId entirely', () => {
        const record = sampleRecord() as unknown as Record<string, unknown>;
        delete record.predecessorExecutionId;
        delete record.predecessorOccurrenceId;
        expect(() => validateIntradayDecisionRecord(record)).toThrow(TypeError);
    });

    it('rejects a mismatched predecessor pair -- one null, one set', () => {
        expect(() => validateIntradayDecisionRecord(sampleRecord({
            predecessorExecutionId: 'exec-am-1', predecessorOccurrenceId: null,
        }))).toThrow(TypeError);
        expect(() => validateIntradayDecisionRecord(sampleRecord({
            predecessorExecutionId: null, predecessorOccurrenceId: 'occ-am-1',
        }))).toThrow(TypeError);
    });

    it('accepts an optional postPredecessorConfirmationRevision on reassessmentInputRevision', () => {
        const record = sampleRecord({
            reassessmentInputRevision: {
                availabilityRevision: 'avail-rev-1',
                completedFactsRevision: 'facts-rev-1',
                checkinRevision: 'checkin-rev-1',
                ledgerRevision: 'ledger-rev-1',
                placementRevision: 'placement-rev-1',
                postPredecessorConfirmationRevision: 'confirmation-rev-1',
            },
        });
        const validated = validateIntradayDecisionRecord(record);
        expect(validated.reassessmentInputRevision.postPredecessorConfirmationRevision).toBe('confirmation-rev-1');
    });

    it('validates an infeasible proposal with a non-empty reason', () => {
        const record = sampleRecord({
            bundlePlacement: {
                bundleId: 'bundle-sunday',
                outcome: 'infeasible',
                reason: 'No available schedule window satisfies the session duration',
            },
        });
        const validated = validateIntradayDecisionRecord(record);
        expect(validated.bundlePlacement.outcome).toBe('infeasible');
        expect(validated.bundlePlacement.reason).toBe('No available schedule window satisfies the session duration');
    });

    it('replays a clean record against matching external plan revision with 0 errors', () => {
        const record = sampleRecord();
        const plan = samplePlanV4();
        const errors = intradayDecisionReplayErrors(record, { plan: plan as unknown as ExternalTrainingPlan, contentHash: 'hash-1' });
        expect(errors).toEqual([]);
    });

    it('flags policy version mismatches during replay', () => {
        const record = sampleRecord({ policyVersion: 'historical-policy-v0' });
        const errors = intradayDecisionReplayErrors(record);
        expect(errors).toContain(`Policy version historical-policy-v0 does not match current build policy version ${POLICY_VERSION}`);
    });

    it('detects bundle placement mismatches during replay', () => {
        const record = sampleRecord({
            bundleId: 'bundle-1',
            bundlePlacement: {
                bundleId: 'bundle-2',
                outcome: 'placed',
                bindings: [],
            },
        });
        const errors = intradayDecisionReplayErrors(record);
        expect(errors.some(e => e.includes('Bundle identity mismatch'))).toBe(true);
        expect(errors.some(e => e.includes('contains no window bindings'))).toBe(true);

        // Defensively handles non-array truthy bindings without throwing TypeError
        const malformedRecord = sampleRecord({
            bundlePlacement: {
                bundleId: 'bundle-sunday',
                outcome: 'placed',
                bindings: 'invalid' as unknown as [],
            },
        });
        const malformedErrors = intradayDecisionReplayErrors(malformedRecord);
        expect(malformedErrors.some(e => e.includes('contains no window bindings'))).toBe(true);
    });

    it('detects external plan mismatch when session order or bundle disagrees', () => {
        const record = sampleRecord({ orderInBundle: 1 });
        const plan = samplePlanV4();
        const errors = intradayDecisionReplayErrors(record, { plan: plan as unknown as ExternalTrainingPlan, contentHash: 'hash-1' });
        expect(errors.some(e => e.includes('Session order mismatch'))).toBe(true);
    });

    it('detects missing session in external plan', () => {
        const record = sampleRecord({ sessionId: 'session-unknown' });
        const plan = samplePlanV4();
        const errors = intradayDecisionReplayErrors(record, { plan: plan as unknown as ExternalTrainingPlan, contentHash: 'hash-1' });
        expect(errors.some(e => e.includes('is not present in plan'))).toBe(true);
    });
});
