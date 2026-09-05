/**
 * ADR-0037: Block Intent and Controlled Progression (H5a).
 *
 * Defines domain models and fail-closed validators for explicit per-objective intent
 * (`develop` | `maintain`), dose envelopes, protected roles/substitutions, prospective
 * review criteria, and one bounded progression experiment.
 */

import type { PlanCoverageKey } from '../workouts/event-plan';
import type { ObjectivePriority } from './models';

export type BlockIntent = 'develop' | 'maintain';
export type BlockSport = 'cycling' | 'strength' | 'running' | 'swimming' | 'multisport' | 'cross_training';

export type DoseUnit =
    | 'minutes'
    | 'sessions'
    | 'repetitions'
    | 'kilometers'
    | 'tss'
    | 'joules'
    | 'rpe_load';

export const SUPPORTED_DOSE_UNITS: readonly DoseUnit[] = [
    'minutes',
    'sessions',
    'repetitions',
    'kilometers',
    'tss',
    'joules',
    'rpe_load',
] as const;

export const SUPPORTED_BLOCK_SPORTS: readonly BlockSport[] = [
    'cycling',
    'strength',
    'running',
    'swimming',
    'multisport',
    'cross_training',
] as const;

export const SUPPORTED_OBJECTIVE_PRIORITIES: readonly ObjectivePriority[] = [
    'must_have',
    'should_have',
    'nice_to_have',
] as const;

export const SUPPORTED_PLAN_COVERAGE_KEYS: readonly PlanCoverageKey[] = [
    'aerobic_volume',
    'recovery_spin',
    'sustained_quality',
    'short_surges',
    'gap_closing',
    'outdoor_event_specific',
    'primary_strength',
    'compact_strength',
    'upper_body_trunk',
    'field_maintenance',
    'walk_run',
    'recovery_or_rest',
    'travel_aerobic',
    'travel_strength',
    'taper_sharpening',
    'pre_race_openers',
    'race_week_strength',
    'race_day',
] as const;

export type FloorSemantics = 'hard_floor' | 'soft_floor';
export type TissueSeverity = 'monitor' | 'limit' | 'exclude';

export interface DoseEnvelope {
    min: number;
    target: number;
    max: number;
    unit: DoseUnit;
    floorSemantics: FloorSemantics;
}

export interface BlockSubstitutionRule {
    targetCoverageKey: PlanCoverageKey;
    allowedCoverageKeys: readonly PlanCoverageKey[];
    minDoseFraction?: number;
    /** Human-facing explanation only; never semantic replay identity. */
    rationale?: string;
}

export interface BlockSuccessCriteria {
    evaluationRef?: {
        id: string;
        revision: number;
        metricId: string;
    };
    minCompletedExposures?: number;
    targetTrend?: 'stable' | 'improving';
    acceptableDeclineTolerancePct?: number;
}

export interface BlockPrerequisites {
    requiredPriorExposures?: number;
    minBaselineDays?: number;
    prohibitedTissueSeverities?: readonly TissueSeverity[];
}

export interface BlockExitCriteria {
    maxWeeksInBlock?: number;
    stagnationReviewAfterWeeks?: number;
}

export interface BlockObjectiveDefinition {
    id: string;
    sport: BlockSport;
    adaptationScope: string;
    coverageKey: PlanCoverageKey;
    intent: BlockIntent;
    priority: ObjectivePriority;
    doseEnvelope: DoseEnvelope;
    knowledgeLineage?: readonly string[];
    protectedRoles?: readonly string[];
    allowedSubstitutions?: readonly BlockSubstitutionRule[];
    successCriteria?: BlockSuccessCriteria;
    entryPrerequisites?: BlockPrerequisites;
    exitCriteria?: BlockExitCriteria;
}

/**
 * Phase-1 progression deliberately supports only a registered duration variable. Additional
 * prescription variables must be added here with an explicit unit mapping and tests rather
 * than accepted as arbitrary executable/free-text field paths (ADR-0037 D-CHANGE).
 */
export type ProgressionVariable = 'duration_min';
export const PROGRESSION_VARIABLE_UNITS: Readonly<Record<ProgressionVariable, DoseUnit>> = {
    duration_min: 'minutes',
};

export type ProgressionReductionTrigger = 'adverse_response';
export type ProgressionRedirectTrigger = 'adverse_response' | 'active_restriction';

