import { useEffect, useState } from 'react';
import type {
  ActivityMatchedSignalExpectation,
  ContextExplanationKind,
  CoreSignalDataQuality,
  CoreSignalEvidence,
  EarlyResponseLevel,
  HealthAnomalyAssessmentRevision,
  HealthAnomalyCalibrationStage,
  HealthAnomalyEvidenceQuality,
  HealthAnomalyPolicy,
  HealthCoreSignal,
  PhysiologicalAnomalyState,
} from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import {
  findRecentHealthAnomalyFollowupCandidate,
  type HealthAnomalyFollowupCandidate,
} from '../services/healthAnomalyOutcomeService';
import { healthAnomalyAssessmentRepository } from '../services/healthAnomalyPersistence';
import {
  configuredHealthAnomalyRuntimePolicy,
  resolveConfiguredHealthAnomalyRuntimePolicy,
} from '../services/healthAnomalyRuntime';
import type { Screen } from '../types/navigation';
import { HealthAnomalyFollowupCard } from './HealthAnomalyFollowupCard';
import {
  healthAnomalyLoadStatusFor,
  resolveHealthAnomalyCardState,
  type PersistedHealthAnomalyCardState,
} from './healthAnomalyShadowView';
import './HealthAnomalyCard.css';

export interface HealthAnomalyCardProps {
  userId: string;
  currentDate: string;
  onNavigate?: (screen: Screen) => void;
  liveRevision?: HealthAnomalyAssessmentRevision | null;
  policyOverride?: HealthAnomalyPolicy;
}

export interface HealthAnomalyCardViewProps {
  userId: string;
  currentDate: string;
  revision: HealthAnomalyAssessmentRevision | null;
  followupCandidate?: HealthAnomalyFollowupCandidate | null;
  unreadableCount?: number;
  /** The persisted assessment read failed; render a read-failure notice instead of nothing. */
  loadFailed?: boolean;
  onNavigate?: (screen: Screen) => void;
}

const DEFAULT_GUIDANCE_NOTICE =
  'For training and recovery awareness only. Wearable trends cannot evaluate or identify medical conditions.';

const SIGNAL_META: Record<HealthCoreSignal, { label: string; shortLabel: string; unit: string }> = {
  rhr: { label: 'Resting heart rate', shortLabel: 'RHR', unit: 'bpm' },
  respiration: { label: 'Respiratory rate', shortLabel: 'Resp', unit: 'brpm' },
  hrv: { label: 'Overnight HRV', shortLabel: 'HRV', unit: 'ms' },
};

const SIGNAL_STATUS_LABELS: Record<CoreSignalEvidence['status'], string> = {
  unavailable: 'Unavailable',
  normal: 'Normal',
  moderate_anomaly: 'Moderate shift',
  strong_anomaly: 'Strong shift',
};

const STATE_BADGE_MAP: Record<
  PhysiologicalAnomalyState,
  { label: string; tone: 'quiet' | 'insufficient' | 'explained' | 'watch' | 'elevated' | 'symptoms' }
> = {
  normal: { label: 'Within baseline', tone: 'quiet' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'insufficient' },
  explained_recovery_strain: { label: 'Explained strain', tone: 'explained' },
  watch_unexplained: { label: 'Early watch', tone: 'watch' },
  possible_illness_or_systemic_stress: { label: 'Persistent multi-signal shift', tone: 'elevated' },
  symptoms_reported: { label: 'Symptoms reported', tone: 'symptoms' },
};

const CALIBRATION_STAGE_LABELS: Record<HealthAnomalyCalibrationStage, string> = {
  insufficient_evidence: 'Building baseline (<7d)',
  emerging_baseline: 'Emerging baseline (7–13d)',
  reliable_baseline: 'Reliable 28d baseline',
  outcome_calibrated: 'Personally calibrated',
};

const EVIDENCE_QUALITY_LABELS: Record<HealthAnomalyEvidenceQuality, string> = {
  insufficient: 'Limited wearable evidence',
  emerging: 'Early baseline evidence',
  single_channel: 'Single channel',
  correlated_autonomic_only: 'Coupled RHR/HRV autonomic shift',
  multi_domain_corroborated: 'Multi-domain corroborated',
};

