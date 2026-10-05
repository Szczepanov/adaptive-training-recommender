import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../sessions/models';
import { SessionEntryActions } from './SessionEntryActions';

function entry(payload: SessionEntry['payload']): SessionEntry {
    return { id: 'entry-1', executionId: 'exec-1', completedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-05T08:00:00Z', updatedAt: '2026-10-05T08:00:00Z', payload };
}

describe('SessionEntryActions', () => {
    it('offers append-only correction but no ordinary edit/remove for the effective choice', () => {
        const html = renderToStaticMarkup(<SessionEntryActions entry={entry({ kind: 'choice', choiceId: 'c1', optionId: 'o1' })} index={0} isEffectiveChoice onEdit={vi.fn()} onRemove={vi.fn()} onCorrectChoice={vi.fn()} />);
        expect(html).toContain('Correct choice');
        expect(html).not.toContain('Edit set');
        expect(html).not.toContain('Remove set');
    });

    it('offers no mutation action for superseded choice history', () => {
        const html = renderToStaticMarkup(<SessionEntryActions entry={entry({ kind: 'choice', choiceId: 'c1', optionId: 'o1' })} index={0} isEffectiveChoice={false} onEdit={vi.fn()} onRemove={vi.fn()} onCorrectChoice={vi.fn()} />);
        expect(html).not.toContain('<button');
    });

    it('keeps ordinary performed-entry actions', () => {
        const html = renderToStaticMarkup(<SessionEntryActions entry={entry({ kind: 'repetition', setIndex: 1, reps: 5 })} index={0} isEffectiveChoice={false} onEdit={vi.fn()} onRemove={vi.fn()} onCorrectChoice={vi.fn()} />);
        expect(html).toContain('Edit');
        expect(html).toContain('Remove set 1');
    });
});
