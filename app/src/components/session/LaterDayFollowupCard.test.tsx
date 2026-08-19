import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaterDayFollowupCard, type LaterDayFollowupTarget } from './LaterDayFollowupCard';

vi.mock('../../services/sessionResponseService', () => ({ sessionResponseService: { recordResponse: vi.fn() } }));

const target: LaterDayFollowupTarget = {
    sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-19' },
    date: '2026-08-19',
    title: 'today’s session',
};

describe('LaterDayFollowupCard (M5.2)', () => {
    it('renders the same-day prompt with answer and skip controls', () => {
        const html = renderToStaticMarkup(
            <LaterDayFollowupCard userId="u1" target={target} onAnswered={vi.fn()} onDismiss={vi.fn()} />,
        );
        expect(html).toContain('Feeling normal');
        expect(html).toContain('Unexpectedly fatigued');
        expect(html).toContain('Not now');
        expect(html).toContain('today’s session');
    });
});
