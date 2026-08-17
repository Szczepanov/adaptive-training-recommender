import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StrengthOverloadHistory } from './StrengthOverloadHistory';
import * as historyHook from '../hooks/useOverloadHistory';
import type { UseOverloadHistoryResult } from '../hooks/useOverloadHistory';

function baseResult(overrides: Partial<UseOverloadHistoryResult> = {}): UseOverloadHistoryResult {
    return {
        loading: false,
        error: null,
        exercises: [],
        selected: null,
        select: vi.fn(),
        history: [],
        invalidRecords: 0,
        ...overrides,
    };
}

describe('StrengthOverloadHistory', () => {
    it('renders a loading state', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({ loading: true }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('Loading overload history');
    });

    it('renders an empty state when nothing has ever been logged', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult());
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('No strength sets logged yet');
    });

    it('surfaces a read error without swallowing it', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({ error: 'Could not load strength session history' }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('Could not load strength session history');
    });

    it('lists distinct exercises in the picker', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({
            exercises: [{ exerciseId: 'front_squat' }, { exerciseId: null, freeTextName: 'Farmer carry' }],
        }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('Front Squat');
        expect(html).toContain('Farmer carry');
    });

    it('renders a history row per session with tonnage and heaviest set', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({
            exercises: [{ exerciseId: 'front_squat' }],
            selected: { exerciseId: 'front_squat' },
            history: [{
                date: '2026-08-10', sessionId: 's1', setCount: 4, workingSetCount: 3, totalReps: 20, tonnageKg: 1200,
                heaviestSet: { setIndex: 3, reps: 5, weightKg: 100, isWarmup: false, completedAt: '2026-08-10T18:10:00Z' },
            }],
        }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('2026-08-10');
        expect(html).toContain('1200');
        expect(html).toContain('5 × 100 kg');
        expect(html).toContain('+1 warm-up');
    });

    it('renders a bodyweight heaviest set without a unit suffix', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({
            exercises: [{ exerciseId: 'pull_up' }],
            selected: { exerciseId: 'pull_up' },
            history: [{
                date: '2026-08-10', sessionId: 's1', setCount: 3, workingSetCount: 3, totalReps: 24, tonnageKg: 0,
                heaviestSet: { setIndex: 1, reps: 8, weightKg: null, isWarmup: false, completedAt: '2026-08-10T18:10:00Z' },
            }],
        }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('8 × BW');
    });

    it('warns about invalid records without hiding the rest of the history', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({
            exercises: [{ exerciseId: 'front_squat' }],
            selected: { exerciseId: 'front_squat' },
            invalidRecords: 2,
            history: [{ date: '2026-08-10', sessionId: 's1', setCount: 1, workingSetCount: 1, totalReps: 5, tonnageKg: 500, heaviestSet: null }],
        }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('2 session records could not be read');
        expect(html).toContain('2026-08-10');
    });

    it('shows an empty-history message for a selected exercise with nothing in the window', () => {
        vi.spyOn(historyHook, 'useOverloadHistory').mockReturnValue(baseResult({
            exercises: [{ exerciseId: 'front_squat' }],
            selected: { exerciseId: 'front_squat' },
            history: [],
        }));
        const html = renderToStaticMarkup(<StrengthOverloadHistory userId="u1" />);
        expect(html).toContain('No sets logged for this exercise');
    });
});
