import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlacedSession } from '../../engine/externalPlacement';
import { TodayImportedSessionsCard } from './TodayImportedSessionsCard';

const sampleSessions: PlacedSession[] = [
  {
    session: {
      id: 'am-ride',
      title: 'Morning Threshold Intervals',
      priority: 'key',
      placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'reschedule_within_week' },
      gating: { modality: 'cycling', intensity: 'hard', durationMin: 55, durationMax: 70, environment: 'indoor', equipment: ['indoor_bike'] },
      intraday: { bundleId: 'mon-bundle', order: 1, window: { startLocal: '07:00', endLocal: '08:15' } },
      definition: {
        id: 'am-ride',
        title: 'Morning Threshold Intervals',
        summary: '3x10 min at 95-100% FTP.',
        modality: 'cycling',
        intensity: 'hard',
        duration: { min: 55, max: 70 },
        blocks: [
          {
            id: 'b1',
            name: 'Main Set',
            steps: [{ id: 's1', label: 'Threshold 10 min', dose: { kind: 'duration', seconds: { min: 600, max: 600 }, sets: 3 } }],
          },
        ],
      },
    } as unknown as PlacedSession['session'],
    date: '2026-09-14',
    status: 'planned',
    moved: false,
  },
  {
    session: {
      id: 'pm-strength',
      title: 'Evening Lower Strength',
      priority: 'supporting',
      placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' },
      gating: { modality: 'strength', intensity: 'moderate', durationMin: 35, durationMax: 45, environment: 'indoor', equipment: ['barbell'] },
      intraday: { bundleId: 'mon-bundle', order: 2, window: { startLocal: '17:30', endLocal: '18:30' } },
      definition: {
        id: 'pm-strength',
        title: 'Evening Lower Strength',
        summary: '4x5 trap-bar deadlift and accessory work.',
        modality: 'strength',
        intensity: 'moderate',
        duration: { min: 35, max: 45 },
        blocks: [
          {
            id: 'b2',
            name: 'Strength',
            steps: [{ id: 's2', label: 'Trap-Bar Deadlift', dose: { kind: 'repetition', reps: { min: 5, max: 5 }, sets: 4 } }],
          },
        ],
      },
      scaling: {
        reducible: true,
        reducedSummary: 'Cut to 2 working sets.',
        reducedDefinition: {
          id: 'pm-strength-reduced',
          title: 'Evening Lower Strength (Reduced)',
          summary: '2x5 trap-bar deadlift maintenance.',
          modality: 'strength',
          intensity: 'moderate',
          duration: { min: 20, max: 30 },
          blocks: [],
        },
      },
    } as unknown as PlacedSession['session'],
    date: '2026-09-14',
    status: 'planned',
    moved: false,
  },
];

describe('TodayImportedSessionsCard', () => {
  it.each([undefined, 'skip', 'defer', 'advisory', 'scale'] as const)('withholds launch without a proceed verdict for this session (%s)', decision => {
    const html = renderToStaticMarkup(
      <TodayImportedSessionsCard
        userId="u1" date="2026-09-14" planId="hybrid-block" revision={2}
        planTitle="Hybrid Build Block" contentHash="hash-2"
        sessions={sampleSessions} allTodaySessions={sampleSessions}
        verdictsBySessionId={{ 'am-ride': 'proceed', 'pm-strength': decision }}
        onStartSession={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Start Morning Threshold Intervals"');
    expect(html).not.toContain('aria-label="Start Evening Lower Strength"');
  });

  it('renders additional today sessions alongside an overview pill bar when Session 1 is shown in the primary card above', () => {
    const html = renderToStaticMarkup(
      <TodayImportedSessionsCard
        userId="u1"
        date="2026-09-14"
        planId="hybrid-block"
        revision={2}
        planTitle="Hybrid Build Block"
        contentHash="hash-2"
        sessions={[sampleSessions[1]]}
        allTodaySessions={sampleSessions}
        primaryDisplayedSessionId="am-ride"
        verdictsBySessionId={{ 'pm-strength': 'proceed' }}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('Additional Planned Session Today (1 more)');
    expect(html).toContain('1. Morning Threshold Intervals (above)');
    expect(html).toContain('2. Evening Lower Strength');
    expect(html).toContain('Session 2 of 2');
    expect(html).toContain('17:30–18:30');
    expect(html).toContain('4x5 trap-bar deadlift and accessory work.');
    // Choice of full vs reduced version when authored on a v6 reducible session
    expect(html).toContain('Full authored dose (35–45 min)');
    expect(html).toContain('Reduced version (20–30 min)');
    expect(html).toContain('aria-label="Start Evening Lower Strength"');
  });

  it('renders all of today’s planned sessions before morning check-in is completed', () => {
    const html = renderToStaticMarkup(
      <TodayImportedSessionsCard
        userId="u1"
        date="2026-09-14"
        planId="hybrid-block"
        revision={2}
        planTitle="Hybrid Build Block"
        contentHash="hash-2"
        sessions={sampleSessions}
        allTodaySessions={sampleSessions}
      />,
    );

    expect(html).toContain('Today in Hybrid Build Block (2 sessions planned)');
    expect(html).toContain('Session 1 of 2');
    expect(html).toContain('Morning Threshold Intervals');
    expect(html).toContain('Session 2 of 2');
    expect(html).toContain('Evening Lower Strength');
    // Start button is withheld when onStartSession is not provided (before check-in)
    expect(html).not.toContain('aria-label="Start Morning Threshold Intervals"');
  });

  it('fails closed when clinicalEscalationRequired is true', () => {
    const html = renderToStaticMarkup(
      <TodayImportedSessionsCard
        userId="u1"
        date="2026-09-14"
        planId="hybrid-block"
        revision={2}
        planTitle="Hybrid Build Block"
        contentHash="hash-2"
        sessions={sampleSessions}
        allTodaySessions={sampleSessions}
        clinicalEscalationRequired={true}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('Morning Threshold Intervals');
    expect(html).not.toContain('Workout steps');
    expect(html).not.toContain('Start Morning Threshold Intervals');
  });
});
