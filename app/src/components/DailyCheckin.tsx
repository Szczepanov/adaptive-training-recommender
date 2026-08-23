import { useState, useEffect, useCallback, useId } from 'react';
import { checkinService } from '../services/checkinService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionResponseService } from '../services/sessionResponseService';
import { relevantFollowupRegions } from '../responses/followupSchedule';
import { EXERCISES } from '../workouts/exercises';
import type { BodyRegion, DailySubjectiveCheckin, RegionTissueResponse, TissueResponseLevel } from '../engine/models';
import type { HealthContextCheckin } from '../engine/healthAnomalyModels';
import { BODY_REGIONS, TISSUE_LEVELS } from '../engine/models';
import { isCompletedSubjectiveCheckin } from '../engine/checkinCompletion';
import { getLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { getErrorMessage } from '../utils/errors';
import type { Screen } from '../types/navigation';
import { HealthContextSection } from './checkin/HealthContextSection';
import { SubjectiveScaleRow } from './checkin/SubjectiveScaleRow';
import './DailyCheckin.css';

interface DailyCheckinProps {
  userId: string;
  onNavigate: (screen: Screen) => void;
  onBack?: () => void;
  onCheckinSaved?: () => void | Promise<void>;
}

const REGION_LABELS: Record<BodyRegion, string> = {
  knee: 'Knee',
  achilles: 'Achilles',
  ankle: 'Ankle',
  calf: 'Calf',
  hamstring: 'Hamstring',
  quadriceps: 'Quadriceps',
  adductor_groin: 'Adductor/Groin',
  hip: 'Hip',
  lower_back: 'Lower Back',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
};

const TISSUE_LEVEL_LABELS: Record<TissueResponseLevel, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

const TISSUE_LEVEL_HELP: Record<TissueResponseLevel, string> = {
  normal: 'No meaningful change; normal movement and function.',
  mild: 'Noticeable stiffness/soreness, but normal walking and function.',
  moderate: 'Persistent or function-changing response that should reduce load.',
  severe: 'Marked pain/swelling/instability or meaningful loss of function.',
};

interface ScaleConfig {
  key: keyof Pick<DailySubjectiveCheckin, 'readiness' | 'sleepQuality' | 'fatigue' | 'soreness' | 'mentalStress' | 'motivation'>;
  label: string;
  desc: string;
  lowLabel: string;
  highLabel: string;
  isInverted?: boolean;
}

const SCALES: ScaleConfig[] = [
  {
    key: 'readiness',
    label: 'Overall Readiness',
    desc: 'How ready do you feel to train today?',
    lowLabel: '1 Not ready',
    highLabel: '10 Fully ready',
  },
  {
    key: 'sleepQuality',
    label: 'Sleep Quality',
    desc: 'How well did you sleep last night?',
    lowLabel: '1 Poor',
    highLabel: '10 Restful',
  },
  {
    key: 'fatigue',
    label: 'Physical Fatigue',
    desc: 'How much physical fatigue do you feel?',
    lowLabel: '1 Fresh',
    highLabel: '10 Exhausted',
    isInverted: true,
  },
  {
    key: 'soreness',
    label: 'Muscle Soreness',
    desc: 'How sore are your muscles?',
    lowLabel: '1 None',
    highLabel: '10 Severe',
    isInverted: true,
  },
  {
    key: 'mentalStress',
    label: 'Mental Stress',
    desc: 'What is your current stress level?',
    lowLabel: '1 Low',
    highLabel: '10 Extreme',
    isInverted: true,
  },
  {
    key: 'motivation',
    label: 'Motivation / Desire to Train',
    desc: 'How motivated are you to exercise?',
    lowLabel: '1 Low',
    highLabel: '10 High',
  },
];

export function DailyCheckin({ userId, onNavigate, onBack, onCheckinSaved }: DailyCheckinProps) {
  const [checkin, setCheckin] = useState<Partial<DailySubjectiveCheckin> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGarminComparison, setShowGarminComparison] = useState(false);
  const [recoverySnapshot, setRecoverySnapshot] = useState<Awaited<ReturnType<typeof recoverySnapshotService.getRecoverySnapshotByDate>>>(null);
  const [pendingFollowups, setPendingFollowups] = useState<Array<{ region: BodyRegion; sessionRef?: RegionTissueResponse['sourceSessionRef'] }>>([]);
  const [pendingTissueRegion, setPendingTissueRegion] = useState<BodyRegion | ''>('');

  const tissueSelectId = useId();
  const timeInputId = useId();
  const modalitySelectId = useId();
  const notesInputId = useId();

  const loadTodayCheckin = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const today = getLocalDateString();

      try {
        const existing = await checkinService.getCheckin(userId, today);
        const snapshot = await recoverySnapshotService.getRecoverySnapshotByDate(userId, today);
        setRecoverySnapshot(snapshot ?? null);

        // Check if yesterday's checkin or session logged tissue reactions requiring
        // follow-up (M1.7), generalized (M5.2) to also derive candidate regions from
        // yesterday's own completed session_executions via M3.5 tissue tags -- so a novel
        // session the athlete never manually flagged a region for during/after still gets
        // asked about a region its own movements make relevant. A region the athlete's own
        // manual tissueResponses flag already covers takes priority (keeps whatever
        // sourceSessionRef that flag already carries); the session-derived scan only fills
        // in what the athlete didn't already flag. Legacy strength_sessions are out of this
        // generalization's scope -- their own manual tissueResponses flag still works
        // unchanged, exactly as before M5.2.
        const yesterday = addDaysToLocalDateString(today, -1);
        const yesterdayCheckin = await checkinService.getCheckin(userId, yesterday);
        const needed: Array<{ region: BodyRegion; sessionRef?: RegionTissueResponse['sourceSessionRef'] }> = [];
        const coveredRegionSessionKeys = new Set<string>();
        if (yesterdayCheckin?.tissueResponses) {
          for (const [regionKey, response] of Object.entries(yesterdayCheckin.tissueResponses)) {
            const region = regionKey as BodyRegion;
            if (response && (response.painDuringTraining || response.afterTrainingState || response.sourceSessionRef)) {
              const sessionKey = response.sourceSessionRef ? `${response.sourceSessionRef.kind}:${response.sourceSessionRef.id}` : 'checkin';
              coveredRegionSessionKeys.add(`${sessionKey}:${region}`);
              if (!existing?.tissueResponses?.[region]?.nextMorningReaction) {
                needed.push({ region, sessionRef: response.sourceSessionRef });
              }
            }
          }
        }
        try {
          const { executions } = await sessionExecutionService.getExecutionsInRange(userId, yesterday, today);
          for (const { execution, entries } of executions) {
            if (execution.state === 'in_progress') continue;
            const exerciseIds: string[] = [];
            for (const entry of entries) {
              if (entry.exerciseRef?.kind === 'catalog') exerciseIds.push(entry.exerciseRef.exerciseId);
            }
            const facets = exerciseIds
              .map(id => EXERCISES.find(item => item.id === id)?.facets)
              .filter((facet): facet is NonNullable<typeof facet> => !!facet);
            const sessionRef: RegionTissueResponse['sourceSessionRef'] = { kind: 'execution', id: execution.executionId, date: execution.date };
            const sessionKey = `execution:${execution.executionId}`;
            for (const region of relevantFollowupRegions(facets)) {
              const key = `${sessionKey}:${region}`;
              if (coveredRegionSessionKeys.has(key)) continue;
              coveredRegionSessionKeys.add(key);
              if (existing?.tissueResponses?.[region]?.nextMorningReaction) continue;
              needed.push({ region, sessionRef });
            }
          }
        } catch {
          // Session-derived candidates are an enhancement, not a requirement -- a failed
          // read here must not block the check-in itself from loading.
        }
        setPendingFollowups(needed);

        if (existing) {
          setCheckin(existing);
        } else {
          // Do not fabricate neutral subjective observations. Missing scores remain null so
          // they cannot contaminate the athlete's longitudinal subjective baseline; the
          // engine already has a neutral fallback for a deliberately partial safety check-in.
          setCheckin({
            userId,
            date: today,
            readiness: null,
            sleepQuality: null,
            fatigue: null,
            soreness: null,
            mentalStress: null,
            motivation: null,
            painOrInjury: false,
            illnessSymptoms: false,
            healthContext: {
              symptoms: { present: false },
              alcoholDrinksLast24h: 0,
              travelDisruption: 'none',
            },
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: {
              timeAvailableMin: null,
              preferredModalityToday: null,
              indoorOnly: false,
            },
            notes: null,
            submittedAt: new Date().toISOString(),
            dataQuality: {
              isComplete: false,
              missingFields: [],
            },
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as DailySubjectiveCheckin);
        }
      } catch (serviceError: unknown) {
        console.error('Service error loading check-in:', serviceError);
        setError(`Couldn't load today's check-in: ${getErrorMessage(serviceError)}`);
      }
    } catch (err) {
      console.error('Unexpected error loading check-in:', err);
      setError('Failed to load check-in');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadTodayCheckin();
  }, [loadTodayCheckin]);

  const handleScaleChange = (field: ScaleConfig['key'], value: number) => {
    if (!checkin) return;
    setCheckin({ ...checkin, [field]: value });
  };

  const handleApplyTypicalPreset = () => {
    if (!checkin) return;
    setCheckin({
      ...checkin,
      readiness: 7,
      sleepQuality: 7,
      fatigue: 3,
      soreness: 2,
      mentalStress: 3,
      motivation: 8,
    });
  };

  const handleBooleanToggle = (field: 'painOrInjury' | 'illnessSymptoms' | 'alreadyTrainedToday') => {
    if (!checkin) return;
    const next = !checkin[field];
    if (field === 'illnessSymptoms') {
      setCheckin({
        ...checkin,
        illnessSymptoms: next,
        healthContext: {
          ...(checkin.healthContext ?? {}),
          symptoms: next
            ? { ...(checkin.healthContext?.symptoms ?? {}), present: true }
            : { present: false },
        },
      });
      return;
    }
    // The hard pain/injury flag and graded tissue observations are independent channels.
    // Turning the hard flag off must not erase a valid mild/moderate tissue observation.
    setCheckin({ ...checkin, [field]: next });
  };

  const handleHealthContextChange = (healthContext: HealthContextCheckin) => {
    if (!checkin) return;
    setCheckin({
      ...checkin,
      healthContext,
      ...(healthContext.symptoms ? { illnessSymptoms: healthContext.symptoms.present } : {}),
    });
  };

  const handleAddTissueRegion = (region: BodyRegion, morningState: TissueResponseLevel) => {
    if (!checkin) return;
    const existing = checkin.tissueResponses ?? {};
    if (existing[region]) return;
    const entry: RegionTissueResponse = { region, morningState };
    setCheckin({
      ...checkin,
      tissueResponses: { ...existing, [region]: entry },
      ...(morningState === 'severe' ? { painOrInjury: true } : {}),
    });
    setPendingTissueRegion('');
  };

  const handleRemoveTissueRegion = (region: BodyRegion) => {
    if (!checkin) return;
    const remaining = { ...(checkin.tissueResponses ?? {}) };
    delete remaining[region];
    setCheckin({ ...checkin, tissueResponses: remaining });
  };

  const handleTissueFieldChange = (
    region: BodyRegion,
    field: keyof RegionTissueResponse,
    value: TissueResponseLevel | '',
  ) => {
    if (!checkin) return;
    const existing = checkin.tissueResponses?.[region];
    if (!existing) return;
    const updated: RegionTissueResponse = { ...existing };
    if (field !== 'region' && field !== 'sourceSessionRef') {
      if (value === '') delete updated[field];
      else (updated as unknown as Record<string, unknown>)[field] = value;
    }
    setCheckin({
      ...checkin,
      tissueResponses: { ...checkin.tissueResponses, [region]: updated },
      ...(value === 'severe' ? { painOrInjury: true } : {}),
    });
  };

  const handleAnswerFollowup = async (
    region: BodyRegion,
    level: TissueResponseLevel,
    sessionRef?: RegionTissueResponse['sourceSessionRef'],
  ) => {
    if (!checkin) return;
    const currentResponses = { ...(checkin.tissueResponses ?? {}) };
    const existingEntry = currentResponses[region] ?? { region, morningState: level };
    currentResponses[region] = {
      ...existingEntry,
      nextMorningReaction: level,
      ...(sessionRef ? { sourceSessionRef: sessionRef } : {}),
    };
    const updatedCheckin: Partial<DailySubjectiveCheckin> = {
      ...checkin,
      tissueResponses: currentResponses,
      // Mild/moderate already tighten the graded tissue policy. Only a severe response
      // promotes the separate hard pain/injury flag that caps the plan at Mobility.
      painOrInjury: level === 'severe' ? true : checkin.painOrInjury,
    };
    setCheckin(updatedCheckin);
    setPendingFollowups(prev => prev.filter(item => !(item.region === region && item.sessionRef?.id === sessionRef?.id && item.sessionRef?.kind === sessionRef?.kind)));
    if (checkin.userId && checkin.date) {
      await checkinService.upsertTodayCheckin(checkin.userId, updatedCheckin);
    }
    // M5.2: one session-level SessionResponse per session for the next_morning window --
    // several regions of the same session must not create duplicates, so an existing one
    // is checked for first. The tissue value itself is never written here or duplicated
    // into it (D-MRESP) -- the check-in write above is the only tissue authority.
    if (sessionRef && checkin.userId && checkin.date) {
      try {
        const already = await sessionResponseService.getResponseForWindow(checkin.userId, sessionRef, 'next_morning');
        if (!already) {
          await sessionResponseService.recordResponse(checkin.userId, sessionRef, 'next_morning', checkin.date, checkin.date, {});
        }
      } catch {
        // Best-effort session-level linkage; the tissue answer above already succeeded and
        // remains the source of truth injuryPolicy.ts/D-SUBJFLOOR consume.
      }
    }
  };

  const handleSkipFollowup = (region: BodyRegion, sessionRef?: RegionTissueResponse['sourceSessionRef']) => {
    setPendingFollowups(prev => prev.filter(item => !(item.region === region && item.sessionRef?.id === sessionRef?.id && item.sessionRef?.kind === sessionRef?.kind)));
  };

  const handleAvailabilityChange = (field: string, value: number | string | boolean | null) => {
    if (!checkin) return;
    setCheckin({
      ...checkin,
      availability: {
        ...checkin.availability,
        [field]: value,
      } as DailySubjectiveCheckin['availability'],
    });
  };

  const handleNotesChange = (value: string) => {
    if (!checkin) return;
    setCheckin({ ...checkin, notes: value || null });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!checkin) return;

    try {
      setSaving(true);
      setError(null);
      const now = new Date().toISOString();
      const isFirstSubmission = !checkin.initialSubmittedAt || !checkin.dataQuality?.isComplete;

      const checkinToSave: Partial<DailySubjectiveCheckin> = {
        ...checkin,
        submittedAt: now,
        initialSubmittedAt: isFirstSubmission ? now : checkin.initialSubmittedAt,
        editedAfterWearableReveal: !isFirstSubmission,
      };

      const result = await checkinService.upsertTodayCheckin(userId, checkinToSave);
      setCheckin(result);
      if (onCheckinSaved) await onCheckinSaved();
      onNavigate('home');
    } catch (err: unknown) {
      console.error('Unexpected error saving check-in:', err);
      setError(getErrorMessage(err) || 'Failed to save check-in');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="checkin-container">
        <div className="loading-state">
          <p>Loading check-in...</p>
        </div>
      </div>
    );
  }

  if (error && !checkin) {
    return (
      <div className="checkin-container">
        <div className="checkin-header-bar">
          <button type="button" onClick={onBack ?? (() => onNavigate('home'))} className="back-btn">
            ← Back
          </button>
        </div>
        <div className="error-card" role="alert">
          <p>{error}</p>
          <button type="button" className="btn-primary" onClick={loadTodayCheckin}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!checkin) {
    return (
      <div className="checkin-container">
        <div className="error-state">
          <p>Failed to load check-in</p>
          <button type="button" onClick={loadTodayCheckin}>Retry</button>
        </div>
      </div>
    );
  }

  const answeredSubjectiveCount = SCALES.filter(scale => typeof checkin[scale.key] === 'number').length;
  const wearableRevealAllowed = Boolean(checkin.initialSubmittedAt && checkin.dataQuality?.isComplete);
  const tissueResponses = Object.values(checkin.tissueResponses ?? {}).filter(
    (response): response is RegionTissueResponse => response !== undefined,
  );
  const isAlreadySubmitted = isCompletedSubjectiveCheckin(checkin);

  return (
    <div className="checkin-container">
      <div className="checkin-header-bar">
        {onBack && (
          <button
            type="button"
            className="back-btn"
            onClick={onBack}
            aria-label={isAlreadySubmitted ? 'Back to Dashboard' : 'Skip to Dashboard'}
          >
            {isAlreadySubmitted ? '← Back to Dashboard' : '← Skip to Dashboard'}
          </button>
        )}
        <div className="checkin-title-group">
          <h1>Morning Check-in</h1>
          <span className="checkin-date-badge">Today · {checkin.date || getLocalDateString()}</span>
        </div>
      </div>

      {isAlreadySubmitted && (
        <aside className="checkin-completed-banner" role="status">
          <div className="checkin-completed-content">
            <span className="checkin-completed-icon">✓</span>
            <div className="checkin-completed-text">
              <strong>Today&apos;s check-in was submitted</strong>
              <p>You can update your entries below anytime, or go straight to today&apos;s plan.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-view-plan-direct"
            onClick={onBack ?? (() => onNavigate('home'))}
          >
            View Today&apos;s Plan →
          </button>
        </aside>
      )}

      {pendingFollowups.length > 0 && (
        <aside className="followup-tissue-prompt" aria-label="Yesterday reaction prompt">
          <h4>Yesterday&apos;s Training Follow-up</h4>
          <p>
            How did your <strong>{REGION_LABELS[pendingFollowups[0].region]}</strong> react this morning after training?
          </p>
          <div className="followup-actions">
            {(['normal', 'mild', 'moderate', 'severe'] as const).map(lvl => (
              <button
                key={lvl}
                type="button"
                className="btn-followup-pill"
                title={TISSUE_LEVEL_HELP[lvl]}
                onClick={() => void handleAnswerFollowup(pendingFollowups[0].region, lvl, pendingFollowups[0].sessionRef)}
              >
                {TISSUE_LEVEL_LABELS[lvl]}
              </button>
            ))}
            <button
              type="button"
              className="btn-followup-skip"
              onClick={() => handleSkipFollowup(pendingFollowups[0].region, pendingFollowups[0].sessionRef)}
            >
              Skip
            </button>
          </div>
        </aside>
      )}

      <form className="checkin-form" onSubmit={handleSubmit}>
        {/* Section 1: Subjective State */}
        <section className="checkin-section" aria-label="Subjective state assessment">
          <div className="section-title-wrap">
            <h2>Subjective Recovery & State</h2>
            <p>Answer before viewing wearable data. {answeredSubjectiveCount}/6 scored; unanswered items remain missing rather than becoming artificial 5/10 values.</p>
          </div>

          <div className="checkin-preset-bar">
            <button
              type="button"
              className="btn-preset-typical"
              onClick={handleApplyTypicalPreset}
            >
              ⚡ Feeling normal today? Use typical values
            </button>
          </div>

          <div className="scales-list">
            {SCALES.map((scale) => (
              <SubjectiveScaleRow
                key={scale.key}
                id={scale.key}
                label={scale.label}
                desc={scale.desc}
                value={(checkin[scale.key] as number | null | undefined) ?? null}
                lowLabel={scale.lowLabel}
                highLabel={scale.highLabel}
                isInverted={scale.isInverted}
                onChange={(nextVal) => handleScaleChange(scale.key, nextVal)}
              />
            ))}
          </div>
          {answeredSubjectiveCount < SCALES.length && (
            <p className="checkin-helper-text">
              You can still save an incomplete check-in to report a safety issue. Only fully scored days enter the longitudinal subjective baseline.
            </p>
          )}
        </section>

        {/* Section 2: Health & Safety Flags */}
        <section className="checkin-section" aria-label="Health and safety status">
          <div className="section-title-wrap">
            <h2>Health & Safety</h2>
            <p>Hard safety flags are separate from graded local tissue response.</p>
          </div>

          <div className="boolean-options-grid">
            <label className={`boolean-toggle-card ${checkin.painOrInjury ? 'is-active is-warning' : ''}`}>
              <input
                type="checkbox"
                checked={checkin.painOrInjury || false}
                onChange={() => handleBooleanToggle('painOrInjury')}
              />
              <span className="toggle-checkmark"></span>
              <div className="toggle-info">
                <strong>Active Pain or Injury</strong>
                <span>Hard safety flag for a current issue that should strongly restrict training</span>
              </div>
            </label>

            <label className={`boolean-toggle-card ${checkin.illnessSymptoms ? 'is-active is-warning' : ''}`}>
              <input
                type="checkbox"
                checked={checkin.illnessSymptoms || false}
                onChange={() => handleBooleanToggle('illnessSymptoms')}
              />
              <span className="toggle-checkmark"></span>
              <div className="toggle-info">
                <strong>Illness Symptoms</strong>
                <span>Feeling sick, feverish, or systemically unwell</span>
              </div>
            </label>

            <label className={`boolean-toggle-card ${checkin.alreadyTrainedToday ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={checkin.alreadyTrainedToday || false}
                onChange={() => handleBooleanToggle('alreadyTrainedToday')}
              />
              <span className="toggle-checkmark"></span>
              <div className="toggle-info">
                <strong>Already Trained Today</strong>
                <span>Recommend rest or recovery only</span>
              </div>
            </label>
          </div>

          <HealthContextSection
            value={checkin.healthContext}
            symptomsPresent={Boolean(checkin.illnessSymptoms)}
            manualPhysiologyMissing={{
              rhr: recoverySnapshot?.raw.restingHr == null,
              hrv: recoverySnapshot?.raw.hrvOvernightAvg == null,
              respiration: recoverySnapshot?.raw.respirationAvg == null,
            }}
            onChange={handleHealthContextChange}
          />

          <div className="tissue-response-expanded" aria-label="Local tissue response">
            <div className="tissue-response-intro">
              <h3>Local Tissue Response</h3>
              <p>
                Report local stiffness, swelling/fullness, unusual tendon or calf soreness, or altered walking/stairs/squat even when you would not call it an injury. Local tissue response can tighten today&apos;s plan independently of Garmin readiness.
              </p>
            </div>

            <div className="form-group add-region-group">
              <label htmlFor={tissueSelectId}>Add body area to monitor</label>
              <select
                id={tissueSelectId}
                className="select-input"
                value={pendingTissueRegion}
                onChange={(e) => setPendingTissueRegion(e.target.value as BodyRegion | '')}
              >
                <option value="">Select a region…</option>
                {BODY_REGIONS.filter(region => !checkin.tissueResponses?.[region]).map(region => (
                  <option key={region} value={region}>{REGION_LABELS[region]}</option>
                ))}
              </select>
            </div>

            {pendingTissueRegion && (
              <div className="followup-tissue-prompt" aria-label={`Morning state for ${REGION_LABELS[pendingTissueRegion]}`}>
                <p>How does your <strong>{REGION_LABELS[pendingTissueRegion]}</strong> feel this morning?</p>
                <div className="followup-actions">
                  {TISSUE_LEVELS.map(level => (
                    <button
                      key={level}
                      type="button"
                      className="btn-followup-pill"
                      title={TISSUE_LEVEL_HELP[level]}
                      onClick={() => handleAddTissueRegion(pendingTissueRegion, level)}
                    >
                      {TISSUE_LEVEL_LABELS[level]}
                    </button>
                  ))}
                </div>
                <small>Normal = no meaningful change · Mild = noticeable but normal function · Moderate = changes function/load · Severe = marked pain/swelling/instability or significant function loss</small>
              </div>
            )}

            {tissueResponses.length === 0 && !pendingTissueRegion && (
              <p className="checkin-helper-text">No local tissue issue reported today.</p>
            )}

            {tissueResponses.map(response => {
              const region = response.region;
              return (
                <article className="tissue-region-card" key={region}>
                  <div className="tissue-region-header">
                    <strong>{REGION_LABELS[region]}</strong>
                    <button
                      type="button"
                      className="tissue-region-remove"
                      onClick={() => handleRemoveTissueRegion(region)}
                      aria-label={`Remove ${REGION_LABELS[region]}`}
                    >
                      ✕ Remove
                    </button>
                  </div>

                  <div className="tissue-region-fields">
                    <div className="form-group">
                      <label htmlFor={`${region}-morningState`}>This morning (resting/waking)</label>
                      <select
                        id={`${region}-morningState`}
                        className="select-input"
                        value={response.morningState}
                        onChange={(e) => handleTissueFieldChange(region, 'morningState', e.target.value as TissueResponseLevel)}
                      >
                        {TISSUE_LEVELS.map(level => (
                          <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`${region}-painDuringTraining`}>Pain during training (if any)</label>
                      <select
                        id={`${region}-painDuringTraining`}
                        className="select-input"
                        value={response.painDuringTraining ?? ''}
                        onChange={(e) => handleTissueFieldChange(region, 'painDuringTraining', e.target.value as TissueResponseLevel | '')}
                      >
                        <option value="">Did not train / not applicable</option>
                        {TISSUE_LEVELS.map(level => (
                          <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`${region}-afterTrainingState`}>Right after training</label>
                      <select
                        id={`${region}-afterTrainingState`}
                        className="select-input"
                        value={response.afterTrainingState ?? ''}
                        onChange={(e) => handleTissueFieldChange(region, 'afterTrainingState', e.target.value as TissueResponseLevel | '')}
                      >
                        <option value="">Did not train / not applicable</option>
                        {TISSUE_LEVELS.map(level => (
                          <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`${region}-nextMorningReaction`}>Reaction to yesterday&apos;s session</label>
                      <select
                        id={`${region}-nextMorningReaction`}
                        className="select-input"
                        value={response.nextMorningReaction ?? ''}
                        onChange={(e) => handleTissueFieldChange(region, 'nextMorningReaction', e.target.value as TissueResponseLevel | '')}
                      >
                        <option value="">No session yesterday / not applicable</option>
                        {TISSUE_LEVELS.map(level => (
                          <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Section 3: Availability & Notes */}
        <section className="checkin-section" aria-label="Session availability">
          <div className="section-title-wrap">
            <h2>Today&apos;s Availability</h2>
            <p>Time and environment preferences for today&apos;s session</p>
          </div>

          <div className="availability-grid">
            <div className="form-group">
              <label htmlFor={timeInputId}>Time Available (minutes)</label>
              <input
                id={timeInputId}
                type="number"
                min="0"
                max="1440"
                placeholder="e.g. 60"
                value={checkin.availability?.timeAvailableMin ?? ''}
                onChange={(e) => handleAvailabilityChange('timeAvailableMin', e.target.value === '' ? null : Number(e.target.value))}
                className="number-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor={modalitySelectId}>Preferred Modality</label>
              <select
                id={modalitySelectId}
                value={checkin.availability?.preferredModalityToday || ''}
                onChange={(e) => handleAvailabilityChange('preferredModalityToday', e.target.value || null)}
                className="select-input"
              >
                <option value="">Coach Choice / No preference</option>
                <option value="Running">Running</option>
                <option value="Cycling">Cycling</option>
                <option value="Strength">Strength Training</option>
                <option value="Mobility">Mobility/Recovery</option>
                <option value="Swimming">Swimming</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <label className={`boolean-toggle-card indoor-toggle ${checkin.availability?.indoorOnly ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={checkin.availability?.indoorOnly || false}
              onChange={(e) => handleAvailabilityChange('indoorOnly', e.target.checked)}
            />
            <span className="toggle-checkmark"></span>
            <div className="toggle-info">
              <strong>Indoor Only</strong>
              <span>Limit session to indoor options (trainer, treadmill, gym)</span>
            </div>
          </label>

          <div className="form-group notes-group">
            <label htmlFor={notesInputId}>Athlete Notes (optional)</label>
            <textarea
              id={notesInputId}
              value={checkin.notes || ''}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Any sensations, soreness notes, or travel context..."
              rows={2}
              className="textarea-input"
            />
          </div>
        </section>

        {/* Objective values remain hidden until a complete subjective submission prevents anchoring. */}
        {recoverySnapshot && (
          <section className="checkin-garmin-disclosure">
            {!wearableRevealAllowed ? (
              <div className="garmin-context-content" aria-label="Garmin context hidden">
                <strong>Garmin context hidden during first subjective check-in</strong>
                <p>Complete and save the six subjective scores first. This keeps your self-report independent from wearable feedback.</p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="garmin-context-toggle"
                  onClick={() => setShowGarminComparison(prev => !prev)}
                  aria-expanded={showGarminComparison}
                >
                  <span>📊 Garmin Context</span>
                  <span className="toggle-arrow">{showGarminComparison ? '▲' : '▼'}</span>
                </button>

                {showGarminComparison && (
                  <div className="garmin-context-content">
                    <div className="garmin-metric-pill">
                      <span className="pill-label">Sleep Score</span>
                      <span className="pill-val">{recoverySnapshot.raw.sleepScore ?? '--'}</span>
                      <small>7d {recoverySnapshot.derived.sleepScore7dAvg ?? '--'}</small>
                    </div>
                    <div className="garmin-metric-pill">
                      <span className="pill-label">Resting HR</span>
                      <span className="pill-val">{recoverySnapshot.raw.restingHr != null ? `${recoverySnapshot.raw.restingHr} bpm` : '--'}</span>
                      <small>7d {recoverySnapshot.derived.restingHr7dAvg != null ? `${recoverySnapshot.derived.restingHr7dAvg} bpm` : '--'}</small>
                    </div>
                    <div className="garmin-metric-pill">
                      <span className="pill-label">HRV Overnight</span>
                      <span className="pill-val">{recoverySnapshot.raw.hrvOvernightAvg != null ? `${recoverySnapshot.raw.hrvOvernightAvg} ms` : '--'}</span>
                      <small>7d {recoverySnapshot.derived.hrv7dAvg != null ? `${recoverySnapshot.derived.hrv7dAvg} ms` : '--'}</small>
                    </div>
                    <div className="garmin-metric-pill">
                      <span className="pill-label">Respiration</span>
                      <span className="pill-val">{recoverySnapshot.raw.respirationAvg != null ? `${recoverySnapshot.raw.respirationAvg} br/min` : '--'}</span>
                      <small>7d {recoverySnapshot.derived.respiration7dAvg != null ? `${recoverySnapshot.derived.respiration7dAvg} br/min` : '--'}</small>
                    </div>
                    <div className="garmin-metric-pill">
                      <span className="pill-label">Body Battery</span>
                      <span className="pill-val">{recoverySnapshot.raw.bodyBatteryWake ?? '--'} / 100</span>
                    </div>
                    {recoverySnapshot.raw.spo2?.avgPct != null && (
                      <div className="garmin-metric-pill">
                        <span className="pill-label">SpO2 Pulse Ox</span>
                        <span className="pill-val">{recoverySnapshot.raw.spo2.avgPct}%</span>
                        {recoverySnapshot.raw.spo2.minPct != null && <small>min {recoverySnapshot.raw.spo2.minPct}%</small>}
                      </div>
                    )}
                    {recoverySnapshot.raw.skinTempDeviationCelsius != null && (
                      <div className="garmin-metric-pill">
                        <span className="pill-label">Skin Temp Dev</span>
                        <span className="pill-val">
                          {recoverySnapshot.raw.skinTempDeviationCelsius > 0 ? '+' : ''}
                          {recoverySnapshot.raw.skinTempDeviationCelsius}°C
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {/* Sticky Action Footer */}
        <div className="checkin-sticky-footer">
          <button
            type="submit"
            className="btn-primary checkin-submit-btn"
            disabled={saving}
          >
            {saving
              ? 'Saving check-in…'
              : isAlreadySubmitted
              ? "Update & see today's plan"
              : "Save & see today's plan"}
          </button>
        </div>
      </form>
    </div>
  );
}
