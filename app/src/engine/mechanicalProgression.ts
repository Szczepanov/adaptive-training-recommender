import type { BodyRegion, GuardrailKey, DailySubjectiveCheckin, RegionTissueResponse } from './models.ts';
import { addDaysToLocalDateString } from '../utils/localDate.ts';
import {
  MECHANICAL_QUALIFYING_IDENTITIES,
  type MechanicalStage,
} from '../workouts/mechanicalExposure.ts';

export interface MechanicalExposureRecord {
  date: string;
  workoutId: string;
  stage: MechanicalStage;
}

export interface CheckinRecord {
  date: string;
  checkin: DailySubjectiveCheckin;
}

export type MechanicalProgressionStatus =
  | 'eligible'
  | 'blocked'
  | 'withheld'
  | 'regressed';

export type TissueResponseVerdict = 'normal' | 'adverse' | 'missing' | 'none_recent';

export interface MechanicalProgressionVerdict {
  stage: MechanicalStage;
  eligible: boolean;
  status: MechanicalProgressionStatus;
  withheldReason?: string;
  recentExposureCount: number;
  lastExposureDate?: string;
  lastExposureStage?: MechanicalStage;
  tissueResponse: {
    verdict: TissueResponseVerdict;
    affectedRegions: readonly BodyRegion[];
    notes: readonly string[];
  };
  eligibleWorkoutIds: readonly string[];
}

export interface EvaluateMechanicalProgressionInput {
  asOfDate: string;
  exposureHistory: readonly MechanicalExposureRecord[];
  checkinHistory: readonly CheckinRecord[];
  guardrails?: ReadonlySet<GuardrailKey> | Partial<Record<GuardrailKey, boolean>>;
  hasKneeSwelling?: boolean;
  hasAcutePain?: boolean;
  targetStage?: MechanicalStage;
}

/** Continuity window owned by `policy.evergreen.mechanical_exposure_v1`: an exposure
 * exactly this many calendar days ago is outside it, so >= 14 days without exposure is
 * re-entry at Stage 1. Callers must supply at least this much exposure history; a shorter
 * read makes a recent exposure invisible and is indistinguishable from a real gap. */
export const MECHANICAL_CONTINUITY_WINDOW_DAYS = 14;

const LOWER_BODY_REGIONS: ReadonlySet<BodyRegion> = new Set<BodyRegion>([
  'knee',
  'achilles',
  'calf',
  'ankle',
  'hamstring',
  'quadriceps',
  'adductor_groin',
  'hip',
]);

function isGuardrailActive(
  guardrails: ReadonlySet<GuardrailKey> | Partial<Record<GuardrailKey, boolean>> | undefined,
  key: GuardrailKey,
): boolean {
  if (!guardrails) return false;
  if (guardrails instanceof Set) return guardrails.has(key);
  return Boolean((guardrails as Partial<Record<GuardrailKey, boolean>>)[key]);
}

/**
 * Pure evaluator for longitudinal mechanical and impact capacity progression and regression.
 *
 * Enforces:
 * 1. Hard safety gates: `avoid_high_impact`, knee swelling, acute pain block mechanical exposure.
 * 2. Gap re-entry gate: Absence of exposure for >= 14 days resets allowed stage to Stage 1.
 * 3. Response-gated progression: Stage advancement (K -> K+1) requires at least two recent
 *    Stage-K exposures with explicit normal follow-up tissue evidence. Missing evidence fails closed.
 * 4. Symptom regression: Reported mild/moderate/severe tissue symptoms regress or withhold stage.
 *
 * Consecutive-calendar-day spacing is intentionally date-scoped in coverage/optimizer
 * (#859). A weekly stage/tissue verdict must not turn a one-day spacing constraint into a
 * seven-day suspension.
 */
