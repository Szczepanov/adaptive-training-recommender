import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAllAssessmentDrafts,
    clearAssessmentDraft,
    loadAssessmentDraft,
    saveAssessmentDraft,
    type DraftTrialRow,
} from './assessmentDraftStorage';

const row: DraftTrialRow = { ordinal: 1, values: { distance_cm: 231 }, validity: 'valid' };

function createStorageMock() {
    const storage = new Map<string, string>();
    return {
        get length() { return storage.size; },
        key: (index: number) => [...storage.keys()][index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => storage.clear(),
    };
}

describe('assessmentDraftStorage', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', createStorageMock());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips and clears one attempt draft', () => {
        saveAssessmentDraft('att-1', [row]);
        expect(loadAssessmentDraft('att-1')).toEqual([row]);
        clearAssessmentDraft('att-1');
        expect(loadAssessmentDraft('att-1')).toBeNull();
    });

    it('ignores a malformed draft instead of rendering it', () => {
        localStorage.setItem('assessment_draft_att-1', JSON.stringify([{ ordinal: 'x' }]));
        expect(loadAssessmentDraft('att-1')).toBeNull();
        localStorage.setItem('assessment_draft_att-1', '{not json');
        expect(loadAssessmentDraft('att-1')).toBeNull();
    });

    it('rejects unsupported validity, non-scalar values and malformed devices', () => {
        localStorage.setItem('assessment_draft_att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: 231 }, validity: 'invented' },
        ]));
        expect(loadAssessmentDraft('att-1')).toBeNull();

        localStorage.setItem('assessment_draft_att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: { nested: true } }, validity: 'valid' },
        ]));
        expect(loadAssessmentDraft('att-1')).toBeNull();

        localStorage.setItem('assessment_draft_att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: 231 }, validity: 'valid', device: [] },
        ]));
        expect(loadAssessmentDraft('att-1')).toBeNull();
    });

    it('clears every assessment draft on sign-out and leaves other keys alone', () => {
        saveAssessmentDraft('att-1', [row]);
        saveAssessmentDraft('att-2', [row]);
        localStorage.setItem('unrelated', 'keep');
        clearAllAssessmentDrafts();
        expect(loadAssessmentDraft('att-1')).toBeNull();
        expect(loadAssessmentDraft('att-2')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBe('keep');
    });

    it('degrades to no draft when storage throws', () => {
        const blocked = () => { throw new Error('blocked'); };
        vi.stubGlobal('localStorage', {
            get length(): number { return blocked(); },
            key: blocked,
            getItem: blocked,
            setItem: blocked,
            removeItem: blocked,
        });
        expect(() => saveAssessmentDraft('att-1', [row])).not.toThrow();
        expect(loadAssessmentDraft('att-1')).toBeNull();
        expect(() => clearAllAssessmentDrafts()).not.toThrow();
    });
});
