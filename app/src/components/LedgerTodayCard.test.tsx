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
  ValidationError: class ExternalPlanLaunchValidationError extends Error {},
}));

// useState slot order inside LedgerTodayCard: executions, launchingKey, launchError.
const LAUNCHING_KEY_SLOT = 1;
const LAUNCH_ERROR_SLOT = 2;

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
  ExternalPlanLaunchValidationError: mocks.ValidationError,
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

  it('does not claim a rest day when the plan has no rest entry for today', () => {
    const html = renderHtml({ date: '2026-11-12', sessions: [] });
    expect(html).toContain('Nothing scheduled today');
    expect(html).toContain('No sessions are scheduled for today.');
    expect(html).not.toContain('Rest day in your plan');
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
      expect.objectContaining({ date: '2026-11-12', useReducedDefinition: true, skipEngineDurationCeiling: true }),
    );
    expect(mocks.prepare.mock.lastCall?.[2]).not.toHaveProperty('scaleVolume');
    expect(baseProps.onStartSession).toHaveBeenLastCalledWith(reducedBinding, undefined);
    // The authored Start never opts out of the ceiling.
    expect(mocks.prepare.mock.calls[0][2]).not.toHaveProperty('skipEngineDurationCeiling');
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

  it('renders a single card-level Check in first prompt for multiple sessions', () => {
    const second: PlacedSession = {
      ...placedSession,
      session: { ...baseSession, id: 'run-today', title: 'Easy Run' } as PlacedSession['session'],
    };
    const props = { todayCheckIn: null, sessions: [placedSession, second] };
    const checkinBtns = renderTree(props).filter(el => el.type === 'button' && String(el.props.children) === 'Check in first');
    expect(checkinBtns).toHaveLength(1);
    expect(renderHtml(props).match(/Check in first/g)).toHaveLength(1);
  });

  it('shows a specific non-retry message when the launch contract rejects the session', async () => {
    mocks.prepare.mockRejectedValueOnce(new mocks.ValidationError('Reduced definition must retain the authored dominant modality.'));
    const tree = renderTree();
    const reducedBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start reduced version of Lower Body Strength');
    reducedBtn!.props.onClick!();
    await vi.waitFor(() => expect(mocks.slots[LAUNCH_ERROR_SLOT]).toEqual(expect.stringContaining("retrying won't help")));
    expect(mocks.slots[LAUNCH_ERROR_SLOT]).not.toContain('Please try again');
    expect(baseProps.onStartSession).not.toHaveBeenCalled();
    expect(renderHtml()).toContain('ledger-today-error');
  });

  it('keeps the retry message for transient launch failures', async () => {
    mocks.prepare.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    const tree = renderTree();
    const startBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Start Lower Body Strength');
    startBtn!.props.onClick!();
    await vi.waitFor(() => expect(mocks.slots[LAUNCH_ERROR_SLOT]).toBe('Could not start Lower Body Strength. Please try again.'));
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

  it('surfaces a resume failure with busy state instead of an unhandled rejection', async () => {
    mocks.slots[0] = {
      'strength-today': { ...authoredBinding, state: 'in_progress' } as SessionExecution,
    };
    let rejectResume: (err: Error) => void = () => {};
    const onStartSession = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectResume = reject; }));
    const tree = renderTree({ onStartSession });
    const resumeBtn = tree.find(el => el.type === 'button' && el.props['aria-label'] === 'Resume Lower Body Strength');
    resumeBtn!.props.onClick!();
    expect(mocks.slots[LAUNCHING_KEY_SLOT]).toBe('strength-today:authored');

    rejectResume(new Error('navigation failed'));
    await vi.waitFor(() => expect(mocks.slots[LAUNCH_ERROR_SLOT]).toBe('Could not start Lower Body Strength. Please try again.'));
    expect(mocks.slots[LAUNCHING_KEY_SLOT]).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
