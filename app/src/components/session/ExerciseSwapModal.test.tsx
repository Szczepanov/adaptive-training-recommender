import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExerciseSwapModal } from './ExerciseSwapModal';
import type { SessionStep } from '../../sessions/models';

const step = {
    id: 'step-1',
    title: 'Back squat',
    exerciseRef: { kind: 'unresolved_free_text', name: 'Back squat' },
} as unknown as SessionStep;

describe('ExerciseSwapModal accessibility', () => {
    it('gives the catalog search input a programmatic label, not only a placeholder', () => {
        const html = renderToStaticMarkup(<ExerciseSwapModal step={step} onSwap={() => {}} onClose={() => {}} />);
        expect(html).toContain('<label class="swap-label" for="swap-exercise-search">Search exercises</label>');
        expect(html).toContain('id="swap-exercise-search"');
        expect(html).toContain('type="search"');
    });
});
