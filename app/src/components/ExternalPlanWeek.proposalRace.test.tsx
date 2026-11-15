import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedSession, ReplacementProposal } from '../engine/externalPlacement';

const mocks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

// Hook slots by call order, as in the PlanView tests: the component runs as a plain function
// and state persists in `slots` between renders.
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        return [mocks.slots[index], (value: unknown) => {
            mocks.slots[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(mocks.slots[index]) : value;
        }];
    },
    useRef: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = { current: initial };
        return mocks.slots[index];
    },
    useMemo: (factory: () => unknown) => factory(),
}));
vi.mock('./WorkoutExportMenu', () => ({ WorkoutExportMenu: () => null }));

import { ExternalPlanWeek } from './ExternalPlanWeek';

type Props = { children?: ReactNode; [key: string]: unknown };
function walk(node: ReactNode): ReactElement<Props>[] {
    if (!isValidElement<Props>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}

const today = '2026-08-18';
function session(id: string): PlacedSession {
    return {
        session: {
            id, title: id, priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'carry_forward' },
            gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
            prescription: { summary: id },
        },
        date: today, status: 'planned', moved: false,
    } as PlacedSession;
}

function deferred() {
    let resolve!: (value: ReplacementProposal) => void;
    const promise = new Promise<ReplacementProposal>(done => { resolve = done; });
    return { promise, resolve };
}

describe('ExternalPlanWeek asynchronous proposals', () => {
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const render = () => {
        mocks.cursor = 0;
        return walk(ExternalPlanWeek({
            userId: 'u1', planTitle: 'Plan', weekStartDate: today, today, critique: null,
            placed: [session('session-a'), session('session-b')],
            onProposeReplacement: sessionId => {
                const request = deferred();
                pending.set(sessionId, request);
                return request.promise;
            },
            onConfirmReplacement: vi.fn(),
            onChooseDate: vi.fn(),
        }) as ReactElement);
    };
    const rescheduleButtons = () => render().filter(item => item.props.className === 'external-week-missed-btn');
    const proposalText = () => render()
        .filter(item => item.type === 'p' && item.props.children !== undefined)
        .map(item => String(item.props.children))
        .find(text => text.startsWith('proposal for'));
    const proposalFor = (sessionId: string): ReplacementProposal =>
        ({ sessionId, missedDate: today, outcome: 'unresolved', rationale: `proposal for ${sessionId}` });

    beforeEach(() => {
        mocks.slots = [];
        pending.clear();
    });

    it('keeps the latest request when an earlier one resolves after it', async () => {
        const [first, second] = rescheduleButtons();
        (first.props.onClick as () => void)();
        (second.props.onClick as () => void)();

        pending.get('session-b')!.resolve(proposalFor('session-b'));
        await Promise.resolve();
        await Promise.resolve();
        pending.get('session-a')!.resolve(proposalFor('session-a'));
        await Promise.resolve();
        await Promise.resolve();

        expect(proposalText()).toBe('proposal for session-b');
    });

    it('drops a pending request once the athlete leaves it as is', async () => {
        const [first, second] = rescheduleButtons();
        (second.props.onClick as () => void)();
        pending.get('session-b')!.resolve(proposalFor('session-b'));
        await Promise.resolve();
        await Promise.resolve();

        (first.props.onClick as () => void)();
        const cancel = render().find(item => item.props.className === 'external-week-cancel');
        (cancel!.props.onClick as () => void)();
        pending.get('session-a')!.resolve(proposalFor('session-a'));
        await Promise.resolve();
        await Promise.resolve();

        expect(proposalText()).toBeUndefined();
    });
});
