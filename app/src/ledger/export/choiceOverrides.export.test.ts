import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { fullInput, fullRecords } from './ledgerExportFixtures.testSupport.ts';
import type { ChoiceOverrideInput } from './inputs.ts';

const overridesWith = (choiceOverrides: ChoiceOverrideInput[] | undefined) => {
    const records = { ...fullRecords(), choiceOverrides };
    if (choiceOverrides === undefined) delete (records as { choiceOverrides?: unknown }).choiceOverrides;
    return buildLedgerExport(fullInput({ records })).coachingHistory.overrides;
};
const choiceRows = (overrides: ReturnType<typeof overridesWith>) => overrides.items.filter(item => item.id.startsWith('choice:'));

describe('choice overrides in the ledger export (Phase 3B)', () => {
    it('keeps an unresolved choice as a row with explicit missingness', () => {
        const [row] = choiceRows(overridesWith([{ id: 'e:c:x', date: '2026-11-19', executionState: 'completed', kind: null, kindState: 'unavailable' }]));
        expect(row.fields.kind).toMatchObject({ value: null, state: 'unavailable' });
        expect(row.fields.step.state).toBe('unavailable');
        expect(row.fields.replacement.state).toBe('unavailable');
        expect(row.fields.planId.state).toBe('not_applicable');
        expect(row.fields.reason.state).toBe('not_recorded');
    });

    it('marks an omission as having no replacement, and a swap without one as missing it', () => {
        const rows = choiceRows(overridesWith([
            { id: 'e:c1:0', date: '2026-11-19', executionState: 'completed', kind: 'omitted', step: 'Curl' },
            { id: 'e:c2:0', date: '2026-11-19', executionState: 'completed', kind: 'swapped', step: 'Back Squat', replacementState: 'invalid' },
        ]));
        expect(rows.map(row => [row.fields.kind.value, row.fields.replacement.state])).toEqual([['omitted', 'not_applicable'], ['swapped', 'invalid']]);
    });

    it('is unavailable, never a clean list, when the executions behind choices were not read', () => {
        const overrides = overridesWith(undefined);
        expect(overrides.state).toBe('unavailable');
        expect(choiceRows(overrides)).toEqual([]);
    });

    it('names both reads as the collection source and carries the run state', () => {
        const overrides = overridesWith([{ id: 'e:c1:0', date: '2026-11-19', executionState: 'abandoned', kind: 'omitted', step: 'Curl' }]);
        expect(overrides.source).toBe('external_plan_placements + performed_training_occurrences');
        expect(choiceRows(overrides)[0].fields.executionState.value).toBe('abandoned');
    });

    it('keeps choices to the export window', () => {
        const rows = choiceRows(overridesWith([
            { id: 'e:old:0', date: '2026-10-01', executionState: 'completed', kind: 'omitted', step: 'Curl' },
            { id: 'e:now:0', date: '2026-11-19', executionState: 'completed', kind: 'omitted', step: 'Curl' },
        ]));
        expect(rows.map(row => row.id)).toEqual(['choice:e:now:0']);
    });
});
