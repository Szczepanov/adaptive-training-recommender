import { describe, expect, it } from 'vitest';
import {
    classifyDEvalSessionOutcome,
    classifyPlacementOutcome,
    DEVAL_SESSION_OUTCOMES,
    type DEvalPlannedSessionInput,
    type PlacementOutcomeInput,
} from './placementOutcome';

const base: PlacementOutcomeInput = {
    assignedDate: '2026-11-15',
    asOfDate: '2026-11-17',
    status: 'planned',
    evidenceComplete: true,
    linked: false,
    unverifiedEvidence: false,
    executions: [],
};
const classify = (over: Partial<PlacementOutcomeInput>) => classifyPlacementOutcome({ ...base, ...over });

describe('classifyPlacementOutcome', () => {
    it('never classifies today or a later date', () => {
        expect(classify({ assignedDate: '2026-11-17' })).toBeNull();
        expect(classify({ assignedDate: '2026-11-20', linked: true })).toBeNull();
    });

    it('a valid link is performed, even over incomplete reads or a later drop', () => {
        expect(classify({ linked: true })).toBe('performed');
        expect(classify({ linked: true, evidenceComplete: false })).toBe('performed');
        expect(classify({ linked: true, status: 'dropped' })).toBe('performed');
    });

    it('incomplete reads, a removed placement or unverifiable evidence are unknown, never missed', () => {
        expect(classify({ evidenceComplete: false })).toBe('unknown');
        expect(classify({ status: null })).toBe('unknown');
        expect(classify({ unverifiedEvidence: true })).toBe('unknown');
        expect(classify({ evidenceComplete: false, status: 'dropped' })).toBe('unknown');
    });

    it('a completed placement or completed execution without a link is done_unlinked', () => {
        expect(classify({ status: 'completed' })).toBe('done_unlinked');
        expect(classify({ executions: [{ state: 'completed' }] })).toBe('done_unlinked');
        expect(classify({ status: 'dropped', executions: [{ state: 'abandoned' }, { state: 'completed' }] })).toBe('done_unlinked');
    });

    it('a started or abandoned execution is started_not_completed, and outranks a drop', () => {
        expect(classify({ executions: [{ state: 'abandoned' }] })).toBe('started_not_completed');
        expect(classify({ executions: [{ state: 'in_progress' }] })).toBe('started_not_completed');
        expect(classify({ status: 'dropped', executions: [{ state: 'abandoned' }] })).toBe('started_not_completed');
    });

    it('a dropped or superseded placement keeps that status', () => {
        expect(classify({ status: 'dropped' })).toBe('dropped');
        expect(classify({ status: 'superseded' })).toBe('superseded');
    });

    it('only a complete read with no evidence of the session is missed; a moved session counts on its as-of date', () => {
        expect(classify({})).toBe('missed');
        expect(classify({ status: 'moved', assignedDate: '2026-11-16' })).toBe('missed');
        expect(classify({ status: 'moved', assignedDate: '2026-11-18' })).toBeNull();
    });
});

const dEvalBase: DEvalPlannedSessionInput = {
    assignedDate: '2026-11-10',
    asOfDate: '2026-11-28',
    blockStartDate: '2026-11-01',
    blockEndDate: '2026-11-28',
    status: 'planned',
    evidenceComplete: true,
    linked: false,
    unverifiedEvidence: false,
    executions: [],
    performedDate: null,
    linkedExecution: null,
    responseCompletedFraction: null,
    activeFlagOnAssignedDate: false,
    redFlagOnAssignedDate: false,
};

const classifyDEval = (over: Partial<DEvalPlannedSessionInput>) =>
    classifyDEvalSessionOutcome({ ...dEvalBase, ...over });

