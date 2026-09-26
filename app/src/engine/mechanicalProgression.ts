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

const LOWER_BODY_REGIONS: ReadonlySet<BodyRegion> = new Set<BodyRegion>([
  'knee',
  'achilles',
  'calf',
  'ankle',
  'hamstring',
  'quadriceps',
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
 * 2. Spacing gate: No consecutive high-impact calendar days (minimum 48h for connective tissue).
 * 3. Gap re-entry gate: Absence of exposure for >= 14 days resets allowed stage to Stage 1.
 * 4. Response-gated progression: Stage advancement (K -> K+1) strictly requires explicit normal
 *    tissue response evidence following Stage K exposure. Missing evidence halts progression.
 * 5. Symptom regression: Reported mild/moderate/severe tissue symptoms regress or withhold stage.
 */
export function evaluateMechanicalStageProgression(
  input: EvaluateMechanicalProgressionInput,
): MechanicalProgressionVerdict {
  const { asOfDate, exposureHistory, checkinHistory, guardrails } = input;

  // 1. Guardrail and acute clinical symptom check
  if (isGuardrailActive(guardrails, 'avoid_high_impact')) {
    return {
      stage: 1,
      eligible: false,
      status: 'blocked',
      withheldReason: 'Impact and mechanical loading are blocked by the active avoid_high_impact safety limit.',
      recentExposureCount: 0,
      tissueResponse: { verdict: 'none_recent', affectedRegions: [], notes: ['avoid_high_impact guardrail is active'] },
      eligibleWorkoutIds: [],
    };
  }

  if (input.hasKneeSwelling || input.hasAcutePain) {
    return {
      stage: 1,
      eligible: false,
      status: 'blocked',
      withheldReason: 'Mechanical exposure is blocked while acute pain or joint swelling is reported.',
      recentExposureCount: 0,
      tissueResponse: { verdict: 'adverse', affectedRegions: input.hasKneeSwelling ? ['knee'] : [], notes: ['Acute pain or swelling reported'] },
      eligibleWorkoutIds: [],
    };
  }

  // 2. Sort past exposures strictly before asOfDate
  const pastExposures = [...exposureHistory]
    .filter(e => e.date < asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lastExposure = pastExposures.at(-1);
  const lookback14Days = addDaysToLocalDateString(asOfDate, -14);
  const recentExposures = pastExposures.filter(e => e.date >= lookback14Days);

  // Spacing rule: no high-impact on consecutive days
  const yesterday = addDaysToLocalDateString(asOfDate, -1);
  if (lastExposure && lastExposure.date === yesterday) {
    return {
      stage: lastExposure.stage,
      eligible: false,
      status: 'withheld',
      withheldReason: 'Mechanical exposure is withheld on consecutive days to allow connective tissue remodeling.',
      recentExposureCount: recentExposures.length,
      lastExposureDate: lastExposure.date,
      lastExposureStage: lastExposure.stage,
      tissueResponse: { verdict: 'none_recent', affectedRegions: [], notes: ['Exposure occurred yesterday'] },
      eligibleWorkoutIds: [],
    };
  }

  // 3. Analyze tissue responses following recent exposures
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

  // Check for adverse tissue response in recent checkins
  const affectedRegions: BodyRegion[] = [];
  let foundAdverse = false;
  let foundSevere = false;

  for (const record of checkinHistory) {
    if (record.date < lookback14Days || record.date > asOfDate) continue;
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
      .filter(i => i.stage <= 1)
      .map(i => i.workoutId);

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
  const followUpCheckin = checkinsByDate.get(dayAfterLastExposure) ?? checkinsByDate.get(asOfDate);

  let responseVerdict: TissueResponseVerdict = 'normal';
  const responseNotes: string[] = [];

  if (foundAdverse) {
    responseVerdict = 'adverse';
    responseNotes.push(`Mild symptoms reported in: ${affectedRegions.join(', ')}`);
  } else if (!followUpCheckin) {
    // No follow-up check-in recorded after the last exposure: missing evidence fails closed
    responseVerdict = 'missing';
    responseNotes.push('No follow-up check-in recorded after previous exposure; progression held');
  }

  // 5. Progression / Regression calculation
  let calculatedStage: MechanicalStage = lastExposure.stage;

  if (responseVerdict === 'adverse') {
    // Regress stage on adverse symptoms
    calculatedStage = Math.max(1, (lastExposure.stage - 1)) as MechanicalStage;
  } else if (responseVerdict === 'normal') {
    // Normal response allows progression if targetStage requests higher
    const requested = input.targetStage ?? lastExposure.stage;
    if (requested > lastExposure.stage) {
      // Conservative progression: at most +1 stage
      calculatedStage = Math.min(4, lastExposure.stage + 1) as MechanicalStage;
    } else {
      calculatedStage = requested;
    }
  } else if (responseVerdict === 'missing') {
    // Missing response evidence: hold stage at last exposure stage, do NOT advance
    calculatedStage = lastExposure.stage;
  }

  const status: MechanicalProgressionStatus = foundAdverse ? 'regressed' : 'eligible';
  const eligibleWorkouts = MECHANICAL_QUALIFYING_IDENTITIES
    .filter(i => i.stage <= calculatedStage)
    .map(i => i.workoutId);

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
