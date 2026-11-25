import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DEvalReadoutOutput } from '../../services/dEvalReadoutService';

const mocks = vi.hoisted(() => ({
    run: vi.fn(),
    download: vi.fn(),
    writeText: vi.fn(),
    serviceLoadCount: 0,
    slots: [] as unknown[],
    cursor: 0,
    cleanup: undefined as undefined | (() => void),
    effectStarted: false,
}));

vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useId: () => 'deval-test',
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

vi.mock('../../services/dEvalReadoutService', () => {
    mocks.serviceLoadCount += 1;
    return { dEvalReadoutService: { run: mocks.run } };
});

vi.mock('../../utils/contextBriefExport', () => ({
    downloadDEvalResultFile: mocks.download,
}));

import { DEvalReadoutSection } from './DEvalReadoutSection';

function collectElements(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
        for (const item of node) collectElements(item, out);
    } else if (isValidElement(node)) {
        const el = node as ReactElement<Record<string, unknown>>;
        out.push(el);
        if (el.props.children !== undefined) {
            for (const child of Children.toArray(el.props.children as ReactNode)) {
                collectElements(child, out);
            }
        }
    }
    return out;
}

function render(props = { userId: 'athlete-a', defaultAsOfDate: '2026-12-26' }) {
    mocks.cursor = 0;
    const tree = DEvalReadoutSection(props) as ReactElement<Record<string, unknown>>;
    const elements = collectElements(tree);
    return {
        tree,
        elements,
        buttons: elements.filter(el => el.type === 'button'),
        inputs: elements.filter(el => el.type === 'input'),
        selects: elements.filter(el => el.type === 'select'),
        textareas: elements.filter(el => el.type === 'textarea'),
        statusNotice: elements.find(el => el.props.role === 'status'),
    };
}

function sampleOutput(overrides: Partial<DEvalReadoutOutput['result']> = {}): DEvalReadoutOutput {
    const result: DEvalReadoutOutput['result'] = {
        blockStartDate: '2026-11-29',
        blockEndDate: '2026-12-26',
        blockDays: 28,
        asOfDate: '2026-12-26',
        criteriaCommit: null,
        phase2Commit: null,
        rollbackSettingState: 'off',
        c1: {
            status: 'pass',
            block: {
                planned: 10,
                completed: 9,
                moved: 0,
                partial: 0,
                reduced: 0,
                reducedCompleted: 0,
                reducedPartial: 0,
                reducedAbandoned: 0,
                reducedUnknown: 0,
                reducedBreakdown: { total: 0, completed: 0, partial: 0, abandoned: 0, unknown: 0 },
                reducedShare: 0,
                flag_skip: 0,
                missed: 1,
                unknown: 0,
                unplanned: 0,
                eligible: 10,
                adherenceRate: 0.9,
                determinableRatio: 1,
                unknownRatio: 0,
                duplicateOccurrenceIds: [],
                outcomes: [],
            },
            baseline: { provided: false, comparable: false, summary: null, reason: 'none' },
            threshold: 0.75,
            thresholdSource: 'absolute_floor',
            reasons: [],
            knownLimits: [],
        },
        c2: { status: 'pending', protocols: [], pendingDueDates: ['2027-03-26'], reasons: [], knownLimits: [] },
        c3: {
            status: 'pass',
            flaggedHardSessions: [],
            flaggedHardDays: [],
            adverseOutcomes: [],
            blindFlagDates: [],
            lastFollowUpWindowClosedAt: null,
            openWindowSessionIds: [],
            incompleteFollowUps: [],
            reasons: [],
            knownLimits: [],
        },
        c4: { status: 'pass', rollbackState: 'unused', reason: null, rollbackAtDate: null },
        meetsMinBlockDays: true,
        blockCompletedAsOfDate: true,
        overall: 'PENDING',
        reasons: [],
        knownLimits: ['No pre-block adherence baseline supplied; used 75% absolute floor (OD5).'],
        ...overrides,
    };
    return {
        input: {} as DEvalReadoutOutput['input'],
        result,
        markdown: `# ADR-0052 D-EVAL result: ${result.blockStartDate} – ${result.blockEndDate}\n- **Overall: PENDING**`,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    mocks.cursor = 0;
    mocks.cleanup = undefined;
    mocks.effectStarted = false;
    Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: mocks.writeText.mockResolvedValue(undefined) } },
        configurable: true,
    });
});

