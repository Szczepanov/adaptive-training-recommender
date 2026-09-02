/**
 * ADR-0033 D-SKR-BOUNDARIES:
 * Athlete-specific evidence represents repeated, longitudinal personal response patterns
 * learned about one specific athlete. It is strictly identity-scoped (bound to a userId),
 * never stored in the global Sports Knowledge Registry, and functions as an empirical
 * posterior refinement over general Sports Knowledge priors.
 */

export const ATHLETE_EVIDENCE_DOMAINS = [
  'recovery_kinetics',
  'subjective_calibration',
  'tissue_tolerance',
  'movement_contraindication',
  'sensor_fidelity',
  'modality_preference',
] as const;

export type AthleteEvidenceDomain = typeof ATHLETE_EVIDENCE_DOMAINS[number];

export const ATHLETE_REFINEMENT_TYPES = [
  'tighten_constraint',
  'calibrate_scalar',
  'prioritize_candidate',
  'abstain_general_rule',
] as const;

export type AthleteRefinementType = typeof ATHLETE_REFINEMENT_TYPES[number];

export const ATHLETE_EVIDENCE_STATUSES = [
  'active',
  'provisional',
  'superseded',
  'revoked',
] as const;

export type AthleteEvidenceStatus = typeof ATHLETE_EVIDENCE_STATUSES[number];

export const ATHLETE_EVIDENCE_CONFIDENCES = ['high', 'moderate', 'low'] as const;

export type AthleteEvidenceConfidence = typeof ATHLETE_EVIDENCE_CONFIDENCES[number];

/**
 * Bounded parameters for an athlete policy refinement.
 * Enforces D-ATHLETE-SAFETY-PRESERVE: modifications are constrained within safe physiological intervals.
 */
export interface AthleteRefinementParameters {
  /** Additive offset applied to an internal score or baseline (clamped to [-2.0, +2.0]). */
  scalarOffset?: number;
  /** Multiplicative scaling applied to recovery duration (clamped to [0.75, 2.0]). */
  scalarMultiplier?: number;
  /** Enforced minimum recovery hours following specified load (clamped to [0, 168]). */
  enforcedMinimumRecoveryHours?: number;
  /** Additional restricted exercise modalities for this athlete. */
  additionalRestrictedModalities?: string[];
  /** Specific movement patterns that are contraindicated for this athlete. */
  contraindicatedMovementPatterns?: string[];
  /** Optional coach or athlete explanatory note. */
  customNote?: string;
}

/**
 * An empirical personal response pattern learned from repeated observations of one athlete.
 */
export interface AthleteEvidenceRecord {
  /** Unique stable pattern ID within the athlete's profile (e.g. 'achilles_delayed_irritability'). */
  id: string;
  /** Strict user isolation identifier. */
  userId: string;
  /** The physiological or behavioral domain of the pattern. */
  domain: AthleteEvidenceDomain;
  /** Lifecycle status of the pattern. Only 'active' records participate in decisions. */
  status: AthleteEvidenceStatus;
  /** Monotonically increasing version of this personal evidence record. */
  version: number;
  /** Linkage to the underlying general Sports Knowledge Claim prior. */
  baseKnowledgeClaimId: string;
  /** Optional specific version of the base knowledge claim when calibrated. */
  baseKnowledgeClaimVersion?: number;
  /** The nature of the policy refinement this pattern asserts over the prior. */
  refinementType: AthleteRefinementType;
  /** Bounded adjustment parameters. */
  parameters: AthleteRefinementParameters;
  /** Number of discrete observation events supporting this pattern (>= 1). */
  sampleSize: number;
  /** Temporal span in calendar days across which observations were gathered (>= 1). */
  observationWindowDays: number;
  /** Empirical confidence tier based on consistency and data volume. */
  confidence: AthleteEvidenceConfidence;
  /** ISO date (YYYY-MM-DD) of the first corroborating observation. */
  firstObservedDate: string;
  /** ISO date (YYYY-MM-DD) of the most recent corroborating observation. */
  lastObservedDate: string;
  /** ISO date (YYYY-MM-DD) when the pattern was explicitly reviewed or confirmed. */
  reviewedAt?: string;
  /** Concise explanation of why this refinement applies to the athlete. */
  rationale: string;
}

/**
 * The root aggregate of an athlete's personal evidence records, persisted under users/{userId}/.
 */
