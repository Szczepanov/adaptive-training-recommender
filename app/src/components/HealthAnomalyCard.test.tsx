import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HealthAnomalyAssessmentRevision,
  PhysiologicalAnomalyAssessment,
} from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import { VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS } from '../derived/flags/illnessAnomaly/healthAnomaly';
import type { HealthAnomalyFollowupCandidate } from '../services/healthAnomalyOutcomeService';
import { HealthAnomalyCard, HealthAnomalyCardView } from './HealthAnomalyCard';

const mockFollowupProps: Array<Record<string, unknown>> = [];

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
vi.mock('./HealthAnomalyFollowupCard', () => ({
  HealthAnomalyFollowupCard: (props: Record<string, unknown>) => {
    mockFollowupProps.push(props);
    return <div data-testid="embedded-followup-card" data-date={String(props.date ?? '')} />;
  },
}));

function makeAssessment(
  overrides: Partial<PhysiologicalAnomalyAssessment> = {},
): PhysiologicalAnomalyAssessment {
  return {
    state: 'watch_unexplained',
    evidenceLevel: 'moderate',
    coreSignals: [
      {
        signal: 'rhr',
        estimator: 'mean-stdev-28d',
        direction: 'high',
        status: 'moderate_anomaly',
        currentValue: 56,
        baselineValue: 50,
        scaleValue: 2.8,
        standardizedDeviation: 2.1,
        baselineVersion: 5,
      },
      {
        signal: 'respiration',
        estimator: 'median-mad-28d',
        direction: 'high',
        status: 'normal',
        currentValue: 14.2,
        baselineValue: 14.0,
        scaleValue: 0.6,
        standardizedDeviation: 0.3,
        baselineVersion: 5,
      },
      {
        signal: 'hrv',
        estimator: 'log-mean-stdev-28d',
        direction: 'low',
        status: 'normal',
        currentValue: 58,
        baselineValue: 60,
        scaleValue: 5,
        standardizedDeviation: -0.4,
        baselineVersion: 5,
      },
    ],
    supportingSignals: [],
    explanations: [],
    unexplainedEvidence: ['rhr:moderate_anomaly'],
    persistenceDays: 1,
    unexplainedPersistenceDays: 1,
    episodeId: 'health-anomaly:2026-11-15',
    episodeDay: 1,
    dataQuality: [
      {
        signal: 'rhr',
        historyCount: 24,
        recentDayCoverage: 1,
        baselineWindowStart: '2026-10-18',
        baselineWindowEndExclusive: '2026-11-15',
        baselineAgeDays: 1,
        zeroOrNearZeroScale: false,
        currentValueMissing: false,
        suspectedQuantizationOrTies: false,
        baselineMaturity: 'reliable',
        contaminatedDaysExcluded: 0,
      },
      {
        signal: 'respiration',
        historyCount: 24,
        recentDayCoverage: 1,
        baselineWindowStart: '2026-10-18',
        baselineWindowEndExclusive: '2026-11-15',
        baselineAgeDays: 1,
        zeroOrNearZeroScale: false,
        currentValueMissing: false,
        suspectedQuantizationOrTies: false,
        baselineMaturity: 'reliable',
        contaminatedDaysExcluded: 0,
      },
      {
        signal: 'hrv',
        historyCount: 24,
        recentDayCoverage: 1,
        baselineWindowStart: '2026-10-18',
        baselineWindowEndExclusive: '2026-11-15',
        baselineAgeDays: 1,
        zeroOrNearZeroScale: false,
        currentValueMissing: false,
        suspectedQuantizationOrTies: false,
        baselineMaturity: 'reliable',
        contaminatedDaysExcluded: 0,
      },
    ],
    rationale: { facts: [], explanations: [], cautions: [] },
    calibrationStage: 'reliable_baseline',
    anomalySeverity: 'mild',
    evidenceQuality: 'single_channel',
    earlyResponse: {
      level: 'level_1_early_watch',
      headline: 'Resting heart rate shifted above your 28-day baseline',
      summary: 'Keep training aerobic and reassess after another night of sleep.',
      actions: ['Cap today’s session at easy aerobic effort', 'Prioritize sleep tonight'],
      reassessTiming: 'Reassess after tomorrow morning’s wearable sync',
      nonDiagnosticNotice: 'Recovery guidance only; cannot evaluate medical conditions.',
      redFlagWarnings: [],
      returnToSportGuidance: [],
      followupPromptEligible: true,
    },
    policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
    thresholdPolicyVersion: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion,
    mode: 'visible-v1',
    ...overrides,
  };
}