describe('DEvalReadoutSection', () => {
    it('renders collapsed by default and does not load dEvalReadoutService on mount', () => {
        const { tree, buttons, elements } = render();
        expect(tree.type).toBe('details');
        expect(tree.props.open).toBeUndefined();
        const summary = elements.find(el => el.type === 'summary');
        expect(summary?.props.children).toBe('ADR-0052 D-EVAL Block Readout (Read-only)');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]?.props.children).toBe('Run Readout');
        expect(mocks.serviceLoadCount).toBe(0);
        expect(mocks.run).not.toHaveBeenCalled();
    });

    it('lazy-loads dEvalReadoutService on Run Readout, renders verdict + Markdown, and supports download/copy', async () => {
        let resolveRun!: (value: DEvalReadoutOutput) => void;
        mocks.run.mockReturnValue(new Promise<DEvalReadoutOutput>(res => { resolveRun = res; }));

        const initial = render();
        const runBtn = initial.buttons.find(btn => btn.props.children === 'Run Readout')!;
        const inFlight = (runBtn.props.onClick as () => Promise<void>)();

        expect(render().buttons[0]?.props.disabled).toBe(true);
        expect(render().buttons[0]?.props.children).toBe('Running readout…');

        const out = sampleOutput();
        resolveRun(out);
        await inFlight;

        expect(mocks.run).toHaveBeenCalledWith('athlete-a', {
            blockStartDate: '2026-11-29',
            blockEndDate: '2026-12-26',
            asOfDate: '2026-12-26',
            rollbackState: 'unused',
            rollbackAtDate: null,
            rollbackReason: null,
        });

        const after = render();
        expect(after.buttons[0]?.props.disabled).toBe(false);
        expect(after.textareas).toHaveLength(1);
        expect(after.textareas[0]?.props.value).toBe(out.markdown);

        const copyBtn = after.buttons.find(btn => btn.props.children === 'Copy Markdown')!;
        await (copyBtn.props.onClick as () => Promise<void>)();
        expect(mocks.writeText).toHaveBeenCalledWith(out.markdown);

        const downloadBtn = render().buttons.find(btn => btn.props.children === 'Download Markdown')!;
        (downloadBtn.props.onClick as () => void)();
        expect(mocks.download).toHaveBeenCalledWith('2026-12-26', out.markdown);
    });

    it('drops the earlier verdict when a later run fails', async () => {
        mocks.run.mockResolvedValueOnce(sampleOutput());
        await (render().buttons[0]?.props.onClick as () => Promise<void>)();
        expect(render().textareas).toHaveLength(1);

        mocks.run.mockRejectedValueOnce(new Error('The D-EVAL as-of date cannot be in the future'));
        await (render().buttons[0]?.props.onClick as () => Promise<void>)();
        const failed = render();
        expect(failed.textareas).toHaveLength(0);
        expect(failed.statusNotice?.props.children).toBe('The D-EVAL as-of date cannot be in the future');
    });

    it('surfaces readout errors in a status notice and suppresses updates after unmount', async () => {
        mocks.run.mockRejectedValueOnce(new Error('Invalid D-EVAL calendar dates or blockStartDate > blockEndDate'));
        const { buttons } = render();
        await (buttons[0]?.props.onClick as () => Promise<void>)();

        const errored = render();
        expect(errored.statusNotice?.props.children).toBe('Invalid D-EVAL calendar dates or blockStartDate > blockEndDate');

        // Unmount suppression
        let resolveLate!: (value: DEvalReadoutOutput) => void;
        mocks.run.mockReturnValueOnce(new Promise<DEvalReadoutOutput>(res => { resolveLate = res; }));
        const op = (errored.buttons[0]?.props.onClick as () => Promise<void>)();
        await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
        mocks.cleanup!();
        const before = [...mocks.slots];
        resolveLate(sampleOutput());
        await op;
        expect(mocks.slots).toEqual(before);
    });
});
