import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionRunner } from './SessionRunner';
import { formatSessionLoad } from '../../sessions/loadDisplay';

vi.mock('../../hooks/useSessionRunner', () => ({
    useSessionRunner: () => ({
        activeStep: null,
        activeBlock: null,
        activeBlockIndex: 0,
        activeStepIndex: 0,
        definition: null,
        entries: [],
        execution: null,
        isRestoring: false,
    }),
}));

vi.mock('../../hooks/useOverloadHistory', () => ({
    useOverloadHistory: () => ({ history: [], select: vi.fn() }),
}));

vi.mock('../../services/sessionDefinitionService', () => ({
    sessionDefinitionService: {
        getDefinitionRevision: vi.fn(),
        listDefinitionHeaders: vi.fn(),
    },
}));

describe('SessionRunner session picker', () => {
    it('offers a preview before starting every reviewed session', () => {
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).toContain('Start a Structured Session');
        expect(html).toContain('Preview');
        expect(html).toContain('Start Session →');
    });
});

describe('formatSessionLoad', () => {
    it('keeps an explicit ramp instruction visible without inferring kilograms', () => {
        expect(formatSessionLoad({ kind: 'descriptive', display: 'Empty bar, then light rehearsal load' })).toBe('Empty bar, then light rehearsal load');
        expect(formatSessionLoad({ kind: 'percent_one_rm', percent: 40 })).toBe('40% 1RM');
    });
});
