import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    slots: [] as unknown[],
    cursor: 0,
    effect: null as null | (() => unknown),
    activePlan: vi.fn(),
    savePlacement: vi.fn(),
    critique: vi.fn(),
}));

// Follow the repository's hook-based interaction tests; no DOM harness is installed.
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
        const index = mocks.cursor++;
        if (!(index in mocks.slots)) mocks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        return [mocks.slots[index], (value: unknown) => {
            mocks.slots[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(mocks.slots[index]) : value;
        }];
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => unknown) => { mocks.effect ??= effect; },
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(), db: {}, auth: {} }));
vi.mock('../services/activeExternalPlanService', () => ({
    activeExternalPlanService: { getActivePlanState: mocks.activePlan },
    externalRestContextForDate: vi.fn(() => null),
}));
vi.mock('../services/externalPlanService', () => ({ externalPlanService: { savePlacement: mocks.savePlacement } }));
vi.mock('../services/fixedActivityService', () => ({ fixedActivityService: {
    getActivitiesInRangeState: vi.fn(async () => ({ status: 'AVAILABLE', data: [], revision: null })) } }));
vi.mock('../services/planBlockService', () => ({ planBlockService: {
    getBlocksInRangeState: vi.fn(async () => ({ status: 'AVAILABLE', data: [], revision: null })) } }));
vi.mock('../services/garminConnectionService', () => ({ garminConnectionService: { getConnectionState: vi.fn() } }));
vi.mock('../engine/composer', () => ({ decisionComposer: {
    composeDailyDecisionInput: vi.fn(async () => ({ recoverySnapshot: {}, subjectiveCheckin: null, activeGoals: [] })) } }));
vi.mock('../engine/safetyCheckin', () => ({
    getMinimumSafetyCheckinStatus: vi.fn(() => 'complete'),
    canGenerateNormalRecommendation: vi.fn(() => true),
}));
vi.mock('../engine/adapters', () => ({
    mapSnapshotToEngineInput: vi.fn(() => ({})), mapCheckinToSubjectiveInput: vi.fn(() => ({})),
    mapGoalsToUserEvents: vi.fn(() => []), mapContextFromGoalsAndTrainingSettings: vi.fn(() => ({})),
}));
// No prepared history snapshot keeps the engine forecast out of these placement tests.
vi.mock('../engine/trainingIntent', () => ({
    prepareTrainingHistorySnapshot: vi.fn(async () => null),
    resolveTrainingIntent: vi.fn(async () => ({ microcycle: {}, fatigue: {}, history: [], planningContext: { profile: { weeklyCommitment: 3 } } })),
}));
vi.mock('../engine/fatigue', () => ({ computeInternalResponseStrain: vi.fn(() => ({})) }));
vi.mock('../engine/planner', () => ({ generateWeekAheadPlanWithIntent: vi.fn(), trailingHistoryFromCompletedExposures: vi.fn(() => []) }));
vi.mock('../engine/periodization', () => ({ evaluatePeriodizationPhase: vi.fn() }));
vi.mock('../engine/planningMode', () => ({ resolvePlanningContext: vi.fn(() => ({ mode: 'general' })) }));
vi.mock('../engine/externalCritique', () => ({ critiqueExternalWeek: mocks.critique }));
vi.mock('./ExternalPlanWeek', () => ({ ExternalPlanWeek: () => null }));
vi.mock('./ExternalPlanImport', () => ({ ExternalPlanImport: () => null }));
vi.mock('./WeekAheadStrip', () => ({ WeekAheadStrip: () => null }));
vi.mock('./GarminSyncNowButton', () => ({ GarminSyncNowButton: () => null }));
vi.mock('./schedule/ScheduleOverlayCard', () => ({ ScheduleOverlayCard: () => null }));
vi.mock('./schedule/ScheduleWindowsCard', () => ({ ScheduleWindowsCard: () => null }));
vi.mock('./PlanAuthorityBanner', () => ({ PlanAuthorityBanner: () => null }));

import { PlanView } from './PlanView';
import { ExternalPlanWeek } from './ExternalPlanWeek';
import { PlacementOverlayRecoveryCard } from './PlacementOverlayRecoveryCard';

