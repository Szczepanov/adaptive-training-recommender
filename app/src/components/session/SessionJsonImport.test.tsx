import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionJsonImport } from './SessionJsonImport';
import { SESSION_AI_PROMPT_TEMPLATE, unwrapSingleSessionFromPlanEnvelope } from './sessionJsonImportHelpers';

describe('SessionJsonImport', () => {
    it('renders the import interface with the AI prompt copy button and help copy', () => {
        const html = renderToStaticMarkup(
            <SessionJsonImport
                userId="user-1"
                onClose={vi.fn()}
                onStartExecution={vi.fn()}
            />,
        );

        expect(html).toContain('Import session JSON');
        expect(html).toContain('Session definition or Workout Export JSON');
        expect(html).toContain('Copy AI prompt to generate session JSON');
        expect(html).toContain('canonical_workout_v1');
        expect(html).toContain('Validate &amp; preview');
        expect(SESSION_AI_PROMPT_TEMPLATE).toContain('"schemaVersion": 1');
    });

    it('unwraps a single-session External Plan envelope into its inner SessionDefinition', () => {
        const innerDef = {
            schemaVersion: 1,
            id: 'def_reentry_01',
            revision: 1,
            title: 'Full-body Strength Re-entry',
            intent: 'rehab_return',
            blocks: [],
        };
        const planEnvelope = {
            schema: 'adaptive-training-recommender/external-plan@2',
            planId: 'advisor-reentry-2026-09-24',
            revision: 1,
            title: 'AI Advisor Full-Body Strength Re-Entry',
            startDate: '2026-09-21',
            weekCount: 1,
            sessions: [{ id: 's1', title: 'Re-entry', definition: innerDef }],
        };

        const unwrapped = unwrapSingleSessionFromPlanEnvelope(planEnvelope);
        expect(unwrapped.sourceFormat).toBe('external_plan_single_session');
        expect(unwrapped.target).toEqual(innerDef);
        expect(unwrapped.multiSessionCount).toBeUndefined();
    });
});
