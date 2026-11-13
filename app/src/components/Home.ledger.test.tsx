import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposedDailyDecisionInput } from '../engine/composer';
import type { ActiveExternalPlan } from '../services/activeExternalPlanService';
import { Home } from './Home';
import { LedgerTodayCard } from './LedgerTodayCard';
import { MorningDecisionCard } from './MorningDecisionCard';
import { TodayImportedSessionsCard } from './session/TodayImportedSessionsCard';
import { DecisionJournalCard } from './DecisionJournalCard';
import { MinimumSafetyCheckin } from './MinimumSafetyCheckin';
import { WeekAheadStrip } from './WeekAheadStrip';

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => unknown>,
  composeDailyDecisionInput: vi.fn(),
  getActivePlanState: vi.fn(),
  getActivitiesInRangeState: vi.fn(),
  getConnectionState: vi.fn(),
  evaluateSameDayRecommendation: vi.fn(),
  evaluateReadinessAndSafetyEnvelope: vi.fn(),
  evaluateNextDayPlanWithIntent: vi.fn(),
  adjustSessionRecommendation: vi.fn(),
  generateWeekAheadPlanWithIntent: vi.fn(),
  saveRecommendation: vi.fn(),
  saveNotApplicableContext: vi.fn(),
  getRecommendation: vi.fn(),
  getJournalEntry: vi.fn(),
  recordActualVerdict: vi.fn(),
  assembleMorningDecisionEvidence: vi.fn(),
  replayRecommendationAuditAgainstSessions: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) {
      mocks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    }
    return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) mocks.slots[index] = { current: initial };
    return mocks.slots[index];
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => unknown) => {
    mocks.effects.push(fn);
  },
}));