function makeRevision(
  assessmentOverrides: Partial<PhysiologicalAnomalyAssessment> = {},
): HealthAnomalyAssessmentRevision {
  return {
    schemaVersion: 1,
    userId: 'u1',
    date: '2026-11-15',
    revisionId: 'ha-1234567890abcdef',
    idempotencyKey: '2026-11-15:1234567890abcdef',
    computedAt: '2026-11-15T06:30:00Z',
    policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
    thresholdPolicy: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
    mode: 'visible-v1',
    source: {
      timezone: 'Europe/Warsaw',
      recoverySnapshotRevision: 'r1',
      checkinRevision: null,
      historyWindowStart: '2026-10-18',
      historyWindowEndExclusive: '2026-11-15',
      historySnapshotRevisions: [],
      travelContextRevision: null,
      persistenceLookbackStart: '2026-11-14',
    },
    assessment: makeAssessment(assessmentOverrides),
  };
}

function collectElements(node: ReactNode, matches: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, matches);
  } else if (isValidElement(node)) {
    matches.push(node);
    const props = node.props as { children?: ReactNode };
    if (props.children !== undefined) collectElements(props.children, matches);
  }
  return matches;
}

const candidate: HealthAnomalyFollowupCandidate = {
  episodeId: 'health-anomaly:2026-11-13',
  sourceAssessment: { date: '2026-11-13', revisionId: 'ha-0000000000000001' },
  episodeDay: 1,
};

