import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }));

// Follow the repository's hook-based interaction tests; no DOM harness is installed. Effects are
// collected per render and flushed after refs are attached, which is the order React commits in.
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = initial;
        return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = value; }];
    },
    useRef: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = { current: initial };
        return mocks.slots[index];
    },
    useEffect: (effect: () => unknown) => { mocks.effects.push(effect); },
}));

import { PlacementOverlayRecoveryCard } from './PlacementOverlayRecoveryCard';

type Props = {
    children?: ReactNode; onClick?: () => unknown; disabled?: boolean; role?: string; className?: string;
    ref?: { current: unknown }; [key: string]: unknown;
};

function walk(node: ReactNode): ReactElement<Props>[] {
    if (!isValidElement<Props>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}
const textOf = (node: ReactNode): string => typeof node === 'string' || typeof node === 'number' ? String(node)
    : isValidElement<Props>(node) ? Children.toArray(node.props.children).map(textOf).join('') : '';

/** Stand-ins for the mounted buttons; `focused` records which one received focus last. */
const focus = { focused: null as string | null };
const fakeButton = (name: string) => ({ name, focus: () => { focus.focused = name; } });
const nameOf = (item: ReactElement<Props>) => item.props.className?.includes('plan-reset-confirm-btn') ? 'confirm'
    : textOf(item) === 'Cancel' ? 'cancel' : 'trigger';

const onReset = vi.fn<() => Promise<void>>();
function render(disabled = false) {
    mocks.cursor = 0;
    mocks.effects = [];
    const elements = walk(PlacementOverlayRecoveryCard({ onReset, disabled }) as ReactElement);
    for (const item of elements) if (item.type === 'button' && item.props.ref) item.props.ref.current = fakeButton(nameOf(item));
    for (const effect of mocks.effects) effect();
    const button = (name: 'trigger' | 'confirm' | 'cancel') => elements.find(item => item.type === 'button' && nameOf(item) === name);
    return { elements, text: textOf(elements[0]), button };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    focus.focused = null;
    onReset.mockResolvedValue(undefined);
});

describe('PlacementOverlayRecoveryCard', () => {
    it('warns that earlier moves are unreadable and that saving replaces them, in a status region of text only', () => {
        const view = render();
        expect(view.elements[0].props.role).toBeUndefined();
        const status = view.elements.filter(item => item.props.role === 'status');
        expect(status).toHaveLength(1);
        expect(status[0].type).toBe('p');
        expect(textOf(status[0])).toBe("Sessions are shown on the plan's own dates. Saving a move or resetting replaces the unreadable moves.");
        expect(view.text).toContain('Earlier moves could not be read');
        expect(textOf(view.button('trigger'))).toBe('Reset moves');
        expect(view.button('trigger')?.props.disabled).toBe(false);
        expect(view.button('cancel')).toBeUndefined();
        expect(focus.focused).toBeNull();
    });

    it('asks for confirmation with focus on Cancel, and Cancel writes nothing and returns focus', () => {
        render().button('trigger')!.props.onClick!();
        const confirming = render();
        expect(confirming.text).toContain('cannot be recovered');
        expect(focus.focused).toBe('cancel');
        confirming.button('cancel')!.props.onClick!();
        const closed = render();
        expect(closed.button('cancel')).toBeUndefined();
        expect(focus.focused).toBe('trigger');
        expect(onReset).not.toHaveBeenCalled();
    });

    it('resets only after the confirm step', async () => {
        render().button('trigger')!.props.onClick!();
        await render().button('confirm')!.props.onClick!();
        expect(onReset).toHaveBeenCalledTimes(1);
        expect(render().button('cancel')).toBeUndefined();
    });

    it('keeps the pending confirm button focusable and ignores repeated activation', async () => {
        let finish!: () => void;
        onReset.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
        render().button('trigger')!.props.onClick!();
        const pending = render().button('confirm')!.props.onClick!();
        const busy = render();
        expect(busy.button('confirm')?.props.disabled).toBeUndefined();
        expect(busy.button('confirm')?.props['aria-disabled']).toBe(true);
        expect(busy.button('cancel')?.props['aria-disabled']).toBe(true);
        expect(textOf(busy.button('confirm'))).toBe('Resetting moves…');
        void busy.button('confirm')!.props.onClick!();
        busy.button('cancel')!.props.onClick!();
        expect(render().button('cancel')).toBeDefined();
        finish();
        await pending;
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('shows one recoverable error and returns focus to the trigger when the reset fails', async () => {
        onReset.mockRejectedValueOnce(new Error('offline'));
        render().button('trigger')!.props.onClick!();
        render();
        await render().button('confirm')!.props.onClick!();
        const failed = render();
        const alerts = failed.elements.filter(item => item.props.role === 'alert');
        expect(alerts.map(textOf)).toEqual(['Moves could not be reset. Check your connection and try again.']);
        expect(failed.button('cancel')).toBeUndefined();
        expect(failed.button('trigger')?.props.disabled).toBe(false);
        expect(focus.focused).toBe('trigger');
    });

    it('disables the reset while reschedule controls are suppressed', () => {
        expect(render(true).button('trigger')?.props.disabled).toBe(true);
    });
});