vi.mock('../engine/composer', () => ({
  decisionComposer: { composeDailyDecisionInput: mocks.composeDailyDecisionInput },
}));
vi.mock('../engine/sameDayRecommendation', () => ({
  evaluateSameDayRecommendation: mocks.evaluateSameDayRecommendation,
}));
vi.mock('../engine/rules', () => ({
  evaluateNextDayPlanWithIntent: mocks.evaluateNextDayPlanWithIntent,
  adjustSessionRecommendation: mocks.adjustSessionRecommendation,
  evaluateReadinessAndSafetyEnvelope: mocks.evaluateReadinessAndSafetyEnvelope,
}));
vi.mock('../engine/planner', () => ({
  generateWeekAheadPlanWithIntent: mocks.generateWeekAheadPlanWithIntent,
}));
vi.mock('../engine/decisionEvidence', () => ({
  assembleMorningDecisionEvidence: mocks.assembleMorningDecisionEvidence,
}));
vi.mock('../engine/replay', () => ({
  replayRecommendationAuditAgainstSessions: mocks.replayRecommendationAuditAgainstSessions,
}));
vi.mock('../services/recommendationService', () => ({
  recommendationService: {
    saveRecommendation: mocks.saveRecommendation,
    saveNotApplicableContext: mocks.saveNotApplicableContext,
    getRecommendation: mocks.getRecommendation,
  },
}));
vi.mock('../services/decisionJournalService', () => ({
  decisionJournalService: {
    getEntry: mocks.getJournalEntry,
    recordActualVerdict: mocks.recordActualVerdict,
  },
}));
vi.mock('../services/activeExternalPlanService', async importOriginal => ({
  ...await importOriginal<typeof import('../services/activeExternalPlanService')>(),
  activeExternalPlanService: {
    getActivePlanState: mocks.getActivePlanState,
  },
}));
vi.mock('../services/fixedActivityService', () => ({
  fixedActivityService: {
    getActivitiesInRangeState: mocks.getActivitiesInRangeState,
    getActivitiesInRange: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../services/garminConnectionService', () => ({
  garminConnectionService: { getConnectionState: mocks.getConnectionState },
}));
vi.mock('../services/recoverySnapshotService', () => ({
  recoverySnapshotService: { getRecoverySnapshotState: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
}));
vi.mock('../services/planBlockService', () => ({
  planBlockService: { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null }) },
}));
vi.mock('../services/intentBlockService', () => ({
  intentBlockService: {
    getActiveBlocksWithDiagnostics: vi.fn().mockResolvedValue({ blocks: [], truncated: false, unreadableCount: 0 }),
  },
}));
vi.mock('../services/activityOverrideService', () => ({
  activityOverrideService: { getAllOverrides: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../services/activityService', () => ({
  activityService: { getActivitiesInRange: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
}));
vi.mock('../services/checkinService', () => ({
  checkinService: { getCheckin: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../services/sessionExecutionService', () => ({
  sessionExecutionService: { getExecutionsInRange: vi.fn().mockResolvedValue({ executions: [] }) },
}));
vi.mock('../hooks/useAutoGarminSync', () => ({
  useAutoGarminSync: () => {},
}));

function walk(node: ReactNode): ReactElement[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}

const ledgerDecisionInput: ComposedDailyDecisionInput = {
  userId: 'u1',
  date: '2026-11-12',
  recoverySnapshot: null,
  subjectiveCheckin: null,
  activeGoals: [],
  trainingSettings: {
    userId: 'u1',
    equipment: {},
    guardrails: {},
    defaults: { environment: 'either' },
    injuryConstraints: [],
    updatedAt: '2026-11-12T06:00:00.000Z',
  },
  preferences: {
    userId: 'u1',
    engineRecommendationsEnabled: false,
    shadowModeEnabled: true,
    updatedAt: '2026-11-12T06:00:00.000Z',
  },
  dataQuality: {
    hasRecoverySnapshot: false,
    hasSubjectiveCheckin: false,
    subjectiveCheckinComplete: false,
    profileReady: true,
  },
  dataConfidence: {
    level: 'limited',
    reasons: [],
  },
  sourceStates: undefined,
} as unknown as ComposedDailyDecisionInput;

const activePlan: ActiveExternalPlan = {
  header: {
    userId: 'u1',
    planId: 'plan-1',
    revision: 1,
    title: 'Ledger Plan',
    startDate: '2026-11-09',
    weekCount: 2,
    contentHash: 'hash-1',
    importedAt: '2026-11-09T06:00:00.000Z',
    supersededFrom: null,
    updatedAt: '2026-11-09T06:00:00.000Z',
  },
  plan: {
    schema: 'adaptive-training-recommender/external-plan@6',
    planId: 'plan-1',
    revision: 1,
    title: 'Ledger Plan',
    startDate: '2026-11-09',
    weekCount: 2,
    restDays: [],
    sessions: [],
  } as unknown as ActiveExternalPlan['plan'],
  placement: null,
  placed: [],
};

function renderHome() {
  mocks.cursor = 0;
  mocks.effects = [];
  return walk(Home({ userId: 'u1', onNavigate: vi.fn() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slots = [];
  mocks.effects = [];
  mocks.composeDailyDecisionInput.mockResolvedValue(ledgerDecisionInput);
  mocks.getActivePlanState.mockResolvedValue({ status: 'AVAILABLE', data: activePlan, revision: null });
  mocks.getActivitiesInRangeState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
  mocks.getConnectionState.mockResolvedValue({ state: 'disconnected' });
});

describe('Home in ledger mode', () => {
  it('skips all engine evaluations, recommendation writes, and shadow/journal runs, and renders LedgerTodayCard', async () => {
    renderHome();
    // Run initial loadDashboardData effect and flush async load
    for (const effect of mocks.effects) {
      effect();
    }
    await vi.waitFor(() => expect(mocks.getActivePlanState).toHaveBeenCalledTimes(1));

    const tree = renderHome();
    for (const effect of mocks.effects) {
      effect();
    }

    expect(tree.some(el => el.type === LedgerTodayCard)).toBe(true);
    expect(tree.some(el => el.type === MorningDecisionCard)).toBe(false);
    expect(tree.some(el => el.type === TodayImportedSessionsCard)).toBe(false);
    expect(tree.some(el => el.type === DecisionJournalCard)).toBe(false);
    expect(tree.some(el => el.type === MinimumSafetyCheckin)).toBe(false);

    expect(mocks.evaluateSameDayRecommendation).not.toHaveBeenCalled();
    expect(mocks.evaluateReadinessAndSafetyEnvelope).not.toHaveBeenCalled();
    expect(mocks.evaluateNextDayPlanWithIntent).not.toHaveBeenCalled();
    expect(mocks.adjustSessionRecommendation).not.toHaveBeenCalled();
    expect(mocks.generateWeekAheadPlanWithIntent).not.toHaveBeenCalled();
    expect(mocks.saveRecommendation).not.toHaveBeenCalled();
    expect(mocks.saveNotApplicableContext).not.toHaveBeenCalled();
    expect(mocks.getRecommendation).not.toHaveBeenCalled();
    expect(mocks.getJournalEntry).not.toHaveBeenCalled();
    expect(mocks.recordActualVerdict).not.toHaveBeenCalled();
    expect(mocks.assembleMorningDecisionEvidence).not.toHaveBeenCalled();
    expect(mocks.replayRecommendationAuditAgainstSessions).not.toHaveBeenCalled();
  });

  describe('engine recovery/sync gates do not block the imported plan (#1247 review)', () => {
    const todaySession = {
      id: 'run-today',
      title: 'Easy Run',
      priority: 'key',
      placement: { week: 1, preferredDay: 'thursday', flexibility: 'fixed', ifMissed: 'drop' },
      gating: { modality: 'running', intensity: 'easy', durationMin: 30, durationMax: 40, environment: 'outdoor', equipment: [] },
    };
    const planWithToday: ActiveExternalPlan = {
      ...activePlan,
      placed: [{ session: todaySession, date: '2026-11-12', status: 'planned', moved: false }],
    } as unknown as ActiveExternalPlan;

    async function loadLedgerHome() {
      renderHome();
      for (const effect of mocks.effects) effect();
      await vi.waitFor(() => expect(mocks.getActivePlanState).toHaveBeenCalledTimes(1));
      // Let the remainder of loadDashboardData settle after the plan read.
      await new Promise(resolve => setTimeout(resolve, 0));
      return renderHome();
    }

    function expectLedgerCardWithTodayPlan(tree: ReactElement[]) {
      const card = tree.find(el => el.type === LedgerTodayCard) as ReactElement<{ activeExternalPlan: unknown; sessions: Array<{ session: { id: string } }> }> | undefined;
      expect(card).toBeDefined();
      expect(card!.props.activeExternalPlan).toBe(planWithToday);
      expect(card!.props.sessions.map(item => item.session.id)).toEqual(['run-today']);
      expect(tree.some(el => (el.props as { className?: string }).className === 'error-state dashboard-inline-error')).toBe(false);
    }

    beforeEach(() => {
      mocks.getActivePlanState.mockResolvedValue({ status: 'AVAILABLE', data: planWithToday, revision: null });
    });

    it('loads the plan for a connected Garmin user whose snapshot is missing', async () => {
      mocks.getConnectionState.mockResolvedValue({ state: 'connected' });
      mocks.composeDailyDecisionInput.mockResolvedValue({
        ...ledgerDecisionInput,
        sourceStates: { recoverySnapshot: { status: 'MISSING' } },
      });

      expectLedgerCardWithTodayPlan(await loadLedgerHome());
      expect(mocks.getConnectionState).not.toHaveBeenCalled();
    });

    it.each(['UNAVAILABLE', 'INVALID'] as const)('loads the plan when the recovery snapshot is %s', async status => {
      mocks.getConnectionState.mockResolvedValue({ state: 'connected' });
      mocks.composeDailyDecisionInput.mockResolvedValue({
        ...ledgerDecisionInput,
        sourceStates: { recoverySnapshot: { status } },
      });

      expectLedgerCardWithTodayPlan(await loadLedgerHome());
    });
  });

  it('hides the engine check-in gate banner (OQ3: prompt, not a gate)', async () => {
    renderHome();
    for (const effect of mocks.effects) effect();
    await vi.waitFor(() => expect(mocks.getActivePlanState).toHaveBeenCalledTimes(1));
    const tree = renderHome();
    expect(tree.some(el => (el.props as { className?: string }).className === 'checkin-action-gate-card')).toBe(false);
  });

  it('passes the recorded check-in red flag to the outlook strip', async () => {
    mocks.composeDailyDecisionInput.mockResolvedValue({
      ...ledgerDecisionInput,
      subjectiveCheckin: { userId: 'u1', date: '2026-11-12', redFlags: { present: true, categories: ['neurological'] } },
      dataQuality: { ...ledgerDecisionInput.dataQuality, hasSubjectiveCheckin: true },
    });
    renderHome();
    for (const effect of mocks.effects) effect();
    await vi.waitFor(() => expect(mocks.getActivePlanState).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    const tree = renderHome();
    const strip = tree.find(el => el.type === WeekAheadStrip) as ReactElement<{ clinicalEscalationRequired?: boolean; planningAuthorityMode?: string }> | undefined;
    expect(strip).toBeDefined();
    expect(strip!.props.clinicalEscalationRequired).toBe(true);
    expect(strip!.props.planningAuthorityMode).toBe('ledger');
  });

  it('hides the empty 7-Day Outlook section when no imported plan is active', async () => {
    mocks.getActivePlanState.mockResolvedValue({ status: 'MISSING' });
    renderHome();
    for (const effect of mocks.effects) effect();
    await vi.waitFor(() => expect(mocks.getActivePlanState).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    const tree = renderHome();
    expect(tree.some(el => el.type === LedgerTodayCard)).toBe(true);
    expect(tree.some(el => el.type === WeekAheadStrip)).toBe(false);
    expect(tree.some(el => (el.props as { className?: string }).className === 'home-week-strip-section')).toBe(false);
  });
});
