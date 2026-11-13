import type { ActiveExternalPlan } from '../services/activeExternalPlanService';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeekAheadStrip } from './WeekAheadStrip';
import type { WeekAheadDay, WeekAheadPlan } from '../engine/planner';

function weekAheadDay(rationale: string): WeekAheadDay {
    return {
        date: '2026-09-18',
        dayOffset: 1,
        confidence: 'provisional',
        phaseName: 'Base',
        template: {
            title: 'Endurance Run',
            category: 'Aerobic',
            modality: 'Running',
            durationMin: 40,
            durationMax: 55,
        },
        mode: 'train',
        rationale,
        addressesObjectives: [],
    } as unknown as WeekAheadDay;
}

function weekAheadPlan(rationale: string): WeekAheadPlan {
    return {
        startDate: '2026-09-18',
        days: [weekAheadDay(rationale)],
        objectiveCredits: [],
        microcycleObjectives: [],
        droppedContributorObjectives: [],
        allocationReport: { outcomes: [] },
    } as unknown as WeekAheadPlan;
}

describe('WeekAheadStrip weekly role visibility', () => {
    it('summarizes planned and blocked primary-strength roles for the whole horizon', () => {
        const plan = weekAheadPlan('Easy aerobic day.');
        plan.allocationReport = {
            outcomes: [
                {
                    occurrence: { id: 'strength-0', coverageKey: 'primary_strength', label: 'Primary full-body strength' },
                    reservation: { occurrenceId: 'strength-0', nominatedDate: '2026-09-19', assignedDate: '2026-09-19', wasMoved: false },
                    status: 'fulfilled',
                },
                {
                    occurrence: { id: 'strength-1', coverageKey: 'primary_strength', label: 'Primary full-body strength' },
                    reservation: { occurrenceId: 'strength-1', nominatedDate: '2026-09-21', assignedDate: null, wasMoved: false },
                    status: 'missed',
                    reason: 'hard_safety_or_recovery',
                },
            ],
        } as WeekAheadPlan['allocationReport'];

        const html = renderToStaticMarkup(<WeekAheadStrip plan={plan} />);
        expect(html).toContain('Strength roles: 1/2 planned; 1 blocked (hard safety or recovery).');
    });

  it('does not invent a strength summary when no primary-strength role exists', () => {
        const html = renderToStaticMarkup(<WeekAheadStrip plan={weekAheadPlan('Easy aerobic day.')} />);
        expect(html).not.toContain('Strength role');
  });

  it('shows due capability maintenance and its typed block reason from the planner result', () => {
    const plan = weekAheadPlan('Easy aerobic day.');
    plan.capabilityMaintenance = {
      enabled: true,
      intervalDays: 14,
      placements: [],
      softContext: [],
      capabilities: [{
        capability: 'sport_skill',
        status: 'overdue',
        requiredStage: 4,
        fulfilment: { status: 'blocked', reason: 'modality_avoided' },
        supportWorkoutIds: [],
        message: 'overdue since 2026-09-15; blocked (modality_avoided): every otherwise eligible qualifying identity is in a training type the athlete avoids',
      }],
    };

    const html = renderToStaticMarkup(<WeekAheadStrip plan={plan} />);
    expect(html).toContain('Capability maintenance');
    expect(html).toContain('Sport skill:');
    expect(html).toContain('overdue since 2026-09-15');
    expect(html).toContain('modality_avoided');
  });

  it('labels deliberate capability suspension as intentional', () => {
    const plan = weekAheadPlan('Recovery day.');
    plan.capabilityMaintenance = {
      enabled: true,
      intervalDays: 14,
      placements: [],
      softContext: [],
      capabilities: [{
        capability: 'sport_skill',
        status: 'overdue',
        requiredStage: 4,
        fulfilment: { status: 'deliberately_suspended', reason: 'adverse_recovery' },
        supportWorkoutIds: [],
        message: 'overdue since 2026-09-15; deliberately suspended (adverse_recovery): suspended for adverse recovery',
      }],
    };

    const html = renderToStaticMarkup(<WeekAheadStrip plan={plan} />);
    expect(html).toContain('deliberately suspended');
    expect(html).toContain('adverse_recovery');
  });
});

