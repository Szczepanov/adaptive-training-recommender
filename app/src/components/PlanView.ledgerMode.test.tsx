import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    slots: [] as unknown[],
    cursor: 0,
    effect: null as null | (() => unknown),
    activePlan: vi.fn(),
    composeDailyDecisionInput: vi.fn(),
    prepareTrainingHistorySnapshot: vi.fn(),
    resolveTrainingIntent: vi.fn(),
    critiqueExternalWeek: vi.fn(),
    evaluateTrainingWithIntent: vi.fn(),
    evaluateNextDayPlanWithIntent: vi.fn(),
    generateWeekAheadPlanWithIntent: vi.fn(),
    garminConnectionState: vi.fn(),
    blocksState: vi.fn(),
}));

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
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => unknown) => { mocks.effect ??= effect; },
}));

vi.mock('../firebase', () => ({ getDb: vi.fn(), db: {}, auth: {} }));
vi.mock('../services/activeExternalPlanService', () => ({
    activeExternalPlanService: { getActivePlanState: mocks.activePlan },
    externalRestContextForDate: vi.fn(() => null),
}));
vi.mock('../services/externalPlanService', () => ({ externalPlanService: { savePlacement: vi.fn() } }));
vi.mock('../services/fixedActivityService', () => ({
    fixedActivityService: {
        getActivitiesInRangeState: vi.fn(async () => ({ status: 'AVAILABLE', data: [], revision: null })),
    },
}));
vi.mock('../services/planBlockService', () => ({
    planBlockService: { getBlocksInRangeState: mocks.blocksState },
}));
vi.mock('../services/garminConnectionService', () => ({
    garminConnectionService: { getConnectionState: mocks.garminConnectionState },
}));
vi.mock('../engine/composer', () => ({
    decisionComposer: { composeDailyDecisionInput: mocks.composeDailyDecisionInput },
}));
vi.mock('../engine/safetyCheckin', () => ({
    getMinimumSafetyCheckinStatus: vi.fn(() => 'complete'),
    canGenerateNormalRecommendation: vi.fn(() => true),
}));
vi.mock('../engine/adapters', () => ({
    mapSnapshotToEngineInput: vi.fn(() => ({})),
    mapCheckinToSubjectiveInput: vi.fn(() => ({})),
    mapGoalsToUserEvents: vi.fn(() => []),
    mapContextFromGoalsAndTrainingSettings: vi.fn(() => ({})),
}));
vi.mock('../engine/trainingIntent', () => ({
    prepareTrainingHistorySnapshot: mocks.prepareTrainingHistorySnapshot,
    resolveTrainingIntent: mocks.resolveTrainingIntent,
}));
vi.mock('../engine/fatigue', () => ({ computeInternalResponseStrain: vi.fn(() => ({})) }));
vi.mock('../engine/rules', () => ({
    evaluateTrainingWithIntent: mocks.evaluateTrainingWithIntent,
    evaluateNextDayPlanWithIntent: mocks.evaluateNextDayPlanWithIntent,
}));
vi.mock('../engine/planner', () => ({
    generateWeekAheadPlanWithIntent: mocks.generateWeekAheadPlanWithIntent,
    trailingHistoryFromCompletedExposures: vi.fn(() => []),
}));
vi.mock('../engine/periodization', () => ({ evaluatePeriodizationPhase: vi.fn() }));
vi.mock('../engine/planningMode', () => ({ resolvePlanningContext: vi.fn(() => ({ mode: 'general' })) }));
vi.mock('../engine/externalCritique', () => ({ critiqueExternalWeek: mocks.critiqueExternalWeek }));
vi.mock('./ExternalPlanWeek', () => ({ ExternalPlanWeek: () => null }));
vi.mock('./ExternalPlanImport', () => ({ ExternalPlanImport: () => null }));
vi.mock('./WeekAheadStrip', () => ({ WeekAheadStrip: () => null }));
vi.mock('./GarminSyncNowButton', () => ({ GarminSyncNowButton: () => null }));
vi.mock('./schedule/ScheduleOverlayCard', () => ({ ScheduleOverlayCard: () => null }));
vi.mock('./schedule/ScheduleWindowsCard', () => ({ ScheduleWindowsCard: () => null }));
vi.mock('./PlanAuthorityBanner', () => ({ PlanAuthorityBanner: () => null }));

