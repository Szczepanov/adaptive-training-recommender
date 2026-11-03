import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedSession } from '../../engine/externalPlacement';
import type { SessionExecution } from '../../sessions/models';
import { WorkoutExportMenu } from '../WorkoutExportMenu';
import { TodayImportedSessionsCard, type TodayImportedSessionsCardProps } from './TodayImportedSessionsCard';

const mocks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, prepare: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = value; }];
  },
  useEffect: () => {},
}));
vi.mock('../../services/sessionAuthoringService', () => ({ prepareExternalPlanSessionLaunch: mocks.prepare }));

type ElementProps = { children?: ReactNode; onClick?: () => void; 'aria-label'?: string; garminSyncDisabled?: boolean };
function walk(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}

const session: PlacedSession['session'] = {
  id: 'ride', title: 'Easy ride', priority: 'supporting',
  placement: { week: 1, flexibility: 'fixed', ifMissed: 'drop' },
  gating: { modality: 'cycling', intensity: 'easy', durationMin: 30, durationMax: 40, environment: 'indoor', equipment: [] },
  definition: { schemaVersion: 1, id: 'ride', revision: 1, title: 'Easy ride', intent: 'training', summary: 'Easy spin', blocks: [] },
};
const placed: PlacedSession = { session, date: '2026-11-03', status: 'planned', moved: false };
const binding = {
  sessionSource: { kind: 'external_plan' as const, planId: 'plan', revision: 1, sessionId: 'ride' },
  occurrenceId: 'occ-1', prescriptionHash: 'hash-1',
};
const props: TodayImportedSessionsCardProps = {
  userId: 'u1', date: placed.date, planId: 'plan', revision: 1, planTitle: 'Plan', contentHash: 'hash',
  sessions: [placed], allTodaySessions: [placed], verdictsBySessionId: { ride: 'proceed' },
  onStartSession: vi.fn(),
};

function render(overrides: Partial<TodayImportedSessionsCardProps> = {}) {
  mocks.cursor = 0;
  return walk(TodayImportedSessionsCard({ ...props, ...overrides }));
}
const launchButton = (elements: ReactElement<ElementProps>[]) => elements.find(el =>
  el.type === 'button' && /^(Start|Resume|Redo) /.test(el.props['aria-label'] ?? ''));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slots = [];
  mocks.prepare.mockResolvedValue({ binding });
});

describe('TodayImportedSessionsCard launch wiring', () => {
  it.each([undefined, 'skip', 'defer', 'advisory', 'scale', 'proceed'] as const)('gates only Garmin sync on the session verdict (%s)', decision => {
    const menu = render({ verdictsBySessionId: { ride: decision }, onStartSession: undefined })
      .find(element => element.type === WorkoutExportMenu);
    expect(menu).toBeDefined();
    expect(menu!.props.garminSyncDisabled).toBe(decision !== 'proceed');
  });

  it.each(['completed', 'in_progress', undefined] as const)('forwards the correct launch options for %s', async state => {
    if (state) mocks.slots[1] = { ride: { ...binding, state } as SessionExecution };
    const button = launchButton(render());
    expect(button).toBeDefined();
    button!.props.onClick!();
    await vi.waitFor(() => expect(props.onStartSession).toHaveBeenCalledTimes(1));
    if (state === 'completed') {
      expect(props.onStartSession).toHaveBeenCalledWith(binding, { allowDuplicateCompleted: true });
    } else if (state === 'in_progress') {
      expect(props.onStartSession).toHaveBeenCalledWith(binding);
      expect(mocks.prepare).not.toHaveBeenCalled();
    } else {
      expect(props.onStartSession).toHaveBeenCalledWith(binding, undefined);
    }
  });

  it.each(['completed', 'in_progress', undefined] as const)('withholds all launch actions without a verdict, including %s', state => {
    if (state) mocks.slots[1] = { ride: { ...binding, state } as SessionExecution };
    expect(launchButton(render({ verdictsBySessionId: {} }))).toBeUndefined();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(props.onStartSession).not.toHaveBeenCalled();
  });

  it('checks eligibility again in the launch handler', () => {
    const verdicts = { ride: 'proceed' as 'proceed' | 'skip' };
    const button = launchButton(render({ verdictsBySessionId: verdicts }));
    verdicts.ride = 'skip';
    button!.props.onClick!();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(props.onStartSession).not.toHaveBeenCalled();
  });
});
