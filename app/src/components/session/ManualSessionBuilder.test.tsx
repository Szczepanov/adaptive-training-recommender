import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ManualSessionBuilder } from './ManualSessionBuilder';

vi.mock('../../services/sessionDefinitionService', () => ({ sessionDefinitionService: { saveDefinitionRevision: vi.fn() } }));
vi.mock('../../services/sessionAuthoringService', () => ({ prepareUnplannedSessionLaunch: vi.fn() }));
vi.mock('../../services/sessionOccurrenceService', () => ({
    sessionOccurrenceService: {
        scheduleOccurrence: vi.fn(), replaceRecommendationOccurrence: vi.fn(), addAdditionalSessionOccurrence: vi.fn(),
    },
}));

/**
 * M3.8 bounded hardening: the builder gained load, effort (RIR), alternative and authored
 * choice editing so the M0.2 fixtures' shapes are reachable without JSON. This repo has no
 * interactive component-test harness (no @testing-library/react) -- these are markup-level
 * smoke tests, matching the existing convention for sibling session components
 * (SessionJsonImport.test.tsx, SessionDestinationSheet.test.tsx). The underlying reducer
 * logic (choice/option/action/alternative defaults) is covered directly in
 * sessions/sessionDraft.test.ts.
 */
describe('ManualSessionBuilder (M3.8 bounded hardening)', () => {
    it('renders the load, effort and authored-choice controls the fixtures need', () => {
        const html = renderToStaticMarkup(
            <ManualSessionBuilder userId="u1" onClose={vi.fn()} onStartExecution={vi.fn()} />,
        );

        // Load kinds needed by fixtures 01/02 (percent_one_rm, descriptive, ...).
        expect(html).toContain('% of 1RM');
        expect(html).toContain('Descriptive (last reviewed load)');
        expect(html).toContain('Bodyweight');

        // Effort now offers RIR alongside RPE (fixture 01 uses RIR for both strength steps).
        expect(html).toContain('>RPE<');
        expect(html).toContain('>RIR<');

        // Authored choices (D-MCHOICE) are buildable without JSON.
        expect(html).toContain('Authored choices');
        expect(html).toContain('Add choice');
        expect(html).toContain('Add alternative');
    });
});
