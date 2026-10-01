import { describe, expect, it } from 'vitest';
import type { DraftTrialRow } from './assessmentDraftStorage';
import { draftRowsToTrials, hasDeviceWithoutProvider } from './assessmentDraftTrials';

describe('assessmentDraftTrials', () => {
    it('passes import sourceRef and context through to trial records', () => {
        const rows: DraftTrialRow[] = [{
            ordinal: 1,
            values: { load_kg: 150, successful: true, mean_concentric_velocity_mps: 0.567 },
            validity: 'valid',
            device: { provider: 'WL Analysis' },
            sourceRef: `wl-analysis-csv:sha256:${'a'.repeat(64)}`,
            context: { wl_parser_version: 'wl-analysis-csv-v1', wl_rep_count: 5 },
        }];
        const [trial] = draftRowsToTrials(rows, 'att-1', { equipment_setup_id: 'rack-a' }, { provider: '' }, '2026-10-01T00:00:00.000Z');
        expect(trial.sourceRef).toBe(`wl-analysis-csv:sha256:${'a'.repeat(64)}`);
        expect(trial.context).toEqual({
            equipment_setup_id: 'rack-a',
            wl_parser_version: 'wl-analysis-csv-v1',
            wl_rep_count: 5,
        });
        expect(trial.device).toEqual({ provider: 'WL Analysis' });
    });

    it('omits provenance keys for hand-typed rows, matching older drafts', () => {
        const rows: DraftTrialRow[] = [{ ordinal: 1, values: { distance_cm: 231 }, validity: 'valid' }];
        const [trial] = draftRowsToTrials(rows, 'att-1', {}, { provider: 'Tape' }, '2026-10-01T00:00:00.000Z');
        expect(trial.sourceRef).toBeUndefined();
        expect(trial.context).toEqual({});
        expect(trial.device).toEqual({ provider: 'Tape' });
    });

    it('rejects imported context that would override locked comparison context', () => {
        const rows: DraftTrialRow[] = [{
            ordinal: 1,
            values: { load_kg: 150, successful: true },
            validity: 'valid',
            context: { equipment_setup_id: 'tampered-rack' },
        }];
        expect(() => draftRowsToTrials(
            rows,
            'att-1',
            { equipment_setup_id: 'locked-rack' },
            { provider: '' },
            '2026-10-01T00:00:00.000Z',
        )).toThrow(/conflicts with locked comparison context/i);
    });

    it('flags device overrides without a provider', () => {
        expect(hasDeviceWithoutProvider({ provider: '', model: 'X' })).toBe(true);
        expect(hasDeviceWithoutProvider({ provider: 'WL Analysis' })).toBe(false);
        expect(hasDeviceWithoutProvider(undefined)).toBe(false);
    });
});