const EXPLANATION_LABELS: Record<ContextExplanationKind, string> = {
  hard_training: 'Recent hard or high-cost training',
  short_or_poor_sleep: 'Short or disrupted sleep',
  psychological_stress: 'Elevated life or mental stress',
  alcohol: 'Recent alcohol intake',
  travel_or_jetlag: 'Travel or time-zone shift',
  heat_or_sauna: 'Heat exposure or sauna',
  dehydration: 'Hydration strain',
  vaccination: 'Recent vaccination',
  medication_change: 'Medication change',
  other: 'Other reported context',
};

const EXPLANATION_STRENGTH_LABELS = {
  weak: 'Mild context link',
  moderate: 'Moderate context link',
  strong: 'Strong context link',
} as const;

function toDisplayMetricValue(
  value: number | null | undefined,
  estimator: CoreSignalEvidence['estimator'],
): number | null | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return estimator === 'log-mean-stdev-28d' ? Math.exp(value) : value;
}

function formatMetricValue(value: number | null | undefined, unit: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = unit === 'brpm' ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${unit}`;
}

function formatStandardizedDeviation(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}z`;
}

function resolveCalibrationLabel(
  revision: HealthAnomalyAssessmentRevision,
): string {
  const { assessment } = revision;
  if (assessment.calibrationStage) {
    return CALIBRATION_STAGE_LABELS[assessment.calibrationStage];
  }
  const matureCount = assessment.dataQuality.filter(item => item.historyCount >= 14).length;
  if (matureCount >= 2) return CALIBRATION_STAGE_LABELS.reliable_baseline;
  const emergingCount = assessment.dataQuality.filter(item => item.historyCount >= 7).length;
  if (emergingCount >= 1) return CALIBRATION_STAGE_LABELS.emerging_baseline;
  return CALIBRATION_STAGE_LABELS.insufficient_evidence;
}

function resolveEpisodeStatusLabel(revision: HealthAnomalyAssessmentRevision): string | null {
  const { episodeDay, persistenceDays } = revision.assessment;
  if (episodeDay === 1) return 'Day 1 (first abnormal night)';
  if (typeof episodeDay === 'number' && episodeDay > 1) {
    const nightsLabel = persistenceDays === 1 ? '1 night' : `${persistenceDays} nights`;
    return `Day ${episodeDay} (persistent episode · ${nightsLabel})`;
  }
  if (persistenceDays > 0) {
    return persistenceDays === 1 ? 'Day 1 (first abnormal night)' : `${persistenceDays} consecutive nights`;
  }
  return null;
}

function defaultHeadlineFor(state: PhysiologicalAnomalyState): string {
  switch (state) {
    case 'insufficient_evidence':
      return 'Not enough overnight signals to assess recovery deviations yet';
    case 'explained_recovery_strain':
      return 'Overnight physiology shifted alongside recent load or context';
    case 'watch_unexplained':
      return 'Early physiological shift without a clear context explanation';
    case 'possible_illness_or_systemic_stress':
      return 'Multi-signal overnight shift beyond your personal baseline';
    case 'symptoms_reported':
      return 'Illness symptoms reported today';
    case 'normal':
      return 'Overnight physiology is within your personal baseline';
  }
}

function defaultSummaryFor(state: PhysiologicalAnomalyState): string {
  switch (state) {
    case 'insufficient_evidence':
      return 'Wait for additional overnight wearable readings before interpreting baseline deviations.';
    case 'explained_recovery_strain':
      return 'One or more overnight signals moved away from baseline, consistent with recorded training, sleep, or lifestyle factors.';
    case 'watch_unexplained':
      return 'Keep intensity easy-to-moderate and check how signals respond over the next 24 hours.';
    case 'possible_illness_or_systemic_stress':
      return 'Multiple signals or consecutive nights stayed outside baseline. Prioritize recovery over hard training today.';
    case 'symptoms_reported':
      return 'Step back from intense training while symptoms are active and update your check-in as things evolve.';
    case 'normal':
      return 'Signals are consistent with your personal 28-day baseline.';
  }
}

