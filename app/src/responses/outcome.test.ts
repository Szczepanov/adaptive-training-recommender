import { describe, expect, it } from 'vitest';
import { deriveSessionOutcome, SESSION_OUTCOME_POLICY_VERSION } from './outcome';
import type { SessionResponse, SessionResponseSourceRef } from './models';
import type { RegionTissueResponse } from '../engine/models';
import type { PerformedSessionComparison } from '../sessions/performedComparison';

const sourceSession: SessionResponseSourceRef = { kind: 'execution', id: 'exec-1', date: '2026-08-18' };

function response(overrides: Partial<SessionResponse> = {}): SessionResponse {
    return {
        userId: 'u1',
        responseId: 'resp-1',
        sourceSession,
        window: 'later_day',
        date: '2026-08-18',
        checkinRef: { date: '2026-08-18' },
        createdAt: '2026-08-18T20:00:00.000Z',
        updatedAt: '2026-08-18T20:00:00.000Z',
        ...overrides,
    };
}

function tissue(overrides: Partial<RegionTissueResponse> = {}): RegionTissueResponse {
    return {
        region: 'knee',
        morningState: 'normal',
        sourceSessionRef: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
        ...overrides,
    };
}

describe('deriveSessionOutcome', () => {
    it('returns unknown with no responses and no tissue observations', () => {
        const outcome = deriveSessionOutcome({ sourceSession, responses: [], tissueResponses: [] });
        expect(outcome.status).toBe('unknown');
        expect(outcome.hasFollowUpData).toBe(false);
        expect(outcome.sourceFacts.responseIds).toEqual([]);
        expect(outcome.sourceFacts.tissueRegions).toEqual([]);
        expect(outcome.policyVersion).toBe(SESSION_OUTCOME_POLICY_VERSION);
    });

    it('returns unknown when only an immediate-window response exists (no follow-up yet)', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response({ window: 'immediate', responseId: 'resp-imm' })],
            tissueResponses: [],
        });
        expect(outcome.status).toBe('unknown');
        expect(outcome.hasFollowUpData).toBe(false);
    });

    it('returns passed when a later_day response and normal tissue response both exist', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response({ unexpectedFatigue: false })],
            tissueResponses: [tissue({ morningState: 'normal', nextMorningReaction: 'normal' })],
        });
        expect(outcome.status).toBe('passed');
        expect(outcome.hasFollowUpData).toBe(true);
        expect(outcome.sourceFacts.tissueRegions).toEqual(['knee']);
    });

    it('returns passed from a later_day response alone, with no tissue observation', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response({ unexpectedFatigue: false, completedFraction: 1 })],
            tissueResponses: [],
        });
        expect(outcome.status).toBe('passed');
    });

    it('returns caution for a mild (monitor) tissue signal', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response()],
            tissueResponses: [tissue({ nextMorningReaction: 'mild' })],
        });
        expect(outcome.status).toBe('caution');
    });

    it('returns caution for unexpectedFatigue alone, with no tissue signal', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response({ unexpectedFatigue: true })],
            tissueResponses: [],
        });
        expect(outcome.status).toBe('caution');
    });

    it('returns reactive for a moderate tissue signal', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response()],
            tissueResponses: [tissue({ afterTrainingState: 'moderate' })],
        });
        expect(outcome.status).toBe('reactive');
    });

    it('returns reactive for a severe tissue signal, outranking a merely-mild one elsewhere', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response()],
            tissueResponses: [
                tissue({ region: 'knee', nextMorningReaction: 'mild' }),
                tissue({ region: 'hamstring', painDuringTraining: 'severe', sourceSessionRef: { kind: 'execution', id: 'exec-1', date: '2026-08-18' } }),
            ],
        });
        expect(outcome.status).toBe('reactive');
        expect(outcome.sourceFacts.tissueRegions).toEqual(['knee', 'hamstring']);
    });

    it('reactive tissue signal overrides an otherwise-passed unexpectedFatigue:false response', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response({ unexpectedFatigue: false })],
            tissueResponses: [tissue({ nextMorningReaction: 'severe' })],
        });
        expect(outcome.status).toBe('reactive');
    });

    it('never fabricates an override reason -- undefined unless explicitly supplied', () => {
        const outcome = deriveSessionOutcome({ sourceSession, responses: [response()], tissueResponses: [] });
        expect(outcome.override.reason).toBeUndefined();
    });

    it('carries a caller-supplied override reason through unchanged', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response()],
            tissueResponses: [],
            overrideReason: 'time_constraint',
        });
        expect(outcome.override.reason).toBe('time_constraint');
    });

    it('surfaces the most recently updated response note as override.note', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [
                response({ responseId: 'resp-a', window: 'later_day', note: 'felt heavy', updatedAt: '2026-08-18T20:00:00.000Z' }),
                response({ responseId: 'resp-b', window: 'next_morning', techniqueNote: 'knee stiff', updatedAt: '2026-08-19T07:00:00.000Z' }),
            ],
            tissueResponses: [],
        });
        expect(outcome.override.note).toBe('knee stiff');
    });

    it('links every contributing response id in sourceFacts', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [
                response({ responseId: 'resp-a', window: 'later_day' }),
                response({ responseId: 'resp-b', window: 'next_morning' }),
            ],
            tissueResponses: [],
        });
        expect(outcome.sourceFacts.responseIds).toEqual(['resp-a', 'resp-b']);
    });

    it('carries the planned/performed delta through from a supplied comparison, unmodified', () => {
        const comparison: PerformedSessionComparison = {
            definitionId: 'def-1',
            revision: 1,
            title: 'Lower',
            totalPlannedSteps: 5,
            completedStepsCount: 4,
            missingRequiredStepsCount: 1,
            stepComparisons: [],
            summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        };
        const outcome = deriveSessionOutcome({
            sourceSession, responses: [response()], tissueResponses: [], comparison,
        });
        expect(outcome.override.completedStepsCount).toBe(4);
        expect(outcome.override.missingRequiredStepsCount).toBe(1);
        expect(outcome.override.totalPlannedSteps).toBe(5);
    });

    it('omits delta fields entirely when no comparison is supplied', () => {
        const outcome = deriveSessionOutcome({ sourceSession, responses: [response()], tissueResponses: [] });
        expect(outcome.override.completedStepsCount).toBeUndefined();
        expect(outcome.override.missingRequiredStepsCount).toBeUndefined();
        expect(outcome.override.totalPlannedSteps).toBeUndefined();
    });

    it('ignores a tissue observation whose morningState-only normal reading contributes no severity', () => {
        const outcome = deriveSessionOutcome({
            sourceSession,
            responses: [response()],
            tissueResponses: [tissue({ morningState: 'normal' })],
        });
        expect(outcome.status).toBe('passed');
    });
});
