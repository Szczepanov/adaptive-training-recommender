import { describe, expect, it } from 'vitest';
import { projectedDateOutcomeFrom, type ProjectedDateEvaluation } from './planner';
import { ENRICHED_TEMPLATES } from './templates';

describe('projected D-LEDGER outcome classification', () => {
    it('does not relabel a ledger-capacity rejection as projected fatigue', () => {
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest');
        const ledgerBlocked = ENRICHED_TEMPLATES.find(template => template.category !== 'Rest');
        expect(rest).toBeDefined();
        expect(ledgerBlocked).toBeDefined();
        if (!rest || !ledgerBlocked) return;

        const evaluation = {
            date: '2026-09-10',
            fatigueTier: 'train',
            eligible: [ledgerBlocked, rest],
            ledgerExcludedTemplateIds: [ledgerBlocked.id],
            fatigueGated: [rest],
            rank: () => ({
                accepted: [{ template: rest }],
                rejected: [],
            }),
        } as unknown as ProjectedDateEvaluation;

        const outcome = projectedDateOutcomeFrom(evaluation);

        expect(outcome.acceptedTemplateIds).toContain(rest.id);
        expect(outcome.exclusionReasons.get(ledgerBlocked.id)).toEqual(['DAILY_LEDGER_CAPACITY']);
        expect(outcome.fatigueExcludedTemplateIds).not.toContain(ledgerBlocked.id);
    });
});