function buildInsufficientReadinessLine(quality: CoreSignalDataQuality): string {
  const meta = SIGNAL_META[quality.signal];
  if (quality.currentValueMissing) {
    return `${meta.label}: No reading recorded for today (${quality.historyCount}/14 baseline nights)`;
  }
  if (quality.historyCount < 14) {
    return `${meta.label}: ${quality.historyCount}/14 baseline nights recorded`;
  }
  return `${meta.label}: Ready (${quality.historyCount} nights)`;
}

function renderActivityMatchedRow(item: ActivityMatchedSignalExpectation) {
  const meta = SIGNAL_META[item.signal];
  const stratumLabel = item.stratum === 'post_hard_or_high_cost'
    ? 'After hard / high-cost session'
    : 'After easy / rest day';
  return (
    <li key={`${item.signal}-${item.stratum}`} className="ha-card-matched-item">
      <div className="ha-card-matched-top">
        <span className="ha-card-matched-signal">{meta.label} · {stratumLabel}</span>
        <span className={`ha-card-matched-pill ${item.withinExpectedTrainingResponse ? 'is-expected' : 'is-beyond'}`}>
          {item.withinExpectedTrainingResponse ? 'Within expected post-training range' : 'Beyond expected post-training range'}
        </span>
      </div>
      <div className="ha-card-matched-values">
        Expected ~{formatMetricValue(item.shrunkExpectedValue, meta.unit)} vs observed{' '}
        {formatMetricValue(item.currentValue, meta.unit)} ({formatStandardizedDeviation(item.residualStandardizedDeviation)})
      </div>
    </li>
  );
}

function shouldShowReturnToSport(level: EarlyResponseLevel | undefined, guidance: readonly string[]): boolean {
  return (level === 'level_2_persistent_or_corroborated' || level === 'level_3_symptoms_reported')
    && guidance.length > 0;
}

