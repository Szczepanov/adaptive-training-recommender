import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

// Follow the repository's hook-based interaction tests; no DOM harness is installed.
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = initial;
        return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = value; }];
    },
}));

import { PlacementOverlayRecoveryCard } from './PlacementOverlayRecoveryCard';

type Props = { children?: ReactNode; onClick?: () => unknown; disabled?: boolean; role?: string; [key: string]: unknown };

function walk(node: ReactNode): ReactElement<Props>[] {
    if (!isValidElement<Props>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}
const textOf = (node: ReactNode): string => typeof node === 'string' || typeof node === 'number' ? String(node)
    : isValidElement<Props>(node) ? Children.toArray(node.props.children).map(textOf).join('') : '';

const onReset = vi.fn<() => Promise<void>>();
function render(disabled = false) {
    mocks.cursor = 0;
    const elements = walk(PlacementOverlayRecoveryCard({ onReset, disabled }) as ReactElement);
    const button = (label: string) => elements.find(item => item.type === 'button' && textOf(item) === label);
    return { elements, text: textOf(elements[0]), button };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    onReset.mockResolvedValue(undefined);
});

describe('PlacementOverlayRecoveryCard', () => {
    it('warns that earlier moves are unreadable and that saving replaces them', () => {
        const view = render();
        expect(view.elements[0].props.role).toBe('status');
        expect(view.text).toContain('Earlier moves could not be read');
        expect(view.text).toContain('Saving a move or resetting replaces the unreadable moves.');
        expect(view.button('Reset moves')?.props.disabled).toBe(false);
        expect(view.button('Cancel')).toBeUndefined();
    });

    it('asks for confirmation before resetting, and Cancel writes nothing', () => {
        render().button('Reset moves')!.props.onClick!();
        const confirming = render();
        expect(confirming.text).toContain('cannot be recovered');
        confirming.button('Cancel')!.props.onClick!();
        expect(render().button('Cancel')).toBeUndefined();
        expect(onReset).not.toHaveBeenCalled();
    });

    it('resets only after the confirm step', async () => {
        render().button('Reset moves')!.props.onClick!();
        await render().button('Reset moves')!.props.onClick!();
        expect(onReset).toHaveBeenCalledTimes(1);
        expect(render().button('Cancel')).toBeUndefined();
    });

    it('keeps the confirm step and shows a recoverable error when the reset fails', async () => {
        onReset.mockRejectedValueOnce(new Error('offline'));
        render().button('Reset moves')!.props.onClick!();
        await render().button('Reset moves')!.props.onClick!();
        const failed = render();
        expect(failed.elements.find(item => item.props.role === 'alert') && textOf(failed.elements.find(item => item.props.role === 'alert'))).toBe('Moves could not be reset. Check your connection and try again.');
        expect(failed.button('Cancel')).toBeDefined();
        expect(failed.button('Reset moves')?.props.disabled).toBe(false);
    });

    it('disables the reset while reschedule controls are suppressed', () => {
        expect(render(true).button('Reset moves')?.props.disabled).toBe(true);
    });
});
