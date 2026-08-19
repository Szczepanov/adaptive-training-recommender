import { useState, useEffect, useCallback, useId } from 'react';
import { checkinService } from '../services/checkinService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import type { BodyRegion, DailySubjectiveCheckin, RegionTissueResponse, TissueResponseLevel } from '../engine/models';
import { BODY_REGIONS, TISSUE_LEVELS } from '../engine/models';
import { getLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { getErrorMessage } from '../utils/errors';
import type { Screen } from '../types/navigation';
import { SubjectiveScaleRow } from './checkin/SubjectiveScaleRow';
import './DailyCheckin.css';

interface DailyCheckinProps {
  userId: string;
  onNavigate: (screen: Screen) => void;
  onBack?: () => void;
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
    label: 'Motivation',
    desc: 'How motivated are you to exercise?',
    lowLabel: '1 Low',
    highLabel: '10 High',
  },
];

export function DailyCheckin({ userId, onNavigate, onBack }: DailyCheckinProps) {
  const [checkin, setCheckin] = useState<Partial<DailySubjectiveCheckin> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGarminComparison, setShowGarminComparison] = useState(false);
  const [recoverySnapshot, setRecoverySnapshot] = useState<Awaited<ReturnType<typeof recoverySnapshotService.getRecoverySnapshotByDate>>>(null);
  const [pendingFollowups, setPendingFollowups] = useState<Array<{ region: BodyRegion; sessionRef?: RegionTissueResponse['sourceSessionRef'] }>>([]);

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

        // Check if yesterday's checkin or session logged tissue reactions requiring follow-up (M1.7)
        const yesterday = addDaysToLocalDateString(today, -1);
        const yesterdayCheckin = await checkinService.getCheckin(userId, yesterday);
        if (yesterdayCheckin?.tissueResponses) {
          const needed: Array<{ region: BodyRegion; sessionRef?: RegionTissueResponse['sourceSessionRef'] }> = [];
          for (const [regionKey, response] of Object.entries(yesterdayCheckin.tissueResponses)) {
            const region = regionKey as BodyRegion;
            if (response && (response.painDuringTraining || response.afterTrainingState || response.sourceSessionRef)) {
              if (!existing?.tissueResponses?.[region]?.nextMorningReaction) {
                needed.push({ region, sessionRef: response.sourceSessionRef });
              }
            }
          }
          setPendingFollowups(needed);
        }

        if (existing) {
          setCheckin(existing);
        } else {
          // Initialize with neutral defaults
          setCheckin({
            userId,
            date: today,
            readiness: 5,
            sleepQuality: 5,
            fatigue: 5,
            soreness: 5,
            mentalStress: 5,
            motivation: 5,
            painOrInjury: false,
            illnessSymptoms: false,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: {
              timeAvailableMin: 60,
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

  const handleBooleanToggle = (field: 'painOrInjury' | 'illnessSymptoms' | 'unusuallyLimitedTime' | 'alreadyTrainedToday') => {
    if (!checkin) return;
    const next = !checkin[field];
    if (field === 'painOrInjury' && !next) {
      // Clear tissueResponses when pain/injury is turned off
      const cleared: Partial<DailySubjectiveCheckin> = { ...checkin, [field]: next };
      delete cleared.tissueResponses;
      setCheckin(cleared);
      return;
    }
    setCheckin({ ...checkin, [field]: next });
  };

  const handleAddTissueRegion = (region: BodyRegion) => {
    if (!checkin) return;
    const existing = checkin.tissueResponses ?? {};
    if (existing[region]) return;
    const entry: RegionTissueResponse = { region, morningState: 'mild' };
    setCheckin({ ...checkin, tissueResponses: { ...existing, [region]: entry } });
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
    setCheckin({ ...checkin, tissueResponses: { ...checkin.tissueResponses, [region]: updated } });
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
      painOrInjury: level !== 'normal' ? true : checkin.painOrInjury,
    };
    setCheckin(updatedCheckin);
    setPendingFollowups(prev => prev.filter(item => item.region !== region));
    if (checkin.userId && checkin.date) {
      await checkinService.upsertTodayCheckin(checkin.userId, updatedCheckin);
    }
  };

  const handleSkipFollowup = (region: BodyRegion) => {
    setPendingFollowups(prev => prev.filter(item => item.region !== region));
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

  return (
    <div className="checkin-container">
      <div className="checkin-header-bar">
        {onBack && (
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            ← Back
          </button>
        )}
        <div className="checkin-title-group">
          <h1>Morning Check-in</h1>
          <span className="checkin-date-badge">Today · {checkin.date || getLocalDateString()}</span>
        </div>
      </div>

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
                onClick={() => void handleAnswerFollowup(pendingFollowups[0].region, lvl, pendingFollowups[0].sessionRef)}
              >
                {TISSUE_LEVEL_LABELS[lvl]}
              </button>
            ))}
            <button
              type="button"
              className="btn-followup-skip"
              onClick={() => handleSkipFollowup(pendingFollowups[0].region)}
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
            <p>6 standard subjective dimensions scaled 1 to 10</p>
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
            {SCALES.map((scale) => {
              const val = (checkin[scale.key] as number) ?? 5;
              return (
                <SubjectiveScaleRow
                  key={scale.key}
                  id={scale.key}
                  label={scale.label}
                  desc={scale.desc}
                  value={val}
                  lowLabel={scale.lowLabel}
                  highLabel={scale.highLabel}
                  isInverted={scale.isInverted}
                  onChange={(nextVal) => handleScaleChange(scale.key, nextVal)}
                />
              );
            })}
          </div>
        </section>

        {/* Section 2: Health & Safety Flags */}
        <section className="checkin-section" aria-label="Health and safety status">
          <div className="section-title-wrap">
            <h2>Health & Safety</h2>
            <p>Safety constraints that protect your recovery and tissue health</p>
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
                <strong>Pain or Injury</strong>
                <span>Active physical issue requiring load restriction</span>
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
                <span>Feeling sick, feverish, or unwell</span>
              </div>
            </label>

            <label className={`boolean-toggle-card ${checkin.unusuallyLimitedTime ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={checkin.unusuallyLimitedTime || false}
                onChange={() => handleBooleanToggle('unusuallyLimitedTime')}
              />
              <span className="toggle-checkmark"></span>
              <div className="toggle-info">
                <strong>Limited Time</strong>
                <span>Have less time available than normal</span>
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

          {checkin.painOrInjury && (
            <div className="tissue-response-expanded">
              <div className="tissue-response-intro">
                <h3>Affected Body Regions</h3>
                <p>Pinpointing where and when helps calibrate safe session substitutions.</p>
              </div>

              <div className="form-group add-region-group">
                <label htmlFor={tissueSelectId}>Add affected body area</label>
                <select
                  id={tissueSelectId}
                  className="select-input"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAddTissueRegion(e.target.value as BodyRegion);
                  }}
                >
                  <option value="">Select an affected region…</option>
                  {BODY_REGIONS.filter(region => !checkin.tissueResponses?.[region]).map(region => (
                    <option key={region} value={region}>{REGION_LABELS[region]}</option>
                  ))}
                </select>
              </div>

              {Object.values(checkin.tissueResponses ?? {}).map(response => {
                if (!response) return null;
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
          )}
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
                value={checkin.availability?.timeAvailableMin ?? 60}
                onChange={(e) => handleAvailabilityChange('timeAvailableMin', Number(e.target.value))}
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

        {/* Section 4: Secondary Garmin Recovery Context Disclosure */}
        {recoverySnapshot && (
          <section className="checkin-garmin-disclosure">
            <button
              type="button"
              className="garmin-context-toggle"
              onClick={() => setShowGarminComparison(prev => !prev)}
              aria-expanded={showGarminComparison}
            >
              <span>📊 Garmin Context ({recoverySnapshot.raw.sleepScore ? `Sleep ${recoverySnapshot.raw.sleepScore}` : 'Synced'})</span>
              <span className="toggle-arrow">{showGarminComparison ? '▲' : '▼'}</span>
            </button>

            {showGarminComparison && (
              <div className="garmin-context-content">
                <div className="garmin-metric-pill">
                  <span className="pill-label">Sleep Score</span>
                  <span className="pill-val">{recoverySnapshot.raw.sleepScore ?? '--'}</span>
                </div>
                <div className="garmin-metric-pill">
                  <span className="pill-label">Resting HR</span>
                  <span className="pill-val">{recoverySnapshot.raw.restingHr ? `${recoverySnapshot.raw.restingHr} bpm` : '--'}</span>
                </div>
                <div className="garmin-metric-pill">
                  <span className="pill-label">HRV Overnight</span>
                  <span className="pill-val">{recoverySnapshot.raw.hrvOvernightAvg ? `${recoverySnapshot.raw.hrvOvernightAvg} ms` : '--'}</span>
                </div>
                <div className="garmin-metric-pill">
                  <span className="pill-label">Body Battery</span>
                  <span className="pill-val">{recoverySnapshot.raw.bodyBatteryWake ?? '--'} / 100</span>
                </div>
              </div>
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
            {saving ? 'Saving check-in…' : "Save & see today's plan"}
          </button>
        </div>
      </form>
    </div>
  );
}
