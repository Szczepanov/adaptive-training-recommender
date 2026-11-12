import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionJournalCard } from './DecisionJournalCard';

describe('DecisionJournalCard (#1167 P2-5 OQ6)', () => {
    it('renders nothing in ledger mode', () => {
        const html = renderToStaticMarkup(
            <DecisionJournalCard
                userId="u1"
                date="2026-11-12"
                engineVerdict="proceed"
                engineRevealed={false}
                onEntryChange={vi.fn()}
                planningAuthorityMode="ledger"
            />,
        );
        expect(html).toBe('');
    });
});
