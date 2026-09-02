import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  activeExternalPlanService,
  type ActiveExternalPlan,
} from '../services/activeExternalPlanService';
import { externalPlanService } from '../services/externalPlanService';
import { fixedActivityService } from '../services/fixedActivityService';
import { planBlockService } from '../services/planBlockService';
import { decisionComposer } from '../engine/composer';
import {
  applyConfirmedProposal,
  proposeReplacement,
  type ReplacementProposal,
} from '../engine/externalPlacement';
import { critiqueExternalWeek, type ExternalWeekCritique } from '../engine/externalCritique';
import { resolveTrainingIntent, prepareTrainingHistorySnapshot } from '../engine/trainingIntent';
import { computeInternalResponseStrain } from '../engine/fatigue';
import { generateWeekAheadPlanWithIntent, trailingHistoryFromCompletedExposures, type WeekAheadPlan } from '../engine/planner';
import { mapSnapshotToEngineInput, mapCheckinToSubjectiveInput, mapGoalsToUserEvents, mapContextFromGoalsAndTrainingSettings } from '../engine/adapters';
import { evaluateTrainingWithIntent, evaluateNextDayPlanWithIntent } from '../engine/rules';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import { resolvePlanningContext } from '../engine/planningMode';
import {
  canGenerateNormalRecommendation,
  getMinimumSafetyCheckinStatus,
} from '../engine/safetyCheckin';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import type {
  ExternalPlacementAssignment,
  ExternalPlanPlacement,
  FixedActivity,
  DailyDecisionInput,
  NextDayPotentialPlan,
} from '../engine/models';
import type { Screen } from '../types/navigation';
import { ExternalPlanWeek } from './ExternalPlanWeek';
import { ExternalPlanImport } from './ExternalPlanImport';
import { WeekAheadStrip } from './WeekAheadStrip';
import { GarminSyncNowButton } from './GarminSyncNowButton';
import type { ErrorRepairAction } from './errorRepairAction';
import './PlanView.css';

