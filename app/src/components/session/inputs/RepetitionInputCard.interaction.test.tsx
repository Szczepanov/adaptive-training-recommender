/**
 * Submit behaviour of `RepetitionInputCard` (#725): single-submit guard, no refocus on a failed
 * write, and refocus + select of the weight field after a set is logged.
 *
 * `@testing-library/react` and jsdom are not installed (and must not be added), so the hooks are
 * mocked, the component function is called directly, and the rendered `<form onSubmit>` is
 * invoked by hand. Real browser focus/selection is covered by the visual Playwright capture.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStep } from '../../../sessions/models';

vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
        useRef: (initial: unknown) => ({ current: initial }),
        useEffect: () => {},
    };
});

import { RepetitionInputCard } from './RepetitionInputCard';

interface Props {
    children?: ReactNode;
    onSubmit?: (e: unknown) => Promise<void>;
    'aria-label'?: string;
    ref?: { current: unknown };
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

const step = { id: 'step-1', dose: { kind: 'repetition', reps: 5 } } as unknown as SessionStep;

function render(onSubmit: (payload: unknown) => void | Promise<void>) {
    const tree = RepetitionInputCard({ step, suggestedWeightKg: 80, onSubmit }) as ReactNode;
    const form = findElement(tree, el => el.type === 'form')!;
    const weight = findElement(tree, el => el.props['aria-label'] === 'Weight in kilograms')!;
    const field = { focus: vi.fn(), select: vi.fn() };
    weight.props.ref!.current = field;
    return { submit: () => form.props.onSubmit!({ preventDefault: vi.fn() }), field };
}

describe('RepetitionInputCard submit', () => {
    it('submits the prescribed reps and suggested weight, then refocuses and selects the weight field', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        const { submit, field } = render(onSubmit);

        await submit();

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'repetition', reps: 5, weightKg: 80, isWarmup: false }));
        expect(field.focus).toHaveBeenCalledTimes(1);
        expect(field.select).toHaveBeenCalledTimes(1);
    });

    it('logs exactly one entry when two submit events arrive before the first write settles', async () => {
        let release: () => void = () => {};
        const onSubmit = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const { submit, field } = render(onSubmit);

        const first = submit();
        const second = submit();
        await second;
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(field.focus).not.toHaveBeenCalled();

        release();
        await first;
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(field.focus).toHaveBeenCalledTimes(1);
    });

    it('does not refocus when the write fails, and allows a retry afterwards', async () => {
        const onSubmit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
        const { submit, field } = render(onSubmit);

        await expect(submit()).rejects.toThrow('offline');
        expect(field.focus).not.toHaveBeenCalled();

        await submit();
        expect(onSubmit).toHaveBeenCalledTimes(2);
        expect(field.focus).toHaveBeenCalledTimes(1);
    });
});
