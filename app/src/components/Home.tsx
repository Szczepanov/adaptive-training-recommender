import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { resolveWorkoutPrescription } from '../workouts';

function formatEventTiming(daysToEvent: number | null): string {
  if (daysToEvent === 0) return 'Today';
  if (daysToEvent === null) return '';
  return daysToEvent > 0 ? `In ${daysToEvent} days` : `${Math.abs(daysToEvent)} days ago`;
}
import {
  activeExternalPlanService,
  externalPlanContextForDate,
  type ActiveExternalPlan,
} from '../services/activeExternalPlanService';
import { checkinService } from '../services/checkinService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionResponseService } from '../services/sessionResponseService';
import { relevantFollowupRegions } from '../responses/followupSchedule';
import { EXERCISES_BY_ID } from '../workouts/exercises';
import { AdherencePrompt, type AdherenceAnswer } from './AdherencePrompt';
import { DecisionJournalCard } from './DecisionJournalCard';
import { MinimumSafetyCheckin } from './MinimumSafetyCheckin';
import { WeekAheadStrip } from './WeekAheadStrip';
import { LaterDayFollowupCard, type LaterDayFollowupTarget } from './session/LaterDayFollowupCard';
import { GarminSyncNowButton } from './GarminSyncNowButton';
import { DataConfidenceIndicator } from './DataConfidenceIndicator';
import { MorningDecisionCard } from './MorningDecisionCard';
import { ActivityReclassificationModal } from './ActivityReclassificationModal';
import { assembleMorningDecisionEvidence } from '../engine/decisionEvidence';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { activityOverrideService } from '../services/activityOverrideService';
import { activityService } from '../services/activityService';
import { usabilityMetrics } from '../utils/usabilityMetrics';
import { TEMPLATES } from '../engine/templates';
import type { ActivityOverride, DailyRecoverySnapshot, NormalizedGarminActivity } from '../engine/models';
import type { ErrorRepairAction } from './errorRepairAction';
import { useAutoGarminSync } from '../hooks/useAutoGarminSync';
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