describe('HealthAnomalyCard', () => {
  beforeEach(() => {
    mockFollowupProps.length = 0;
  });

  it('is quiet when normal and no follow-up candidate is pending', () => {
    const normalRevision = makeRevision({ state: 'normal', episodeId: null, episodeDay: null, persistenceDays: 0 });
    const html = renderToStaticMarkup(
      <HealthAnomalyCardView userId="u1" currentDate="2026-11-15" revision={normalRevision} followupCandidate={null} />,
    );
    expect(html).toBe('');
  });

  it('renders embedded follow-up on a normal day when a retrospective follow-up candidate is due', () => {
    const normalRevision = makeRevision({ state: 'normal', episodeId: null, episodeDay: null, persistenceDays: 0 });
    const html = renderToStaticMarkup(
      <HealthAnomalyCardView
        userId="u1"
        currentDate="2026-11-15"
        revision={normalRevision}
        followupCandidate={candidate}
        onNavigate={vi.fn()}
      />,
    );
    expect(html).toContain('Today within baseline');
    expect(html).toContain('2026-11-13');
    expect(html).toContain('data-testid="embedded-followup-card"');
    expect(mockFollowupProps[0]).toMatchObject({ userId: 'u1', date: '2026-11-15', currentRevision: normalRevision });
  });

  it('renders honest cold-start baseline progress when insufficient_evidence', () => {
    const insufficient = makeRevision({
      state: 'insufficient_evidence',
      evidenceLevel: 'none',
      episodeId: null,
      episodeDay: null,
      persistenceDays: 0,
      calibrationStage: 'insufficient_evidence',
      evidenceQuality: 'insufficient',
      dataQuality: [
        {
          signal: 'rhr',
          historyCount: 6,
          recentDayCoverage: 4 / 7,
          baselineWindowStart: '2026-10-18',
          baselineWindowEndExclusive: '2026-11-15',
          baselineAgeDays: 1,
          zeroOrNearZeroScale: false,
          currentValueMissing: false,
          suspectedQuantizationOrTies: false,
          baselineMaturity: 'insufficient',
          contaminatedDaysExcluded: 0,
        },
        {
          signal: 'hrv',
          historyCount: 5,
          recentDayCoverage: 3 / 7,
          baselineWindowStart: '2026-10-18',
          baselineWindowEndExclusive: '2026-11-15',
          baselineAgeDays: 1,
          zeroOrNearZeroScale: false,
          currentValueMissing: true,
          suspectedQuantizationOrTies: false,
          baselineMaturity: 'insufficient',
          contaminatedDaysExcluded: 0,
        },
      ],
      earlyResponse: {
        level: 'none',
        headline: 'Building your personal baseline (6 of 14 nights)',
        summary: 'Core wearable history is still gathering before deviations can be judged.',
        actions: [],
        reassessTiming: 'Continue wearing your tracker overnight.',
        nonDiagnosticNotice: 'Recovery guidance only.',
        redFlagWarnings: [],
        returnToSportGuidance: [],
        followupPromptEligible: false,
      },
    });
    const html = renderToStaticMarkup(
      <HealthAnomalyCardView userId="u1" currentDate="2026-11-15" revision={insufficient} onNavigate={vi.fn()} />,
    );
    expect(html).toContain('Insufficient evidence');
    expect(html).toContain('6/14 baseline nights recorded');
    expect(html).toContain('Overnight HRV: No reading recorded for today (5/14 baseline nights)');
    expect(html).toContain('Update symptoms &amp; context');
    expect(html).not.toContain('Within baseline');
  });

  it('renders signal changes, emerging calibration, single-channel Day 1 status, explanations, and Level 1 protocol', () => {
    const watch = makeRevision({
      state: 'explained_recovery_strain',
      calibrationStage: 'emerging_baseline',
      evidenceQuality: 'single_channel',
      explanations: [
        {
          kind: 'hard_training',
          strength: 'strong',
          explainsSignals: ['rhr'],
          evidence: ['High-cost threshold workout completed yesterday'],
        },
      ],
      activityMatchedExpectations: [
        {
          signal: 'rhr',
          stratum: 'post_hard_or_high_cost',
          stratumSampleCount: 5,
          unconditionalBaseline: 50,
          shrunkExpectedValue: 55,
          currentValue: 56,
          residualFromExpected: 1,
          residualStandardizedDeviation: 0.5,
          withinExpectedTrainingResponse: true,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <HealthAnomalyCardView userId="u1" currentDate="2026-11-15" revision={watch} onNavigate={vi.fn()} />,
    );
    expect(html).toContain('What changed');
    expect(html).toContain('Resting heart rate');
    expect(html).toContain('56 bpm');
    expect(html).toContain('50 bpm');
    expect(html).toContain('+2.1z');
    expect(html).toContain('Emerging baseline (7–13d)');
    expect(html).toContain('Single channel');
    expect(html).toContain('Day 1 (first abnormal night)');
    expect(html).toContain('Plausible non-illness explanations');
    expect(html).toContain('Recent hard or high-cost training');
    expect(html).toContain('Within expected post-training range');
    expect(html).toContain('Cap today’s session at easy aerobic effort');
    expect(html).not.toContain('Watch for these red-flag warning signs');
    expect(html).not.toContain('Return-to-training guidance');
  });

  it('renders persistent multi-domain Day 2 Level 2 return-to-sport guidance and outcome calibration badge', () => {
    const persistent = makeRevision({
      state: 'possible_illness_or_systemic_stress',
      evidenceLevel: 'high',
      persistenceDays: 2,
      unexplainedPersistenceDays: 2,
      episodeDay: 2,
      calibrationStage: 'outcome_calibrated',
      evidenceQuality: 'multi_domain_corroborated',
      personalCalibration: {
        asOfDate: '2026-11-15',
        priorEpisodesCount: 4,
        illnessConfirmedCount: 2,
        confounderExplainedCount: 2,
        noIllnessCount: 0,
        unknownCount: 0,
        positiveRespiratoryTestsCount: 1,
        negativeRespiratoryTestsCount: 0,
        medianLeadTimeDays: 1,
        calibrationEligible: true,
      },
      respirationElevation: {
        status: 'resolving',
        currentValue: 15.2,
        baseline7dValue: 15.5,
        baseline28dValue: 14.0,
        deltaVs7d: -0.3,
        deltaVs28d: 1.2,
        baselineVersion: 5,
        historyCount: 28,
        recentDayCoverage: 1,
        reasonCodes: ['RECENT_DELTA_NON_POSITIVE'],
        policyVersion: 'respiration-elevation/shadow-e2-s1-v1',
      },
      earlyResponse: {
        level: 'level_2_persistent_or_corroborated',
        headline: 'Multi-domain overnight shift persisted into Day 2',
        summary: 'Autonomic and respiratory channels both shifted beyond baseline.',
        actions: ['Switch to full rest or brief low-intensity mobility'],
        reassessTiming: 'Check overnight recovery tomorrow and monitor for symptoms',
        nonDiagnosticNotice: 'For recovery awareness only.',
        redFlagWarnings: [],
        returnToSportGuidance: ['Wait 48 hours of normal resting metrics before resuming hard intervals'],
        followupPromptEligible: true,
      },
    });

    const html = renderToStaticMarkup(
      <HealthAnomalyCardView userId="u1" currentDate="2026-11-15" revision={persistent} followupCandidate={candidate} onNavigate={vi.fn()} />,
    );
    expect(html).toContain('Personally calibrated');
    expect(html).toContain('Multi-domain corroborated');
    expect(html).toContain('Day 2 (persistent episode · 2 nights)');
    expect(html).toContain('4 prior episodes tracked');
    expect(html).toContain('Continuing episode');
    expect(html).toContain('resolving');
    expect(html).toContain('Return-to-training guidance');
    expect(html).toContain('Wait 48 hours of normal resting metrics');
    expect(html).toContain('data-testid="embedded-followup-card"');
  });

  it('renders Level 3 red-flag warnings for symptoms_reported and navigates to checkin on CTA click', () => {
    const symptoms = makeRevision({
      state: 'symptoms_reported',
      evidenceQuality: 'correlated_autonomic_only',
      earlyResponse: {
        level: 'level_3_symptoms_reported',
        headline: 'Illness symptoms reported alongside overnight autonomic shift',
        summary: 'Pause strenuous exercise while systemic symptoms are present.',
        actions: ['Rest completely today', 'Hydrate and prioritize sleep'],
        reassessTiming: 'Reassess daily until fever-free and resting signals normalize',
        nonDiagnosticNotice: 'Informational guidance only; consult a clinician if concerned.',
        redFlagWarnings: ['Chest tightness or shortness of breath at rest', 'Persistent high fever'],
        returnToSportGuidance: ['Begin gradual Zone 1 return only after symptom resolution'],
        followupPromptEligible: true,
      },
    });
    const html = renderToStaticMarkup(
      <HealthAnomalyCardView userId="u1" currentDate="2026-11-15" revision={symptoms} onNavigate={vi.fn()} />,
    );
    expect(html).toContain('Coupled RHR/HRV autonomic shift');
    expect(html).toContain('Watch for these red-flag warning signs');
    expect(html).toContain('Chest tightness or shortness of breath at rest');
    expect(html).toContain('Return-to-training guidance');
    expect(html).toContain('Informational guidance only');

    const onNavigate = vi.fn();
    const tree = HealthAnomalyCardView({ userId: 'u1', currentDate: '2026-11-15', revision: symptoms, onNavigate });
    const buttons = collectElements(tree).filter(
      el => el.type === 'button' && (el.props as { className?: string }).className === 'ha-card-checkin-btn',
    );
    expect(buttons).toHaveLength(1);
    (buttons[0].props as { onClick: () => void }).onClick();
    expect(onNavigate).toHaveBeenCalledWith('checkin');
  });

  it('renders nothing when runtime policy override is off or shadow-v1', () => {
    expect(
      renderToStaticMarkup(
        <HealthAnomalyCard userId="u1" currentDate="2026-11-15" liveRevision={makeRevision()} policyOverride="off" />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <HealthAnomalyCard userId="u1" currentDate="2026-11-15" liveRevision={makeRevision()} policyOverride="shadow-v1" />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <HealthAnomalyCard userId="u1" currentDate="2026-11-15" liveRevision={makeRevision()} policyOverride="visible-v1" />,
      ),
    ).toContain('Resting heart rate');
  });
});
