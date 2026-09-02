import type { SafetyEnvelope, SessionTemplate } from '../engine/models';
import {
  ATHLETE_EVIDENCE_MODALITIES,
  type AthleteEvidenceDomain,
  type AthleteEvidenceModality,
  type AthleteEvidenceProfile,
  type AthleteEvidenceRecord,
} from './athleteEvidence';
import { KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

/**
 * Filter active, usable evidence records from an athlete profile.
 * Identity mismatch fails closed: records belonging to another user never participate,
 * even if an unvalidated profile reaches this pure policy layer.
 */
export function resolveActiveAthleteEvidenceRecords(
  profile: AthleteEvidenceProfile | null | undefined,
  domain?: AthleteEvidenceDomain
): AthleteEvidenceRecord[] {
  if (!profile || !Array.isArray(profile.records)) return [];
  return profile.records.filter(
    record =>
      record.status === 'active' &&
      record.userId === profile.userId &&
      (!domain || record.domain === domain)
  );
}

export interface SubjectiveCalibrationResult {
  calibratedSoreness: number;
  calibratedFatigue: number;
  offsetApplied: number;
  appliedRecord?: AthleteEvidenceRecord;
}

/**
 * Apply conservative athlete-specific subjective calibration.
 *
 * ADR-0020 D-SUBJFLOOR makes the asymmetry structural: athlete history may never lower
 * today's raw soreness/fatigue values on a deciding path, because doing so could cancel
 * the absolute `soreness > 6`, `fatigue > 8`, or aggregate fatigue floors. Negative
 * offsets therefore fail safe as a no-op here even if an unvalidated record reaches this
 * function. Two-sided reporting-scale calibration requires a separate accepted policy.
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

  if (!record || record.parameters.scalarOffset === undefined || record.parameters.scalarOffset <= 0) {
    return {
      calibratedSoreness: raw.soreness,
      calibratedFatigue: raw.fatigue,
      offsetApplied: 0,
    };
  }

  const offset = Math.min(2.0, record.parameters.scalarOffset);
  const calibratedSoreness = Math.max(1, Math.min(10, Math.round((raw.soreness + offset) * 10) / 10));
  const calibratedFatigue = Math.max(1, Math.min(10, Math.round((raw.fatigue + offset) * 10) / 10));

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
 * Apply athlete-specific recovery kinetics to a safety-linked recovery prior.
 *
 * v1 is deliberately tighten-only: a repeated personal slow-recovery pattern may lengthen
 * the general prior, but this boundary does not authorize a personal fast-recovery pattern
 * to shorten it. Recovery research is protocol- and outcome-dependent, so a universal 36h
 * personal floor would be false precision rather than a validated safety invariant.
 */
export function applyAthleteRecoveryKinetics(
  profile: AthleteEvidenceProfile | null | undefined,
  baseRecoveryHours: number,
  _options?: { isStrenuousLowerBody?: boolean }
): RecoveryKineticsResult {
  const records = resolveActiveAthleteEvidenceRecords(profile, 'recovery_kinetics');
  const record = records.find(
    r =>
      r.refinementType === 'tighten_constraint' &&
      (r.baseKnowledgeClaimId === KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue ||
        r.baseKnowledgeClaimId === KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing)
  );

  if (!record) {
    return { effectiveRecoveryHours: baseRecoveryHours };
  }

  let hours = baseRecoveryHours;

  if (record.parameters.scalarMultiplier !== undefined) {
    const multiplier = Math.max(1.0, Math.min(2.0, record.parameters.scalarMultiplier));
    hours = Math.round(hours * multiplier);
  }

  if (record.parameters.enforcedMinimumRecoveryHours !== undefined) {
    hours = Math.max(hours, record.parameters.enforcedMinimumRecoveryHours);
  }

  const effectiveRecoveryHours = Math.min(168, Math.max(baseRecoveryHours, hours));
  return {
    effectiveRecoveryHours,
    ...(effectiveRecoveryHours > baseRecoveryHours ? { appliedRecord: record } : {}),
  };
}

export interface TissueToleranceResult {
  additionalRestrictedModalities: SessionTemplate['modality'][];
  contraindicatedMovementPatterns: string[];
  appliedRecords: AthleteEvidenceRecord[];
}

function isKnownModality(value: string): value is AthleteEvidenceModality {
  return (ATHLETE_EVIDENCE_MODALITIES as readonly string[]).includes(value);
}

function regionScopeMatches(record: AthleteEvidenceRecord, activeBodyRegions: readonly string[] | undefined): boolean {
  const scope = record.parameters.applicableBodyRegions;
  if (!scope || scope.length === 0 || !activeBodyRegions || activeBodyRegions.length === 0) return true;
  const active = new Set(activeBodyRegions.map(region => region.trim().toLowerCase()));
  return scope.some(region => active.has(region.trim().toLowerCase()));
}

/**
 * Resolve athlete tissue/movement restrictions. Records with an explicit region scope are
 * skipped when the caller has explicit, non-matching current region context; missing region
 * context remains conservative and keeps the restriction active.
 */
export function resolveAthleteTissueTolerance(
  profile: AthleteEvidenceProfile | null | undefined,
  options?: { activeBodyRegions?: readonly string[] }
): TissueToleranceResult {
  const records = [
    ...resolveActiveAthleteEvidenceRecords(profile, 'tissue_tolerance'),
    ...resolveActiveAthleteEvidenceRecords(profile, 'movement_contraindication'),
  ];
  const additionalRestrictedModalities: SessionTemplate['modality'][] = [];
  const contraindicatedMovementPatterns: string[] = [];
  const appliedRecords: AthleteEvidenceRecord[] = [];

  for (const record of records) {
    if (record.refinementType !== 'tighten_constraint' || !regionScopeMatches(record, options?.activeBodyRegions)) {
      continue;
    }

    let changed = false;
    for (const modality of record.parameters.additionalRestrictedModalities ?? []) {
      if (isKnownModality(modality) && !additionalRestrictedModalities.includes(modality)) {
        additionalRestrictedModalities.push(modality);
        changed = true;
      }
    }
    for (const pattern of record.parameters.contraindicatedMovementPatterns ?? []) {
      if (typeof pattern === 'string' && pattern.trim().length > 0 && !contraindicatedMovementPatterns.includes(pattern)) {
        contraindicatedMovementPatterns.push(pattern);
        changed = true;
      }
    }
    if (changed) appliedRecords.push(record);
  }

  return {
    additionalRestrictedModalities,
    contraindicatedMovementPatterns,
    appliedRecords,
  };
}

/**
 * Monotonic safety assertion ensuring a refined safety envelope never weakens the original.
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
  for (const modality of original.restrictedModalities) {
    if (!refined.restrictedModalities.includes(modality)) {
      throw new Error(`Safety monotonicity violation: restricted modality "${modality}" was removed by refinement`);
    }
  }
  for (const category of original.redFlagCategories ?? []) {
    if (!(refined.redFlagCategories ?? []).includes(category)) {
      throw new Error(`Safety monotonicity violation: red flag category "${category}" was removed by refinement`);
    }
  }
}
