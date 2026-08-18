import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionDestinationSheet } from './SessionDestinationSheet';
import type { SessionDefinition } from '../../sessions/models';

vi.mock('../../services/sessionDefinitionService', () => ({ sessionDefinitionService: { saveDefinitionRevision: vi.fn() } }));
vi.mock('../../services/sessionAuthoringService', () => ({ prepareUnplannedSessionLaunch: vi.fn() }));
vi.mock('../../services/sessionOccurrenceService', () => ({
    sessionOccurrenceService: {
        scheduleOccurrence: vi.fn(), replaceRecommendationOccurrence: vi.fn(), addAdditionalSessionOccurrence: vi.fn(),
    },
}));

const definition: SessionDefinition = {
    schemaVersion: 1, id: 'def-1', revision: 1, title: 'Full Body Maintenance', intent: 'training',
    blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
};

describe('SessionDestinationSheet (M3.3)', () => {
    it('renders nothing when closed', () => {
        const html = renderToStaticMarkup(
            <SessionDestinationSheet userId="u1" definition={definition} isOpen={false} onClose={vi.fn()} onStartExecution={vi.fn()} />,
        );
        expect(html).toBe('');
    });

    it('renders all five destinations with their engine-effect copy when open', () => {
        const html = renderToStaticMarkup(
            <SessionDestinationSheet userId="u1" definition={definition} isOpen={true} onClose={vi.fn()} onStartExecution={vi.fn()} />,
        );
        expect(html).toContain('Full Body Maintenance');
        expect(html).toContain('Start now');
        expect(html).toContain('Schedule for a date');
        expect(html).toContain('Replace today');
        expect(html).toContain('Add to today');
        expect(html).toContain('Save to library');
        expect(html).not.toContain('Not yet available');
        expect(html.match(/disabled=""/g)).toBeNull();
    });

    it('defaults to Start now selected and does not show the schedule date', () => {
        const html = renderToStaticMarkup(
            <SessionDestinationSheet userId="u1" definition={definition} isOpen={true} onClose={vi.fn()} onStartExecution={vi.fn()} />,
        );
        expect(html).not.toContain('destination-schedule-date');
    });
});