import { PlanView } from './PlanView';
import { ExternalPlanWeek } from './ExternalPlanWeek';
import { ExternalPlanImport } from './ExternalPlanImport';
import { PlanAuthorityBanner } from './PlanAuthorityBanner';
import { WeekAheadStrip } from './WeekAheadStrip';

type Props = { children?: ReactNode; [key: string]: unknown };
function walk(node: ReactNode): ReactElement<Props>[] {
    if (!isValidElement<Props>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}
function render(props: Partial<Parameters<typeof PlanView>[0]> = {}) {
    mocks.cursor = 0;
    return walk(PlanView({ userId: 'athlete-a', ...props }) as ReactElement);
}
const find = (elements: ReactElement<Props>[], type: unknown) => elements.find(item => item.type === type);

const plan = { planId: 'autumn-block', revision: 2, title: 'Autumn block' };
const activePlanResponse = {
    status: 'AVAILABLE',
    revision: 'r',
    data: {
        header: { contentHash: 'h' },
        plan,
        placement: null,
        placed: [],
    },
};

function decisionInputWithPreferences(preferences: Record<string, unknown>) {
    return {
        recoverySnapshot: {},
        subjectiveCheckin: null,
        activeGoals: [],
        preferences,
    };
}

async function mount(props: Partial<Parameters<typeof PlanView>[0]> = {}) {
    render(props);
    mocks.effect!();
    await vi.waitFor(() => {
        if (render(props).some(item => item.props.className === 'plan-loading-state')) {
            throw new Error('still loading');
        }
    });
    return render(props);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.slots = [];
    mocks.effect = null;
    mocks.prepareTrainingHistorySnapshot.mockResolvedValue({ exposures: [] });
    mocks.resolveTrainingIntent.mockResolvedValue({
        microcycle: {},
        fatigue: {},
        history: [],
        planningContext: { profile: { weeklyCommitment: 3 } },
    });
    mocks.critiqueExternalWeek.mockReturnValue({ findings: [] });
    mocks.evaluateTrainingWithIntent.mockResolvedValue({
        mode: 'train',
        template: { title: 'Threshold Ride' },
        envelopes: { safety: { clinicalEscalationRequired: false } },
    });
    mocks.evaluateNextDayPlanWithIntent.mockResolvedValue({
        isSinglePlan: true,
        branches: { green: { recommendation: null } },
    });
    mocks.generateWeekAheadPlanWithIntent.mockResolvedValue({ days: [] });
    mocks.garminConnectionState.mockResolvedValue({ state: 'disconnected' });
    mocks.blocksState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
});