export function HealthAnomalyCardView({
  userId,
  currentDate,
  revision,
  followupCandidate = null,
  unreadableCount = 0,
  loadFailed = false,
  onNavigate,
}: HealthAnomalyCardViewProps) {
  const latestUncertain = unreadableCount > 0;
  const effectiveFollowupCandidate = latestUncertain ? null : followupCandidate;
  const uncertaintyNotice = latestUncertain ? (
    <p className="ha-card-notice" role="status">
      {unreadableCount} stored assessment revision(s) for {currentDate} could not be read. This may not be the latest one, so follow-up is unavailable.
    </p>
  ) : loadFailed ? (
    <p className="ha-card-notice" role="status">
      Today's early-warning assessment could not be loaded, so the current signal state is unknown. Reload the app to try again.
    </p>
  ) : null;

  if (!revision) {
    if (!effectiveFollowupCandidate) {
      if (!uncertaintyNotice) return null;
      return (
        <section className="dashboard-card ha-card ha-card--insufficient" aria-label="Early physiological signals">
          {uncertaintyNotice}
        </section>
      );
    }
    return (
      <section className="dashboard-card ha-card ha-card--followup" aria-label="Health anomaly episode follow-up">
        <div className="ha-card-header">
          <div className="ha-card-title-row">
            <span className="ha-card-kicker">Episode follow-up</span>
            <span className="ha-card-badge tone-quiet">Review due</span>
          </div>
          <h2 className="ha-card-headline">How did the {effectiveFollowupCandidate.sourceAssessment.date} physiological shift turn out?</h2>
          <p className="ha-card-summary">
            Logging what happened helps calibrate future overnight alerts to your physiology.
          </p>
        </div>
        <div className="ha-card-followup-wrap">
          <HealthAnomalyFollowupCard userId={userId} date={currentDate} currentRevision={null} />
        </div>
        {onNavigate && (
          <div className="ha-card-footer-actions">
            <button type="button" className="ha-card-checkin-btn" onClick={() => onNavigate('checkin')}>
              Update symptoms &amp; context
            </button>
          </div>
        )}
      </section>
    );
  }

  const { assessment } = revision;

  if (assessment.state === 'normal') {
    if (!effectiveFollowupCandidate) {
      if (!uncertaintyNotice) return null;
      return (
        <section className="dashboard-card ha-card ha-card--insufficient" aria-label="Early physiological signals">
          {uncertaintyNotice}
        </section>
      );
    }
    return (
      <section className="dashboard-card ha-card ha-card--followup" aria-label="Health anomaly episode follow-up">
        <div className="ha-card-header">
          <div className="ha-card-title-row">
            <span className="ha-card-kicker">Episode follow-up</span>
            <span className="ha-card-badge tone-quiet">Today within baseline</span>
          </div>
          <h2 className="ha-card-headline">Overnight signals are normal today — confirm your {effectiveFollowupCandidate.sourceAssessment.date} episode</h2>
          <p className="ha-card-summary">
            Recording whether that earlier shift led to illness or reflected training/life load personalizes future alerts.
          </p>
        </div>
        <div className="ha-card-followup-wrap">
          <HealthAnomalyFollowupCard userId={userId} date={currentDate} currentRevision={revision} />
        </div>
        {onNavigate && (
          <div className="ha-card-footer-actions">
            <button type="button" className="ha-card-checkin-btn" onClick={() => onNavigate('checkin')}>
              Update symptoms &amp; context
            </button>
          </div>
        )}
      </section>
    );
  }

  const stateMeta = STATE_BADGE_MAP[assessment.state];
  const earlyResponse = assessment.earlyResponse;

  if (assessment.state === 'insufficient_evidence') {
    return (
      <section className="dashboard-card ha-card ha-card--insufficient" aria-label="Early physiological signals">
        {uncertaintyNotice}
        <div className="ha-card-header">
          <div className="ha-card-title-row">
            <span className="ha-card-kicker">Early physiological signals</span>
            <span className="ha-card-badge tone-insufficient">{stateMeta.label}</span>
          </div>
          <h2 className="ha-card-headline">{earlyResponse?.headline ?? defaultHeadlineFor('insufficient_evidence')}</h2>
          <p className="ha-card-summary">{earlyResponse?.summary ?? defaultSummaryFor('insufficient_evidence')}</p>
        </div>

        <ul className="ha-card-readiness-list" aria-label="Wearable baseline readiness">
          {assessment.dataQuality.map(quality => (
            <li key={quality.signal} className="ha-card-readiness-item">
              {buildInsufficientReadinessLine(quality)}
            </li>
          ))}
        </ul>

        <div className="ha-card-footer-actions">
          <button
            type="button"
            className="ha-card-checkin-btn"
            onClick={() => onNavigate?.('checkin')}
          >
            Update symptoms &amp; context
          </button>
        </div>

        {effectiveFollowupCandidate && (
          <div className="ha-card-followup-wrap">
            <HealthAnomalyFollowupCard userId={userId} date={currentDate} currentRevision={revision} />
          </div>
        )}

        <p className="ha-card-notice">{earlyResponse?.nonDiagnosticNotice ?? DEFAULT_GUIDANCE_NOTICE}</p>
      </section>
    );
  }

  const calibrationLabel = resolveCalibrationLabel(revision);
  const evidenceQualityLabel = assessment.evidenceQuality
    ? EVIDENCE_QUALITY_LABELS[assessment.evidenceQuality]
    : null;
  const episodeStatusLabel = resolveEpisodeStatusLabel(revision);
  const isContinuingEpisode = typeof assessment.episodeDay === 'number' && assessment.episodeDay > 1;
  const matchedExpectations = assessment.activityMatchedExpectations ?? [];

  return (
    <section
      className={`dashboard-card ha-card ha-card--${stateMeta.tone}`}
      aria-label="Early physiological signals"
    >
      <div className="ha-card-header">
        <div className="ha-card-title-row">
          <span className="ha-card-kicker">Early physiological signals</span>
          <span className={`ha-card-badge tone-${stateMeta.tone}`}>{stateMeta.label}</span>
        </div>
        <h2 className="ha-card-headline">{earlyResponse?.headline ?? defaultHeadlineFor(assessment.state)}</h2>
        <p className="ha-card-summary">{earlyResponse?.summary ?? defaultSummaryFor(assessment.state)}</p>

        <div className="ha-card-meta-pills" aria-label="Assessment confidence and episode status">
          <span className="ha-card-meta-pill">{calibrationLabel}</span>
          {evidenceQualityLabel && <span className="ha-card-meta-pill">{evidenceQualityLabel}</span>}
          {episodeStatusLabel && <span className="ha-card-meta-pill">{episodeStatusLabel}</span>}
          {assessment.personalCalibration?.calibrationEligible && (
            <span className="ha-card-meta-pill">
              {assessment.personalCalibration.priorEpisodesCount} prior episodes tracked
            </span>
          )}
        </div>

        {isContinuingEpisode && (
          <p className="ha-card-continuing-note">
            Continuing episode — track day-over-day trajectory and keep intensity conservative until overnight markers stabilize.
          </p>
        )}
      </div>

      <div className="ha-card-block">
        <h3 className="ha-card-block-title">What changed</h3>
        <ul className="ha-card-signals-grid">
          {assessment.coreSignals.map(signal => {
            const meta = SIGNAL_META[signal.signal];
            return (
              <li key={signal.signal} className={`ha-card-signal-row status-${signal.status}`}>
                <div className="ha-card-signal-top">
                  <span className="ha-card-signal-name">{meta.label}</span>
                  <span className={`ha-card-signal-status status-${signal.status}`}>
                    {SIGNAL_STATUS_LABELS[signal.status]}
                  </span>
                </div>
                <div className="ha-card-signal-metrics">
                  <span>Current: <strong>{formatMetricValue(toDisplayMetricValue(signal.currentValue, signal.estimator), meta.unit)}</strong></span>
                  <span>28d baseline: {formatMetricValue(toDisplayMetricValue(signal.baselineValue, signal.estimator), meta.unit)}</span>
                  <span className="ha-card-signal-z">Deviation: <strong>{formatStandardizedDeviation(signal.standardizedDeviation)}</strong></span>
                </div>
              </li>
            );
          })}
        </ul>
        {assessment.respirationElevation?.status === 'resolving' && (
          <p className="ha-card-resolving-note">
            Respiratory rate trend: 7-day breathing rate is easing back toward your personal 28-day baseline.
          </p>
        )}
      </div>

      <div className="ha-card-block">
        <h3 className="ha-card-block-title">Plausible non-illness explanations</h3>
        {assessment.explanations.length > 0 ? (
          <ul className="ha-card-explanations-list">
            {assessment.explanations.map((explanation, index) => (
              <li key={`${explanation.kind}-${index}`} className="ha-card-explanation-item">
                <div className="ha-card-explanation-top">
                  <strong>{EXPLANATION_LABELS[explanation.kind]}</strong>
                  <span className="ha-card-explanation-strength">
                    {EXPLANATION_STRENGTH_LABELS[explanation.strength]}
                  </span>
                </div>
                {explanation.explainsSignals.length > 0 && (
                  <div className="ha-card-explanation-signals">
                    Related signals: {explanation.explainsSignals.map(sig => SIGNAL_META[sig].shortLabel).join(', ')}
                  </div>
                )}
                {explanation.evidence.length > 0 && (
                  <p className="ha-card-explanation-evidence">{explanation.evidence.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ha-card-empty-context">
            No strong training, sleep, alcohol, or travel explanation was recorded for today&apos;s shifts.
          </p>
        )}

        {matchedExpectations.length > 0 && (
          <ul className="ha-card-matched-list" aria-label="Activity-matched expectations">
            {matchedExpectations.map(renderActivityMatchedRow)}
          </ul>
        )}
      </div>

      {earlyResponse && (
        <div className="ha-card-block">
          <h3 className="ha-card-block-title">Recommended next steps</h3>
          {earlyResponse.actions.length > 0 && (
            <ul className="ha-card-actions-list">
              {earlyResponse.actions.map((action, index) => (
                <li key={index}>{action}</li>
              ))}
            </ul>
          )}
          <p className="ha-card-reassess">
            <strong>Reassess:</strong> {earlyResponse.reassessTiming}
          </p>

          {earlyResponse.level === 'level_3_symptoms_reported' && earlyResponse.redFlagWarnings.length > 0 && (
            <div className="ha-card-redflags" role="note" aria-label="Warning signs requiring rest or medical review">
              <strong>Watch for these red-flag warning signs:</strong>
              <ul>
                {earlyResponse.redFlagWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {shouldShowReturnToSport(earlyResponse.level, earlyResponse.returnToSportGuidance) && (
            <div className="ha-card-rts">
              <strong>Return-to-training guidance:</strong>
              <ul>
                {earlyResponse.returnToSportGuidance.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="ha-card-footer-actions">
        <button
          type="button"
          className="ha-card-checkin-btn"
          onClick={() => onNavigate?.('checkin')}
        >
          Update symptoms &amp; context
        </button>
      </div>

      {effectiveFollowupCandidate && (
        <div className="ha-card-followup-wrap">
          <HealthAnomalyFollowupCard userId={userId} date={currentDate} currentRevision={revision} />
        </div>
      )}

      {uncertaintyNotice}

      <p className="ha-card-notice">{earlyResponse?.nonDiagnosticNotice ?? DEFAULT_GUIDANCE_NOTICE}</p>
    </section>
  );
}

export function HealthAnomalyCard({
  userId,
  currentDate,
  onNavigate,
  liveRevision,
  policyOverride,
}: HealthAnomalyCardProps) {
  const activePolicy = policyOverride !== undefined
    ? resolveConfiguredHealthAnomalyRuntimePolicy(policyOverride)
    : configuredHealthAnomalyRuntimePolicy();
  const visibleEnabled = activePolicy === 'visible-v1';

  const [persistedState, setPersistedState] = useState<PersistedHealthAnomalyCardState | null>(null);

  const [followupState, setFollowupState] = useState<{
    userId: string;
    date: string;
    revisionId: string | null;
    candidate: HealthAnomalyFollowupCandidate | null;
  } | null>(null);

  useEffect(() => {
    if (!visibleEnabled || !userId || !currentDate) return;
    let cancelled = false;
    healthAnomalyAssessmentRepository.getLatestForDateWithDiagnostics(userId, currentDate)
      .then(({ revision, unreadableCount }) => {
        if (!cancelled) {
          setPersistedState({
            revision,
            loadResult: {
              userId,
              date: currentDate,
              status: healthAnomalyLoadStatusFor(revision, unreadableCount),
              unreadableCount,
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersistedState({
            revision: null,
            loadResult: { userId, date: currentDate, status: 'error' },
          });
        }
      });
    return () => { cancelled = true; };
  }, [visibleEnabled, userId, currentDate]);

  const cardState = visibleEnabled && userId && currentDate
    ? resolveHealthAnomalyCardState({
        userId,
        currentDate,
        liveRevision,
        persistedState,
        followupState,
      })
    : null;
  const revision = cardState?.revision ?? null;
  const currentRevisionId = revision?.revisionId ?? null;
  const followupAllowed = cardState?.followupAllowed ?? false;

  useEffect(() => {
    if (!visibleEnabled || !userId || !currentDate || !followupAllowed) return;
    let cancelled = false;
    findRecentHealthAnomalyFollowupCandidate(userId, currentDate, revision)
      .then(candidate => {
        if (!cancelled) {
          setFollowupState({ userId, date: currentDate, revisionId: currentRevisionId, candidate });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFollowupState({ userId, date: currentDate, revisionId: currentRevisionId, candidate: null });
        }
      });
    return () => { cancelled = true; };
  }, [visibleEnabled, userId, currentDate, followupAllowed, revision, currentRevisionId]);

  if (!visibleEnabled || !userId || !currentDate || !cardState) return null;

  return (
    <HealthAnomalyCardView
      userId={userId}
      currentDate={currentDate}
      revision={cardState.revision}
      followupCandidate={cardState.followupCandidate}
      unreadableCount={cardState.unreadableCount}
      loadFailed={cardState.loadFailed}
      onNavigate={onNavigate}
    />
  );
}