export function Home({ userId, onNavigate, onViewData, onStartSession }: HomeProps) {
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'easier' | 'harder' | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorRepairTargets, setErrorRepairTargets] = useState<ErrorRepairAction[]>([]);
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);
  const [recommendationRevealed, setRecommendationRevealed] = useState(false);
  const [todaysJournalEntry, setTodaysJournalEntry] = useState<DecisionJournalEntry | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<TrainingHistorySnapshot | null>(null);
  const [yesterdaySnapshot, setYesterdaySnapshot] = useState<DailyRecoverySnapshot | null>(null);
  const [yesterdayRecommendation, setYesterdayRecommendation] = useState<DailyRecommendation | null>(null);
  const [activeAlternativeId, setActiveAlternativeId] = useState<string | null>(null);
  const [activityOverrides, setActivityOverrides] = useState<Record<string, ActivityOverride>>({});
  const [reclassifyModalOpen, setReclassifyModalOpen] = useState(false);
  const [recentActivities, setRecentActivities] = useState<NormalizedGarminActivity[]>([]);
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
  const handleRevealRecommendation = useCallback(() => setRecommendationRevealed(true), []);
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

  // M5.2: same-day "later_day" follow-up -- distinct from the next-morning tissue prompt
  // above, which the check-in model has no same-day field for. Gated on M3.5 tissue-tag
  // relevance (relevantFollowupRegions) so an ordinary easy session with nothing
  // tissue-relevant in it never nags; only offered once per execution per mount
  // (dismissedLaterDayKeys), and never for a window a SessionResponse already answers.
  const [laterDayFollowup, setLaterDayFollowup] = useState<LaterDayFollowupTarget | null>(null);
  const [dismissedLaterDayKeys, setDismissedLaterDayKeys] = useState<Set<string>>(new Set());
  const [laterDayFollowupRevision, setLaterDayFollowupRevision] = useState(0);

  useEffect(() => {
    if (!decisionInput) {
      setLaterDayFollowup(null);
      return;
    }
    let cancelled = false;
    const today = decisionInput.date;
    const tomorrow = addDaysToLocalDateString(today, 1);
    (async () => {
      try {
        const { executions } = await sessionExecutionService.getExecutionsInRange(userId, today, tomorrow);
        const finished = executions
          .filter(item => item.execution.state !== 'in_progress')
          .sort((a, b) => (b.execution.completedAt ?? b.execution.updatedAt).localeCompare(a.execution.completedAt ?? a.execution.updatedAt));

        for (const { execution, entries } of finished) {
          const key = `execution:${execution.executionId}`;
          if (dismissedLaterDayKeys.has(key)) continue;

          const exerciseIds: string[] = [];
          for (const entry of entries) {
            if (entry.exerciseRef?.kind === 'catalog') exerciseIds.push(entry.exerciseRef.exerciseId);
          }
          const facets = exerciseIds
            .map(id => EXERCISES_BY_ID.get(id)?.facets)
            .filter((facet): facet is NonNullable<typeof facet> => !!facet);
          if (relevantFollowupRegions(facets).length === 0) continue;

          const existing = await sessionResponseService.getResponseForWindow(
            userId,
            { kind: 'execution', id: execution.executionId },
            'later_day',
          );
          if (existing) continue;

          if (!cancelled) {
            setLaterDayFollowup({
              sourceSession: { kind: 'execution', id: execution.executionId, date: execution.date },
              ...(execution.occurrenceId ? { occurrenceId: execution.occurrenceId } : {}),
              date: execution.date,
              title: 'today’s session',
            });
          }
          return;
        }
        if (!cancelled) setLaterDayFollowup(null);
      } catch {
        if (!cancelled) setLaterDayFollowup(null);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, decisionInput, dismissedLaterDayKeys, laterDayFollowupRevision]);

  const dismissLaterDayFollowup = useCallback(() => {
    setLaterDayFollowup(current => {
      if (current) setDismissedLaterDayKeys(prev => new Set(prev).add(`execution:${current.sourceSession.id}`));
      return null;
    });
  }, []);
  const handleLaterDayAnswered = useCallback(() => {
    setLaterDayFollowup(null);
    setLaterDayFollowupRevision(current => current + 1);
  }, []);
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
      setErrorRepairTargets([]);
      setHistorySnapshot(null);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      if (!isCurrent()) return;
      setDecisionInput(input);

      const recoveryState = input.sourceStates?.recoverySnapshot;
      if (recoveryState && recoveryState.status !== 'AVAILABLE' && recoveryState.status !== 'MISSING') {
        setRecommendation(null);
        setNextDayPlan(null);
        clearExternalPlanState();
        if (recoveryState.status === 'INVALID') {
          // A malformed stored snapshot is fixed by re-ingesting, not by re-reading it --
          // offer a forced resync instead of a dead-end Retry.
          setErrorRepairTargets([{ kind: 'resync' }]);
        }
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
        if (decisionSourceFailure.status === 'INVALID') {
          // Point the user at whichever screen owns the invalid document(s) so the error
          // is actionable rather than a dead end -- re-saving there re-runs validation
          // and clears the INVALID state.
          const repairTargets: ErrorRepairAction[] = [];
          if (input.sourceStates?.activeGoals.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'goals', label: 'Review goals' });
          if (input.sourceStates?.preferences.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'preferences', label: 'Review preferences' });
          if (input.sourceStates?.trainingSettings.status === 'INVALID') repairTargets.push({ kind: 'navigate', screen: 'constraints', label: 'Review training settings' });
          setErrorRepairTargets(repairTargets);
        }
        setError(decisionSourceFailure.status === 'UNAVAILABLE'
          ? 'Decision inputs are temporarily unavailable. Please retry before generating a plan.'
          : 'Decision inputs need repair before generating a plan.');
        return;
      }

      const yesterday = getPreviousLocalDateString(input.date);
      const [
        yesterdayRec,
        yesterdaySnapState,
        todayAndTomorrowFixedActivities,
        todayAndTomorrowPlanBlocks,
        loadedOverrides,
        activitiesState,
      ] = await Promise.all([
        recommendationService.getRecommendation(userId, yesterday).catch(err => {
          console.warn('Failed to load yesterday\'s recommendation:', err);
          return null;
        }),
        recoverySnapshotService.getRecoverySnapshotState(userId, yesterday).catch(() => ({ status: 'MISSING' as const })),
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
          }),
        activityOverrideService.getAllOverrides(userId).catch(() => ({})),
        activityService.getActivitiesInRange(userId, addDaysToLocalDateString(input.date, -6), addDaysToLocalDateString(input.date, 1)).catch(() => ({ status: 'MISSING' as const })),
      ]);

      if (!isCurrent()) return;

      setYesterdayRecommendation(yesterdayRec);
      setYesterdaySnapshot(yesterdaySnapState.status === 'AVAILABLE' ? yesterdaySnapState.data : null);
      setActivityOverrides(loadedOverrides);
      if (activitiesState.status === 'AVAILABLE') {
        setRecentActivities(activitiesState.data);
      }

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

  useAutoGarminSync({
    userId,
    decisionInput,
    onSynced: loadDashboardData,
  });

  // Phase 9.0.3: a new calendar day starts hidden again. todaysJournalEntry must be reset
  // here too, not left to DecisionJournalCard's own async read -- otherwise a non-null
  // entry from yesterday would make recommendationEffectivelyRevealed true for today until
  // the new fetch resolves, revealing today's recommendation before the athlete has had a
  // chance to record (or decline to record) today's blind verdict.
  useEffect(() => {
    setRecommendationRevealed(false);
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

  const computeAdjustedRecommendation = useCallback((
    direction: 'easier' | 'harder' | null,
    alternativeId: string | null = null,
  ): Recommendation | null => {
    if (!recommendation) return null;
    if (!canGenerateNormalPlan) return recommendation;
    if (!engineInputs || !decisionInput) return recommendation;

    let base = recommendation;

    // Apply situational alternative if active
    if (alternativeId) {
      if (alternativeId === 'mobility') {
        const mobTemplate = TEMPLATES.find(t => t.id === 'mob_01') ?? TEMPLATES.find(t => t.modality === 'Mobility') ?? base.template;
        base = {
          ...base,
          template: mobTemplate,
          mode: 'modify',
          rationale: '1-tap alternative applied: Joint Mobility & Recovery flow.',
          prescription: undefined,
          primarySession: undefined,
        };
      } else if (alternativeId === 'recovery-walk') {
        const recTemplate = TEMPLATES.find(t => t.id === 'mob_01') ?? base.template;
        base = {
          ...base,
          template: {
            ...recTemplate,
            title: 'Active Recovery Walk',
            category: 'Mobility/Recovery',
            modality: 'Mobility',
            description: 'Low-intensity Zone 1 walk to flush muscle tissue without autonomic stress.',
          },
          mode: 'recover',
          rationale: '1-tap alternative applied: 30 min conversational recovery walk.',
          prescription: undefined,
          primarySession: undefined,
        };
      } else if (alternativeId === 'home-bodyweight') {
        const bwTemplate = TEMPLATES.find(t => t.id === 'mob_travel_flow_01') ?? TEMPLATES.find(t => t.id === 'mob_01') ?? base.template;
        base = {
          ...base,
          template: bwTemplate,
          rationale: '1-tap alternative applied: Zero-equipment home training session.',
          prescription: undefined,
          primarySession: undefined,
        };
      } else if (alternativeId.startsWith('time-')) {
        const targetMinutes = parseInt(alternativeId.replace('time-', ''), 10);
        if (!Number.isNaN(targetMinutes)) {
          const ratio = Math.max(0.3, Math.min(1.0, targetMinutes / (base.template.durationMin || 45)));
          base = {
            ...base,
            template: {
              ...base.template,
              durationMin: targetMinutes,
              durationMax: targetMinutes + 5,
            },
            executionDose: {
              volume: ratio,
              intensity: base.executionDose?.intensity ?? 1.0,
            },
            rationale: `${base.rationale} (Time-crunch adjusted to ${targetMinutes} min).`,
          };
        }
      }
    }

    if (!direction) {
      const resolvedPrescription = resolveWorkoutPrescription(
        base,
        userId,
        decisionInput.date,
        decisionInput.preferences?.performanceProfile,
        base.executionDose,
        decisionInput.trainingSettings,
      ) ?? undefined;
      return {
        ...base,
        prescription: resolvedPrescription ?? base.prescription,
      };
    }

    const { subjective, objective, context } = engineInputs;
    const adjusted = adjustSessionRecommendation(base, direction, { subjective, objective }, context, decisionInput.date);
    if (!adjusted) return base;
    const plannedDose = adjusted.plannedDose ?? base.plannedDose;
    const executionDose = plannedDose === undefined || !adjusted.envelopes
      ? base.executionDose
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
    const adjusted = direction ? computeAdjustedRecommendation(direction, activeAlternativeId) : null;
    recommendationService.saveRecommendation(userId, decisionInput.date, {
      ...recommendation,
      adjustment: direction ? adjusted?.adjustment : undefined,
    })
      .then(saved => verifySessionBindingReplay(userId, saved))
      .catch(err => console.warn('Failed to persist adjusted recommendation:', err));
  }, [recommendation, canGenerateNormalPlan, decisionInput, computeAdjustedRecommendation, activeAlternativeId, userId]);

  const handleSelectTimeCrunch = useCallback((minutes: number) => {
    const nextId = activeAlternativeId === `time-${minutes}` ? null : `time-${minutes}`;
    setActiveAlternativeId(nextId);
    if (decisionInput) {
      usabilityMetrics.recordAlternativeChosen(userId, decisionInput.date, `time_crunch_${minutes}`);
    }
  }, [activeAlternativeId, decisionInput, userId]);

  const handleSelectHomeAlternative = useCallback(() => {
    const nextId = activeAlternativeId === 'home-bodyweight' ? null : 'home-bodyweight';
    setActiveAlternativeId(nextId);
    if (decisionInput) {
      usabilityMetrics.recordAlternativeChosen(userId, decisionInput.date, 'home_bodyweight');
    }
  }, [activeAlternativeId, decisionInput, userId]);

  const handleSelectMobilityAlternative = useCallback(() => {
    const nextId = activeAlternativeId === 'mobility' ? null : 'mobility';
    setActiveAlternativeId(nextId);
    if (decisionInput) {
      usabilityMetrics.recordAlternativeChosen(userId, decisionInput.date, 'joint_mobility');
    }
  }, [activeAlternativeId, decisionInput, userId]);

  const handleSelectActiveRecoveryWalk = useCallback(() => {
    const nextId = activeAlternativeId === 'recovery-walk' ? null : 'recovery-walk';
    setActiveAlternativeId(nextId);
    if (decisionInput) {
      usabilityMetrics.recordAlternativeChosen(userId, decisionInput.date, 'recovery_walk');
    }
  }, [activeAlternativeId, decisionInput, userId]);

  const handleResetAlternative = useCallback(() => {
    setActiveAlternativeId(null);
    setAdjustmentDirection(null);
  }, []);

  const activeRec = useMemo(
    () => computeAdjustedRecommendation(adjustmentDirection, activeAlternativeId),
    [computeAdjustedRecommendation, adjustmentDirection, activeAlternativeId]
  );

  const morningEvidence = useMemo(() => {
    return assembleMorningDecisionEvidence(
      decisionInput?.recoverySnapshot ?? null,
      yesterdaySnapshot,
      activeRec,
      yesterdayRecommendation,
      decisionInput,
    );
  }, [decisionInput, yesterdaySnapshot, activeRec, yesterdayRecommendation]);

  const todaysEngineVerdict = activeRec && canGenerateNormalPlan
    ? resolveEngineShadowVerdict(activeRec.mode, activeRec.externalVerdict?.decision)
    : null;
  const recommendationEffectivelyRevealed = recommendationRevealed || !!todaysJournalEntry;

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
          {errorRepairTargets.length > 0 && (
            <p className="error-state-hint">
              {errorRepairTargets.some(target => target.kind === 'resync')
                ? 'Forcing a fresh Garmin sync below re-writes the flagged data and clears this error.'
                : 'Re-saving the flagged data below re-validates it and clears this error.'}
            </p>
          )}
          <div className="error-state-actions">
            {errorRepairTargets.map(target => target.kind === 'navigate' ? (
              <button key={target.screen} type="button" onClick={() => onNavigate(target.screen)}>
                {target.label} →
              </button>
            ) : (
              <GarminSyncNowButton key="resync" userId={userId} onSynced={loadDashboardData} />
            ))}
            <button onClick={loadDashboardData}>Retry</button>
          </div>
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

      {laterDayFollowup && (
        <LaterDayFollowupCard
          userId={userId}
          target={laterDayFollowup}
          onAnswered={handleLaterDayAnswered}
          onDismiss={dismissLaterDayFollowup}
        />
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
          <div className="home-data-confidence-row">
            <DataConfidenceIndicator confidence={decisionInput?.dataConfidence} onRefresh={loadDashboardData} />
          </div>

          {/* The first, still-unrecorded verdict is an intentional reveal gate. Once it has
              been recorded, it no longer needs premium dashboard space and moves to the
              insights disclosure below, where the editable evening outcome remains available. */}
          {decisionInput && !todaysJournalEntry && (
            <DecisionJournalCard
              userId={userId}
              date={decisionInput.date}
              engineVerdict={todaysEngineVerdict}
              engineRevealed={recommendationEffectivelyRevealed}
              onEntryChange={handleJournalEntryChange}
            />
          )}

          {/* Hero Morning Decision Card with Progressive Disclosure */}
          {activeRec ? (
            canGenerateNormalPlan && !recommendationEffectivelyRevealed ? (
              <div className="dashboard-card recommendation-hidden">
                <p className="card-empty">Today's recommendation is ready.</p>
                <button type="button" className="reveal-recommendation-btn" onClick={handleRevealRecommendation}>
                  👁️ Reveal today's recommendation
                </button>
                <p className="reveal-hint">
                  Recording your own plan's verdict first is what the Decision Journal card above measures.
                </p>
              </div>
            ) : (
              <MorningDecisionCard
                userId={userId}
                date={decisionInput?.date ?? ''}
                recommendation={activeRec}
                evidence={morningEvidence}
                prescription={activeRec?.prescription}
                adjustmentDirection={adjustmentDirection}
                activeAlternativeId={activeAlternativeId}
                isGateLocked={recommendation?.envelopes?.safety.clinicalFlagActive ?? false}
                gateLockedReason={recommendation?.envelopes?.safety.clinicalFlagActive ? 'Harder option is disabled because an active pain or injury flag restricts physical loading.' : undefined}
                onAdjustLoad={handleAdjustSession}
                onSelectTimeCrunch={handleSelectTimeCrunch}
                onSelectHomeAlternative={handleSelectHomeAlternative}
                onSelectMobilityAlternative={handleSelectMobilityAlternative}
                onSelectActiveRecoveryWalk={handleSelectActiveRecoveryWalk}
                onResetAlternative={handleResetAlternative}
                onStartSession={onStartSession}
                onOpenReclassify={recentActivities.length > 0 ? () => setReclassifyModalOpen(true) : undefined}
              />
            )
          ) : (
            <div className="dashboard-card empty-recommendation-card">
              <p className="card-empty">
                {!decisionInput?.dataQuality.hasRecoverySnapshot
                  ? "No Garmin recovery data synced today yet — that's required to generate a recommendation."
                  : decisionInput.subjectiveCheckin && !decisionInput.dataQuality.subjectiveCheckinComplete
                  ? "Today's check-in is only partially filled in — finish it to get a recommendation."
                  : 'Unable to compute a recommendation yet.'}
              </p>
            </div>
          )}

          {!canGenerateNormalPlan && (
            <MinimumSafetyCheckin
              userId={userId}
              existingCheckin={decisionInput?.subjectiveCheckin ?? null}
              onCompleted={loadDashboardData}
            />
          )}

          {activityOverrides && reclassifyModalOpen && recentActivities.length > 0 && (
            <ActivityReclassificationModal
              userId={userId}
              activities={recentActivities}
              existingOverrides={activityOverrides}
              isOpen={reclassifyModalOpen}
              onClose={() => setReclassifyModalOpen(false)}
              onSaved={loadDashboardData}
            />
          )}

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
          {decisionInput && todaysJournalEntry && (
            <DecisionJournalCard
              userId={userId}
              date={decisionInput.date}
              engineVerdict={todaysEngineVerdict}
              engineRevealed={recommendationEffectivelyRevealed}
              onEntryChange={handleJournalEntryChange}
            />
          )}
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

          <div className="sidebar-status-cards">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Today's Recovery</h3>
                {decisionInput?.recoverySnapshot ? (
                  <span className="status-badge status-normal">
                    Sleep {decisionInput.recoverySnapshot.raw.sleepScore ?? '--'} · HRV {decisionInput.recoverySnapshot.raw.hrvOvernightAvg ?? '--'}ms
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