export interface BlockProgressionContract {
    targetBinding: {
        objectiveId: string;
        sessionId?: string;
        stepId?: string;
    };
    variable: ProgressionVariable;
    unit: DoseUnit;
    currentValue: number;
    permittedRange: {
        min: number;
        max: number;
    };
    increment: number;
    knowledgeLineage?: readonly string[];
    observationWindowDays: number;
    minCompletedExposures: number;
    requiredFollowUpCoveragePct: number;
    reviewCadenceDays: number;
    reductionAlternative?: {
        decrement: number;
        trigger: ProgressionReductionTrigger;
    };
    /** Explicit stop-and-review triggers. No hidden adverse-count threshold exists. */
    redirectCriteria?: {
        triggers: readonly ProgressionRedirectTrigger[];
    };
}

export interface IntentBlock {
    id: string;
    revision: number;
    sourcePlanId: string;
    sourcePlanRevision: number;
    dateRange: {
        startDate: string;
        endDate: string;
    };
    objectives: readonly BlockObjectiveDefinition[];
    reviewSchedule: {
        reviewCadenceDays: number;
        nextReviewDate: string;
    };
    progressionContract?: BlockProgressionContract;
    /** Presentation / descriptive labels only; excluded from canonical replay digest. */
    title?: string;
    notes?: string;
}

export interface ValidationIssue {
    code: string;
    message: string;
    path: string;
}

export interface IntentBlockValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function isValidLocalDateString(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month - 1
        && candidate.getUTCDate() === day;
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0;
}

function validateOptionalStringSet(values: readonly string[] | undefined, path: string): ValidationIssue[] {
    if (values === undefined) return [];
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (!isNonEmptyString(value)) {
            issues.push({
                code: 'INVALID_STRING_SET_MEMBER',
                message: 'Set members must be non-empty strings',
                path: `${path}[${index}]`,
            });
            return;
        }
        if (seen.has(value)) {
            issues.push({
                code: 'DUPLICATE_STRING_SET_MEMBER',
                message: `Duplicate value: ${value}`,
                path: `${path}[${index}]`,
            });
        }
        seen.add(value);
    });
    return issues;
}

export function isSupportedDoseUnit(unit: string): unit is DoseUnit {
    return (SUPPORTED_DOSE_UNITS as readonly string[]).includes(unit);
}

function isSupportedCoverageKey(key: string): key is PlanCoverageKey {
    return (SUPPORTED_PLAN_COVERAGE_KEYS as readonly string[]).includes(key);
}

export function validateDoseEnvelope(envelope: DoseEnvelope, path: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!isSupportedDoseUnit(envelope.unit)) {
        issues.push({
            code: 'UNSUPPORTED_DOSE_UNIT',
            message: `Unsupported dose unit: ${envelope.unit}`,
            path: `${path}.unit`,
        });
    }

    if (!Number.isFinite(envelope.min) || envelope.min < 0) {
        issues.push({
            code: 'INVALID_DOSE_MIN',
            message: `Dose min must be a finite non-negative number: ${envelope.min}`,
            path: `${path}.min`,
        });
    }
    if (!Number.isFinite(envelope.target) || envelope.target < 0) {
        issues.push({
            code: 'INVALID_DOSE_TARGET',
            message: `Dose target must be a finite non-negative number: ${envelope.target}`,
            path: `${path}.target`,
        });
    }
    if (!Number.isFinite(envelope.max) || envelope.max < 0) {
        issues.push({
            code: 'INVALID_DOSE_MAX',
            message: `Dose max must be a finite non-negative number: ${envelope.max}`,
            path: `${path}.max`,
        });
    }
    if (Number.isFinite(envelope.min) && Number.isFinite(envelope.target) && envelope.min > envelope.target) {
        issues.push({
            code: 'INVERTED_DOSE_BOUNDS_MIN_TARGET',
            message: `Dose min (${envelope.min}) cannot exceed target (${envelope.target})`,
            path: `${path}.min`,
        });
    }
    if (Number.isFinite(envelope.target) && Number.isFinite(envelope.max) && envelope.target > envelope.max) {
        issues.push({
            code: 'INVERTED_DOSE_BOUNDS_TARGET_MAX',
            message: `Dose target (${envelope.target}) cannot exceed max (${envelope.max})`,
            path: `${path}.max`,
        });
    }
    if (envelope.floorSemantics !== 'hard_floor' && envelope.floorSemantics !== 'soft_floor') {
        issues.push({
            code: 'INVALID_FLOOR_SEMANTICS',
            message: `Invalid floor semantics: ${envelope.floorSemantics}`,
            path: `${path}.floorSemantics`,
        });
    }

    return issues;
}

