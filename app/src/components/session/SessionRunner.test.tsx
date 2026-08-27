import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionRunner } from './SessionRunner';

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
