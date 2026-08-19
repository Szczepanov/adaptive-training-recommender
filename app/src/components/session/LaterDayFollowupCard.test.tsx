import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaterDayFollowupCard } from './LaterDayFollowupCard';
import { recordLaterDayFollowup, type LaterDayFollowupTarget } from './laterDayFollowupAction';
import { sessionResponseService } from '../../services/sessionResponseService';

vi.mock('../../services/sessionResponseService', () => ({ sessionResponseService: { recordResponse: vi.fn() } }));

const target: LaterDayFollowupTarget = {
    sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-19' },
    occurrenceId: 'occ-1',
    date: '2026-08-19',
    title: 'today’s session',
};

describe('LaterDayFollowupCard (M5.2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the same-day prompt with answer and skip controls', () => {
        const html = renderToStaticMarkup(
            <LaterDayFollowupCard userId="u1" target={target} onAnswered={vi.fn()} onDismiss={vi.fn()} />,
        );
        expect(html).toContain('Feeling normal');
        expect(html).toContain('Unexpectedly fatigued');
        expect(html).toContain('Not now');
        expect(html).toContain('today’s session');
    });

    it('records a later_day response with target details when answered feeling normal', async () => {
        await recordLaterDayFollowup('u1', target, false);
        expect(sessionResponseService.recordResponse).toHaveBeenCalledWith(
            'u1',
            target.sourceSession,
            'later_day',
            '2026-08-19',
            '2026-08-19',
            { unexpectedFatigue: false },
            'occ-1',
        );
    });

    it('records a later_day response with unexpectedFatigue true when answered fatigued', async () => {
        await recordLaterDayFollowup('u1', target, true);
        expect(sessionResponseService.recordResponse).toHaveBeenCalledWith(
            'u1',
            target.sourceSession,
            'later_day',
            '2026-08-19',
            '2026-08-19',
            { unexpectedFatigue: true },
            'occ-1',
        );
    });

    it('does not write any response when dismissed via onDismiss', () => {
        const onDismiss = vi.fn();
        onDismiss();
        expect(onDismiss).toHaveBeenCalled();
        expect(sessionResponseService.recordResponse).not.toHaveBeenCalled();
    });
});
