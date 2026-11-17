import { describe, expect, it } from 'vitest';
import { classifyPlacementOutcome, type PlacementOutcomeInput } from './placementOutcome';

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
