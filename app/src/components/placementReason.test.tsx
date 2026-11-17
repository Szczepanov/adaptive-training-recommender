import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { placementReasonFrom, withPlacementReason } from './placementReason';
import { PlacementReasonPicker } from './PlacementReasonPicker';

describe('placementReasonFrom', () => {
    it('is null when nothing was chosen, so a blank answer is distinct from a legacy write', () => {
        expect(placementReasonFrom('', '')).toBeNull();
        expect(placementReasonFrom('', '   ')).toBeNull();
    });

    it('keeps the code, trims the note, and files a bare note under other', () => {
        expect(placementReasonFrom('fatigue', '')).toEqual({ code: 'fatigue' });
        expect(placementReasonFrom('travel', '  Away  ')).toEqual({ code: 'travel', note: 'Away' });
        expect(placementReasonFrom('', 'Kids were sick')).toEqual({ code: 'other', note: 'Kids were sick' });
        expect(placementReasonFrom('time', 'x'.repeat(250))?.note).toHaveLength(200);
    });
});

describe('withPlacementReason', () => {
    it('stamps only the moved or dropped session and leaves the others as they were', () => {
        const result = withPlacementReason([
            { sessionId: 's1', date: '2026-11-18', status: 'dropped' },
            { sessionId: 's2', date: '2026-11-19', status: 'moved', reason: { code: 'time' } },
            { sessionId: 's3', date: '2026-11-20', status: 'planned' },
        ], 's1', { code: 'pain' });
        expect(result).toEqual([
            { sessionId: 's1', date: '2026-11-18', status: 'dropped', reason: { code: 'pain' } },
            { sessionId: 's2', date: '2026-11-19', status: 'moved', reason: { code: 'time' } },
            { sessionId: 's3', date: '2026-11-20', status: 'planned' },
        ]);
        expect(withPlacementReason([{ sessionId: 's3', date: '2026-11-20', status: 'planned' }], 's3', null))
            .toEqual([{ sessionId: 's3', date: '2026-11-20', status: 'planned' }]);
    });
});

describe('withPlacementReason movedFrom', () => {
    it('records the date moved from on a move only', () => {
        expect(withPlacementReason([{ sessionId: 's1', date: '2026-11-19', status: 'moved' }], 's1', null, '2026-11-17'))
            .toEqual([{ sessionId: 's1', date: '2026-11-19', status: 'moved', reason: null, movedFrom: '2026-11-17' }]);
        expect(withPlacementReason([{ sessionId: 's1', date: '2026-11-17', status: 'dropped' }], 's1', null, '2026-11-17'))
            .toEqual([{ sessionId: 's1', date: '2026-11-17', status: 'dropped', reason: null }]);
    });
});

describe('PlacementReasonPicker', () => {
    it('offers the fixed list with a blank default and a bounded note, both labelled', () => {
        const html = renderToStaticMarkup(<PlacementReasonPicker code="" note="" onCodeChange={() => {}} onNoteChange={() => {}} />);
        expect(html).toContain('Reason (optional)');
        expect(html).toContain('Note (optional)');
        expect(html).toContain('<option value="" selected="">No reason given</option>');
        for (const label of ['Time', 'Fatigue', 'Pain', 'Equipment', 'Travel', 'Other']) expect(html).toContain(`>${label}</option>`);
        expect(html).toContain('maxLength="200"');
    });
});
