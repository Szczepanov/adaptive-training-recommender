import {
  SUPPORTED_BLOCK_SPORTS,
  SUPPORTED_ADAPTATION_SCOPES,
  SUPPORTED_PLAN_COVERAGE_KEYS,
  SUPPORTED_OBJECTIVE_PRIORITIES,
  type IntentBlock,
  type BlockIntent,
} from '../engine/blockIntent';
import { manualIntentBlockSourceIdentity } from '../services/intentBlockService';
import { addDaysToLocalDateString } from '../utils/localDate';

/** A single pinned lineage tag standing in for a registered knowledge-registry claim
 * (ADR-0033). This form authors a block directly from the athlete's own judgment, not from
 * a cited research claim -- see `intentBlockService.ts`'s `manualIntentBlockSourceIdentity`
 * doc comment for the same reasoning applied to source-plan identity. */
export const MANUAL_KNOWLEDGE_LINEAGE = ['athlete-authored-manual-v1'] as const;

export const sportLabels: Record<(typeof SUPPORTED_BLOCK_SPORTS)[number], string> = {
  cycling: 'Cycling', strength: 'Strength', running: 'Running',
  swimming: 'Swimming', multisport: 'Multisport', cross_training: 'Cross training',
};

export const adaptationScopeLabels: Record<(typeof SUPPORTED_ADAPTATION_SCOPES)[number], string> = {
  threshold_quality: 'Threshold quality', surge_repeatability: 'Surge repeatability',
  zone2_aerobic: 'Zone 2 aerobic', strength_maintenance: 'Strength maintenance',
  strength_development: 'Strength development', race_specific_endurance: 'Race-specific endurance',
  vo2_max: 'VO2 max',
};

export const coverageKeyLabels: Record<(typeof SUPPORTED_PLAN_COVERAGE_KEYS)[number], string> = {
  aerobic_volume: 'Aerobic volume', recovery_spin: 'Recovery spin', sustained_quality: 'Sustained quality',
  short_surges: 'Short surges', gap_closing: 'Gap closing', outdoor_event_specific: 'Outdoor event-specific',
  primary_strength: 'Primary strength', compact_strength: 'Compact strength', upper_body_trunk: 'Upper body / trunk',
  field_maintenance: 'Field maintenance', walk_run: 'Walk/run', recovery_or_rest: 'Recovery or rest',
  travel_aerobic: 'Travel aerobic', travel_strength: 'Travel strength', taper_sharpening: 'Taper sharpening',
  pre_race_openers: 'Pre-race openers', race_week_strength: 'Race-week strength', race_day: 'Race day',
};

export const priorityLabels: Record<(typeof SUPPORTED_OBJECTIVE_PRIORITIES)[number], string> = {
  must_have: 'Must have', should_have: 'Should have', nice_to_have: 'Nice to have',
};

export function defaultDraft(today: string) {
  return {
    title: '',
    startDate: today,
    endDate: addDaysToLocalDateString(today, 28),
    sport: 'cycling' as (typeof SUPPORTED_BLOCK_SPORTS)[number],
    adaptationScope: 'threshold_quality' as (typeof SUPPORTED_ADAPTATION_SCOPES)[number],
    coverageKey: 'sustained_quality' as (typeof SUPPORTED_PLAN_COVERAGE_KEYS)[number],
    intent: 'develop' as BlockIntent,
    priority: 'must_have' as (typeof SUPPORTED_OBJECTIVE_PRIORITIES)[number],
    doseMin: 60,
    doseTarget: 90,
    doseMax: 120,
    minCompletedExposures: 3,
    reviewCadenceDays: 14,
    nextReviewDate: addDaysToLocalDateString(today, 14),
    trackProgression: false,
    progressionIncrement: 10,
    progressionMax: 150,
    observationWindowDays: 14,
    requiredFollowUpCoveragePct: 66,
    reductionDecrement: 10,
  };
}

export type ProgressionBlockDraft = ReturnType<typeof defaultDraft>;

export function buildBlock(draft: ProgressionBlockDraft): IntentBlock {
  const blockId = `block_${Date.now()}`;
  const objectiveId = 'obj_1';
  const { sourcePlanId, sourcePlanRevision } = manualIntentBlockSourceIdentity(blockId);

  return {
    id: blockId,
    revision: 1,
    sourcePlanId,
    sourcePlanRevision,
    dateRange: { startDate: draft.startDate, endDate: draft.endDate },
    objectives: [{
      id: objectiveId,
      sport: draft.sport,
      adaptationScope: draft.adaptationScope,
      coverageKey: draft.coverageKey,
      intent: draft.intent,
      priority: draft.priority,
      // The progression ceiling must nest inside the objective's own dose envelope
      // (validateProgressionContract's PROGRESSION_RANGE_EXCEEDS_OBJECTIVE_ENVELOPE) --
      // widen the envelope's max to cover it rather than silently clamping the athlete's
      // requested ceiling down to whatever the plain dose-envelope max happened to be.
      doseEnvelope: {
        min: draft.doseMin,
        target: draft.doseTarget,
        max: draft.trackProgression ? Math.max(draft.doseMax, draft.progressionMax) : draft.doseMax,
        unit: 'minutes',
        floorSemantics: 'soft_floor',
      },
      knowledgeLineage: [...MANUAL_KNOWLEDGE_LINEAGE],
      successCriteria: { minCompletedExposures: draft.minCompletedExposures },
    }],
    reviewSchedule: { reviewCadenceDays: draft.reviewCadenceDays, nextReviewDate: draft.nextReviewDate },
    ...(draft.trackProgression ? {
      progressionContract: {
        targetBinding: { objectiveId },
        variable: 'duration_min' as const,
        unit: 'minutes' as const,
        currentValue: draft.doseTarget,
        permittedRange: { min: draft.doseMin, max: draft.progressionMax },
        increment: draft.progressionIncrement,
        knowledgeLineage: [...MANUAL_KNOWLEDGE_LINEAGE],
        observationWindowDays: draft.observationWindowDays,
        minCompletedExposures: draft.minCompletedExposures,
        requiredFollowUpCoveragePct: draft.requiredFollowUpCoveragePct,
        reviewCadenceDays: draft.reviewCadenceDays,
        reductionAlternative: { decrement: draft.reductionDecrement, trigger: 'adverse_response' as const },
      },
    } : {}),
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
  };
}
