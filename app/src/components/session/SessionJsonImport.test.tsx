import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionJsonImport } from './SessionJsonImport';

describe('SessionJsonImport', () => {
    it('renders the import interface with updated placeholder and help copy', () => {
        const html = renderToStaticMarkup(
            <SessionJsonImport
                userId="user-1"
                onClose={vi.fn()}
                onStartExecution={vi.fn()}
            />,
        );

        expect(html).toContain('Import session JSON');
        expect(html).toContain('Session definition or Workout Export JSON');
        expect(html).toContain('canonical_workout_v1');
        expect(html).toContain('Validate &amp; preview');
    });
});
