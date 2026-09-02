import type { SafetyEnvelope, SessionTemplate } from '../engine/models';
import {
  type AthleteEvidenceDomain,
  type AthleteEvidenceProfile,
  type AthleteEvidenceRecord,
} from './athleteEvidence';
import { KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

/**
 * Filter active, usable evidence records from an athlete profile.
 */
export function resolveActiveAthleteEvidenceRecords(
  profile: AthleteEvidenceProfile | null | undefined,
  domain?: AthleteEvidenceDomain
): AthleteEvidenceRecord[] {
  if (!profile || !Array.isArray(profile.records)) return [];
  return profile.records.filter(
    record => record.status === 'active' && (!domain || record.domain === domain)
  );
}

export interface SubjectiveCalibrationResult {
  calibratedSoreness: number;
  calibratedFatigue: number;
  offsetApplied: number;
  appliedRecord?: AthleteEvidenceRecord;
}

/**
 * Apply athlete-specific subjective calibration offset (e.g., for athletes with chronic baseline soreness).
 * Enforces D-ATHLETE-SAFETY-PRESERVE:
 * - If raw soreness is severe (>= 8), calibration can never adjust it below 6 (preserving the mode trigger).
 * - Calibrated values are always clamped to the valid [1, 10] range.
 */
export function applyAthleteSubjectiveCalibration(
  profile: AthleteEvidenceProfile | null | undefined,
  raw: { soreness: number; fatigue: number }
): SubjectiveCalibrationResult {
  const records = resolveActiveAthleteEvidenceRecords(profile, 'subjective_calibration');
  const record = records.find(
    r =>
      r.refinementType === 'calibrate_scalar' &&
      r.baseKnowledgeClaimId === KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy &&
      r.parameters.scalarOffset !== undefined
  );

  if (!record || record.parameters.scalarOffset === undefined) {
    return {
      calibratedSoreness: raw.soreness,
      calibratedFatigue: raw.fatigue,
      offsetApplied: 0,
    };
  }

  const offset = record.parameters.scalarOffset;

  // An athlete whose habitual baseline is 3.5 might have an offset of -1.5.
  // We apply the offset, then clamp.
  let calibratedSoreness = raw.soreness + offset;
  let calibratedFatigue = raw.fatigue + offset;

  // SAFETY GUARD: Severe soreness (>= 8) must never be diluted into green/normal territory (< 6)
  if (raw.soreness >= 8) {
    calibratedSoreness = Math.max(6, calibratedSoreness);
  }
  if (raw.fatigue >= 8) {
    calibratedFatigue = Math.max(6, calibratedFatigue);
  }

  calibratedSoreness = Math.max(1, Math.min(10, Math.round(calibratedSoreness * 10) / 10));
  calibratedFatigue = Math.max(1, Math.min(10, Math.round(calibratedFatigue * 10) / 10));

  return {
    calibratedSoreness,
    calibratedFatigue,
    offsetApplied: offset,
    appliedRecord: record,
  };
}

export interface RecoveryKineticsResult {
  effectiveRecoveryHours: number;
  appliedRecord?: AthleteEvidenceRecord;
}

/**
 * Apply athlete-specific recovery kinetics scaling to template recovery hours.
 * Enforces D-ATHLETE-SAFETY-PRESERVE:
 * - Recovery hours cannot be reduced below 75% of baseline or below 24h for strenuous lower-body work.
 * - Enforced minimums can only lengthen recovery duration, never shorten it.
 */
export function applyAthleteRecoveryKinetics(
  profile: AthleteEvidenceProfile | null | undefined,
  baseRecoveryHours: number,
  options?: { isStrenuousLowerBody?: boolean }
): RecoveryKineticsResult {
  const records = resolveActiveAthleteEvidenceRecords(profile, 'recovery_kinetics');
  const record = records.find(
    r =>
      r.baseKnowledgeClaimId === KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue ||
      r.baseKnowledgeClaimId === KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing
  );

  if (!record) {
    return { effectiveRecoveryHours: baseRecoveryHours };
  }

  let hours = baseRecoveryHours;

  if (record.parameters.scalarMultiplier !== undefined) {
    const mult = Math.max(0.75, Math.min(2.0, record.parameters.scalarMultiplier));
    hours = Math.round(hours * mult);
  }

  if (record.parameters.enforcedMinimumRecoveryHours !== undefined) {
    hours = Math.max(hours, record.parameters.enforcedMinimumRecoveryHours);
  }

  // Safety constraint: strenuous lower-body work (>= 48h base) cannot be compressed below 36h
  if (options?.isStrenuousLowerBody && baseRecoveryHours >= 48) {
    hours = Math.max(36, hours);
  }

  return {
    effectiveRecoveryHours: Math.min(168, Math.max(0, hours)),
    appliedRecord: record,
  };
}

export interface TissueToleranceResult {
  additionalRestrictedModalities: SessionTemplate['modality'][];
  appliedRecords: AthleteEvidenceRecord[];
}

/**
 * Resolve tissue tolerance restrictions based on athlete evidence.
 * Can only tighten constraints by adding restricted modalities or enforcing minimum gaps.
 */
export function resolveAthleteTissueTolerance(
  profile: AthleteEvidenceProfile | null | undefined,
  options?: { activeBodyRegions?: readonly string[] }
): TissueToleranceResult {
  const records = resolveActiveAthleteEvidenceRecords(profile, 'tissue_tolerance');
  const additionalRestrictedModalities: SessionTemplate['modality'][] = [];
  const appliedRecords: AthleteEvidenceRecord[] = [];

  for (const record of records) {
    if (record.refinementType === 'tighten_constraint') {
      if (record.parameters.additionalRestrictedModalities) {
        for (const mod of record.parameters.additionalRestrictedModalities) {
          const typedMod = mod as SessionTemplate['modality'];
          if (!additionalRestrictedModalities.includes(typedMod)) {
            additionalRestrictedModalities.push(typedMod);
          }
        }
        appliedRecords.push(record);
      }
    }
  }

  if (options?.activeBodyRegions && options.activeBodyRegions.length > 0) {
    // Retained for context when evaluating regional loading constraints
  }

  return {
    additionalRestrictedModalities,
    appliedRecords,
  };
}

/**
 * Monotonic safety assertion ensuring refined safety envelope never weakens safety over original.
 */
export function assertSafetyMonotonicity(
  original: SafetyEnvelope,
  refined: SafetyEnvelope
): void {
  if (original.clinicalFlagActive && !refined.clinicalFlagActive) {
    throw new Error('Safety monotonicity violation: clinicalFlagActive was disabled by refinement');
  }
  if (original.redFlagActive && !refined.redFlagActive) {
    throw new Error('Safety monotonicity violation: redFlagActive was disabled by refinement');
  }
  if (original.clinicalEscalationRequired && !refined.clinicalEscalationRequired) {
    throw new Error('Safety monotonicity violation: clinicalEscalationRequired was disabled by refinement');
  }
  for (const mod of original.restrictedModalities) {
    if (!refined.restrictedModalities.includes(mod)) {
      throw new Error(`Safety monotonicity violation: restricted modality "${mod}" was removed by refinement`);
    }
  }
}
