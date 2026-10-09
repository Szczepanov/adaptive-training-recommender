import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAllAssessmentDrafts,
    clearAssessmentDraft,
    loadAssessmentDraft,
    loadAssessmentDraftSetup,
    saveAssessmentDraftSetup,
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
        saveAssessmentDraft('user-1', 'att-1', [row]);
        expect(loadAssessmentDraft('user-1', 'att-1')).toEqual([row]);
        clearAssessmentDraft('user-1', 'att-1');
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
    });

    it('preserves locked comparison setup and device alongside row updates, scoped to the attempt', () => {
        const setup = { contextValues: { test_load_kg: '60', measurement_method_id: 'wl-analysis-csv-v2', equipment_setup_id: 'bench-a' }, defaultDevice: { provider: 'WL Analysis' } };
        saveAssessmentDraftSetup('user-1', 'att-1', setup);
        saveAssessmentDraft('user-1', 'att-1', [row]);
        expect(loadAssessmentDraftSetup('user-1', 'att-1')).toEqual(setup);
        expect(loadAssessmentDraft('user-1', 'att-1')).toEqual([row]);
        saveAssessmentDraftSetup('user-1', 'att-1', { ...setup, defaultDevice: { provider: 'manual' } });
        expect(loadAssessmentDraft('user-1', 'att-1')).toEqual([row]);
        expect(loadAssessmentDraftSetup('other-user', 'att-1')).toBeNull();
        clearAssessmentDraft('user-1', 'att-1');
        expect(loadAssessmentDraftSetup('user-1', 'att-1')).toBeNull();
    });

    it('isolates drafts by Firebase uid even when attempt ids match', () => {
        const otherRow: DraftTrialRow = { ordinal: 1, values: { distance_cm: 245 }, validity: 'valid' };
        saveAssessmentDraft('user-a', 'shared-attempt', [row]);
        saveAssessmentDraft('user-b', 'shared-attempt', [otherRow]);

        expect(loadAssessmentDraft('user-a', 'shared-attempt')).toEqual([row]);
        expect(loadAssessmentDraft('user-b', 'shared-attempt')).toEqual([otherRow]);

        clearAssessmentDraft('user-a', 'shared-attempt');
        expect(loadAssessmentDraft('user-a', 'shared-attempt')).toBeNull();
        expect(loadAssessmentDraft('user-b', 'shared-attempt')).toEqual([otherRow]);
    });

    it('ignores a malformed draft instead of rendering it', () => {
        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([{ ordinal: 'x' }]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
        localStorage.setItem('assessment_draft_user-1::att-1', '{not json');
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
    });

    it('rejects unsupported validity, non-scalar values and malformed devices', () => {        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: 231 }, validity: 'invented' },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: { nested: true } }, validity: 'valid' },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: 231 }, validity: 'valid', device: [] },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ordinal: 1, values: { distance_cm: 231 }, validity: 'valid', device: { model: 'WL Analysis' } },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
    });

    it('clears every assessment draft on sign-out and leaves other keys alone', () => {
        saveAssessmentDraft('user-1', 'att-1', [row]);
        saveAssessmentDraft('user-1', 'att-2', [row]);
        localStorage.setItem('unrelated', 'keep');
        clearAllAssessmentDrafts();
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
        expect(loadAssessmentDraft('user-1', 'att-2')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBe('keep');
    });

    it('round-trips import provenance and stays backward-compatible with older drafts', () => {
        const imported: DraftTrialRow = {
            ordinal: 2,
            values: { load_kg: 150, successful: true, mean_concentric_velocity_mps: 0.567 },
            validity: 'valid',
            device: { provider: 'WL Analysis' },
            sourceRef: `wl-analysis-csv:sha256:${'a'.repeat(64)}`,
            context: { wl_parser_version: 'wl-analysis-csv-v1', wl_rep_count: 1 },
            importReview: {
                loadKgConfirmed: false,
                successConfirmed: false,
                validityConfirmed: false,
            },
        };
        saveAssessmentDraft('user-1', 'att-1', [imported]);
        expect(loadAssessmentDraft('user-1', 'att-1')).toEqual([imported]);

        // Drafts saved before the importer existed carry neither field and still load.
        localStorage.setItem('assessment_draft_user-1::att-old', JSON.stringify([row]));
        expect(loadAssessmentDraft('user-1', 'att-old')).toEqual([row]);
    });

    it('rejects malformed import provenance instead of rendering it', () => {
        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ...row, sourceRef: '' },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ...row, context: { wl_rep_count: { nested: true } } },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ...row, context: { '': 1 } },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();

        localStorage.setItem('assessment_draft_user-1::att-1', JSON.stringify([
            { ...row, importReview: { loadKgConfirmed: false, successConfirmed: 'yes', validityConfirmed: false } },
        ]));
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
    });

    it('degrades to no draft when storage throws', () => {        const blocked = () => { throw new Error('blocked'); };
        vi.stubGlobal('localStorage', {
            get length(): number { return blocked(); },
            key: blocked,
            getItem: blocked,
            setItem: blocked,
            removeItem: blocked,
        });
        expect(() => saveAssessmentDraft('user-1', 'att-1', [row])).not.toThrow();
        expect(loadAssessmentDraft('user-1', 'att-1')).toBeNull();
        expect(() => clearAllAssessmentDrafts()).not.toThrow();
    });
});