describe('classifyDEvalSessionOutcome (ADR-0052 D-EVAL §2)', () => {
    it('exports the closed 7-outcome D-EVAL vocabulary', () => {
        expect(DEVAL_SESSION_OUTCOMES).toEqual([
            'unknown',
            'reduced',
            'partial',
            'moved',
            'completed',
            'flag_skip',
            'missed',
        ]);
    });

    it('resolves incomplete, removed, or unverified evidence to unknown even when linked', () => {
        expect(classifyDEval({
            linked: true,
            evidenceComplete: false,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            status: null,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            unverifiedEvidence: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('unknown');
    });

    it('never infers full completion from linkage or execution state alone', () => {
        expect(classifyDEval({ linked: true, performedDate: '2026-11-10' })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', executedDefinition: 'authored', completedFraction: null },
            responseCompletedFraction: null,
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: null,
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('unknown');
    });

    it('resolves invalid or conflicting completion evidence to unknown', () => {
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 1 },
            responseCompletedFraction: 0.75,
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 0.9999999 },
            responseCompletedFraction: 1,
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 0.4 },
            responseCompletedFraction: 0.6,
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'abandoned', completedFraction: 1 },
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 1.2 },
        })).toBe('unknown');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            responseCompletedFraction: Number.NaN,
        })).toBe('unknown');
    });

    it('treats reduced linked performance as reduced across completion states, unless evidence conflicts or is unlinked', () => {
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 1 },
        })).toBe('reduced');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 0.5 },
        })).toBe('reduced');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'abandoned', executedDefinition: 'reduced' },
        })).toBe('reduced');
        expect(classifyDEval({
            linked: true,
            linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: null },
        })).toBe('reduced');
        // Conflicting completion reports still resolve to unknown.
        expect(classifyDEval({
            linked: true,
            linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 1 },
            responseCompletedFraction: 0.5,
        })).toBe('unknown');
        // Launch selection alone (unlinked) is not performed training.
        expect(classifyDEval({
            linked: false,
            linkedExecution: { state: 'in_progress', executedDefinition: 'reduced' },
        })).toBe('unknown');
    });

    it('classifies partial from completedFraction < 1 or abandoned linked execution', () => {
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', executedDefinition: 'authored', completedFraction: 0.7 },
        })).toBe('partial');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed' },
            responseCompletedFraction: 0,
        })).toBe('partial');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'abandoned' },
        })).toBe('partial');
        // Small floating tolerance within 1e-6 agrees.
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-10',
            linkedExecution: { state: 'completed', completedFraction: 0.5 },
            responseCompletedFraction: 0.5000001,
        })).toBe('partial');
    });

    it('classifies moved before completed when status is moved inside the block, and falls through to completed/missed outside it', () => {
        expect(classifyDEval({
            linked: true,
            status: 'moved',
            assignedDate: '2026-11-20',
            performedDate: '2026-11-20',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('moved');
        expect(classifyDEval({
            linked: true,
            status: 'moved',
            assignedDate: '2026-11-10',
            performedDate: '2026-11-28',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('moved');
        // Assigned on blockEndDate and performed +1 day outside the block: `moved` does not match,
        // so the next rule (`completed`, assigned date ±1) applies.
        expect(classifyDEval({
            linked: true,
            status: 'moved',
            assignedDate: '2026-11-28',
            performedDate: '2026-11-29',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('completed');
        // Outside the block and outside ±1 day -> missed.
        expect(classifyDEval({
            linked: true,
            status: 'moved',
            assignedDate: '2026-11-27',
            performedDate: '2026-11-30',
            linkedExecution: { state: 'completed', completedFraction: 1 },
        })).toBe('missed');
    });

    it('classifies completed within assignedDate ± 1 Warsaw day and missed outside that window', () => {
        for (const performedDate of ['2026-11-09', '2026-11-10', '2026-11-11']) {
            expect(classifyDEval({
                linked: true,
                performedDate,
                responseCompletedFraction: 1,
            })).toBe('completed');
        }
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-12',
            responseCompletedFraction: 1,
        })).toBe('missed');
        expect(classifyDEval({
            linked: true,
            performedDate: '2026-11-08',
            responseCompletedFraction: 1,
        })).toBe('missed');
    });

    it('distinguishes flag_skip, missed, and unknown on unlinked sessions', () => {
        expect(classifyDEval({ activeFlagOnAssignedDate: true, redFlagOnAssignedDate: false })).toBe('flag_skip');
        expect(classifyDEval({ activeFlagOnAssignedDate: false, redFlagOnAssignedDate: true })).toBe('flag_skip');
        expect(classifyDEval({ activeFlagOnAssignedDate: false, redFlagOnAssignedDate: false })).toBe('missed');
        expect(classifyDEval({ status: 'dropped', activeFlagOnAssignedDate: false, redFlagOnAssignedDate: false })).toBe('missed');
        // Unlinked completion signals or missing flag observability resolve to unknown.
        expect(classifyDEval({ status: 'completed' })).toBe('unknown');
        expect(classifyDEval({ executions: [{ state: 'completed' }] })).toBe('unknown');
        expect(classifyDEval({ activeFlagOnAssignedDate: null })).toBe('unknown');
        expect(classifyDEval({ redFlagOnAssignedDate: undefined })).toBe('unknown');
        // One confirmed flag is sufficient for flag_skip even when the other signal is unknown.
        expect(classifyDEval({ activeFlagOnAssignedDate: true, redFlagOnAssignedDate: null })).toBe('flag_skip');
        expect(classifyDEval({ activeFlagOnAssignedDate: undefined, redFlagOnAssignedDate: true })).toBe('flag_skip');
        expect(classifyDEval({ activeFlagOnAssignedDate: false, redFlagOnAssignedDate: null })).toBe('unknown');
    });
});