describe('PlanView planning authority modes (ADR-0052 Phase 2, #1167 P2-4)', () => {
    it('runs engine forecast + critique and renders ai_forecast tab and PlanAuthorityBanner in engine mode', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(decisionInputWithPreferences({ engineRecommendationsEnabled: true }));
        mocks.activePlan.mockResolvedValue(activePlanResponse);

        const elements = await mount();

        expect(mocks.evaluateTrainingWithIntent).toHaveBeenCalledTimes(1);
        expect(mocks.evaluateNextDayPlanWithIntent).toHaveBeenCalledTimes(1);
        expect(mocks.generateWeekAheadPlanWithIntent).toHaveBeenCalledTimes(1);
        expect(mocks.critiqueExternalWeek).toHaveBeenCalledTimes(1);

        expect(find(elements, PlanAuthorityBanner)).toBeDefined();
        expect(find(elements, ExternalPlanWeek)).toBeDefined();
        const tabs = elements.filter(item => item.props.role === 'tab');
        expect(tabs).toHaveLength(2);
    });

    it('hides ai_forecast tab and PlanAuthorityBanner and skips engine forecast in ledger mode when active plan exists', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(
            decisionInputWithPreferences({ engineRecommendationsEnabled: false }),
        );
        mocks.activePlan.mockResolvedValue(activePlanResponse);

        const elements = await mount();

        expect(mocks.evaluateTrainingWithIntent).not.toHaveBeenCalled();
        expect(mocks.evaluateNextDayPlanWithIntent).not.toHaveBeenCalled();
        expect(mocks.generateWeekAheadPlanWithIntent).not.toHaveBeenCalled();
        expect(mocks.resolveTrainingIntent).not.toHaveBeenCalled();
        expect(mocks.critiqueExternalWeek).not.toHaveBeenCalled();

        expect(find(elements, PlanAuthorityBanner)).toBeUndefined();
        expect(elements.filter(item => item.props.role === 'tab')).toHaveLength(0);
        expect(find(elements, ExternalPlanWeek)).toBeDefined();
        expect(find(elements, ExternalPlanWeek)?.props.critique).toBeNull();
    });

    it('renders WeekAheadStrip ledger empty state with onImportPlan when no active plan exists in ledger mode', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(
            decisionInputWithPreferences({ engineRecommendationsEnabled: false }),
        );
        mocks.activePlan.mockResolvedValue({ status: 'MISSING', data: null });

        const elements = await mount();

        expect(mocks.evaluateTrainingWithIntent).not.toHaveBeenCalled();
        expect(mocks.generateWeekAheadPlanWithIntent).not.toHaveBeenCalled();
        expect(elements.some(item => item.props.className === 'plan-evergreen-content')).toBe(false);

        const strip = find(elements, WeekAheadStrip);
        expect(strip).toBeDefined();
        expect(strip?.props.planningAuthorityMode).toBe('ledger');
        expect(strip?.props.externalPlan).toBeNull();
        expect(typeof strip?.props.onImportPlan).toBe('function');

        (strip?.props.onImportPlan as () => void)();
        const afterImportClick = render();
        expect(find(afterImportClick, ExternalPlanImport)).toBeDefined();
    });

    it('locks plan-week steps and export for a recorded red flag in ledger mode (ADR-0052 OQ2)', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue({
            ...decisionInputWithPreferences({ engineRecommendationsEnabled: false }),
            subjectiveCheckin: { redFlags: { present: true, categories: ['chest_pain'] } },
        });
        mocks.activePlan.mockResolvedValue(activePlanResponse);

        const elements = await mount();

        expect(find(elements, ExternalPlanWeek)?.props.clinicalEscalationRequired).toBe(true);
        expect(mocks.evaluateTrainingWithIntent).not.toHaveBeenCalled();
    });

    it('still shows the imported plan in ledger mode when engine-only plan blocks are unreadable', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(
            decisionInputWithPreferences({ engineRecommendationsEnabled: false }),
        );
        mocks.activePlan.mockResolvedValue(activePlanResponse);
        mocks.blocksState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read plan blocks', retryable: true });

        const elements = await mount();

        expect(find(elements, ExternalPlanWeek)).toBeDefined();
        expect(elements.some(item => item.props.className === 'plan-unavailable-card')).toBe(false);
    });

    it('keeps failing closed on unreadable plan blocks in engine mode', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(decisionInputWithPreferences({ engineRecommendationsEnabled: true }));
        mocks.activePlan.mockResolvedValue(activePlanResponse);
        mocks.blocksState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read plan blocks', retryable: true });

        const elements = await mount();

        expect(find(elements, ExternalPlanWeek)).toBeUndefined();
        expect(elements.some(item => item.props.className === 'plan-unavailable-card')).toBe(true);
        expect(mocks.evaluateTrainingWithIntent).not.toHaveBeenCalled();
    });

    it('lets the planningAuthorityMode prop override stored preferences', async () => {
        mocks.composeDailyDecisionInput.mockResolvedValue(decisionInputWithPreferences({}));
        mocks.activePlan.mockResolvedValue(activePlanResponse);

        const ledgerElements = await mount({ planningAuthorityMode: 'ledger' });
        expect(mocks.evaluateTrainingWithIntent).not.toHaveBeenCalled();
        expect(ledgerElements.filter(item => item.props.role === 'tab')).toHaveLength(0);
    });
});
