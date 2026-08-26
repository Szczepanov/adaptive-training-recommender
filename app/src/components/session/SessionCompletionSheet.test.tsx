import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionCompletionSheet } from './SessionCompletionSheet';
import { COMPLETION_TISSUE_LEVEL_OPTIONS } from './sessionCompletionOptions';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';

describe('SessionCompletionSheet', () => {
    it('uses the canonical tissue-response vocabulary for completion feedback', () => {
        expect(COMPLETION_TISSUE_LEVEL_OPTIONS.map(option => option.value)).toEqual(['mild', 'moderate', 'severe']);
    });

    it('renders summary metrics correctly including duration, total sets, and completed exercises count', () => {
        const steps: SessionStepSummary[] = [
            {
                exerciseIndex: 0,
                exerciseId: 'back_squat',
                displayName: 'Back Squat',
                isPlanned: true,
                optional: false,
                targetSets: 3,
                targetReps: 5,
                targetGauge: null,
                loggedSetsCount: 3,
                isComplete: true,
            },
            {
                exerciseIndex: 1,
                exerciseId: 'bench_press',
                displayName: 'Bench Press',
                isPlanned: true,
                optional: false,
                targetSets: 3,
                targetReps: 5,
                targetGauge: null,
                loggedSetsCount: 0,
                isComplete: false,
            },
        ];

        const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const html = renderToStaticMarkup(
            <SessionCompletionSheet
                startedAt={startedAt}
                totalSets={3}
                steps={steps}
                onComplete={vi.fn()}
                onAbandon={vi.fn()}
                onCancel={vi.fn()}
                saving={false}
            />,
        );

        expect(html).toContain('30 min');
        expect(html).toContain('Total Sets');
        expect(html).toContain('3');
        expect(html).toContain('Exercises');
        expect(html).toContain('1'); // Only 1 exercise has loggedSetsCount > 0
    });

    it('renders warning box when there are incomplete required steps', () => {
        const steps: SessionStepSummary[] = [
            {
                exerciseIndex: 0,
                exerciseId: 'back_squat',
                displayName: 'Back Squat',
                isPlanned: true,
                optional: false,
                targetSets: 3,
                targetReps: 5,
                targetGauge: null,
                loggedSetsCount: 1,
                isComplete: false,
            },
            {
                exerciseIndex: 1,
                exerciseId: 'plank',
                displayName: 'Plank',
                isPlanned: true,
                optional: true, // optional step, should not show in warning
                targetSets: 2,
                targetReps: null,
                targetGauge: null,
                loggedSetsCount: 0,
                isComplete: false,
            },
        ];

        const html = renderToStaticMarkup(
            <SessionCompletionSheet
                startedAt={new Date().toISOString()}
                totalSets={1}
                steps={steps}
                onComplete={vi.fn()}
                onAbandon={vi.fn()}
                onCancel={vi.fn()}
                saving={false}
            />,
        );

        expect(html).toContain('Incomplete Required Steps (1)');
        expect(html).toContain('Back Squat (1/3 sets)');
        expect(html).not.toContain('Plank (0/2 sets)');
    });

    it('does not render warning box when all required steps are completed', () => {
        const steps: SessionStepSummary[] = [
            {
                exerciseIndex: 0,
                exerciseId: 'back_squat',
                displayName: 'Back Squat',
                isPlanned: true,
                optional: false,
                targetSets: 3,
                targetReps: 5,
                targetGauge: null,
                loggedSetsCount: 3,
                isComplete: true,
            },
        ];

        const html = renderToStaticMarkup(
            <SessionCompletionSheet
                startedAt={new Date().toISOString()}
                totalSets={3}
                steps={steps}
                onComplete={vi.fn()}
                onAbandon={vi.fn()}
                onCancel={vi.fn()}
                saving={false}
            />,
        );

        expect(html).not.toContain('Incomplete Required Steps');
    });

    it('renders abandon confirmation when openAbandonConfirmation is true', () => {
        const html = renderToStaticMarkup(
            <SessionCompletionSheet
                startedAt={new Date().toISOString()}
                totalSets={2}
                steps={[]}
                onComplete={vi.fn()}
                onAbandon={vi.fn()}
                onCancel={vi.fn()}
                saving={false}
                openAbandonConfirmation={true}
            />,
        );

        expect(html).toContain('Abandon Session?');
        expect(html).toContain('Yes, Abandon Session');
        expect(html).toContain('Partial sets you have logged (2 sets) are permanently retained');
    });
});
