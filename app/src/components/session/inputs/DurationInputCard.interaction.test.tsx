/**
 * Starting a hold must end a still-running rest countdown, otherwise the rest elapses -- and
 * its completion cue fires -- in the middle of the hold. Hooks are mocked and the component is
 * called directly because jsdom is not installed (see DistanceInputCard.interaction.test.tsx).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStep } from '../../../sessions/models';

vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
        useEffect: vi.fn(),
        useCallback: (fn: unknown) => fn,
        useRef: (initial: unknown) => ({ current: initial }),
    };
});
vi.mock('../../../utils/audioFeedback', () => ({ playCountdownBeep: vi.fn() }));

import { DurationInputCard } from './DurationInputCard';
import { RpeField } from './RpeField';

interface Props {
    children?: ReactNode;
    onClick?: () => void;
    onSubmit?: (e: unknown) => void;
    className?: string;
}

function findElement(node: ReactNode, predicate: (el: ReactElement<Props>) => boolean): ReactElement<Props> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const hit = findElement(child, predicate);
            if (hit) return hit;
        }
        return null;
    }
    if (!isValidElement(node)) return null;
    const element = node as ReactElement<Props>;
    if (predicate(element)) return element;
    return findElement(element.props.children, predicate);
}

const plank: SessionStep = {
    id: 'plank', kind: 'exercise',
    exerciseRef: { kind: 'catalog', exerciseId: 'hollow_body_hold' },
    dose: { kind: 'duration', sets: 3, seconds: 30 },
};

describe('DurationInputCard', () => {
    it('does not end the rest when only the lead-in starts (it can still be cancelled)', () => {
        const onWorkStarted = vi.fn();
        const tree = DurationInputCard({ step: plank, onSubmit: vi.fn(), onWorkStarted }) as ReactNode;
        const start = findElement(tree, el => typeof el.props.className === 'string' && el.props.className.includes('timer-control-btn start'));
        start!.props.onClick!();
        expect(onWorkStarted).not.toHaveBeenCalled();
    });

    it('offers RPE and logs it with the hold', () => {
        const onSubmit = vi.fn();
        const tree = DurationInputCard({ step: plank, onSubmit }) as ReactNode;
        expect(findElement(tree, el => el.type === RpeField)).not.toBeNull();
        findElement(tree, el => el.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });
        expect(onSubmit).toHaveBeenCalledWith({ kind: 'duration', seconds: 30 }, undefined);
    });
});

describe('DurationInputCard double Log', () => {
    it('ignores a second Log while the first hold is still saving', async () => {
        let release: () => void = () => {};
        const onSubmit = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const tree = DurationInputCard({ step: plank, onSubmit }) as ReactNode;
        const form = findElement(tree, el => el.type === 'form')!;
        const first = form.props.onSubmit!({ preventDefault: vi.fn() }) as unknown as Promise<void>;
        await form.props.onSubmit!({ preventDefault: vi.fn() });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        release();
        await first;
    });
});
