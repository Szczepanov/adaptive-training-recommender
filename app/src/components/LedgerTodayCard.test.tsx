import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedSession } from '../engine/externalPlacement';
import type { DailySubjectiveCheckin } from '../ledger/models';
import type { ActiveExternalPlan } from '../services/activeExternalPlanService';
import type { SessionExecution } from '../sessions/models';
import { hasRecordedRedFlag } from '../ledger/redFlagPause';
import { LedgerTodayCard, type LedgerTodayCardProps } from './LedgerTodayCard';

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  prepare: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = value; }];
  },
  useEffect: () => {},
}));

vi.mock('../services/sessionAuthoringService', () => ({
  prepareExternalPlanSessionLaunch: mocks.prepare,
}));

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  role?: string;
};

function walk(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}

const baseSession: PlacedSession['session'] = {
  id: 'strength-today',
  title: 'Lower Body Strength',
  priority: 'key',
  placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' },
  gating: { modality: 'strength', intensity: 'moderate', durationMin: 40, durationMax: 55, environment: 'indoor', equipment: ['barbell'] },
  intraday: { bundleId: 'mon-bundle', order: 1, window: { startLocal: '07:00', endLocal: '08:30' } },
  definition: {
    schemaVersion: 1,
    id: 'strength-today',
    revision: 1,
    title: 'Lower Body Strength',
    summary: '4x5 squat and accessory work.',
    intent: 'training',
    dominantModality: 'strength',
    duration: { min: 40, max: 55 },
    blocks: [],
  },
  scaling: {
    reducible: true,
    reducedSummary: 'Cut to 2 working sets.',
    reducedDefinition: {
      schemaVersion: 1,
      id: 'strength-today',
      revision: 1,
      title: 'Lower Body Strength (Reduced)',
      summary: '2x5 squat maintenance.',
      intent: 'training',
      dominantModality: 'strength',
      duration: { min: 20, max: 30 },
      blocks: [],
    },
  },
} as unknown as PlacedSession['session'];

const placedSession: PlacedSession = {
  session: baseSession,
  date: '2026-11-12',
  status: 'planned',
  moved: false,
};

const activePlan: ActiveExternalPlan = {
  header: {
    userId: 'u1',
    planId: 'plan-1',
    revision: 2,
    title: 'Winter Base',
    startDate: '2026-11-09',
    weekCount: 4,
    contentHash: 'hash-1',
    importedAt: '2026-11-09T06:00:00.000Z',
    supersededFrom: null,
    updatedAt: '2026-11-09T06:00:00.000Z',
  },
  plan: {
    schema: 'adaptive-training-recommender/external-plan@6',
    planId: 'plan-1',
    revision: 2,
    title: 'Winter Base',
    startDate: '2026-11-09',
    weekCount: 4,
    restDays: [{ id: 'rest-sun', week: 1, day: 'sunday' }],
    sessions: [baseSession],
  } as unknown as ActiveExternalPlan['plan'],
  placement: null,
  placed: [placedSession],
};

const okCheckin: DailySubjectiveCheckin = {
  userId: 'u1',
  date: '2026-11-12',
  readiness: 7,
  sleepQuality: 7,
  fatigue: 4,
  soreness: 4,
  mentalStress: 3,
  motivation: 8,
  painOrInjury: false,
  illnessSymptoms: false,
  unusuallyLimitedTime: false,
  alreadyTrainedToday: false,
  availability: { timeAvailableMin: 90, preferredModalityToday: 'Any', indoorOnly: false },
  notes: null,
  submittedAt: '2026-11-12T06:30:00.000Z',
  dataQuality: { isComplete: true, missingFields: [] },
  schemaVersion: 1,
  createdAt: '2026-11-12T06:30:00.000Z',
  updatedAt: '2026-11-12T06:30:00.000Z',
};

const authoredBinding = {
  sessionSource: { kind: 'external_plan' as const, planId: 'plan-1', revision: 2, sessionId: 'strength-today' },
  occurrenceId: 'occ-1',
  prescriptionHash: 'hash-authored',
  executedDefinition: 'authored' as const,
};

const reducedBinding = {
  sessionSource: { kind: 'external_plan' as const, planId: 'plan-1', revision: 2, sessionId: 'strength-today' },
  occurrenceId: 'occ-1',
  prescriptionHash: 'hash-reduced',
  executedDefinition: 'reduced' as const,
};

const baseProps: LedgerTodayCardProps = {
  userId: 'u1',
  date: '2026-11-12',
  activeExternalPlan: activePlan,
  sessions: [placedSession],
  todayCheckIn: okCheckin,
  onNavigate: vi.fn(),
  onStartSession: vi.fn(),
};

function renderTree(overrides: Partial<LedgerTodayCardProps> = {}) {
  mocks.cursor = 0;
  return walk(LedgerTodayCard({ ...baseProps, ...overrides }));
}

function renderHtml(overrides: Partial<LedgerTodayCardProps> = {}) {
  mocks.cursor = 0;
  return renderToStaticMarkup(<LedgerTodayCard {...baseProps} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slots = [];
  mocks.prepare.mockResolvedValue({ binding: authoredBinding });
});