function validateSuccessCriteria(
    criteria: BlockSuccessCriteria | undefined,
    intent: BlockIntent,
    path: string,
): ValidationIssue[] {
    if (!criteria) return [];
    const issues: ValidationIssue[] = [];
    if (criteria.evaluationRef) {
        if (!isNonEmptyString(criteria.evaluationRef.id)) {
            issues.push({ code: 'INVALID_EVALUATION_REF_ID', message: 'Evaluation id must be non-empty', path: `${path}.evaluationRef.id` });
        }
        if (!isPositiveInteger(criteria.evaluationRef.revision)) {
            issues.push({ code: 'INVALID_EVALUATION_REF_REVISION', message: 'Evaluation revision must be a positive integer', path: `${path}.evaluationRef.revision` });
        }
        if (!isNonEmptyString(criteria.evaluationRef.metricId)) {
            issues.push({ code: 'INVALID_EVALUATION_METRIC_ID', message: 'Evaluation metricId must be non-empty', path: `${path}.evaluationRef.metricId` });
        }
    }
    if (criteria.minCompletedExposures !== undefined && !isPositiveInteger(criteria.minCompletedExposures)) {
        issues.push({
            code: 'INVALID_SUCCESS_MIN_EXPOSURES',
            message: 'Success minCompletedExposures must be a positive integer',
            path: `${path}.minCompletedExposures`,
        });
    }
    if (criteria.targetTrend !== undefined && criteria.targetTrend !== 'stable' && criteria.targetTrend !== 'improving') {
        issues.push({ code: 'INVALID_TARGET_TREND', message: `Unsupported target trend: ${criteria.targetTrend}`, path: `${path}.targetTrend` });
    }
    if (criteria.acceptableDeclineTolerancePct !== undefined && (
        !Number.isFinite(criteria.acceptableDeclineTolerancePct)
        || criteria.acceptableDeclineTolerancePct < 0
        || criteria.acceptableDeclineTolerancePct > 100
    )) {
        issues.push({
            code: 'INVALID_DECLINE_TOLERANCE',
            message: 'acceptableDeclineTolerancePct must be finite and between 0 and 100',
            path: `${path}.acceptableDeclineTolerancePct`,
        });
    }
    if ((criteria.targetTrend !== undefined || criteria.acceptableDeclineTolerancePct !== undefined) && !criteria.evaluationRef) {
        issues.push({
            code: 'OUTCOME_CRITERIA_REQUIRE_EVALUATION_REF',
            message: 'Outcome trend/tolerance criteria require a pinned evaluationRef',
            path,
        });
    }
    if (intent === 'develop' && criteria.evaluationRef && criteria.targetTrend === undefined) {
        issues.push({
            code: 'DEVELOPMENT_OUTCOME_REQUIRES_TARGET_TREND',
            message: 'A measured development objective must declare its prospective targetTrend',
            path: `${path}.targetTrend`,
        });
    }
    if (intent === 'maintain' && criteria.evaluationRef && criteria.acceptableDeclineTolerancePct === undefined) {
        issues.push({
            code: 'MAINTENANCE_OUTCOME_REQUIRES_TOLERANCE',
            message: 'A measured maintenance objective must declare an acceptable decline tolerance',
            path: `${path}.acceptableDeclineTolerancePct`,
        });
    }
    return issues;
}

function validatePrerequisites(prerequisites: BlockPrerequisites | undefined, path: string): ValidationIssue[] {
    if (!prerequisites) return [];
    const issues: ValidationIssue[] = [];
    if (prerequisites.requiredPriorExposures !== undefined && !isNonNegativeInteger(prerequisites.requiredPriorExposures)) {
        issues.push({ code: 'INVALID_REQUIRED_PRIOR_EXPOSURES', message: 'requiredPriorExposures must be a non-negative integer', path: `${path}.requiredPriorExposures` });
    }
    if (prerequisites.minBaselineDays !== undefined && !isNonNegativeInteger(prerequisites.minBaselineDays)) {
        issues.push({ code: 'INVALID_MIN_BASELINE_DAYS', message: 'minBaselineDays must be a non-negative integer', path: `${path}.minBaselineDays` });
    }
    if (prerequisites.prohibitedTissueSeverities) {
        const seen = new Set<TissueSeverity>();
        prerequisites.prohibitedTissueSeverities.forEach((severity, index) => {
            if (severity !== 'monitor' && severity !== 'limit' && severity !== 'exclude') {
                issues.push({ code: 'INVALID_PROHIBITED_TISSUE_SEVERITY', message: `Unsupported tissue severity: ${severity}`, path: `${path}.prohibitedTissueSeverities[${index}]` });
            } else if (seen.has(severity)) {
                issues.push({ code: 'DUPLICATE_PROHIBITED_TISSUE_SEVERITY', message: `Duplicate tissue severity: ${severity}`, path: `${path}.prohibitedTissueSeverities[${index}]` });
            }
            seen.add(severity);
        });
    }
    return issues;
}