export function evaluateMechanicalStageProgression(
  input: EvaluateMechanicalProgressionInput,
): MechanicalProgressionVerdict {
  const { asOfDate, exposureHistory, checkinHistory, guardrails } = input;

  // 1. Guardrail and acute clinical symptom check
  const guardrailCheck = evaluateMechanicalGuardrails({
    avoid_high_impact: isGuardrailActive(guardrails, 'avoid_high_impact'),
    knee_swelling: Boolean(input.hasKneeSwelling),
    acute_pain: Boolean(input.hasAcutePain),
  });

  if (guardrailCheck.blocked) {
    const isAvoidImpact = guardrailCheck.reasons.includes('avoid_high_impact_active');
    return {
      stage: 1,
      eligible: false,
      status: 'blocked',
      withheldReason: isAvoidImpact
        ? 'Impact and mechanical loading are blocked by the active avoid_high_impact safety limit.'
        : 'Mechanical exposure is blocked while acute pain or joint swelling is reported.',
      recentExposureCount: 0,
      tissueResponse: {
        verdict: isAvoidImpact ? 'none_recent' : 'adverse',
        affectedRegions: input.hasKneeSwelling ? ['knee'] : [],
        notes: isAvoidImpact ? ['avoid_high_impact guardrail is active'] : ['Acute pain or swelling reported'],
      },
      eligibleWorkoutIds: [],
    };
  }

  // 2. Sort past exposures strictly before asOfDate
  const pastExposures = [...exposureHistory]
    .filter(e => e.date < asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lastExposure = pastExposures.at(-1);
  const lookback14Days = addDaysToLocalDateString(asOfDate, -MECHANICAL_CONTINUITY_WINDOW_DAYS);
  // `lookback14Days` itself is exactly 14 calendar days ago, so it is outside the
  // continuity window: >=14 days without exposure is re-entry by policy.
  const recentExposures = pastExposures.filter(e => e.date > lookback14Days);

  // 3. Analyze tissue responses following recent exposures. The date-specific
  // no-consecutive-day gate is applied later from actual/projected history.
  const checkinsByDate = new Map(checkinHistory.map(c => [c.date, c.checkin]));
  const todayCheckin = checkinsByDate.get(asOfDate);

  const hasPain = todayCheckin?.painOrInjury || Boolean((todayCheckin as unknown as { painFlag?: boolean })?.painFlag);
  if (hasPain) {
    return {
      stage: 1,
      eligible: false,
      status: 'blocked',
      withheldReason: 'Mechanical exposure is blocked by an active pain flag in today’s check-in.',
      recentExposureCount: recentExposures.length,
      lastExposureDate: lastExposure?.date,
      lastExposureStage: lastExposure?.stage,
      tissueResponse: { verdict: 'adverse', affectedRegions: [], notes: ['painFlag is active'] },
      eligibleWorkoutIds: [],
    };
  }

  if (todayCheckin?.illnessSymptoms) {
    return {
      stage: lastExposure?.stage ?? 1,
      eligible: false,
      status: 'withheld',
      withheldReason: 'Mechanical exposure is withheld while illness symptoms are active.',
      recentExposureCount: recentExposures.length,
      lastExposureDate: lastExposure?.date,
      lastExposureStage: lastExposure?.stage,
      tissueResponse: { verdict: 'none_recent', affectedRegions: [], notes: ['Illness symptoms active'] },
      eligibleWorkoutIds: [],
    };
  }

  // Check for adverse response after the most recent exposure. Older resolved symptoms do
  // not keep regressing the athlete indefinitely once a newer exposure has been completed.
  const affectedRegions: BodyRegion[] = [];
  let foundAdverse = false;
  let foundSevere = false;

  for (const record of checkinHistory) {
    if (record.date <= (lastExposure?.date ?? lookback14Days) || record.date > asOfDate) continue;
    const checkin = record.checkin;
    if (checkin.soreness !== undefined && checkin.soreness !== null && checkin.soreness >= 5) {
      foundAdverse = true;
    }
    if (checkin.tissueResponses) {
      for (const [regionKey, response] of Object.entries(checkin.tissueResponses)) {
        const region = regionKey as BodyRegion;
        const tissueResponse = response as RegionTissueResponse | undefined;
        if (!LOWER_BODY_REGIONS.has(region) || !tissueResponse) continue;
        const levels = [
          tissueResponse.morningState,
          tissueResponse.painDuringTraining,
          tissueResponse.afterTrainingState,
          tissueResponse.nextMorningReaction,
        ].filter(Boolean);

        if (levels.some(l => l === 'moderate' || l === 'severe')) {
          foundSevere = true;
          foundAdverse = true;
          if (!affectedRegions.includes(region)) affectedRegions.push(region);
        } else if (levels.some(l => l === 'mild')) {
          foundAdverse = true;
          if (!affectedRegions.includes(region)) affectedRegions.push(region);
        }
      }
    }
  }

  if (foundSevere) {
    return {
      stage: 1,
      eligible: false,
      status: 'withheld',
      withheldReason: `Mechanical exposure is withheld due to moderate or severe tissue response in: ${affectedRegions.join(', ')}.`,
      recentExposureCount: recentExposures.length,
      lastExposureDate: lastExposure?.date,
      lastExposureStage: lastExposure?.stage,
      tissueResponse: {
        verdict: 'adverse',
        affectedRegions,
        notes: ['Severe or moderate symptoms reported in lower-body tissue response'],
      },
      eligibleWorkoutIds: [],
    };
  }

  // 4. Determine stage baseline from exposure gap
  if (!lastExposure || recentExposures.length === 0) {
    // Gap >= 14 days or no history: re-entry at Stage 1
    const eligibleWorkouts = MECHANICAL_QUALIFYING_IDENTITIES
      .filter(identity => identity.planningUse === 'maintenance_candidate' && identity.stage <= 1)
      .map(identity => identity.workoutId);

    return {
      stage: 1,
      eligible: true,
      status: 'eligible',
      recentExposureCount: 0,
      tissueResponse: { verdict: 'none_recent', affectedRegions: [], notes: ['Re-entry dose: no exposure in past 14 days'] },
      eligibleWorkoutIds: eligibleWorkouts,
    };
  }

  // Check the tissue response following the most recent exposure
  const dayAfterLastExposure = addDaysToLocalDateString(lastExposure.date, 1);
  const followUpCheckin = checkinsByDate.get(dayAfterLastExposure);

  const explicitFollowUpVerdict = (checkin: DailySubjectiveCheckin | undefined): TissueResponseVerdict => {
    if (!checkin?.tissueResponses) return 'missing';
    const lowerBodyResponses = Object.entries(checkin.tissueResponses)
      .filter(([region, response]) => LOWER_BODY_REGIONS.has(region as BodyRegion) && Boolean(response))
      .map(([, response]) => response as RegionTissueResponse);
    if (lowerBodyResponses.length === 0) return 'missing';
    const levels = lowerBodyResponses.flatMap(response => [
      response.morningState,
      response.painDuringTraining,
      response.afterTrainingState,
      response.nextMorningReaction,
    ].filter(Boolean));
    if (levels.some(level => level === 'mild' || level === 'moderate' || level === 'severe')) return 'adverse';
    return levels.some(level => level === 'normal') ? 'normal' : 'missing';
  };

  const responseVerdict: TissueResponseVerdict = foundAdverse ? 'adverse' : explicitFollowUpVerdict(followUpCheckin);
  const responseNotes: string[] = [];

  if (responseVerdict === 'adverse') {
    responseNotes.push(`Symptoms reported after the latest exposure${affectedRegions.length ? ` in: ${affectedRegions.join(', ')}` : ''}`);
  } else if (responseVerdict === 'missing') {
    responseNotes.push('Explicit next-day lower-body tissue response is missing; progression held');
  }

  // 5. Progression / Regression calculation
  // Issue #805: the held stage is the highest stage performed with an explicit normal next-day
  // follow-up inside the continuity window, not merely the latest exposure's stage. A lower-stage
  // session (e.g. a linear-speed touch) therefore no longer demotes an athlete who is tolerating a
  // higher stage; symptoms, gaps and guardrails still regress/block as before.
  const hasNormalFollowUp = (exposure: MechanicalExposureRecord): boolean =>
    explicitFollowUpVerdict(checkinsByDate.get(addDaysToLocalDateString(exposure.date, 1))) === 'normal';
  const confirmedStages = recentExposures.filter(hasNormalFollowUp).map(exposure => exposure.stage);
  // Only normal-confirmed stages are allowed to ratchet the held stage upward. A newly
  // attempted higher-stage exposure with a missing follow-up therefore cannot silently become
  // the new baseline. When no exposure in the continuity window has any explicit normal
  // follow-up, fail closed to Stage 1 rather than manufacturing evidence of tolerance.
  const heldStage = (confirmedStages.length > 0 ? Math.max(...confirmedStages) : 1) as MechanicalStage;
  let calculatedStage: MechanicalStage = heldStage;

  if (responseVerdict === 'adverse') {
    // Regress stage on adverse symptoms after the latest exposure
    calculatedStage = Math.max(1, (lastExposure.stage - 1)) as MechanicalStage;
  } else if (responseVerdict === 'normal') {
    // A target only ever raises the request; it never demotes below the held stage.
    const requested = input.targetStage ?? heldStage;
    if (requested > heldStage) {
      const successfulCurrentStageExposures = recentExposures.filter(exposure =>
        exposure.stage === heldStage && hasNormalFollowUp(exposure)
      ).length;
      if (successfulCurrentStageExposures >= 2) {
        // Conservative progression: at most +1 stage.
        calculatedStage = Math.min(4, heldStage + 1) as MechanicalStage;
      } else {
        calculatedStage = heldStage;
        responseNotes.push(`Progression held: ${successfulCurrentStageExposures}/2 current-stage exposures have explicit normal follow-up.`);
      }
    } else {
      calculatedStage = heldStage;
    }
  } else if (responseVerdict === 'missing') {
    // Missing response evidence for the latest exposure: hold, do NOT advance
    calculatedStage = heldStage;
  }

  const status: MechanicalProgressionStatus = foundAdverse ? 'regressed' : 'eligible';
  const eligibleWorkouts = MECHANICAL_QUALIFYING_IDENTITIES
    .filter(identity => identity.planningUse === 'maintenance_candidate' && identity.stage <= calculatedStage)
    .map(identity => identity.workoutId);

  return {
    stage: calculatedStage,
    eligible: true,
    status,
    ...(foundAdverse ? { withheldReason: `Regressed to Stage ${calculatedStage} due to mild tissue symptoms.` } : {}),
    recentExposureCount: recentExposures.length,
    lastExposureDate: lastExposure.date,
    lastExposureStage: lastExposure.stage,
    tissueResponse: {
      verdict: responseVerdict,
      affectedRegions,
      notes: responseNotes,
    },
    eligibleWorkoutIds: eligibleWorkouts,
  };
}

export const evaluateMechanicalProgression = evaluateMechanicalStageProgression;

export function evaluateMechanicalGuardrails(args: {
  avoid_high_impact?: boolean;
  knee_swelling?: boolean;
  acute_pain?: boolean;
}): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (args.avoid_high_impact) reasons.push('avoid_high_impact_active');
  if (args.knee_swelling) reasons.push('knee_swelling_reported');
  if (args.acute_pain) reasons.push('acute_pain_reported');
  return { blocked: reasons.length > 0, reasons };
}
