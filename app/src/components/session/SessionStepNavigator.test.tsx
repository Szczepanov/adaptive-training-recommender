import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionStepNavigator } from './SessionStepNavigator';

describe('SessionStepNavigator', () => {
    it('renders repeated exercise identities without duplicate React keys', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const html = renderToStaticMarkup(
            <SessionStepNavigator
                activeExerciseIndex={null}
                onSelectStep={vi.fn()}
                steps={[
                    {
                        exerciseIndex: null, exerciseId: 'bike_easy_spin', displayName: 'Easy spin',
                        isPlanned: true, optional: false, targetSets: 1, targetReps: null,
                        targetGauge: null, loggedSetsCount: 0, isComplete: false,
                    },
                    {
                        exerciseIndex: null, exerciseId: 'bike_easy_spin', displayName: 'Easy spin cooldown',
                        isPlanned: true, optional: true, targetSets: 1, targetReps: null,
                        targetGauge: null, loggedSetsCount: 0, isComplete: false,
                    },
                ]}
            />,
        );

        expect(html).toContain('Easy spin');
        expect(html).toContain('Easy spin cooldown');
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