describe('WeekAheadStrip rationale display (UX review follow-up)', () => {
    it('moves engine scoring internals into a collapsed detail instead of the visible rationale', () => {
        const html = renderToStaticMarkup(
            <WeekAheadStrip
                plan={weekAheadPlan(
                    'Base phase. Coverage tier: 1. Benefit score: 1.27, Fatigue cost penalty: 1.30. (Advances an explicit required weekly programming role.) (Sequence intent: recondition/spread, preferred key gap 2d.)',
                )}
            />,
        );

        const rationaleMatch = html.match(/<p class="detail-rationale">(.*?)<\/p>/);
        const technicalDetailsMatch = html.match(/<details class="detail-rationale-technical"([^>]*)>([\s\S]*?)<\/details>/);

        expect(rationaleMatch?.[1]).toBe('Base phase.');
        expect(rationaleMatch?.[1]).not.toContain('Coverage tier');
        expect(rationaleMatch?.[1]).not.toContain('Sequence intent');
        expect(technicalDetailsMatch?.[1]).toBe('');
        expect(technicalDetailsMatch?.[2]).toContain('Engine scoring telemetry');
        expect(technicalDetailsMatch?.[2]).toContain('Coverage tier: 1. Benefit score: 1.27, Fatigue cost penalty: 1.30.');
        expect(technicalDetailsMatch?.[2]).toContain('Sequence intent: recondition/spread, preferred key gap 2d.');
    });

    it('renders a plain rationale with no technical-detail disclosure at all', () => {
        const html = renderToStaticMarkup(<WeekAheadStrip plan={weekAheadPlan('Recovery day after yesterday\'s long run.')} />);

        expect(html).toContain('<p class="detail-rationale">Recovery day after yesterday&#x27;s long run.</p>');
        expect(html).not.toContain('Engine scoring telemetry');
        expect(html).not.toContain('detail-rationale-technical');
    });
});


describe('WeekAheadStrip clipped role reporting (#933)', () => {
  it('visibly reports a role packed after the strip without calling it blocked or unresolved', () => {
    const plan = weekAheadPlan('Easy aerobic day.');
    plan.allocationReport.outcomes = [{
      occurrence: { id: 'evergreen@transition|strength', coverageKey: 'primary_strength',
        label: 'Primary full-body strength', plannedDate: '2026-09-25' },
      reservation: { occurrenceId: 'evergreen@transition|strength', nominatedDate: '2026-09-25',
        assignedDate: null, wasMoved: false }, status: 'planned_beyond_horizon',
    }] as WeekAheadPlan['allocationReport']['outcomes'];
    const html = renderToStaticMarkup(<WeekAheadStrip plan={plan} />);
    expect(html).toContain('Planned beyond this forecast');
    expect(html).toContain('Primary full-body strength (2026-09-25)');
    expect(html).toContain('1 planned beyond this forecast');
    expect(html).toContain('Strength role: 1/1 planned');
    expect(html).not.toContain('1 blocked');
    expect(html).not.toContain('1 still unresolved');
  });
});

