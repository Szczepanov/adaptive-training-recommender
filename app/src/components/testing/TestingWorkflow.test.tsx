import { describe, expect, it } from 'vitest';
import {
    canStartFreshAssessmentAttempt,
    describeAbandonedAssessment,
} from './TestingWorkflow';

describe('describeAbandonedAssessment', () => {
    it('names the lost attempt and protocol lock (#494)', () => {
        const copy = describeAbandonedAssessment(
            { id: 'attempt-1', purpose: 'baseline' },
            { title: '20-min FTP test', revision: 3 },
        );

        expect(copy).toContain('attempt-1');
        expect(copy).toContain('20-min FTP test');
        expect(copy).toContain('rev 3');
        expect(copy).toContain('baseline');
    });

    it('states what was lost, that abandonment is terminal, and that re-testing needs a fresh attempt (#494)', () => {
        const copy = describeAbandonedAssessment(
            { id: 'attempt-1', purpose: 'checkpoint' },
            { title: '20-min FTP test', revision: 3 },
        );

        expect(copy).toContain('will never produce a benchmark observation');
        expect(copy).toContain('terminal');
        expect(copy).toContain('cannot be resumed');
        expect(copy).toContain('start a fresh attempt');
    });
});

describe('canStartFreshAssessmentAttempt', () => {
    it('allows a fresh attempt only after terminal abandonment is persisted (#494)', () => {
        expect(canStartFreshAssessmentAttempt({ state: 'abandoned' })).toBe(true);
        expect(canStartFreshAssessmentAttempt({ state: 'scheduled' })).toBe(false);
        expect(canStartFreshAssessmentAttempt({ state: 'in_progress' })).toBe(false);
        expect(canStartFreshAssessmentAttempt({ state: 'completed' })).toBe(false);
        expect(canStartFreshAssessmentAttempt(null)).toBe(false);
    });
});
