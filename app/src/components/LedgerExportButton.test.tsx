import { Children, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLedgerExport } from '../ledger/export/buildLedgerExport';
import { fullInput } from '../ledger/export/ledgerExportFixtures.testSupport';

const mocks = vi.hoisted(() => ({
    build: vi.fn(), download: vi.fn(), serviceLoadCount: 0,
    slots: [] as unknown[], cursor: 0,
    cleanup: undefined as undefined | (() => void),
    effectStarted: false,
}));

// Follow the repository's hook-based interaction tests; no DOM harness is installed.
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
    useEffect: (effect: () => (() => void)) => {
        if (!mocks.effectStarted) {
            mocks.effectStarted = true;
            mocks.cleanup = effect();
        }
    },
}));
vi.mock('../services/ledgerExportService', () => {
    mocks.serviceLoadCount += 1;
    return { ledgerExportService: { build: mocks.build } };
});
vi.mock('../utils/contextBriefExport', () => ({ downloadLedgerExportFile: mocks.download }));

import { LedgerExportButton } from './LedgerExportButton';

const props = { userId: 'athlete-a', asOfDate: '2026-11-20', purpose: 'planning' as const };
interface ElementProps { children?: string; onClick: () => Promise<void>; disabled?: boolean; role?: string; className?: string; type?: string }
function render() {
    mocks.cursor = 0;
    const tree = LedgerExportButton(props) as ReactElement<{ children: ReactElement<ElementProps>[] }>;
    const children = Children.toArray(tree.props.children) as ReactElement<ElementProps>[];
    return { button: children.find(child => child.type === 'button')!, error: children.find(child => child.props.role === 'status') };
}
function pendingBuild() {
    let resolve!: (ledger: ReturnType<typeof buildLedgerExport>) => void;
    let reject!: (reason: Error) => void;
    mocks.build.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    return { resolve, reject };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    mocks.cursor = 0;
    mocks.cleanup = undefined;
    mocks.effectStarted = false;
});

describe('LedgerExportButton', () => {
    it('does not load the ledger service or read sources on mount', () => {
        const { button } = render();
        expect(button.props.children).toBe('Export ledger (JSON)');
        expect(button.props.type).toBe('button');
        expect(button.props.className).toBe('brief-copy');
        expect(mocks.serviceLoadCount).toBe(0);
        expect(mocks.build).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
    });

    it('reads the selected user and window on click, disables duplicates and downloads the returned ledger', async () => {
        const pending = pendingBuild();
        const ledger = buildLedgerExport(fullInput());
        const first = render().button.props.onClick();
        expect(render().button.props.disabled).toBe(true);
        expect(render().button.props.children).toBe('Exporting ledger…');
        await render().button.props.onClick();
        await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
        expect(mocks.build).toHaveBeenCalledWith('athlete-a', { asOfDate: '2026-11-20', purpose: 'planning', window: undefined });
        pending.resolve(ledger);
        await first;
        expect(mocks.download).toHaveBeenCalledWith(ledger);
        expect(render().button.props.disabled).toBe(false);
    });

    it('forwards the explicit diagnostic window', async () => {
        const ledger = buildLedgerExport(fullInput());
        mocks.build.mockResolvedValue(ledger);
        const window = { startDate: '2026-11-01', endDate: '2026-11-20' };
        mocks.cursor = 0;
        const tree = LedgerExportButton({ ...props, purpose: 'diagnostic', window }) as ReactElement<{ children: ReactElement<ElementProps>[] }>;
        const button = (Children.toArray(tree.props.children) as ReactElement<ElementProps>[]).find(child => child.type === 'button')!;
        await button.props.onClick();
        expect(mocks.build).toHaveBeenCalledWith('athlete-a', { asOfDate: props.asOfDate, purpose: 'diagnostic', window });
    });

    it('shows a recoverable error and allows retry after a failed export', async () => {
        mocks.build.mockRejectedValueOnce(new Error('offline'));
        await render().button.props.onClick();
        expect(render().error?.props.children).toBe('Ledger export could not start. Try again.');
        expect(render().button.props.disabled).toBe(false);
        expect(mocks.download).not.toHaveBeenCalled();
        const ledger = buildLedgerExport(fullInput());
        mocks.build.mockResolvedValueOnce(ledger);
        await render().button.props.onClick();
        expect(render().error).toBeUndefined();
        expect(mocks.download).toHaveBeenCalledWith(ledger);
    });

    it('suppresses a completed export after unmount', async () => {
        const pending = pendingBuild();
        const operation = render().button.props.onClick();
        await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
        mocks.cleanup!();
        const before = [...mocks.slots];
        pending.resolve(buildLedgerExport(fullInput()));
        await operation;
        expect(mocks.download).not.toHaveBeenCalled();
        expect(mocks.slots).toEqual(before);
    });

    it('suppresses errors after unmount', async () => {
        const pending = pendingBuild();
        const operation = render().button.props.onClick();
        await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
        mocks.cleanup!();
        const before = [...mocks.slots];
        pending.reject(new Error('offline'));
        await operation;
        expect(mocks.slots).toEqual(before);
        expect(mocks.download).not.toHaveBeenCalled();
    });

    it('does not start source reads when unmounted during the lazy import', async () => {
        const operation = render().button.props.onClick();
        mocks.cleanup!();
        await operation;
        expect(mocks.build).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
    });
});