export interface AthleteEvidenceProfile {
  userId: string;
  schemaVersion: 1;
  updatedAt: string;
  records: AthleteEvidenceRecord[];
}

export interface AthleteEvidenceValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_ID_REGEX = /^[a-z0-9_.-]{3,64}$/;

function isValidDate(dateStr: string): boolean {
  if (!ISO_DATE_REGEX.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Validate a single athlete evidence record against structural, referential, and safety bounds.
 */
export function validateAthleteEvidenceRecord(
  record: unknown,
  registeredClaimIds?: ReadonlySet<string>
): AthleteEvidenceValidationResult {
  const errors: string[] = [];

  if (record === null || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be a non-null object'] };
  }

  const rec = record as Partial<AthleteEvidenceRecord>;

  if (!rec.id || typeof rec.id !== 'string' || !RECORD_ID_REGEX.test(rec.id)) {
    errors.push(`Invalid record id: "${rec.id}". Must be 3-64 characters matching ${RECORD_ID_REGEX}`);
  }

  if (!rec.userId || typeof rec.userId !== 'string' || rec.userId.trim().length === 0) {
    errors.push('userId is required and cannot be empty');
  }

  if (!rec.domain || !ATHLETE_EVIDENCE_DOMAINS.includes(rec.domain as AthleteEvidenceDomain)) {
    errors.push(`Invalid domain: "${rec.domain}". Allowed: ${ATHLETE_EVIDENCE_DOMAINS.join(', ')}`);
  }

  if (!rec.status || !ATHLETE_EVIDENCE_STATUSES.includes(rec.status as AthleteEvidenceStatus)) {
    errors.push(`Invalid status: "${rec.status}". Allowed: ${ATHLETE_EVIDENCE_STATUSES.join(', ')}`);
  }

  if (typeof rec.version !== 'number' || !Number.isInteger(rec.version) || rec.version < 1) {
    errors.push('version must be a positive integer >= 1');
  }

  if (!rec.baseKnowledgeClaimId || typeof rec.baseKnowledgeClaimId !== 'string') {
    errors.push('baseKnowledgeClaimId is required and must be a string');
  } else if (registeredClaimIds) {
    if (!registeredClaimIds.has(rec.baseKnowledgeClaimId)) {
      errors.push(`baseKnowledgeClaimId "${rec.baseKnowledgeClaimId}" does not exist in the Sports Knowledge Registry`);
    }
  }

  if (rec.baseKnowledgeClaimVersion !== undefined) {
    if (typeof rec.baseKnowledgeClaimVersion !== 'number' || !Number.isInteger(rec.baseKnowledgeClaimVersion) || rec.baseKnowledgeClaimVersion < 1) {
      errors.push('baseKnowledgeClaimVersion must be a positive integer >= 1');
    }
  }

  if (!rec.refinementType || !ATHLETE_REFINEMENT_TYPES.includes(rec.refinementType as AthleteRefinementType)) {
    errors.push(`Invalid refinementType: "${rec.refinementType}". Allowed: ${ATHLETE_REFINEMENT_TYPES.join(', ')}`);
  }

  if (!rec.confidence || !ATHLETE_EVIDENCE_CONFIDENCES.includes(rec.confidence as AthleteEvidenceConfidence)) {
    errors.push(`Invalid confidence: "${rec.confidence}". Allowed: ${ATHLETE_EVIDENCE_CONFIDENCES.join(', ')}`);
  }

  if (typeof rec.sampleSize !== 'number' || !Number.isInteger(rec.sampleSize) || rec.sampleSize < 1) {
    errors.push('sampleSize must be an integer >= 1');
  }

  if (typeof rec.observationWindowDays !== 'number' || !Number.isInteger(rec.observationWindowDays) || rec.observationWindowDays < 1) {
    errors.push('observationWindowDays must be an integer >= 1');
  }

  if (!rec.firstObservedDate || !isValidDate(rec.firstObservedDate)) {
    errors.push(`firstObservedDate "${rec.firstObservedDate}" must be a valid ISO YYYY-MM-DD date`);
  }

  if (!rec.lastObservedDate || !isValidDate(rec.lastObservedDate)) {
    errors.push(`lastObservedDate "${rec.lastObservedDate}" must be a valid ISO YYYY-MM-DD date`);
  }

  if (rec.firstObservedDate && rec.lastObservedDate && isValidDate(rec.firstObservedDate) && isValidDate(rec.lastObservedDate)) {
    if (rec.firstObservedDate > rec.lastObservedDate) {
      errors.push(`firstObservedDate (${rec.firstObservedDate}) cannot be after lastObservedDate (${rec.lastObservedDate})`);
    }
  }

  if (rec.reviewedAt !== undefined && !isValidDate(rec.reviewedAt)) {
    errors.push(`reviewedAt "${rec.reviewedAt}" must be a valid ISO YYYY-MM-DD date`);
  }

  if (!rec.rationale || typeof rec.rationale !== 'string' || rec.rationale.trim().length < 5) {
    errors.push('rationale is required and must be at least 5 characters');
  }

  // Safety & parameter bounds checking
  if (!rec.parameters || typeof rec.parameters !== 'object') {
    errors.push('parameters must be an object');
  } else {
    const p = rec.parameters;

    if (p.scalarOffset !== undefined) {
      if (typeof p.scalarOffset !== 'number' || !Number.isFinite(p.scalarOffset)) {
        errors.push('parameters.scalarOffset must be a finite number');
      } else if (p.scalarOffset < -2.0 || p.scalarOffset > 2.0) {
        errors.push(`parameters.scalarOffset (${p.scalarOffset}) violates safety bounds [-2.0, +2.0]`);
      }
    }

    if (p.scalarMultiplier !== undefined) {
      if (typeof p.scalarMultiplier !== 'number' || !Number.isFinite(p.scalarMultiplier)) {
        errors.push('parameters.scalarMultiplier must be a finite number');
      } else if (p.scalarMultiplier < 0.75 || p.scalarMultiplier > 2.0) {
        errors.push(`parameters.scalarMultiplier (${p.scalarMultiplier}) violates safety bounds [0.75, 2.0]`);
      }
    }

    if (p.enforcedMinimumRecoveryHours !== undefined) {
      if (typeof p.enforcedMinimumRecoveryHours !== 'number' || !Number.isInteger(p.enforcedMinimumRecoveryHours)) {
        errors.push('parameters.enforcedMinimumRecoveryHours must be an integer');
      } else if (p.enforcedMinimumRecoveryHours < 0 || p.enforcedMinimumRecoveryHours > 168) {
        errors.push(`parameters.enforcedMinimumRecoveryHours (${p.enforcedMinimumRecoveryHours}) violates bounds [0, 168] hours`);
      }
    }

    if (p.additionalRestrictedModalities !== undefined) {
      if (!Array.isArray(p.additionalRestrictedModalities)) {
        errors.push('parameters.additionalRestrictedModalities must be an array of strings');
      }
    }

    if (p.contraindicatedMovementPatterns !== undefined) {
      if (!Array.isArray(p.contraindicatedMovementPatterns)) {
        errors.push('parameters.contraindicatedMovementPatterns must be an array of strings');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate an athlete evidence profile and all its constituent records.
 */
export function validateAthleteEvidenceProfile(
  profile: unknown,
  registeredClaimIds?: ReadonlySet<string>
): AthleteEvidenceValidationResult {
  const errors: string[] = [];

  if (profile === null || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be a non-null object'] };
  }

  const prof = profile as Partial<AthleteEvidenceProfile>;

  if (!prof.userId || typeof prof.userId !== 'string' || prof.userId.trim().length === 0) {
    errors.push('userId is required and cannot be empty');
  }

  if (prof.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, received: ${prof.schemaVersion}`);
  }

  if (!prof.updatedAt || typeof prof.updatedAt !== 'string') {
    errors.push('updatedAt is required');
  }

  if (!Array.isArray(prof.records)) {
    errors.push('records must be an array');
  } else {
    const seenIds = new Set<string>();
    prof.records.forEach((record, idx) => {
      const recResult = validateAthleteEvidenceRecord(record, registeredClaimIds);
      recResult.errors.forEach(err => errors.push(`records[${idx}]: ${err}`));

      if (record && typeof record === 'object' && 'id' in record) {
        const id = (record as { id: string }).id;
        if (seenIds.has(id)) {
          errors.push(`Duplicate record ID found in profile: "${id}"`);
        }
        seenIds.add(id);

        if ('userId' in record && prof.userId && (record as { userId: string }).userId !== prof.userId) {
          errors.push(`records[${idx}].userId "${(record as { userId: string }).userId}" does not match profile userId "${prof.userId}"`);
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