function validateExitCriteria(criteria: BlockExitCriteria | undefined, path: string): ValidationIssue[] {
    if (!criteria) return [];
    const issues: ValidationIssue[] = [];
    if (criteria.maxWeeksInBlock !== undefined && !isPositiveInteger(criteria.maxWeeksInBlock)) {
        issues.push({ code: 'INVALID_MAX_WEEKS_IN_BLOCK', message: 'maxWeeksInBlock must be a positive integer', path: `${path}.maxWeeksInBlock` });
    }
    if (criteria.stagnationReviewAfterWeeks !== undefined && !isPositiveInteger(criteria.stagnationReviewAfterWeeks)) {
        issues.push({ code: 'INVALID_STAGNATION_REVIEW_WEEKS', message: 'stagnationReviewAfterWeeks must be a positive integer', path: `${path}.stagnationReviewAfterWeeks` });
    }
    if (
        criteria.maxWeeksInBlock !== undefined
        && criteria.stagnationReviewAfterWeeks !== undefined
        && criteria.stagnationReviewAfterWeeks > criteria.maxWeeksInBlock
    ) {
        issues.push({
            code: 'STAGNATION_REVIEW_AFTER_BLOCK_EXIT',
            message: 'stagnationReviewAfterWeeks cannot exceed maxWeeksInBlock',
            path: `${path}.stagnationReviewAfterWeeks`,
        });
    }
    return issues;
}

function validateSubstitutions(
    objective: BlockObjectiveDefinition,
    path: string,
): ValidationIssue[] {
    if (!objective.allowedSubstitutions) return [];
    const issues: ValidationIssue[] = [];
    const targets = new Set<PlanCoverageKey>();
    objective.allowedSubstitutions.forEach((rule, index) => {
        const rulePath = `${path}[${index}]`;
        if (!isSupportedCoverageKey(rule.targetCoverageKey)) {
            issues.push({ code: 'INVALID_SUBSTITUTION_TARGET', message: `Unsupported target coverage key: ${rule.targetCoverageKey}`, path: `${rulePath}.targetCoverageKey` });
        } else {
            if (rule.targetCoverageKey !== objective.coverageKey) {
                issues.push({
                    code: 'SUBSTITUTION_TARGET_MISMATCH',
                    message: `Substitution target ${rule.targetCoverageKey} does not match objective coverage ${objective.coverageKey}`,
                    path: `${rulePath}.targetCoverageKey`,
                });
            }
            if (targets.has(rule.targetCoverageKey)) {
                issues.push({ code: 'DUPLICATE_SUBSTITUTION_TARGET', message: `Duplicate substitution rule for ${rule.targetCoverageKey}`, path: `${rulePath}.targetCoverageKey` });
            }
            targets.add(rule.targetCoverageKey);
        }
        if (!Array.isArray(rule.allowedCoverageKeys) || rule.allowedCoverageKeys.length === 0) {
            issues.push({ code: 'EMPTY_SUBSTITUTION_CANDIDATES', message: 'allowedCoverageKeys must contain at least one typed coverage key', path: `${rulePath}.allowedCoverageKeys` });
        } else {
            const allowed = new Set<PlanCoverageKey>();
            rule.allowedCoverageKeys.forEach((key, allowedIndex) => {
                if (!isSupportedCoverageKey(key)) {
                    issues.push({ code: 'INVALID_SUBSTITUTION_CANDIDATE', message: `Unsupported coverage key: ${key}`, path: `${rulePath}.allowedCoverageKeys[${allowedIndex}]` });
                } else if (allowed.has(key)) {
                    issues.push({ code: 'DUPLICATE_SUBSTITUTION_CANDIDATE', message: `Duplicate allowed coverage key: ${key}`, path: `${rulePath}.allowedCoverageKeys[${allowedIndex}]` });
                }
                allowed.add(key);
            });
        }
        if (rule.minDoseFraction !== undefined && (
            !Number.isFinite(rule.minDoseFraction)
            || rule.minDoseFraction <= 0
            || rule.minDoseFraction > 1
        )) {
            issues.push({
                code: 'INVALID_SUBSTITUTION_MIN_DOSE_FRACTION',
                message: 'minDoseFraction must be finite and in (0, 1]',
                path: `${rulePath}.minDoseFraction`,
            });
        }
    });
    return issues;
}

