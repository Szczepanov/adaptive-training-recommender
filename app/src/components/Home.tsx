import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { decisionComposer } from '../engine/composer';
import { evaluateTrainingWithIntent, evaluateNextDayPlanWithIntent, adjustSessionRecommendation, evaluateReadinessAndSafetyEnvelope } from '../engine/rules';
import { mapSnapshotToEngineInput, mapCheckinToSubjectiveInput, mapContextFromGoalsAndTrainingSettings, mapGoalsToUserEvents } from '../engine/adapters';
import { generateWeekAheadPlanWithIntent, type WeekAheadPlan } from '../engine/planner';
import { prepareTrainingHistorySnapshot } from '../engine/trainingIntent';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { buildRecommendationAudit } from '../engine/provenance';
import { evaluatePeriodizationPhase, getDaysToEvent } from '../engine/periodization';
import { resolvePlanningContext } from '../engine/planningMode';
import { resolveExecutionDose } from '../engine/dose';
import { resolveAvailability } from '../engine/schedule';
import { adjudicateAuthoredSession, createAuthoredSessionTemplate, estimateAuthoredSessionSystemicCost } from '../engine/authoredSessionGates';
import { sessionOccurrenceService } from '../services/sessionOccurrenceService';
import type { AuthoredPlanBlock, BodyRegion, DailyDecisionInput, Recommendation, NextDayPotentialPlan, DailyRecommendation, DecisionJournalEntry, FixedActivity, ShadowVerdict } from '../engine/models';
import type { SessionReferenceBinding } from '../sessions/models';
import type { DataState } from '../engine/dataState';
import { recommendationService } from '../services/recommendationService';
import { prepareAuthoredOccurrenceLaunch, prepareCatalogSessionLaunch } from '../services/sessionAuthoringService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { fixedActivityService } from '../services/fixedActivityService';
import { planBlockService } from '../services/planBlockService';
import { decisionJournalService } from '../services/decisionJournalService';
import { resolveEngineShadowVerdict } from '../engine/shadowAgreement';
import { getPreviousLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { getPrescriptionLegend, resolveWorkoutPrescription } from '../workouts';
import type { WorkoutPrescription } from '../workouts';
import {
  activeExternalPlanService,
  externalPlanContextForDate,
  type ActiveExternalPlan,
} from '../services/activeExternalPlanService';
import { checkinService } from '../services/checkinService';
import { ExternalVerdictBanner } from './ExternalVerdictBanner';
import { WorkoutExportMenu } from './WorkoutExportMenu';
import { AdherencePrompt, type AdherenceAnswer } from './AdherencePrompt';
import { DecisionJournalCard } from './DecisionJournalCard';
import { MinimumSafetyCheckin } from './MinimumSafetyCheckin';
import { WeekAheadStrip } from './WeekAheadStrip';
import {
  canGenerateNormalRecommendation,
  createProvisionalSafetyRecommendation,
  getMinimumSafetyCheckinStatus,
} from '../engine/safetyCheckin';
import './Home.css';

import type { Screen } from '../types/navigation';

interface HomeProps {
  userId: string;
  onNavigate: (screen: Screen) => void;
  onViewData?: () => void;
  /** Launches today's immutable session binding through the source-neutral runner. */
  onStartSession?: (binding: SessionReferenceBinding) => void | Promise<void>;
}

const MODE_LABELS: Record<Recommendation['mode'], string> = {
  train: 'Normal load',
  modify: 'Reduced load',
  recover: 'Recovery day',
};

function formatEventTiming(daysToEvent: number | null): string {
  if (daysToEvent === 0) return 'Today';
  if (daysToEvent === null) return '';
  return daysToEvent > 0 ? `In ${daysToEvent} days` : `${Math.abs(daysToEvent)} days ago`;
}


/**
 * Fire-and-forget self-check (M3.2): confirms a just-saved decision's session bindings
 * actually replay against their stored bytes. Skips a day with no bindings at all, so an
 * ordinary catalog/no-session day doesn't pay two extra Firestore reads on every save.
 * Non-fatal by design, matching saveRecommendation's own "shouldn't block the dashboard"
 * idiom -- reports via console.warn only, same as every other integrity check in this
 * codebase (see shadowLogService). Lazily imported so replay.ts stays free of a live
 * Firestore dependency for every other caller (see its own module comment).
 */
function verifySessionBindingReplay(userId: string, saved: DailyRecommendation | null): void {
  if (!saved || (!saved.primarySession && !saved.additionalSessions)) return;
  import('../engine/replay')
    .then(({ replayRecommendationAuditAgainstSessions }) => replayRecommendationAuditAgainstSessions(userId, saved))
    .then(result => {
      if (!result.reproducible) {
        console.warn(`Recommendation for ${saved.date} does not replay against its stored session bindings:`, result.errors);
      }
    })
    .catch(err => console.warn(`Failed to verify session-binding replay for ${saved.date}:`, err));
}

const DetailedTodayPlan = memo(function DetailedTodayPlan({
  prescription,
  userId,
  date,
  title,
  modality,
}: {
  prescription: WorkoutPrescription;
  userId: string;
  date: string;
  title: string;
  modality: string;
}) {
  return (
    <section className="detailed-plan" aria-label={`Workout details for ${title}`}>
      <div className="detailed-plan-header">
        <div>
          <h5>Today&apos;s Plan</h5>
          <span>{prescription.targetDurationMin} min target</span>
        </div>
        <WorkoutExportMenu
          userId={userId}
          date={date}
          title={title}
          modality={modality}
          prescription={prescription}
        />
      </div>
      {prescription.displayBlocks.map((block) => (
        <section className={`plan-block plan-block-${block.role}`} key={block.id}>
          <h6 className="plan-block-role">{block.name}</h6>
          {block.steps.map((step) => (
            <article className="plan-step" key={step.id}>
              <div className="plan-step-heading">
                <strong>{step.name}</strong>
                {step.optional && <span className="optional-step">Optional</span>}
              </div>
              <p className="plan-dose">{step.dose}{step.rest ? ` · ${step.rest}` : ''}</p>

              {step.structuredTargets && step.structuredTargets.length > 0 ? (
                <ul className="step-target-list">
                  {step.structuredTargets.map((t, idx) => (
                    <li key={idx} className={`target-item role-${t.role}`}>
                      <span className={`target-role-badge role-${t.role}`}>{t.label}</span>
                      <span className="target-value">{t.valueText}</span>
                    </li>
                  ))}
                </ul>
              ) : step.targets && step.targets.length > 0 ? (
                <ul className="plan-targets">
                  {step.targets.map((target, idx) => (
                    <li key={idx}>{target}</li>
                  ))}
                </ul>
              ) : null}

              {step.cues && step.cues.length > 0 && (
                <div className="step-cues-list">
                  {step.cues.map((cue, idx) => (
                    <p key={idx} className="step-cue">💡 {cue}</p>
                  ))}
                </div>
              )}

              {step.stopConditions && step.stopConditions.length > 0 && (
                <div className="step-stop-conditions">
                  {step.stopConditions.map((cond, idx) => (
                    <p key={idx} className="step-stop-condition">⚠️ <strong>Stop if:</strong> {cond}</p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
      <p className="plan-legend">{getPrescriptionLegend()}</p>
    </section>
  );
});

export function Home({ userId, onNavigate, onViewData, onStartSession }: HomeProps) {
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'easier' | 'harder' | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(false);
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);
  const [, setTodaysJournalEntry] = useState<DecisionJournalEntry | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<TrainingHistorySnapshot | null>(null);
  const [, setActiveExternalPlan] = useState<ActiveExternalPlan | null>(null);
  const [hasPendingSessionResponse, setHasPendingSessionResponse] = useState(false);
  const pendingAdherenceRef = useRef(pendingAdherence);
  useEffect(() => { pendingAdherenceRef.current = pendingAdherence; }, [pendingAdherence]);

  const handlePendingAdherenceResolved = useCallback((answer: AdherenceAnswer) => {
    const resolved = pendingAdherenceRef.current;
    setPendingAdherence(null);
    if (answer.followed === true && resolved) {
      decisionJournalService.getEntry(userId, resolved.date)
        .then(existing => {
          if (!existing || existing.actualVerdict) return;
          const persisted = resolved.recommendation as DailyRecommendation & { engineVerdict?: ShadowVerdict };
          const exactVerdict = persisted.engineVerdict ?? resolveEngineShadowVerdict(persisted.mode);
          if (exactVerdict === 'advisory') return;
          return decisionJournalService.recordActualVerdict(userId, resolved.date, exactVerdict);
        })
        .catch(err => console.warn('Failed to sync decision journal actualVerdict from adherence:', err));
    }
  }, [userId]);
  const handleJournalEntryChange = useCallback((entry: DecisionJournalEntry | null) => setTodaysJournalEntry(entry), []);
  const dashboardRequest = useRef(0);

  useEffect(() => {
    if (!decisionInput) {
      setHasPendingSessionResponse(false);
      return;
    }
    let cancelled = false;
    const today = decisionInput.date;
    const yesterday = getPreviousLocalDateString(today);
    Promise.all([
      checkinService.getCheckin(userId, today),
      checkinService.getCheckin(userId, yesterday),
    ]).then(([todayCheckin, yesterdayCheckin]) => {
      if (cancelled) return;
      const pending = Object.entries(yesterdayCheckin?.tissueResponses ?? {}).some(([region, response]) =>
        !!response
        && !!(response.painDuringTraining || response.afterTrainingState || response.sourceSessionRef)
        && !todayCheckin?.tissueResponses?.[region as BodyRegion]?.nextMorningReaction,
      );
      setHasPendingSessionResponse(pending);
    }).catch(() => {
      if (!cancelled) setHasPendingSessionResponse(false);
    });
    return () => { cancelled = true; };
  }, [userId, decisionInput]);
  const activeSettings = useMemo(() => {
    if (!decisionInput) return [];
    const { equipment, guardrails, defaults } = decisionInput.trainingSettings;
    const equipmentLabels: Record<keyof typeof equipment, string> = {
      free_weights: 'Free weights available', cable_machine: 'Cable machine available', treadmill: 'Treadmill available', indoor_bike: 'Stationary bike available', pullup_bar: 'Pull-up bar available'
    };
    const guardrailLabels: Record<keyof typeof guardrails, string> = {
      avoid_high_impact: 'Block high-impact training', avoid_heavy_lower_body: 'Block heavy lower-body work', avoid_overhead_pressing: 'Block overhead pressing', avoid_heavy_spinal_loading: 'Block heavy spinal loading'
    };
    return [
      ...Object.entries(equipment).filter(([, enabled]) => enabled).map(([key]) => ({ label: equipmentLabels[key as keyof typeof equipment], kind: 'capability' })),
      ...Object.entries(guardrails).filter(([, enabled]) => enabled).map(([key]) => ({ label: guardrailLabels[key as keyof typeof guardrails], kind: 'guardrail' })),
      ...(defaults.environment === 'either' ? [] : [{ label: `${defaults.environment === 'indoor' ? 'Indoor' : 'Outdoor'} training only`, kind: 'guardrail' }]),
    ];
  }, [decisionInput]);

  // ⚡ Bolt: Memoize filtered guardrails to prevent redundant O(N) filtering on every render
  const activeGuardrails = useMemo(
    () => activeSettings.filter((setting) => setting.kind === 'guardrail'),
    [activeSettings]
  );
  const minimumSafetyStatus = useMemo(
    () => getMinimumSafetyCheckinStatus(decisionInput?.subjectiveCheckin),
    [decisionInput?.subjectiveCheckin],
  );
  const canGenerateNormalPlan = canGenerateNormalRecommendation(minimumSafetyStatus);

  const clearExternalPlanState = useCallback(() => {
    setActiveExternalPlan(null);
  }, []);

  const loadDashboardData = useCallback(async () => {
    const requestId = ++dashboardRequest.current;
    const isCurrent = () => requestId === dashboardRequest.current;
    try {
      setLoading(true);
      setError(null);
      setHistorySnapshot(null);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      if (!isCurrent()) return;
      setDecisionInput(input);

      const recoveryState = input.sourceStates?.recoverySnapshot;
      if (recoveryState && recoveryState.status !== 'AVAILABLE' && recoveryState.status !== 'MISSING') {
        setRecommendation(null);
        setNextDayPlan(null);
        clearExternalPlanState();
        setError(recoveryState.status === 'UNAVAILABLE'
          ? 'Recovery data is temporarily unavailable. Please retry before generating a plan.'
          : 'Recovery data needs repair before generating a plan.');
        return;
      }
      const decisionSourceFailure = input.sourceStates
        && [input.sourceStates.activeGoals, input.sourceStates.preferences, input.sourceStates.trainingSettings]
          .find(state => state.status === 'INVALID' || state.status === 'UNAVAILABLE');
      if (decisionSourceFailure) {
        setRecommendation(null);
        setNextDayPlan(null);
        clearExternalPlanState();
        setError(decisionSourceFailure.status === 'UNAVAILABLE'
          ? 'Decision inputs are temporarily unavailable. Please retry before generating a plan.'
          : 'Decision inputs need repair before generating a plan.');
        return;
      }

      const yesterday = getPreviousLocalDateString(input.date);
      const [yesterdayRec, todayAndTomorrowFixedActivities, todayAndTomorrowPlanBlocks] = await Promise.all([
        recommendationService.getRecommendation(userId, yesterday).catch(err => {
          console.warn('Failed to load yesterday\'s recommendation:', err);
          return null;
        }),
        fixedActivityService
          .getActivitiesInRange(userId, input.date, addDaysToLocalDateString(input.date, 1))
          .catch(err => {
            console.warn('Failed to load fixed activities for today/tomorrow:', err);
            return [];
          }),
        planBlockService
          .getBlocksInRangeState(userId, input.date, addDaysToLocalDateString(input.date, 1))
          .then(state => {
            if (state.status === 'AVAILABLE') return state.data;
            console.warn(`Failed to load authored plan blocks for today/tomorrow: ${state.status}`);
            return [];
          })
          .catch(err => {
            console.warn('Failed to load authored plan blocks for today/tomorrow:', err);
            return [];
          })
      ]);

      if (!isCurrent()) return;

      setPendingAdherence(
        yesterdayRec && yesterdayRec.adherence.respondedAt === null
          ? { date: yesterday, recommendation: yesterdayRec }
          : null
      );

      const safetyStatus = getMinimumSafetyCheckinStatus(input.subjectiveCheckin);
      if (input.recoverySnapshot && canGenerateNormalRecommendation(safetyStatus)) {
        const objective = mapSnapshotToEngineInput(input.recoverySnapshot);
        const subjective = mapCheckinToSubjectiveInput(input.subjectiveCheckin);
        const context = mapContextFromGoalsAndTrainingSettings(input.activeGoals, input.trainingSettings, input.preferences, input.date, input.subjectiveCheckin);
        const forecastContext = mapContextFromGoalsAndTrainingSettings(input.activeGoals, input.trainingSettings, input.preferences, input.date, null);
        const events = mapGoalsToUserEvents(input.activeGoals);
        const preparedSnapshot = await prepareTrainingHistorySnapshot(userId, input.date);
        if (!isCurrent()) return;
        if (!preparedSnapshot) {
          throw new Error('A revisioned training history snapshot is required for a normal recommendation.');
        }
        setHistorySnapshot(preparedSnapshot);

        const planWeekActivitiesState = await fixedActivityService.getActivitiesInRangeState(
          userId, input.date, addDaysToLocalDateString(input.date, 6),
        );
        if (!isCurrent()) return;
        if (planWeekActivitiesState.status !== 'AVAILABLE') {
          console.warn(`Fixed activities for the plan week could not be read (${planWeekActivitiesState.status}); placement falls back to the dates the plan itself implies.`);
        }
        const planWeekActivities = planWeekActivitiesState.status === 'AVAILABLE' ? planWeekActivitiesState.data : [];

        const activeExternalState = await activeExternalPlanService.getActivePlanState(
          userId, input.date, planWeekActivities,
        );
        if (!isCurrent()) return;
        const activeExternal = activeExternalState.status === 'AVAILABLE' ? activeExternalState.data : null;
        setActiveExternalPlan(activeExternal);
        if (activeExternalState.status === 'INVALID' || activeExternalState.status === 'UNAVAILABLE') {
          console.warn(`External plan could not be read (${activeExternalState.status}); today falls back to the ranked path.`);
        }
        const externalContext = activeExternal ? externalPlanContextForDate(activeExternal, input.date) : null;

        const baseRecommendation = await evaluateTrainingWithIntent(
          userId, { subjective, objective, subjectiveBaseline: input.subjectiveBaseline }, context, events, input.date, yesterdayRec?.mode, undefined, preparedSnapshot,
          todayAndTomorrowFixedActivities, todayAndTomorrowPlanBlocks, input.trainingIntentProfile, input.preferences,
          'max', externalContext,
        );
        if (!isCurrent()) return;
        const recommendationWithPrescription = {
          ...baseRecommendation,
          prescription: resolveWorkoutPrescription(baseRecommendation, userId, input.date, input.preferences?.performanceProfile, baseRecommendation.executionDose, input.trainingSettings) ?? undefined
        };

        // M3.1/M3.4: a catalog-sourced recommendation gets its executable snapshot bound
        // and persisted (write-once, content-addressed) at composition time.
        let primarySession: Recommendation['primarySession'] = recommendationWithPrescription.primarySession;
        if (recommendationWithPrescription.prescription) {
          try {
            const launch = await prepareCatalogSessionLaunch(userId, recommendationWithPrescription.prescription);
            if (!isCurrent()) return;
            primarySession = launch.binding;
          } catch (err) {
            console.warn('Failed to prepare the catalog session binding for today\'s recommendation:', err);
          }
        }

        let recommendationWithSession = { ...recommendationWithPrescription, primarySession };

        // M3.3 Gated authored replacement & additional session authority (ADR-0023 / D-MAUTH)
        try {
          const replaceOccurrence = await sessionOccurrenceService.getReplaceOccurrenceForDate(userId, input.date);
          const additionalOccurrences = await sessionOccurrenceService.getAdditionalOccurrencesForDate(userId, input.date);
          const envelopeState = evaluateReadinessAndSafetyEnvelope(
            { subjective, objective, subjectiveBaseline: input.subjectiveBaseline },
            context,
            input.date,
            yesterdayRec?.mode,
          );
          const availability = resolveAvailability(input.date, subjective, todayAndTomorrowFixedActivities, context);
          let acceptedSameDaySystemicCost = baseRecommendation.template.systemicCost;
          let acceptedSameDayMinutes = baseRecommendation.template.durationMin;

          if (replaceOccurrence) {
            const source = {
              kind: 'manual' as const,
              definitionId: replaceOccurrence.definitionRef.definitionId,
              revision: replaceOccurrence.definitionRef.revision,
              contentHash: replaceOccurrence.definitionRef.contentHash,
            };
            // Resolve through the content-hash boundary before freezing a new
            // occurrence-specific prescription; never bind a live definition directly.
            const defState = await resolveSessionDefinition(userId, source);
            if (defState.status === 'AVAILABLE') {
              const authoredVerdict = adjudicateAuthoredSession(
                defState.data,
                { subjective, objective, subjectiveBaseline: input.subjectiveBaseline },
                context,
                envelopeState,
                baseRecommendation.executionDose ?? { volume: 1.0, intensity: 1.0 },
                input.date,
                availability,
              );

              if (authoredVerdict.decision === 'proceed' || authoredVerdict.decision === 'scale') {
                const targetDef = authoredVerdict.scaledDefinition ?? defState.data;
                const launch = await prepareAuthoredOccurrenceLaunch(userId, source, replaceOccurrence.occurrenceId, targetDef);
                if (!isCurrent()) return;
                const traceWithoutExternalPlan = { ...(baseRecommendation.decisionTrace ?? {
                  policyVersion: '', candidateScores: [], droppedContributorObjectives: [],
                }) };
                delete traceWithoutExternalPlan.externalPlan;
                recommendationWithSession = {
                  ...baseRecommendation,
                  // The catalog prescription belongs to the displaced engine candidate,
                  // not the accepted authored occurrence.
                  prescription: undefined,
                  externalVerdict: undefined,
                  externalPrescription: undefined,
                  template: createAuthoredSessionTemplate(targetDef),
                  rationale: `${authoredVerdict.rationale} (Authored replacement for today).`,
                  mode: envelopeState.mode,
                  executionDose: authoredVerdict.executionDose ?? baseRecommendation.executionDose,
                  primarySession: launch.binding,
                  decisionTrace: {
                    ...traceWithoutExternalPlan,
                    // An authored primary is adjudicated rather than ranked against the
                    // catalog. Retaining these scores would misstate its authority.
                    candidateScores: [],
                    authoredOccurrence: {
                      occurrenceId: replaceOccurrence.occurrenceId,
                      decision: authoredVerdict.decision,
                    },
                  },
                };
                acceptedSameDaySystemicCost = authoredVerdict.acceptedSystemicCost ?? estimateAuthoredSessionSystemicCost(targetDef);
                acceptedSameDayMinutes = targetDef.duration?.min ?? acceptedSameDayMinutes;
              } else {
                recommendationWithSession = {
                  ...recommendationWithSession,
                  rationale: `${recommendationWithSession.rationale} [Notice: Scheduled replacement session was rejected by safety gates: ${authoredVerdict.rationale}]`,
                };
              }
            } else {
              recommendationWithSession = {
                ...recommendationWithSession,
                rationale: `${recommendationWithSession.rationale} [Notice: Scheduled replacement session could not be resolved (${defState.status}) and was not activated.]`,
              };
            }
          }

          const additionalBindings: SessionReferenceBinding[] = [];
          const additionalNotices: string[] = [];
          for (const occurrence of additionalOccurrences) {
            const source = {
              kind: 'manual' as const,
              definitionId: occurrence.definitionRef.definitionId,
              revision: occurrence.definitionRef.revision,
              contentHash: occurrence.definitionRef.contentHash,
            };
            const defState = await resolveSessionDefinition(userId, source);
            if (defState.status !== 'AVAILABLE') {
              additionalNotices.push(`Additional session ${occurrence.occurrenceId} could not be resolved (${defState.status}).`);
              continue;
            }
            const remainingAvailability = {
              ...availability,
              maxTimeMinutes: Math.max(0, availability.maxTimeMinutes - acceptedSameDayMinutes),
            };
            const verdict = adjudicateAuthoredSession(
              defState.data,
              { subjective, objective, subjectiveBaseline: input.subjectiveBaseline },
              context,
              envelopeState,
              baseRecommendation.executionDose ?? { volume: 1.0, intensity: 1.0 },
              input.date,
              remainingAvailability,
              acceptedSameDaySystemicCost,
            );
            if (verdict.decision === 'reject') {
              additionalNotices.push(`Additional session ${occurrence.occurrenceId} was rejected by safety gates: ${verdict.rationale}`);
              continue;
            }
            const targetDef = verdict.scaledDefinition ?? defState.data;
            const launch = await prepareAuthoredOccurrenceLaunch(userId, source, occurrence.occurrenceId, targetDef);
            if (!isCurrent()) return;
            additionalBindings.push(launch.binding);
            acceptedSameDaySystemicCost += verdict.acceptedSystemicCost ?? estimateAuthoredSessionSystemicCost(targetDef);
            acceptedSameDayMinutes += targetDef.duration?.min ?? 45;
          }

          if (additionalBindings.length > 0 || additionalNotices.length > 0) {
            recommendationWithSession = {
              ...recommendationWithSession,
              ...(additionalBindings.length > 0 ? { additionalSessions: additionalBindings } : {}),
              rationale: additionalNotices.length > 0
                ? `${recommendationWithSession.rationale} [Notice: ${additionalNotices.join(' ')}]`
                : recommendationWithSession.rationale,
            };
          }
        } catch (occErr) {
          console.warn('Failed to evaluate authored session occurrences for today:', occErr);
        }

        const todayRec = {
          ...recommendationWithSession,
          recommendationAudit: buildRecommendationAudit(recommendationWithSession, preparedSnapshot) ?? undefined,
        };
        setRecommendation(todayRec);

        const tomorrowPlan = await evaluateNextDayPlanWithIntent(
          userId, events, { subjective, objective }, forecastContext, input.date, todayRec, undefined, preparedSnapshot,
          todayAndTomorrowFixedActivities, todayAndTomorrowPlanBlocks, input.trainingIntentProfile, input.preferences,
        );
        if (!isCurrent()) return;
        setNextDayPlan(tomorrowPlan);

        recommendationService.saveRecommendation(userId, input.date, todayRec)
          .then(saved => verifySessionBindingReplay(userId, saved))
          .catch(err => console.warn('Failed to persist recommendation:', err));
      } else if (input.recoverySnapshot && safetyStatus !== 'complete') {
        setRecommendation(createProvisionalSafetyRecommendation(safetyStatus));
        setAdjustmentDirection(null);
        setNextDayPlan(null);
        setHistorySnapshot(null);
        clearExternalPlanState();
      } else {
        setRecommendation(null);
        setNextDayPlan(null);
        setHistorySnapshot(null);
        clearExternalPlanState();
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [userId, clearExternalPlanState]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    setTodaysJournalEntry(null);
  }, [decisionInput?.date]);

  const getDataCompleteness = () => {
    if (!decisionInput) return 0;
    const { dataQuality } = decisionInput;
    const items = [
      dataQuality.hasRecoverySnapshot,
      dataQuality.hasSubjectiveCheckin,
      dataQuality.profileReady
    ];
    const completed = items.filter(Boolean).length;
    return Math.round((completed / items.length) * 100);
  };

  const engineInputs = useMemo(() => {
    if (!decisionInput || !decisionInput.recoverySnapshot) return null;
    const subjective = mapCheckinToSubjectiveInput(decisionInput.subjectiveCheckin);
    const objective = mapSnapshotToEngineInput(decisionInput.recoverySnapshot);
    const context = mapContextFromGoalsAndTrainingSettings(decisionInput.activeGoals, decisionInput.trainingSettings, decisionInput.preferences, decisionInput.date, decisionInput.subjectiveCheckin);
    return { subjective, objective, context };
  }, [decisionInput]);

  const forecastEngineInputs = useMemo(() => {
    if (!decisionInput || !decisionInput.recoverySnapshot) return null;
    const subjective = mapCheckinToSubjectiveInput(decisionInput.subjectiveCheckin);
    const objective = mapSnapshotToEngineInput(decisionInput.recoverySnapshot);
    const context = mapContextFromGoalsAndTrainingSettings(decisionInput.activeGoals, decisionInput.trainingSettings, decisionInput.preferences, decisionInput.date, null);
    return { subjective, objective, context };
  }, [decisionInput]);

  const computeAdjustedRecommendation = useCallback((direction: 'easier' | 'harder' | null): Recommendation | null => {
    if (!recommendation) return null;
    if (!canGenerateNormalPlan) return recommendation;
    if (!direction || !engineInputs || !decisionInput) return recommendation;

    const { subjective, objective, context } = engineInputs;
    const adjusted = adjustSessionRecommendation(recommendation, direction, { subjective, objective }, context, decisionInput.date);
    if (!adjusted) return recommendation;
    const plannedDose = adjusted.plannedDose ?? recommendation.plannedDose;
    const executionDose = plannedDose === undefined || !adjusted.envelopes
      ? recommendation.executionDose
      : resolveExecutionDose(plannedDose, adjusted.envelopes.plan, direction);
    const adjustedWithExecution = { ...adjusted, plannedDose, executionDose };
    return {
      ...adjustedWithExecution,
      prescription: resolveWorkoutPrescription(adjustedWithExecution, userId, decisionInput.date, decisionInput.preferences?.performanceProfile, executionDose, decisionInput.trainingSettings) ?? undefined
    };
  }, [recommendation, canGenerateNormalPlan, engineInputs, decisionInput, userId]);

  const handleAdjustSession = useCallback((direction: 'easier' | 'harder' | null) => {
    if (!canGenerateNormalPlan) return;
    setAdjustmentDirection(direction);
    if (!recommendation || !decisionInput) return;
    const adjusted = direction ? computeAdjustedRecommendation(direction) : null;
    recommendationService.saveRecommendation(userId, decisionInput.date, {
      ...recommendation,
      adjustment: direction ? adjusted?.adjustment : undefined,
    })
      .then(saved => verifySessionBindingReplay(userId, saved))
      .catch(err => console.warn('Failed to persist adjusted recommendation:', err));
  }, [recommendation, canGenerateNormalPlan, decisionInput, computeAdjustedRecommendation, userId]);

  const activeRec = useMemo(
    () => computeAdjustedRecommendation(adjustmentDirection),
    [computeAdjustedRecommendation, adjustmentDirection]
  );

  const todaysEngineVerdict = activeRec && canGenerateNormalPlan
    ? resolveEngineShadowVerdict(activeRec.mode, activeRec.externalVerdict?.decision)
    : null;
  const recommendationEffectivelyRevealed = true;

  const eventPeriodization = useMemo(() => {
    if (!decisionInput) return null;
    const events = mapGoalsToUserEvents(decisionInput.activeGoals);
    return {
      events,
      today: evaluatePeriodizationPhase(events, decisionInput.date),
    };
  }, [decisionInput]);

  const resolvedPlanningMode = useMemo(() => {
    if (!decisionInput || !eventPeriodization) return undefined;
    return resolvePlanningContext(
      decisionInput.trainingIntentProfile,
      eventPeriodization.today,
      decisionInput.date,
    ).mode;
  }, [decisionInput, eventPeriodization]);

  const WEEK_AHEAD_DAYS = 7;

  const [fixedActivitiesState, setFixedActivitiesState] = useState<DataState<FixedActivity[]>>({ status: 'AVAILABLE', data: [], revision: null });
  useEffect(() => {
    let cancelled = false;
    if (!decisionInput) {
      setFixedActivitiesState({ status: 'AVAILABLE', data: [], revision: null });
      return () => { cancelled = true; };
    }
    const endDate = addDaysToLocalDateString(decisionInput.date, WEEK_AHEAD_DAYS);
    fixedActivityService.getActivitiesInRangeState(userId, decisionInput.date, endDate)
      .then(state => { if (!cancelled) setFixedActivitiesState(state); })
      .catch(err => {
        console.warn('Failed to load fixed activities:', err);
        if (!cancelled) setFixedActivitiesState({ status: 'UNAVAILABLE', operation: 'read fixed activities', retryable: true });
      });
    return () => { cancelled = true; };
  }, [userId, decisionInput]);
  const fixedActivities = useMemo(
    () => (fixedActivitiesState.status === 'AVAILABLE' ? fixedActivitiesState.data : []),
    [fixedActivitiesState]
  );

  const [planBlocksState, setPlanBlocksState] = useState<DataState<AuthoredPlanBlock[]>>({ status: 'AVAILABLE', data: [], revision: null });
  useEffect(() => {
    let cancelled = false;
    if (!decisionInput) {
      setPlanBlocksState({ status: 'AVAILABLE', data: [], revision: null });
      return () => { cancelled = true; };
    }
    const endDate = addDaysToLocalDateString(decisionInput.date, WEEK_AHEAD_DAYS);
    planBlockService.getBlocksInRangeState(userId, decisionInput.date, endDate)
      .then(state => { if (!cancelled) setPlanBlocksState(state); })
      .catch(err => {
        console.warn('Failed to load authored plan blocks:', err);
        if (!cancelled) setPlanBlocksState({ status: 'UNAVAILABLE', operation: 'read plan blocks', retryable: true });
      });
    return () => { cancelled = true; };
  }, [userId, decisionInput]);
  const authoredPlanBlocks = useMemo(
    () => (planBlocksState.status === 'AVAILABLE' ? planBlocksState.data : []),
    [planBlocksState]
  );

  const [selectedNextDayTier, setSelectedNextDayTier] = useState<'green' | 'yellow' | 'red'>('green');
  const [weekAheadPlan, setWeekAheadPlan] = useState<WeekAheadPlan | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!forecastEngineInputs || !decisionInput || !activeRec || !canGenerateNormalPlan || !historySnapshot) {
      setWeekAheadPlan(null);
      return () => { cancelled = true; };
    }
    if (fixedActivitiesState.status !== 'AVAILABLE' || planBlocksState.status !== 'AVAILABLE') {
      console.warn(`Skipping week-ahead plan generation: fixed activities=${fixedActivitiesState.status}, plan blocks=${planBlocksState.status}; both must be AVAILABLE.`);
      setWeekAheadPlan(null);
      return () => { cancelled = true; };
    }
    const { subjective, objective, context } = forecastEngineInputs;
    const tomorrowRec = nextDayPlan
      ? (nextDayPlan.branches[selectedNextDayTier]?.recommendation ?? nextDayPlan.branches.green.recommendation)
      : null;
    void generateWeekAheadPlanWithIntent(
      userId,
      { subjective, objective },
      context,
      decisionInput.preferences,
      eventPeriodization?.events ?? [],
      decisionInput.date,
      activeRec,
      tomorrowRec,
      { days: WEEK_AHEAD_DAYS, fixedActivities, authoredPlanBlocks },
      undefined,
      historySnapshot,
      decisionInput.trainingIntentProfile,
    ).then(plan => {
      if (!cancelled) setWeekAheadPlan(plan);
    }).catch(err => {
      if (!cancelled) {
        console.warn('Failed to generate week-ahead plan:', err);
        setWeekAheadPlan(null);
      }
    });
    return () => { cancelled = true; };
  }, [userId, forecastEngineInputs, decisionInput, activeRec, canGenerateNormalPlan, nextDayPlan, selectedNextDayTier, eventPeriodization, historySnapshot, fixedActivitiesState, fixedActivities, planBlocksState, authoredPlanBlocks]);

  if (loading) {
    return (
      <div className="home-container">
        <div className="loading-state">
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-container">
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadDashboardData}>Retry</button>
        </div>
      </div>
    );
  }

  const completeness = getDataCompleteness();
  const periodizationToday = eventPeriodization?.today ?? null;
  const subjectiveReadiness = decisionInput?.subjectiveCheckin?.readiness ?? null;
  const subjectiveReadinessLabel = subjectiveReadiness === null
    ? null
    : subjectiveReadiness >= 8 ? 'High' : subjectiveReadiness >= 5 ? 'Moderate' : 'Low';

  const isCheckinMissing = !decisionInput?.dataQuality.hasSubjectiveCheckin;

  return (
    <div className="home-container">
      {hasPendingSessionResponse && (
        <aside className="session-response-reminder" aria-label="Session response follow-up">
          <div>
            <strong>How did yesterday&apos;s session feel this morning?</strong>
            <span>Your response helps keep future recommendations appropriately cautious.</span>
          </div>
          <button type="button" onClick={() => onNavigate('checkin')}>Answer follow-up</button>
        </aside>
      )}

      {isCheckinMissing && (
        <section className="checkin-action-gate-card" aria-label="Morning check-in required">
          <div className="gate-content">
            <div className="gate-text">
              <h3>Good morning</h3>
              <p>Complete your morning check-in (~10 sec) to generate today&apos;s plan.</p>
            </div>
            <button
              type="button"
              className="btn-primary start-checkin-gate-btn"
              onClick={() => onNavigate('checkin')}
            >
              Start Check-in ✓
            </button>
          </div>
          {decisionInput?.recoverySnapshot && (
            <div className="gate-garmin-strip">
              <span className="strip-item">Sleep <strong>{decisionInput.recoverySnapshot.raw.sleepScore ?? '--'}</strong></span>
              <span className="strip-item">HRV <strong>{decisionInput.recoverySnapshot.raw.hrvOvernightAvg ?? '--'} ms</strong></span>
              <span className="strip-item">RHR <strong>{decisionInput.recoverySnapshot.raw.restingHr ?? '--'} bpm</strong></span>
              <span className="strip-item">Battery <strong>{decisionInput.recoverySnapshot.raw.bodyBatteryWake ?? '--'}</strong></span>
            </div>
          )}
        </section>
      )}

      <div className="home-dashboard-layout">
        <div className="home-main-col">
          {/* State Summary Banner */}
          <div className="dashboard-card today-status-summary-card">
            <div className="today-status-header">
              <div className="today-status-hero-text">
                <span className="today-status-tag">Today&apos;s Readiness</span>
                <h3 className="today-status-headline">
                  {activeRec?.mode === 'recover'
                    ? 'Recovery Day'
                    : activeRec?.mode === 'modify'
                    ? 'Train, but reduce load'
                    : 'Ready to train'}
                </h3>
              </div>
              {activeRec && (
                <span className={`status-badge mode-${activeRec.mode}`}>
                  {MODE_LABELS[activeRec.mode]}
                </span>
              )}
            </div>

            {/* Direct Biomarker Chips */}
            <div className="today-biomarkers-strip">
              <div className="biomarker-chip">
                <span className="biomarker-label">Readiness</span>
                <span className="biomarker-value">
                  {subjectiveReadiness !== null ? `${subjectiveReadiness}/10` : '--'}
                </span>
              </div>
              {decisionInput?.recoverySnapshot && (
                <>
                  <div className="biomarker-chip">
                    <span className="biomarker-label">Sleep</span>
                    <span className="biomarker-value">
                      {decisionInput.recoverySnapshot.raw.sleepScore ?? '--'}
                    </span>
                  </div>
                  <div className="biomarker-chip">
                    <span className="biomarker-label">HRV</span>
                    <span className="biomarker-value">
                      {decisionInput.recoverySnapshot.raw.hrvOvernightAvg ? `${decisionInput.recoverySnapshot.raw.hrvOvernightAvg} ms` : '--'}
                    </span>
                  </div>
                  <div className="biomarker-chip">
                    <span className="biomarker-label">Battery</span>
                    <span className="biomarker-value">
                      {decisionInput.recoverySnapshot.raw.bodyBatteryWake ? `${decisionInput.recoverySnapshot.raw.bodyBatteryWake}` : '--'}
                    </span>
                  </div>
                </>
              )}
            </div>

            {activeRec && (activeRec.mode === 'modify' || activeRec.mode === 'recover') && (
              <div className="mode-rationale-callout">
                <strong>{activeRec.mode === 'recover' ? 'Recovery reason:' : 'Reduced load reason:'}</strong> {activeRec.rationale}
              </div>
            )}
          </div>

          {/* Today's Recommendation Card */}
          <div className="dashboard-card recommendation-card">
            <div className="card-header">
              <h3>Today&apos;s Training</h3>
              {activeRec && (
                <span className={`status-badge mode-${activeRec.mode}`}>
                  {MODE_LABELS[activeRec.mode]}
                </span>
              )}
            </div>

            {activeRec ? (
              <div className="recommendation-content">
                {activeRec.externalPrescription && activeRec.externalVerdict && (
                  <ExternalVerdictBanner
                    prescription={activeRec.externalPrescription}
                    verdict={activeRec.externalVerdict}
                  />
                )}

                <h4 className="recommendation-title">
                  {activeRec.template.title}
                  {activeRec.activeDose && (
                    <span className="dose-badge">{activeRec.activeDose.label}</span>
                  )}
                </h4>

                <p className="recommendation-meta">
                  {activeRec.template.category} · {activeRec.activeDose ? `${activeRec.activeDose.durationMin}-${activeRec.activeDose.durationMax}` : `${activeRec.template.durationMin}-${activeRec.template.durationMax}`} min · {activeRec.template.modality}
                </p>

                <p className="recommendation-description">
                  {activeRec.activeDose ? activeRec.activeDose.prescriptionSummary : activeRec.template.description}
                </p>

                {/* Primary Dominant Start Workout Action */}
                {activeRec.primarySession && onStartSession && (
                  <div className="primary-action-cta-wrap">
                    <button
                      type="button"
                      className="btn-primary start-workout-dominant-cta"
                      onClick={() => { void onStartSession(activeRec.primarySession!); }}
                    >
                      {activeRec.template.modality === 'Strength' ? '🏋️' : '▶️'} Start Session →
                    </button>
                  </div>
                )}

                {/* Secondary Actions Row */}
                {activeRec.prescription && (
                  <div className="recommendation-secondary-actions">
                    <button
                      type="button"
                      className="btn-secondary toggle-workout-btn view-workout-btn"
                      onClick={() => setShowWorkoutDetails((isOpen) => !isOpen)}
                      aria-expanded={showWorkoutDetails}
                    >
                      {showWorkoutDetails ? 'Hide workout' : 'View workout'}
                    </button>
                    <WorkoutExportMenu
                      userId={userId}
                      date={decisionInput?.date ?? ''}
                      title={activeRec.template.title}
                      modality={activeRec.template.modality}
                      prescription={activeRec.prescription}
                    />
                  </div>
                )}

                {showWorkoutDetails && activeRec.prescription && (
                  <DetailedTodayPlan
                    prescription={activeRec.prescription}
                    userId={userId}
                    date={decisionInput?.date ?? ''}
                    title={activeRec.template.title}
                    modality={activeRec.template.modality}
                  />
                )}

                {/* Collapsible Rationale */}
                <details className="recommendation-why-disclosure">
                  <summary>Why this today? ›</summary>
                  <div className="why-content">
                    <p>{activeRec.rationale}</p>
                  </div>
                </details>

                {!canGenerateNormalPlan && (
                  <MinimumSafetyCheckin
                    userId={userId}
                    existingCheckin={decisionInput?.subjectiveCheckin ?? null}
                    onCompleted={loadDashboardData}
                  />
                )}

                {/* Load Adjustment Section */}
                {canGenerateNormalPlan && (
                  <details className="adjustment-disclosure">
                    <summary>Adjust session load ›</summary>
                    <div className="adjustment-control-section">
                      <span className="adjustment-label">Select load variation:</span>
                      <div className="adjustment-button-group">
                        <button
                          type="button"
                          className={`adjustment-btn ${adjustmentDirection === 'easier' ? 'active' : ''}`}
                          onClick={() => handleAdjustSession(adjustmentDirection === 'easier' ? null : 'easier')}
                        >
                          Easier
                        </button>
                        <button
                          type="button"
                          className={`adjustment-btn ${adjustmentDirection === null ? 'active' : ''}`}
                          onClick={() => handleAdjustSession(null)}
                        >
                          As Recommended
                        </button>
                        <button
                          type="button"
                          className={`adjustment-btn ${adjustmentDirection === 'harder' ? 'active' : ''}`}
                          disabled={recommendation?.envelopes?.safety.clinicalFlagActive}
                          title={recommendation?.envelopes?.safety.clinicalFlagActive ? 'Harder option disabled due to active pain/injury flag.' : 'Increase session load'}
                          onClick={() => handleAdjustSession(adjustmentDirection === 'harder' ? null : 'harder')}
                        >
                          Harder
                        </button>
                      </div>

                      {recommendation?.envelopes?.safety.clinicalFlagActive && (
                        <p className="adjustment-notice safety-notice">
                          ⚠️ Harder option is unavailable today because an active pain/injury flag restricts physical loading.
                        </p>
                      )}

                      {activeRec.adjustment && (
                        <div className="adjustment-summary-box">
                          <p>
                            <strong>Session Adjusted ({activeRec.adjustment.direction}):</strong> {activeRec.adjustment.rationale}
                          </p>
                          <button
                            type="button"
                            className="reset-adjustment-btn"
                            onClick={() => handleAdjustSession(null)}
                          >
                            ↺ Reset to As Recommended
                          </button>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p className="card-empty">
                {!decisionInput?.dataQuality.hasRecoverySnapshot
                  ? "No Garmin recovery data synced today yet — that's required to generate a recommendation."
                  : decisionInput.subjectiveCheckin && !decisionInput.dataQuality.subjectiveCheckinComplete
                  ? "Today's check-in is only partially filled in — finish it to get a recommendation."
                  : 'Unable to compute a recommendation yet.'}
              </p>
            )}
          </div>

          <div className="home-week-strip-section">
            <div className="section-header-row">
              <h4>7-Day Outlook</h4>
              <button
                type="button"
                className="view-plan-link-btn"
                onClick={() => onNavigate('plan')}
              >
                View full plan →
              </button>
            </div>
            <WeekAheadStrip
              plan={weekAheadPlan}
              nextDayPlan={nextDayPlan}
              selectedTier={selectedNextDayTier}
              onSelectTier={setSelectedNextDayTier}
              trainingIntentProfile={decisionInput?.trainingIntentProfile}
              planningMode={resolvedPlanningMode}
            />
          </div>
        </div>

        <div className="home-sidebar-col">
          <details className="home-insights-disclosure">
            <summary className="home-insights-summary">More insights & history ›</summary>
            <div className="home-insights-content">
          {completeness < 100 && (
            <div className="completeness-card dashboard-card">
              <div className="completeness-header">
                <span>Profile Completeness</span>
                <span>{completeness}%</span>
              </div>
              <div className="completeness-bar">
                <div
                  className="completeness-fill"
                  style={{ width: `${completeness}%` }}
                />
              </div>
            </div>
          )}

          {pendingAdherence && (
            <AdherencePrompt
              userId={userId}
              date={pendingAdherence.date}
              recommendation={pendingAdherence.recommendation}
              onResolved={handlePendingAdherenceResolved}
            />
          )}

          {decisionInput && (
            <DecisionJournalCard
              userId={userId}
              date={decisionInput.date}
              engineVerdict={todaysEngineVerdict}
              engineRevealed={recommendationEffectivelyRevealed}
              onEntryChange={handleJournalEntryChange}
            />
          )}

          <div className="sidebar-status-cards">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Today's Recovery</h3>
                {decisionInput?.recoverySnapshot ? (
                  <span className={`status-badge mode-${activeRec?.mode ?? 'train'}`}>
                    {activeRec?.mode === 'recover' ? 'Needs recovery' : activeRec?.mode === 'modify' ? 'Cautious' : 'Good'}
                  </span>
                ) : (
                  <span className="status-badge warning">No Data</span>
                )}
              </div>

              {decisionInput?.recoverySnapshot ? (
                <div className="recovery-metrics revealed">
                  <>
                      <div className="metric">
                        <span className="metric-label">Sleep Score</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.sleepScore ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">Resting HR</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.restingHr ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">HRV</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.hrvOvernightAvg ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">Body Battery</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.bodyBatteryWake ?? '--'}
                        </span>
                      </div>
                  </>
                </div>
              ) : (
                <p className="card-empty">No Garmin data synced today</p>
              )}
            </div>

            <div className="dashboard-card" onClick={() => onNavigate('checkin')}>
              <div className="card-header">
                <h3>Today's Check-in</h3>
                {canGenerateNormalPlan ? (
                  <span className="status-badge success">Complete ✓</span>
                ) : (
                  <span className="status-badge pending">Safety check needed</span>
                )}
              </div>

              {decisionInput?.subjectiveCheckin ? (
                <div className="checkin-summary">
                  <div className="readiness-score">
                    <span className="score-label">Subjective Readiness</span>
                    <span className="score-value">{subjectiveReadiness ?? '--'}{subjectiveReadiness !== null && <small>/10</small>}</span>
                    {subjectiveReadinessLabel && <span className="readiness-label">{subjectiveReadinessLabel}</span>}
                  </div>
                  <p className="card-action">Edit check-in</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No check-in today</p>
                  <p className="card-action">Start check-in</p>
                </div>
              )}
            </div>

            <div className="dashboard-card" onClick={() => onNavigate('goals')}>
              <div className="card-header">
                <h3>{periodizationToday?.focusEvent ? 'Focus Event' : 'Active Goals'}</h3>
              </div>

              {periodizationToday?.focusEvent ? (
                <div className="goals-preview event-preview">
                  <strong className="event-title">{periodizationToday.focusEvent.title}</strong>
                  <span className="event-meta">
                    {formatEventTiming(periodizationToday.daysToEvent)} · {periodizationToday.phase.phaseName} phase
                  </span>
                  <button type="button" className="card-action" onClick={(e) => { e.stopPropagation(); onNavigate('goals'); }}>Manage goals →</button>
                </div>
              ) : decisionInput?.activeGoals.length ? (
                <div className="goals-preview">
                  {['short-term', 'mid-term', 'long-term'].map(category => {
                    const goal = decisionInput.activeGoals.find(g => g.category === category);
                    return goal ? (
                      <div key={category} className="goal-item">
                        <span className="goal-category">{category}</span>
                        <span className="goal-title">
                          {goal.title}
                          {goal.eventCategory && goal.targetDate && (
                            <span className="goal-event-days"> · 🏁 {(() => {
                              const days = getDaysToEvent(goal.targetDate, decisionInput.date);
                              return days >= 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
                            })()}</span>
                          )}
                        </span>
                      </div>
                    ) : null;
                  })}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No active goals</p>
                  <p className="card-action">Tap to add</p>
                </div>
              )}
            </div>

            {periodizationToday?.staleEvents.length ? (
              <div className="dashboard-card stale-event-card">
                <div className="card-header"><h3>Past Events</h3></div>
                <p>Update the outcome for these events:</p>
                <ul>
                  {periodizationToday.staleEvents.map(event => <li key={event.id}>{event.title}</li>)}
                </ul>
                <button type="button" className="card-action" onClick={() => onNavigate('goals')}>Review goals and events</button>
              </div>
            ) : null}

            <div className="dashboard-card" onClick={() => onNavigate('constraints')}>
              <div className="card-header">
                <h3>Training Status</h3>
              </div>

              {activeGuardrails.length > 0 ? (
                <div className="constraints-preview">
                  {activeGuardrails.slice(0, 3).map(setting => (
                    <div key={setting.label} className="constraint-item">
                      <span className="constraint-name">{setting.label}</span>
                      <span className={`constraint-severity ${setting.kind}`}>
                        {setting.kind === 'guardrail' ? 'required' : 'available'}
                      </span>
                    </div>
                  ))}
                  {activeGuardrails.length > 3 && (
                    <p className="more-items">
                      +{activeGuardrails.length - 3} more
                    </p>
                  )}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No active restrictions</p>
                  <p className="card-action">View training setup</p>
                </div>
              )}
            </div>

            {onViewData && (
              <button onClick={onViewData} className="quick-action-btn secondary full-width">
                📊 View Detailed Data
              </button>
            )}
          </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