describe('WeekAheadStrip imported plan Today + Next 7 Days multi-session view', () => {
  const sampleExternalPlan = {
    header: {
      userId: 'u1',
      planId: 'hybrid-block',
      revision: 2,
      title: 'Hybrid Build Block',
      startDate: '2026-09-14',
      weekCount: 2,
      contentHash: 'hash-2',
      importedAt: '2026-09-14T08:00:00Z',
    },
    plan: {
      schema: 'adaptive-training-recommender/external-plan@4',
      planId: 'hybrid-block',
      revision: 2,
      title: 'Hybrid Build Block',
      startDate: '2026-09-14',
      weekCount: 2,
      restDays: [{ id: 'rest-fri', week: 1, day: 'friday' }],
      sessions: [],
    },
    placement: null,
    placed: [
      {
        session: {
          id: 'mon-am-bike',
          title: 'Morning Threshold Ride',
          priority: 'key',
          placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed' },
          gating: { modality: 'cycling', intensity: 'hard', durationMin: 50, durationMax: 65, environment: 'indoor', equipment: ['indoor_bike'] },
          intraday: { bundleId: 'mon-bundle', order: 1, window: { startLocal: '07:00', endLocal: '08:15' } },
          prescription: {
            summary: '3x10 min threshold intervals.',
            steps: [{ name: 'Threshold set', durationMin: 10, sets: 3, target: '95-100% FTP' }],
          },
        },
        date: '2026-09-14',
        status: 'planned',
        moved: false,
      },
      {
        session: {
          id: 'mon-pm-lift',
          title: 'Evening Lower Strength',
          priority: 'supporting',
          placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed' },
          gating: { modality: 'strength', intensity: 'moderate', durationMin: 35, durationMax: 45, environment: 'indoor', equipment: ['barbell'] },
          intraday: { bundleId: 'mon-bundle', order: 2, window: { startLocal: '17:30', endLocal: '18:30' } },
          prescription: {
            summary: 'Trap-bar deadlift and split squats.',
            steps: [{ name: 'Trap-bar deadlift', sets: 4, repeat: 5, target: 'RPE 7.5' }],
          },
          scaling: {
            reducible: true,
            reducedSummary: 'Cut to 2 working sets per lift.',
          },
        },
        date: '2026-09-14',
        status: 'planned',
        moved: false,
      },
      {
        session: {
          id: 'tue-z2',
          title: 'Easy Aerobic Spin',
          priority: 'optional',
          placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred' },
          gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
          prescription: { summary: 'Steady Zone 2 recovery spin.' },
        },
        date: '2026-09-15',
        status: 'planned',
        moved: false,
      },
    ],
  } as unknown as NonNullable<Parameters<typeof WeekAheadStrip>[0]['externalPlan']>;

  it('renders Today and next 7 days from the imported plan with multi-session tiles and details', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={null}
        externalPlan={sampleExternalPlan}
        today="2026-09-14"
        userId="u1"
      />,
    );

    expect(html).toContain('Today &amp; Next 7 Days · Hybrid Build Block');
    expect(html).toContain('Imported plan schedule (r2)');
    expect(html).toContain('Today (Mon)');
    expect(html).toContain('Tomorrow (Tue)');
    // Multi-session tile for Today (2 sessions, combined 85-110 m)
    expect(html).toContain('2 sessions');
    expect(html).toContain('85-110 m');
    // Selected day (Today by default) lists both sessions in detail
    expect(html).toContain('2 Sessions Planned');
    expect(html).toContain('Session 1 of 2');
    expect(html).toContain('07:00–08:15');
    expect(html).toContain('Morning Threshold Ride');
    expect(html).toContain('3x10 min threshold intervals.');
    expect(html).toContain('Session 2 of 2');
    expect(html).toContain('17:30–18:30');
    expect(html).toContain('Evening Lower Strength');
    expect(html).toContain('Trap-bar deadlift and split squats.');
    expect(html).toContain('Cut to 2 working sets per lift.');
    // Friday (2026-09-18) is an authored rest day in the 8-day strip
    expect(html).toContain('Authored');
  });

  it('withholds workout steps and export menu when clinicalEscalationRequired is true', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={null}
        externalPlan={sampleExternalPlan}
        today="2026-09-14"
        userId="u1"
        clinicalEscalationRequired={true}
      />,
    );

    expect(html).toContain('Morning Threshold Ride');
    expect(html).toContain('Evening Lower Strength');
    expect(html).not.toContain('95-100% FTP');
    expect(html).not.toContain('Workout steps');
  });

  it('renders imported placements in ledger mode even if an engine plan is also supplied', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={weekAheadPlan('Engine forecast should not render.')}
        externalPlan={sampleExternalPlan}
        today="2026-09-14"
        userId="u1"
        planningAuthorityMode="ledger"
      />,
    );

    expect(html).toContain('Today &amp; Next 7 Days · Hybrid Build Block');
    expect(html).toContain('Morning Threshold Ride');
    expect(html).not.toContain('Recalculates daily as your data changes');
    expect(html).not.toContain('Engine forecast should not render.');
  });
});

describe('WeekAheadStrip planningAuthorityMode (ADR-0052 Phase 2, #1167 P2-4)', () => {
  it('renders the engine WeekAheadPlan in engine mode when no external plan is active', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={weekAheadPlan('Easy aerobic day.')}
        externalPlan={null}
        planningAuthorityMode="engine"
      />,
    );

    expect(html).toContain('Next 7 Days');
    expect(html).toContain('Recalculates daily as your data changes');
    expect(html).toContain('Easy aerobic day.');
    expect(html).not.toContain('No imported plan');
  });

  it('never renders the engine WeekAheadPlan in ledger mode and shows an empty state with import link', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={weekAheadPlan('Engine forecast should never appear in ledger mode.')}
        externalPlan={null}
        planningAuthorityMode="ledger"
        onImportPlan={() => {}}
      />,
    );

    expect(html).toContain('No imported plan');
    expect(html).toContain('No active training plan is imported.');
    expect(html).toContain('Import a training plan');
    expect(html).not.toContain('Recalculates daily as your data changes');
    expect(html).not.toContain('Engine forecast should never appear in ledger mode.');
  });

  it('renders nothing in ledger mode while an imported plan waits for today to resolve', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={null}
        externalPlan={{ plan: { planId: 'p', revision: 1 }, placed: [] } as unknown as ActiveExternalPlan}
        planningAuthorityMode="ledger"
        onImportPlan={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('renders an honest empty state in ledger mode even without onImportPlan', () => {
    const html = renderToStaticMarkup(
      <WeekAheadStrip
        plan={null}
        externalPlan={null}
        planningAuthorityMode="ledger"
      />,
    );

    expect(html).toContain('No imported plan');
    expect(html).toContain('Open Plan to import a coach or AI plan');
  });
});