describe('LedgerTodayCard', () => {
  it('renders an honest empty state when no active imported plan exists', () => {
    const html = renderHtml({ activeExternalPlan: null, sessions: [] });
    expect(html).toContain('No imported plan — import one');

    const tree = renderTree({ activeExternalPlan: null, sessions: [] });
    const navBtn = tree.find(el => el.type === 'button');
    expect(navBtn).toBeDefined();
    navBtn!.props.onClick!();
    expect(baseProps.onNavigate).toHaveBeenCalledWith('plan');
  });

  it('renders a rest-day empty state when today has no planned sessions', () => {
    const html = renderHtml({ date: '2026-11-15', sessions: [] });
    expect(html).toContain('Rest day in your plan');
    expect(html).toContain('Scheduled rest day in your plan.');

    const tree = renderTree({ date: '2026-11-15', sessions: [] });
    const navBtn = tree.find(el => el.type === 'button');
    navBtn!.props.onClick!();
    expect(baseProps.onNavigate).toHaveBeenCalledWith('plan');
  });

  it('renders today session authored dose, placement, Start, and Start reduced version', () => {
    const html = renderHtml();
    expect(html).toContain('Lower Body Strength');
    expect(html).toContain('07:00–08:30');
    expect(html).toContain('4x5 squat and accessory work.');
    expect(html).toContain('Start Lower Body Strength');
    expect(html).toContain('Start reduced version');
    expect(html).not.toContain('Check in first');
  });

  it('launches authored definition by default on Start and reduced definition only on explicit choice', async () => {
    const tree = renderTree();
    const startBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start Lower Body Strength');
    const reducedBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start reduced version of Lower Body Strength');
    expect(startBtn).toBeDefined();
    expect(reducedBtn).toBeDefined();

    startBtn!.props.onClick!();
    await vi.waitFor(() => expect(baseProps.onStartSession).toHaveBeenCalledTimes(1));
    expect(mocks.prepare).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ planId: 'plan-1', revision: 2 }),
      expect.objectContaining({ date: '2026-11-12', useReducedDefinition: false }),
    );
    expect(baseProps.onStartSession).toHaveBeenCalledWith(authoredBinding, undefined);

    mocks.prepare.mockResolvedValueOnce({ binding: reducedBinding });
    reducedBtn!.props.onClick!();
    await vi.waitFor(() => expect(baseProps.onStartSession).toHaveBeenCalledTimes(2));
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      'u1',
      expect.objectContaining({ planId: 'plan-1', revision: 2 }),
      expect.objectContaining({ date: '2026-11-12', useReducedDefinition: true, scaleVolume: 1 }),
    );
    expect(baseProps.onStartSession).toHaveBeenLastCalledWith(reducedBinding, undefined);
  });

  it('shows a non-blocking Check in first prompt when todayCheckIn is missing while keeping Start enabled', async () => {
    const tree = renderTree({ todayCheckIn: null });
    const checkinBtn = tree.find(el => el.type === 'button' && String(el.props.children) === 'Check in first');
    const startBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start Lower Body Strength');
    expect(checkinBtn).toBeDefined();
    expect(startBtn).toBeDefined();

    checkinBtn!.props.onClick!();
    expect(baseProps.onNavigate).toHaveBeenCalledWith('checkin');

    startBtn!.props.onClick!();
    await vi.waitFor(() => expect(baseProps.onStartSession).toHaveBeenCalledTimes(1));
  });

  it('pauses launch and hides Start/Start reduced buttons when todayCheckIn has red flags', () => {
    const redFlagCheckin: DailySubjectiveCheckin = {
      ...okCheckin,
      redFlags: { present: true, categories: ['neurological'] },
    };
    const html = renderHtml({ todayCheckIn: redFlagCheckin });
    expect(html).toContain('Training paused for clinical evaluation');
    expect(html).not.toContain('Start Lower Body Strength');
    expect(html).not.toContain('Start reduced version');

    const tree = renderTree({ todayCheckIn: redFlagCheckin });
    const buttons = tree.filter(el => el.type === 'button');
    expect(buttons).toHaveLength(0);
  });

  it('detects both explicit redFlags and severe systemic fever_or_chills', () => {
    expect(hasRecordedRedFlag(null)).toBe(false);
    expect(hasRecordedRedFlag(okCheckin)).toBe(false);
    expect(hasRecordedRedFlag({ ...okCheckin, redFlags: { present: true } })).toBe(true);
    expect(hasRecordedRedFlag({
      ...okCheckin,
      healthContext: { symptoms: { present: true, severity: 'severe', types: ['fever_or_chills'] } },
    })).toBe(true);
  });

  it('resumes in_progress execution without calling prepareExternalPlanSessionLaunch and passes allowDuplicateCompleted for completed', async () => {
    mocks.slots[0] = {
      'strength-today': {
        ...authoredBinding,
        state: 'in_progress',
      } as SessionExecution,
    };
    const inProgressTree = renderTree();
    const resumeBtn = inProgressTree.find(el => el.type === 'button' && el.props['aria-label'] === 'Resume Lower Body Strength');
    expect(resumeBtn).toBeDefined();
    expect(inProgressTree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start reduced version of Lower Body Strength')).toBeUndefined();

    resumeBtn!.props.onClick!();
    await vi.waitFor(() => expect(baseProps.onStartSession).toHaveBeenCalledTimes(1));
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.slots[0] = {
      'strength-today': {
        ...authoredBinding,
        state: 'completed',
      } as SessionExecution,
    };
    const completedTree = renderTree();
    const redoBtn = completedTree.find(el => el.type === 'button' && el.props['aria-label'] === 'Redo Lower Body Strength');
    expect(redoBtn).toBeDefined();
    redoBtn!.props.onClick!();
    await vi.waitFor(() => expect(baseProps.onStartSession).toHaveBeenCalledTimes(2));
    expect(baseProps.onStartSession).toHaveBeenLastCalledWith(authoredBinding, { allowDuplicateCompleted: true });
  });
});