type Props = { children?: ReactNode; [key: string]: unknown };
function walk(node: ReactNode): ReactElement<Props>[] {
    if (!isValidElement<Props>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}
function render() {
    mocks.cursor = 0;
    return walk(PlanView({ userId: 'athlete-a' }) as ReactElement);
}
const find = (elements: ReactElement<Props>[], type: unknown) => elements.find(item => item.type === type);

const plan = { planId: 'autumn-block', revision: 2, title: 'Autumn block' };
const active = (overrides: Record<string, unknown> = {}) => ({ status: 'AVAILABLE', revision: 'r', data: {
    header: { contentHash: 'h' }, plan, placement: null, placed: [], ...overrides } });

async function mount() {
    render();
    mocks.effect!();
    // The mount effect starts loadPlanData without awaiting it; wait for the loading state to clear.
    await vi.waitFor(() => {
        if (render().some(item => item.props.className === 'plan-loading-state')) throw new Error('still loading');
    });
    return render();
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    mocks.effect = null;
    mocks.savePlacement.mockResolvedValue(undefined);
});

describe('PlanView placement overlay recovery (#1172)', () => {
    it('shows the plan at its default dates with a warning instead of failing the whole plan', async () => {
        mocks.activePlan.mockResolvedValue(active({ placementOverlayInvalid: true }));
        const elements = await mount();
        expect(mocks.activePlan).toHaveBeenCalledWith('athlete-a', expect.any(String), [], { degradeInvalidPlacement: true });
        expect(find(elements, PlacementOverlayRecoveryCard)).toBeDefined();
        // The coach-week critique would judge a placement that is not known; it is withheld.
        expect(mocks.critique).not.toHaveBeenCalled();
        expect(find(elements, ExternalPlanWeek)?.props.critique).toBeNull();
        expect(elements.some(item => item.props.className === 'plan-unavailable-card')).toBe(false);
    });

    it('resets moves by saving an empty overlay, then reloads', async () => {
        mocks.activePlan.mockResolvedValue(active({ placementOverlayInvalid: true }));
        const elements = await mount();
        mocks.activePlan.mockResolvedValue(active());
        await (find(elements, PlacementOverlayRecoveryCard)!.props.onReset as () => Promise<void>)();
        expect(mocks.savePlacement).toHaveBeenCalledWith('athlete-a', { planId: 'autumn-block', revision: 2, assignments: [] });
        expect(find(render(), PlacementOverlayRecoveryCard)).toBeUndefined();
    });

    it('leaves a failed reset to the card alert, without a second plan-week error', async () => {
        mocks.activePlan.mockResolvedValue(active({ placementOverlayInvalid: true }));
        const elements = await mount();
        mocks.savePlacement.mockRejectedValueOnce(new Error('offline'));
        await expect((find(elements, PlacementOverlayRecoveryCard)!.props.onReset as () => Promise<void>)()).rejects.toThrow('offline');
        expect(find(render(), ExternalPlanWeek)?.props.writeError).toBeNull();
    });

    it('lets a normal move proceed after the warning, replacing the unreadable moves', async () => {
        mocks.activePlan.mockResolvedValue(active({ placementOverlayInvalid: true }));
        const elements = await mount();
        await (find(elements, ExternalPlanWeek)!.props.onChooseDate as (id: string, date: string) => Promise<void>)('w1-a', '2026-08-20');
        expect(mocks.savePlacement).toHaveBeenCalledWith('athlete-a', { planId: 'autumn-block', revision: 2,
            assignments: [{ sessionId: 'w1-a', date: '2026-08-20', status: 'moved' }] });
    });

    it('shows no warning for a readable overlay', async () => {
        mocks.activePlan.mockResolvedValue(active({ placement: { assignments: [] } }));
        expect(find(await mount(), PlacementOverlayRecoveryCard)).toBeUndefined();
        expect(mocks.critique).toHaveBeenCalledTimes(1);
    });

    it('still fails closed when the plan itself is invalid', async () => {
        mocks.activePlan.mockResolvedValue({ status: 'INVALID', issues: [] });
        const elements = await mount();
        expect(find(elements, PlacementOverlayRecoveryCard)).toBeUndefined();
        expect(find(elements, ExternalPlanWeek)).toBeUndefined();
        expect(elements.some(item => item.props.className === 'plan-unavailable-card')).toBe(true);
    });
});