export function validateProgressionContract(
    contract: BlockProgressionContract,
    objectivesById: ReadonlyMap<string, BlockObjectiveDefinition>,
    path: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const binding = contract.targetBinding;
    const objectiveId = binding?.objectiveId;
    const targetObjective = objectiveId ? objectivesById.get(objectiveId) : undefined;

    if (!binding || !isNonEmptyString(objectiveId)) {
        issues.push({ code: 'MISSING_TARGET_OBJECTIVE_ID', message: 'Progression contract must bind to an objectiveId', path: `${path}.targetBinding.objectiveId` });
    } else if (!targetObjective) {
        issues.push({ code: 'DANGLING_PROGRESSION_TARGET_OBJECTIVE', message: `Progression target objectiveId ${objectiveId} is not in block objectives`, path: `${path}.targetBinding.objectiveId` });
    }
    if (binding?.sessionId !== undefined && !isNonEmptyString(binding.sessionId)) {
        issues.push({ code: 'INVALID_TARGET_SESSION_ID', message: 'targetBinding.sessionId must be non-empty when present', path: `${path}.targetBinding.sessionId` });
    }
    if (binding?.stepId !== undefined && !isNonEmptyString(binding.stepId)) {
        issues.push({ code: 'INVALID_TARGET_STEP_ID', message: 'targetBinding.stepId must be non-empty when present', path: `${path}.targetBinding.stepId` });
    }
    if (binding?.stepId !== undefined && binding.sessionId === undefined) {
        issues.push({ code: 'STEP_BINDING_REQUIRES_SESSION', message: 'targetBinding.stepId requires targetBinding.sessionId', path: `${path}.targetBinding.stepId` });
    }

    const expectedUnit = PROGRESSION_VARIABLE_UNITS[contract.variable];
    if (!expectedUnit) {
        issues.push({
            code: 'UNSUPPORTED_PROGRESSION_VARIABLE',
            message: `Unsupported progression variable: ${String(contract.variable)}`,
            path: `${path}.variable`,
        });
    } else if (contract.unit !== expectedUnit) {
        issues.push({
            code: 'PROGRESSION_VARIABLE_UNIT_MISMATCH',
            message: `Progression variable ${contract.variable} requires unit ${expectedUnit}, got ${contract.unit}`,
            path: `${path}.unit`,
        });
    }

    if (!Number.isFinite(contract.currentValue) || contract.currentValue < 0) {
        issues.push({ code: 'INVALID_CURRENT_VALUE', message: `Current value must be finite and non-negative: ${contract.currentValue}`, path: `${path}.currentValue` });
    }
    if (!Number.isFinite(contract.increment) || contract.increment <= 0) {
        issues.push({ code: 'INVALID_PROGRESSION_INCREMENT', message: `Progression increment must be a positive finite number: ${contract.increment}`, path: `${path}.increment` });
    }

    const range = contract.permittedRange;
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min < 0 || range.max < 0) {
        issues.push({ code: 'INVALID_PERMITTED_RANGE', message: 'Permitted range min/max must be finite non-negative numbers', path: `${path}.permittedRange` });
    } else {
        if (range.min >= range.max) {
            issues.push({ code: 'INVERTED_PERMITTED_RANGE', message: `Permitted range min (${range.min}) must be less than max (${range.max})`, path: `${path}.permittedRange` });
        }
        if (Number.isFinite(contract.currentValue) && (contract.currentValue < range.min || contract.currentValue > range.max)) {
            issues.push({ code: 'CURRENT_VALUE_OUT_OF_RANGE', message: `Current value (${contract.currentValue}) is outside permitted range [${range.min}, ${range.max}]`, path: `${path}.currentValue` });
        }
        if (targetObjective && contract.unit === targetObjective.doseEnvelope.unit && (
            range.min < targetObjective.doseEnvelope.min
            || range.max > targetObjective.doseEnvelope.max
        )) {
            issues.push({
                code: 'PROGRESSION_RANGE_EXCEEDS_OBJECTIVE_ENVELOPE',
                message: `Progression range [${range.min}, ${range.max}] must stay within objective envelope [${targetObjective.doseEnvelope.min}, ${targetObjective.doseEnvelope.max}]`,
                path: `${path}.permittedRange`,
            });
        }
    }

    if (!isPositiveInteger(contract.observationWindowDays)) {
        issues.push({ code: 'INVALID_OBSERVATION_WINDOW', message: `Observation window must be a positive integer days: ${contract.observationWindowDays}`, path: `${path}.observationWindowDays` });
    }
    if (!isPositiveInteger(contract.minCompletedExposures)) {
        issues.push({ code: 'INVALID_MIN_COMPLETED_EXPOSURES', message: `Min completed exposures must be a positive integer: ${contract.minCompletedExposures}`, path: `${path}.minCompletedExposures` });
    }
    if (!Number.isFinite(contract.requiredFollowUpCoveragePct) || contract.requiredFollowUpCoveragePct <= 0 || contract.requiredFollowUpCoveragePct > 100) {
        issues.push({ code: 'INVALID_FOLLOW_UP_COVERAGE_PCT', message: `Required follow-up coverage percent must be in (0, 100]: ${contract.requiredFollowUpCoveragePct}`, path: `${path}.requiredFollowUpCoveragePct` });
    }
    if (!isPositiveInteger(contract.reviewCadenceDays)) {
        issues.push({ code: 'INVALID_REVIEW_CADENCE', message: `Review cadence days must be a positive integer: ${contract.reviewCadenceDays}`, path: `${path}.reviewCadenceDays` });
    }

    issues.push(...validateOptionalStringSet(contract.knowledgeLineage, `${path}.knowledgeLineage`));

    if (contract.reductionAlternative) {
        if (contract.reductionAlternative.trigger !== 'adverse_response') {
            issues.push({ code: 'UNSUPPORTED_REDUCTION_TRIGGER', message: `Unsupported reduction trigger: ${contract.reductionAlternative.trigger}`, path: `${path}.reductionAlternative.trigger` });
        }
        if (!Number.isFinite(contract.reductionAlternative.decrement) || contract.reductionAlternative.decrement <= 0) {
            issues.push({ code: 'INVALID_REDUCTION_DECREMENT', message: `Reduction decrement must be a positive finite number: ${contract.reductionAlternative.decrement}`, path: `${path}.reductionAlternative.decrement` });
        } else if (range && Number.isFinite(range.min) && Number.isFinite(contract.currentValue)
            && contract.currentValue - contract.reductionAlternative.decrement < range.min) {
            issues.push({
                code: 'REDUCTION_DECREMENT_EXCEEDS_RANGE',
                message: 'Reduction alternative must produce a value inside the permitted range without hidden clamping',
                path: `${path}.reductionAlternative.decrement`,
            });
        }
    }

    if (contract.redirectCriteria) {
        if (!Array.isArray(contract.redirectCriteria.triggers) || contract.redirectCriteria.triggers.length === 0) {
            issues.push({ code: 'EMPTY_REDIRECT_TRIGGERS', message: 'redirectCriteria.triggers must not be empty', path: `${path}.redirectCriteria.triggers` });
        } else {
            const seen = new Set<ProgressionRedirectTrigger>();
            contract.redirectCriteria.triggers.forEach((trigger, index) => {
                if (trigger !== 'adverse_response' && trigger !== 'active_restriction') {
                    issues.push({ code: 'UNSUPPORTED_REDIRECT_TRIGGER', message: `Unsupported redirect trigger: ${trigger}`, path: `${path}.redirectCriteria.triggers[${index}]` });
                } else if (seen.has(trigger)) {
                    issues.push({ code: 'DUPLICATE_REDIRECT_TRIGGER', message: `Duplicate redirect trigger: ${trigger}`, path: `${path}.redirectCriteria.triggers[${index}]` });
                }
                seen.add(trigger);
            });
        }
    }

    if (
        contract.reductionAlternative?.trigger === 'adverse_response'
        && contract.redirectCriteria?.triggers.includes('adverse_response')
    ) {
        issues.push({
            code: 'AMBIGUOUS_ADVERSE_RESPONSE_ACTION',
            message: 'The same adverse_response trigger cannot request both reduction and redirect',
            path,
        });
    }

    return issues;
}

