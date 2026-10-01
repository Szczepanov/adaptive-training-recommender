import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssessmentHistory } from './AssessmentHistory';
import { AssessmentAttemptDetail } from './AssessmentAttemptDetail';
import type { AssessmentAttempt } from '../../observations/models';

describe('AssessmentHistory', () => {
    it('renders initial loading state with accessible message', () => {
        const html = renderToStaticMarkup(<AssessmentHistory userId="user-1" />);
        expect(html).toContain('Loading assessment history across all tests…');
    });
});

describe('AssessmentAttemptDetail', () => {
    const attempt: AssessmentAttempt = {
        id: 'att-detail-1',
        protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
        scheduledDate: '2026-10-20',
        state: 'completed',
        purpose: 'baseline',
    };

    it('renders dialog shell with title and close button in initial loading state', () => {
        const html = renderToStaticMarkup(
            <AssessmentAttemptDetail
                userId="user-1"
                attempt={attempt}
                onClose={() => {}}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('Assessment attempt detail');
        expect(html).toContain('field-standing-broad-jump');
        expect(html).toContain('rev 1');
        expect(html).toContain('Close');
        expect(html).toContain('Loading attempt details');
    });
});
