import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ManualSessionBuilder } from './ManualSessionBuilder';
import type { SessionDefinition } from '../../sessions/models';

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
        expect(html).toContain('Choices and actions');
        expect(html).toContain('Add choice');
        expect(html).toContain('Add alternative');
    });

    it('starts optional editing closed for a new movement and names its movement controls', () => {
        const html = renderToStaticMarkup(
            <ManualSessionBuilder userId="u1" onClose={vi.fn()} onStartExecution={vi.fn()} />,
        );

        expect(html).toMatch(/<details class="builder-advanced-fields"><summary>Advanced prescription<\/summary>/);
        expect(html).toMatch(/<details class="builder-choices"><summary>Choices and actions<\/summary>/);
        expect(html).toContain('aria-label="Move movement 1 up"');
        expect(html).toContain('aria-label="Remove movement 1"');
    });

    it('opens saved advanced prescription and authored choices with explicit remove names', () => {
        const definition: SessionDefinition = {
            schemaVersion: 1, id: 'saved', revision: 1, title: 'Saved session', intent: 'training',
            dominantModality: 'strength', duration: { min: 30, max: 30 },
            blocks: [{
                id: 'block', title: 'Main', role: 'main', executionMode: 'sequential',
                steps: [{
                    id: 'press', kind: 'exercise', title: 'Press',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Press' },
                    dose: { kind: 'repetition', sets: 3, reps: 8 },
                    notes: 'Keep shoulders comfortable',
                    alternatives: [{ id: 'floor', title: 'Floor press', exerciseRef: { kind: 'unresolved_free_text', name: 'Floor press' } }],
                }],
                optionSets: [{
                    id: 'choice', appliesAtStepId: 'press',
                    trigger: { kind: 'athlete_observed', description: 'How does it feel?' },
                    options: [{ id: 'option', label: 'Go lighter', actions: [{ kind: 'reduce_load_percent', targetStepId: 'press', percent: 20 }] }],
                }],
            }],
        };
        const html = renderToStaticMarkup(
            <ManualSessionBuilder userId="u1" onClose={vi.fn()} onStartExecution={vi.fn()} initialDefinition={definition} />,
        );

        expect(html).toMatch(/<details class="builder-advanced-fields" open=""><summary>Advanced prescription<\/summary>/);
        expect(html).toMatch(/<details class="builder-choices" open=""><summary>Choices and actions \(1\)<\/summary>/);
        expect(html).toContain('aria-label="Remove alternative Floor press from movement 1"');
        expect(html).toContain('aria-label="Remove choice for Press"');
        expect(html).toContain('aria-label="Remove option Go lighter"');
        expect(html).toContain('aria-label="Remove action 1 from option Go lighter"');
    });
});