function validateObjective(objective: BlockObjectiveDefinition, path: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!isNonEmptyString(objective.id)) {
        issues.push({ code: 'MISSING_OBJECTIVE_ID', message: 'Objective ID must be a non-empty string', path: `${path}.id` });
    }
    if (!(SUPPORTED_BLOCK_SPORTS as readonly string[]).includes(objective.sport)) {
        issues.push({ code: 'INVALID_OBJECTIVE_SPORT', message: `Unsupported objective sport: ${objective.sport}`, path: `${path}.sport` });
    }
    if (!isNonEmptyString(objective.adaptationScope)) {
        issues.push({ code: 'INVALID_ADAPTATION_SCOPE', message: 'adaptationScope must be a non-empty string', path: `${path}.adaptationScope` });
    }
    if (!isSupportedCoverageKey(objective.coverageKey)) {
        issues.push({ code: 'INVALID_OBJECTIVE_COVERAGE_KEY', message: `Unsupported coverage key: ${objective.coverageKey}`, path: `${path}.coverageKey` });
    }
    if (objective.intent !== 'develop' && objective.intent !== 'maintain') {
        issues.push({ code: 'INVALID_OBJECTIVE_INTENT', message: `Objective intent must be 'develop' or 'maintain', got: ${objective.intent}`, path: `${path}.intent` });
    }
    if (!(SUPPORTED_OBJECTIVE_PRIORITIES as readonly string[]).includes(objective.priority)) {
        issues.push({ code: 'INVALID_OBJECTIVE_PRIORITY', message: `Unsupported objective priority: ${objective.priority}`, path: `${path}.priority` });
    }
    if (objective.doseEnvelope) {
        issues.push(...validateDoseEnvelope(objective.doseEnvelope, `${path}.doseEnvelope`));
    } else {
        issues.push({ code: 'MISSING_DOSE_ENVELOPE', message: 'Objective must specify a doseEnvelope', path: `${path}.doseEnvelope` });
    }
    issues.push(...validateOptionalStringSet(objective.knowledgeLineage, `${path}.knowledgeLineage`));
    issues.push(...validateOptionalStringSet(objective.protectedRoles, `${path}.protectedRoles`));
    issues.push(...validateSubstitutions(objective, `${path}.allowedSubstitutions`));
    issues.push(...validateSuccessCriteria(objective.successCriteria, objective.intent, `${path}.successCriteria`));
    issues.push(...validatePrerequisites(objective.entryPrerequisites, `${path}.entryPrerequisites`));
    issues.push(...validateExitCriteria(objective.exitCriteria, `${path}.exitCriteria`));
    return issues;
}