interface PlanViewProps {
  userId: string;
  onNavigate?: (screen: Screen) => void;
  onPlanChanged?: () => void;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function formatWeekRange(startDateStr: string): string {
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${addDaysToLocalDateString(startDateStr, 6)}T00:00:00Z`);
  return `${WEEKDAY_FORMATTER.format(start)} – ${WEEKDAY_FORMATTER.format(end)}`;
}

export const PlanView: React.FC<PlanViewProps> = ({ userId, onNavigate, onPlanChanged }) => {
  const today = useMemo(() => getLocalDateString(), []);
  const [activePlan, setActivePlan] = useState<ActiveExternalPlan | null>(null);
  const [critique, setCritique] = useState<ExternalWeekCritique | null>(null);
  const [fixedActivities, setFixedActivities] = useState<FixedActivity[]>([]);
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [weekAheadPlan, setWeekAheadPlan] = useState<WeekAheadPlan | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [selectedNextDayTier, setSelectedNextDayTier] = useState<'green' | 'yellow' | 'red'>('green');
  const [viewMode, setViewMode] = useState<'imported' | 'ai_forecast'>('imported');
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forecastUnavailable, setForecastUnavailable] = useState<string | null>(null);
  const [forecastRepairTargets, setForecastRepairTargets] = useState<ErrorRepairAction[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState<boolean>(false);
  // SEP-C4: the imported-plan weekly view must fail closed the same way MorningDecisionCard
  // does -- suppress workout-step detail, export, and reschedule controls while active.
  const [clinicalEscalationRequired, setClinicalEscalationRequired] = useState<boolean>(false);

  const loadPlanData = useCallback(async () => {
    // Clear stale state on every reload attempt
    setLoading(true);
    setLoadError(null);
    setForecastUnavailable(null);
    setForecastRepairTargets([]);
    setWeekAheadPlan(null);
    setNextDayPlan(null);
    setCritique(null);
    setClinicalEscalationRequired(false);

    try {
      const weekEnd = addDaysToLocalDateString(today, 6);
      const [actState, blocksState, input] = await Promise.all([
        fixedActivityService.getActivitiesInRangeState(userId, today, weekEnd),
        planBlockService.getBlocksInRangeState(userId, today, weekEnd),
        decisionComposer.composeDailyDecisionInput(userId, today),
      ]);

      setDecisionInput(input);

      // P0: Enforce strict DataState semantics. Do NOT silently convert unavailable/invalid
      // schedule data into empty arrays.
      if (actState.status !== 'AVAILABLE' || blocksState.status !== 'AVAILABLE') {
        const unavailMsg =
          actState.status === 'UNAVAILABLE' || blocksState.status === 'UNAVAILABLE'
            ? 'Some schedule inputs are temporarily unavailable. Check your connection and retry.'
            : 'Schedule data could not be verified. Please retry before using this plan.';
        setForecastUnavailable(unavailMsg);
        setFixedActivities([]);
        setActivePlan(null);
        return;
      }

      // Check decision input source states like Home.tsx
      const decisionSourceFailure =
        input.sourceStates &&
        [input.sourceStates.activeGoals, input.sourceStates.preferences, input.sourceStates.trainingSettings].find(
          (state) => state.status === 'INVALID' || state.status === 'UNAVAILABLE',
        );
      if (decisionSourceFailure) {
        if (decisionSourceFailure.status === 'INVALID') {
          // Point the user at whichever screen owns the invalid document(s) so the error
          // is actionable rather than a dead end -- re-saving there re-runs validation
          // and clears the INVALID state.
          const repairTargets: ErrorRepairAction[] = [];
          if (input.sourceStates?.activeGoals.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'goals', label: 'Review goals' });
          if (input.sourceStates?.preferences.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'preferences', label: 'Review preferences' });
          if (input.sourceStates?.trainingSettings.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'constraints', label: 'Review training settings' });
          setForecastRepairTargets(repairTargets);
        }
        setForecastUnavailable(
          decisionSourceFailure.status === 'UNAVAILABLE'
            ? 'Decision inputs are temporarily unavailable. Please retry before generating a plan.'
            : 'Decision inputs need repair before generating a plan.',
        );
        return;
      }

      const recoveryState = input.sourceStates?.recoverySnapshot;
      if (recoveryState && recoveryState.status !== 'AVAILABLE' && recoveryState.status !== 'MISSING') {
        if (recoveryState.status === 'INVALID') {
          // A malformed stored snapshot is fixed by re-ingesting, not by re-reading it --
          // offer a forced resync instead of a dead-end Retry.
          setForecastRepairTargets([{ kind: 'resync' }]);
        }
        setForecastUnavailable(
          recoveryState.status === 'UNAVAILABLE'
            ? 'Recovery data is temporarily unavailable. Please retry before generating a plan.'
            : 'Recovery data needs repair before generating a plan.',
        );
        return;
      }

      const acts = actState.data;
      const blocks = blocksState.data;
      setFixedActivities(acts);

      // P0: Fail closed on activeExternalPlanState errors. INVALID or UNAVAILABLE must never
      // silently decay to MISSING / no plan, as that could discard athlete placements.
      const activePlanState = await activeExternalPlanService.getActivePlanState(userId, today, acts);
      if (activePlanState.status === 'INVALID' || activePlanState.status === 'UNAVAILABLE') {
        setForecastUnavailable(
          activePlanState.status === 'UNAVAILABLE'
            ? 'Your active coach plan is temporarily unavailable. Check your connection and retry.'
            : 'Your active coach plan could not be verified. Retry before using this schedule.',
        );
        setFixedActivities([]);
        setActivePlan(null);
        return;
      }

      const currentPlan = activePlanState.status === 'AVAILABLE' ? activePlanState.data : null;
      setActivePlan(currentPlan);

      // P0/P1: Verify minimum safety check-in status before generating normal adaptive forecast
      const safetyStatus = getMinimumSafetyCheckinStatus(input.subjectiveCheckin);
      const canGenerateNormalPlan = canGenerateNormalRecommendation(safetyStatus);

      if (input.recoverySnapshot && canGenerateNormalPlan) {
        const subjective = mapCheckinToSubjectiveInput(input.subjectiveCheckin);
        const objective = mapSnapshotToEngineInput(input.recoverySnapshot);
        const events = mapGoalsToUserEvents(input.activeGoals);
        const context = mapContextFromGoalsAndTrainingSettings(
          input.activeGoals,
          input.trainingSettings,
          input.preferences,
          today,
          input.subjectiveCheckin,
        );
        const forecastContext = mapContextFromGoalsAndTrainingSettings(
          input.activeGoals,
          input.trainingSettings,
          input.preferences,
          today,
          null,
        );
        const preparedSnapshot = await prepareTrainingHistorySnapshot(userId, today);

        if (currentPlan) {
          const intent = await resolveTrainingIntent(
            userId,
            events,
            today,
            { subjective, objective },
            7,
            undefined,
            preparedSnapshot ?? undefined,
            blocks,
            input.trainingIntentProfile,
          );

          setCritique(
            critiqueExternalWeek({
              weekStartDate: today,
              planId: currentPlan.plan.planId,
              revision: currentPlan.plan.revision,
              placed: currentPlan.placed,
              microcycle: intent.microcycle,
              fatigue: intent.fatigue,
              internalStrain: computeInternalResponseStrain({ subjective, objective }),
              internalStrainAsOf: today,
              weeklyCommitment: intent.planningContext.profile.weeklyCommitment,
              trailingHistory: trailingHistoryFromCompletedExposures(intent.history, today),
              fixedActivities: acts,
            }),
          );
        } else {
          setCritique(null);
        }

        // Generate the 7-day AI forecast
        if (preparedSnapshot) {
          const baseRec = await evaluateTrainingWithIntent(
            userId,
            { subjective, objective, subjectiveBaseline: input.subjectiveBaseline },
            context,
            events,
            today,
            undefined,
            undefined,
            preparedSnapshot,
            acts,
            blocks,
            input.trainingIntentProfile,
            input.preferences,
            'max',
            null,
          );
          setClinicalEscalationRequired(baseRec.envelopes?.safety.clinicalEscalationRequired === true);

          const tomorrowPlan = await evaluateNextDayPlanWithIntent(
            userId,
            events,
            { subjective, objective },
            forecastContext,
            today,
            baseRec,
            undefined,
            preparedSnapshot,
            acts,
            blocks,
            input.trainingIntentProfile,
            input.preferences,
          );
          setNextDayPlan(tomorrowPlan);

          const tomorrowRec =
            tomorrowPlan?.branches[selectedNextDayTier]?.recommendation ??
            tomorrowPlan?.branches.green.recommendation ??
            null;

          const forecast = await generateWeekAheadPlanWithIntent(
            userId,
            { subjective, objective },
            forecastContext,
            input.preferences,
            events,
            today,
            baseRec,
            tomorrowRec,
            { days: 7, fixedActivities: acts, authoredPlanBlocks: blocks },
            undefined,
            preparedSnapshot,
            input.trainingIntentProfile,
          );
          setWeekAheadPlan(forecast);
        }
      }
    } catch (err) {
      console.error('Failed to load plan or forecast in PlanView:', err);
      setLoadError('An unexpected error occurred while generating the plan. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [userId, today, selectedNextDayTier]);

  useEffect(() => {
    loadPlanData();
  }, [loadPlanData]);

  const handleProposeReplacement = useCallback(
    (sessionId: string, missedDate: string): ReplacementProposal => {
      if (!activePlan) throw new Error('No imported plan is active.');
      return proposeReplacement(
        activePlan.plan,
        activePlan.placement,
        sessionId,
        missedDate,
        { fixedActivities },
        today,
      );
    },
    [activePlan, fixedActivities, today],
  );

  const persistAssignments = useCallback(
    async (assignments: ExternalPlacementAssignment[]) => {
      if (!activePlan) return;
      setWriteError(null);
      try {
        await externalPlanService.savePlacement(userId, {
          planId: activePlan.plan.planId,
          revision: activePlan.plan.revision,
          assignments,
        });
      } catch (err) {
        console.error('Failed to save external plan placement:', err);
        setWriteError('That change could not be saved. Check your connection and try again.');
        throw err;
      }
      await loadPlanData();
      onPlanChanged?.();
    },
    [activePlan, userId, loadPlanData, onPlanChanged],
  );

  const handleConfirmReplacement = useCallback(
    async (proposal: ReplacementProposal) => {
      if (!activePlan) return;
      const overlay: ExternalPlanPlacement = activePlan.placement ?? {
        userId,
        planId: activePlan.plan.planId,
        revision: activePlan.plan.revision,
        assignments: [],
        updatedAt: '',
      };
      await persistAssignments(applyConfirmedProposal(overlay, proposal).assignments);
    },
    [activePlan, userId, persistAssignments],
  );

  const handleChooseDate = useCallback(
    async (sessionId: string, date: string) => {
      if (!activePlan) return;
      const existing = activePlan.placement?.assignments ?? [];
      await persistAssignments([
        ...existing.filter((item) => item.sessionId !== sessionId),
        { sessionId, date, status: 'moved' },
      ]);
    },
    [activePlan, persistAssignments],
  );

  const handlePlanImported = useCallback(() => {
    setShowImport(false);
    loadPlanData();
    onPlanChanged?.();
  }, [loadPlanData, onPlanChanged]);

  const resolvedPlanningMode = useMemo(() => {
    if (!decisionInput) return undefined;
    const events = mapGoalsToUserEvents(decisionInput.activeGoals);
    const todayPhase = evaluatePeriodizationPhase(events, today);
    return resolvePlanningContext(decisionInput.trainingIntentProfile, todayPhase, today).mode;
  }, [decisionInput, today]);

  const safetyCheckinStatus = useMemo(
    () => getMinimumSafetyCheckinStatus(decisionInput?.subjectiveCheckin),
    [decisionInput?.subjectiveCheckin],
  );
  const canGenerateAdaptiveForecast = canGenerateNormalRecommendation(safetyCheckinStatus);

  return (
    <div className="plan-view-container">
      <div className="plan-view-header">
        <div className="plan-view-title-group">
          <span className="plan-view-badge">Week Architecture</span>
          <h2 className="plan-view-heading">Training Plan</h2>
          <p className="plan-week-range">Next 7 days · {formatWeekRange(today)}</p>
        </div>
        <div className="plan-header-actions">
          <button
            type="button"
            className="plan-toggle-import-btn"
            onClick={() => setShowImport((prev) => !prev)}
          >
            {showImport ? '✕ Close Import' : activePlan ? '📥 Revise Plan' : '📥 Import Plan'}
          </button>
        </div>
      </div>

      {showImport && (
        <section className="plan-import-section" aria-label="Plan import and revision tool">
          <ExternalPlanImport userId={userId} onImported={handlePlanImported} />
        </section>
      )}

      {activePlan && (
        <div className="plan-view-mode-tabs" role="tablist" aria-label="Training plan views">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'imported'}
            className={`plan-tab-btn ${viewMode === 'imported' ? 'active' : ''}`}
            onClick={() => setViewMode('imported')}
          >
            📋 Coach's Plan ({activePlan.plan.title})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'ai_forecast'}
            className={`plan-tab-btn ${viewMode === 'ai_forecast' ? 'active' : ''}`}
            onClick={() => setViewMode('ai_forecast')}
          >
            🤖 AI Adaptive Forecast (7 Days)
          </button>
        </div>
      )}

      {loading ? (
        <div className="plan-loading-state">
          <p>Loading active plan & weekly forecast…</p>
        </div>
      ) : loadError ? (
        <div className="plan-error-card">
          <p className="plan-error-message">⚠️ {loadError}</p>
          <button type="button" className="plan-retry-btn" onClick={loadPlanData}>
            🔄 Retry
          </button>
        </div>
      ) : forecastUnavailable ? (
        <div className="plan-unavailable-card">
          <h3>7-Day Forecast Temporarily Unavailable</h3>
          <p className="plan-unavailable-message">{forecastUnavailable}</p>
          {forecastRepairTargets.length > 0 && (
            <p className="plan-unavailable-message">
              {forecastRepairTargets.some(target => target.kind === 'resync')
                ? 'Forcing a fresh Garmin sync below re-writes the flagged data and clears this error.'
                : 'Re-saving the flagged data below re-validates it and clears this error.'}
            </p>
          )}
          <div className="plan-unavailable-actions">
            {forecastRepairTargets.map(target => target.kind === 'navigate' ? (
              onNavigate && (
                <button
                  key={target.screen}
                  type="button"
                  className="plan-retry-btn"
                  onClick={() => onNavigate(target.screen)}
                >
                  {target.label} →
                </button>
              )
            ) : (
              <GarminSyncNowButton key="resync" userId={userId} onSynced={loadPlanData} />
            ))}
            <button type="button" className="plan-retry-btn" onClick={loadPlanData}>
              🔄 Retry
            </button>
          </div>
        </div>
      ) : activePlan && viewMode === 'imported' ? (
        <div className="plan-active-content">
          <ExternalPlanWeek
            userId={userId}
            planTitle={activePlan.plan.title}
            weekStartDate={today}
            placed={activePlan.placed}
            critique={critique}
            today={today}
            fixedActivities={fixedActivities}
            onProposeReplacement={handleProposeReplacement}
            onConfirmReplacement={handleConfirmReplacement}
            onChooseDate={handleChooseDate}
            writeError={writeError}
            clinicalEscalationRequired={clinicalEscalationRequired}
          />
        </div>
      ) : (
        <div className="plan-evergreen-content">
          <div className="plan-evergreen-banner">
            <div className="plan-evergreen-text">
              <h3>🤖 AI Adaptive Training Schedule</h3>
              <p>
                {activePlan
                  ? 'Alternative 7-day projection dynamically optimized by the engine.'
                  : 'The engine dynamically prescribes and balances workouts across your microcycle objectives based on daily recovery, readiness scores, and training goals.'}
              </p>
            </div>
            {!activePlan && (
              <button
                type="button"
                className="plan-import-subtle-btn"
                onClick={() => setShowImport(true)}
              >
                📥 Have a coach's plan? Import it
              </button>
            )}
          </div>

          {!decisionInput?.recoverySnapshot ? (
            <div className="plan-missing-recovery-card">
              <p>
                📊 No Garmin recovery data synced today yet. Sync your Garmin device
                to compute the dynamic 7-day projection.
              </p>
            </div>
          ) : !canGenerateAdaptiveForecast ? (
            <div className="plan-missing-checkin-card">
              <p>
                📋 Complete today's safety check-in to compute the dynamic 7-day adaptive forecast.
              </p>
              {onNavigate && (
                <button
                  type="button"
                  className="plan-complete-checkin-btn"
                  onClick={() => onNavigate('checkin')}
                >
                  Complete Morning Check-in →
                </button>
              )}
            </div>
          ) : (
            <WeekAheadStrip
              plan={weekAheadPlan}
              nextDayPlan={nextDayPlan}
              selectedTier={selectedNextDayTier}
              onSelectTier={setSelectedNextDayTier}
              trainingIntentProfile={decisionInput?.trainingIntentProfile}
              planningMode={resolvedPlanningMode}
            />
          )}
        </div>
      )}
    </div>
  );
};
