import { describe, expect, it } from 'vitest';
import type { DailyRecommendation } from './models';
import {
    EXECUTION_NOT_RECONCILED_NOTE,
    renderRecommendationFeedback,
    renderRecommendationFeedbackLine,
} from './contextBriefFeedback';

function rec(date: string, adherence: Partial<DailyRecommendation['adherence']> = {}): DailyRecommendation {
    return {
        userId: 'u1', date, templateId: 't1', templateTitle: 'Tempo ride',
        category: 'Hard Endurance', modality: 'Cycling', mode: 'train',
        rationale: 'ok', schemaVersion: 3,
        createdAt: `${date}T07:00:00Z`, updatedAt: `${date}T07:00:00Z`,
        adherence: {
            respondedAt: null, followed: null, actualModality: null, actualDurationMin: null,
            skipped: false, notes: null, ...adherence,
        },
    };
}

const day = (i: number): string => `2026-08-${String(i + 1).padStart(2, '0')}`;
const render = (recs: readonly DailyRecommendation[]): string =>
    renderRecommendationFeedback(recs, '## 6. Recommendation feedback').join('\n');

describe('renderRecommendationFeedback (#815)', () => {
    it('reports 4/14 feedback completion and never counts unanswered prompts as skips', () => {
        const recs = Array.from({ length: 14 }, (_, i) =>
            rec(day(i), i < 4 ? { respondedAt: `${day(i)}T20:00:00Z`, followed: true } : {}));
        const text = render(recs);
        expect(text).toContain('Feedback completion: 4/14 prompts answered · 10 unanswered (unknown, not skipped).');
        expect(text).toContain('- Athlete reported skipping: 0');
        expect(text).not.toContain('Reported deviations:');
        expect(text).not.toMatch(/adherence rate|non-adheren|missed/i);
    });

    it('keeps an explicit skip as an athlete-reported skip without needing activity data', () => {
        const text = render([rec(day(0), { followed: false, skipped: true, notes: 'travel' })]);
        expect(text).toContain('- Athlete reported skipping: 1');
        expect(text).toContain('2026-08-01: prescribed Tempo ride (train), reported skipped — "travel"');
    });

    it('does not double count a skip that also carries followed=true', () => {
        const text = render([rec(day(0), { followed: true, skipped: true })]);
        expect(text).toContain('- Athlete reported followed as prescribed: 0');
        expect(text).toContain('- Athlete reported skipping: 1');
    });

    it('reports a different activity as athlete feedback, not as execution evidence', () => {
        const text = render([rec(day(0), { followed: false, actualModality: 'Running', actualDurationMin: 40 })]);
        expect(text).toContain('- Athlete reported doing something different: 1');
        expect(text).toContain('reported doing Running for 40 min');
    });

    it('states that execution is not reconciled, scopes counts to app recommendations, and keeps the note when empty', () => {
        for (const text of [render([rec(day(0))]), render([])]) {
            expect(text).toContain(EXECUTION_NOT_RECONCILED_NOTE);
            expect(text).toContain('Imported/external-plan sessions are not counted here.');
        }
        expect(render([])).toContain('No app recommendations recorded in this window.');
        expect(EXECUTION_NOT_RECONCILED_NOTE).toContain('#646');
        expect(EXECUTION_NOT_RECONCILED_NOTE).toContain('a missing activity is not proof of non-execution');
    });

    it('renders unreadable recommendations with an unknown message when the read failed', () => {
        const unreadable = (recs: readonly DailyRecommendation[]): string =>
            renderRecommendationFeedback(recs, '## 6. Recommendation feedback', false).join('\n');
        const text = unreadable([]);
        expect(text).toContain('Recommendation feedback unavailable (read failed)');
        expect(text).toContain('unknown, not none');
        expect(text).toContain(EXECUTION_NOT_RECONCILED_NOTE);
        expect(text).not.toContain('No app recommendations recorded in this window.');
    });

    it('notes when an imported/external plan is the planning authority', () => {
        const withExternalAuthority = renderRecommendationFeedback(
            [rec(day(0), { followed: true })],
            '## 6. Recommendation feedback',
            { recommendationsReadable: true, isExternalPlanAuthority: true },
        ).join('\n');
        expect(withExternalAuthority).toContain('Planning authority note: An imported/external plan is the active planning authority for this athlete.');
        expect(withExternalAuthority).toContain('The feedback below reflects responses to in-app recommendation prompts only, not compliance with the external plan.');
        expect(withExternalAuthority).toContain('Feedback completion: 1/1 prompts answered · 0 unanswered (unknown, not skipped).');

        const emptyWithExternalAuthority = renderRecommendationFeedback(
            [],
            '## 6. Recommendation feedback',
            { recommendationsReadable: true, isExternalPlanAuthority: true },
        ).join('\n');
        expect(emptyWithExternalAuthority).toContain('Planning authority note: An imported/external plan is the active planning authority for this athlete.');
        expect(emptyWithExternalAuthority).toContain('No app recommendations recorded in this window.');

        const appAuthority = renderRecommendationFeedback(
            [rec(day(0))],
            '## 6. Recommendation feedback',
            { recommendationsReadable: true, isExternalPlanAuthority: false },
        ).join('\n');
        expect(appAuthority).not.toContain('Planning authority note:');
    });

    it('explicitly renders execution reconciliation as unavailable due to shadow-only status (#646)', () => {
        expect(EXECUTION_NOT_RECONCILED_NOTE).toContain('Plan execution reconciliation: unavailable');
        expect(EXECUTION_NOT_RECONCILED_NOTE).toContain('canonical planned-vs-performed reconciliation is shadow-only; ADR-0034 TO4/TO5, #646');
    });
});

describe('renderRecommendationFeedbackLine (#815)', () => {
    const label = '- Recommendation feedback (athlete response, not execution)';
    it('distinguishes no recommendation from an unanswered prompt', () => {
        expect(renderRecommendationFeedbackLine(null)).toBe(`${label}: no app recommendation recorded for yesterday.`);
        expect(renderRecommendationFeedbackLine(rec(day(0)))).toBe(`${label}: not answered yet — unknown, not a skip.`);
    });
    it('notes external plan authority when no recommendation was recorded', () => {
        expect(renderRecommendationFeedbackLine(null, true, true)).toBe(`${label}: no app recommendation recorded for yesterday (external plan governs).`);
    });
    it('renders each explicit response', () => {
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: true }))).toBe(`${label}: reported followed as prescribed`);
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: false, skipped: true }))).toBe(`${label}: reported skipped`);
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: false, actualModality: 'Mobility' })))
            .toBe(`${label}: reported doing Mobility instead`);
    });
    it('reports unreadable recommendations as unknown when the read failed', () => {
        expect(renderRecommendationFeedbackLine(null, false))
            .toContain('unavailable (read failed)');
        expect(renderRecommendationFeedbackLine(null, false))
            .toContain('unknown, not none');
    });
});