export function validateIntentBlock(block: IntentBlock): IntentBlockValidationResult {
    const issues: ValidationIssue[] = [];
    const rootPath = `intentBlock[${block.id || 'unknown'}]`;

    if (!isNonEmptyString(block.id)) {
        issues.push({ code: 'MISSING_BLOCK_ID', message: 'Block ID must be a non-empty string', path: `${rootPath}.id` });
    }
    if (!isPositiveInteger(block.revision)) {
        issues.push({ code: 'INVALID_BLOCK_REVISION', message: `Block revision must be a positive integer: ${block.revision}`, path: `${rootPath}.revision` });
    }
    if (!isNonEmptyString(block.sourcePlanId)) {
        issues.push({ code: 'MISSING_SOURCE_PLAN_ID', message: 'sourcePlanId must be a non-empty string', path: `${rootPath}.sourcePlanId` });
    }
    if (!isPositiveInteger(block.sourcePlanRevision)) {
        issues.push({ code: 'INVALID_SOURCE_PLAN_REVISION', message: `sourcePlanRevision must be a positive integer: ${block.sourcePlanRevision}`, path: `${rootPath}.sourcePlanRevision` });
    }

    const startValid = isValidLocalDateString(block.dateRange?.startDate);
    const endValid = isValidLocalDateString(block.dateRange?.endDate);
    if (!startValid || !endValid) {
        issues.push({ code: 'INVALID_DATE_RANGE', message: 'Block dateRange must contain valid YYYY-MM-DD calendar dates', path: `${rootPath}.dateRange` });
    } else if (block.dateRange.startDate > block.dateRange.endDate) {
        issues.push({ code: 'INVERTED_DATE_RANGE', message: `Block startDate (${block.dateRange.startDate}) cannot be after endDate (${block.dateRange.endDate})`, path: `${rootPath}.dateRange` });
    }

    if (!block.reviewSchedule || !isPositiveInteger(block.reviewSchedule.reviewCadenceDays)) {
        issues.push({ code: 'INVALID_BLOCK_REVIEW_CADENCE', message: 'Block reviewSchedule.reviewCadenceDays must be a positive integer', path: `${rootPath}.reviewSchedule.reviewCadenceDays` });
    }
    if (!block.reviewSchedule || !isValidLocalDateString(block.reviewSchedule.nextReviewDate)) {
        issues.push({ code: 'INVALID_NEXT_REVIEW_DATE', message: 'Block reviewSchedule.nextReviewDate must be a valid YYYY-MM-DD date', path: `${rootPath}.reviewSchedule.nextReviewDate` });
    } else if (startValid && endValid && (
        block.reviewSchedule.nextReviewDate < block.dateRange.startDate
        || block.reviewSchedule.nextReviewDate > block.dateRange.endDate
    )) {
        issues.push({
            code: 'NEXT_REVIEW_OUTSIDE_BLOCK',
            message: 'nextReviewDate must fall inside the active block interval',
            path: `${rootPath}.reviewSchedule.nextReviewDate`,
        });
    }

    const objectivesById = new Map<string, BlockObjectiveDefinition>();
    if (!Array.isArray(block.objectives) || block.objectives.length === 0) {
        issues.push({ code: 'NO_OBJECTIVES', message: 'Block must contain at least one objective', path: `${rootPath}.objectives` });
    } else {
        block.objectives.forEach((objective, index) => {
            const objectivePath = `${rootPath}.objectives[${index}]`;
            issues.push(...validateObjective(objective, objectivePath));
            if (isNonEmptyString(objective.id)) {
                if (objectivesById.has(objective.id)) {
                    issues.push({ code: 'DUPLICATE_OBJECTIVE_ID', message: `Duplicate objective ID: ${objective.id}`, path: `${objectivePath}.id` });
                } else {
                    objectivesById.set(objective.id, objective);
                }
            }
        });
    }

    if (block.progressionContract) {
        issues.push(...validateProgressionContract(block.progressionContract, objectivesById, `${rootPath}.progressionContract`));
        if (
            block.reviewSchedule
            && isPositiveInteger(block.reviewSchedule.reviewCadenceDays)
            && isPositiveInteger(block.progressionContract.reviewCadenceDays)
            && block.reviewSchedule.reviewCadenceDays !== block.progressionContract.reviewCadenceDays
        ) {
            issues.push({
                code: 'PROGRESSION_REVIEW_CADENCE_MISMATCH',
                message: 'Block review cadence and progression contract cadence must agree',
                path: `${rootPath}.progressionContract.reviewCadenceDays`,
            });
        }
    }

    return { valid: issues.length === 0, issues };
}

