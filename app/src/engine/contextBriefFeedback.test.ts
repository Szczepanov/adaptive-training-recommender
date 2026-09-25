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
});

describe('renderRecommendationFeedbackLine (#815)', () => {
    const label = '- Recommendation feedback (athlete response, not execution)';
    it('distinguishes no recommendation from an unanswered prompt', () => {
        expect(renderRecommendationFeedbackLine(null)).toBe(`${label}: no app recommendation recorded for yesterday.`);
        expect(renderRecommendationFeedbackLine(rec(day(0)))).toBe(`${label}: not answered yet — unknown, not a skip.`);
    });
    it('renders each explicit response', () => {
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: true }))).toBe(`${label}: reported followed as prescribed`);
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: false, skipped: true }))).toBe(`${label}: reported skipped`);
        expect(renderRecommendationFeedbackLine(rec(day(0), { followed: false, actualModality: 'Mobility' })))
            .toBe(`${label}: reported doing Mobility instead`);
    });
});