export function validatePlanIntentBlocks(blocks: readonly IntentBlock[]): IntentBlockValidationResult {
    const issues: ValidationIssue[] = [];
    const blockIdsByPlan = new Map<string, Set<string>>();
    const validIntervalsByPlan = new Map<string, IntentBlock[]>();

    blocks.forEach((block, index) => {
        const singleResult = validateIntentBlock(block);
        issues.push(...singleResult.issues);

        if (isNonEmptyString(block.sourcePlanId) && isNonEmptyString(block.id)) {
            const ids = blockIdsByPlan.get(block.sourcePlanId) ?? new Set<string>();
            if (ids.has(block.id)) {
                issues.push({
                    code: 'DUPLICATE_BLOCK_ID',
                    message: `Duplicate block ID across plan ${block.sourcePlanId}: ${block.id}`,
                    path: `blocks[${index}].id`,
                });
            }
            ids.add(block.id);
            blockIdsByPlan.set(block.sourcePlanId, ids);
        }

        if (
            isNonEmptyString(block.sourcePlanId)
            && isValidLocalDateString(block.dateRange?.startDate)
            && isValidLocalDateString(block.dateRange?.endDate)
            && block.dateRange.startDate <= block.dateRange.endDate
        ) {
            const intervals = validIntervalsByPlan.get(block.sourcePlanId) ?? [];
            intervals.push(block);
            validIntervalsByPlan.set(block.sourcePlanId, intervals);
        }
    });

    for (const [planId, planBlocks] of validIntervalsByPlan) {
        const sorted = [...planBlocks].sort((a, b) => a.dateRange.startDate.localeCompare(b.dateRange.startDate));
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].dateRange.endDate >= sorted[i + 1].dateRange.startDate) {
                issues.push({
                    code: 'OVERLAPPING_INTENT_BLOCKS',
                    message: `Intent blocks ${sorted[i].id} and ${sorted[i + 1].id} overlap in plan ${planId}: ${sorted[i].dateRange.endDate} >= ${sorted[i + 1].dateRange.startDate}`,
                    path: `blocks[${sorted[i].id}]`,
                });
            }
        }
    }

    return { valid: issues.length === 0, issues };
}
