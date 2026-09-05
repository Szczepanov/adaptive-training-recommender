/**
 * ADR-0037: Block Intent and Controlled Progression (H5a).
 *
 * Defines domain models and validators for explicit per-objective intent
 * (`develop` | `maintain`), dose envelopes, protected roles, substitution rules,
 * and bounded progression contracts.
 */

import type { PlanCoverageKey } from '../workouts/event-plan';
import type { ObjectivePriority } from './models';

export type BlockIntent = 'develop' | 'maintain';

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

export type FloorSemantics = 'hard_floor' | 'soft_floor';

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
    prohibitedTissueSeverities?: readonly ('monitor' | 'limit' | 'exclude')[];
}

export interface BlockExitCriteria {
    maxWeeksInBlock?: number;
    stagnationReviewAfterWeeks?: number;
}

export interface BlockObjectiveDefinition {
    id: string;
    sport: 'cycling' | 'strength' | 'running' | 'swimming' | 'multisport' | 'cross_training';
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

export interface BlockProgressionContract {
    targetBinding: {
        objectiveId: string;
        sessionId?: string;
        stepId?: string;
    };
    variable: string;
    unit: string;
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
        trigger: 'adverse_response' | 'stagnation';
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
    /** Presentation / descriptive labels only; excluded from canonical replay digest */
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

export function isSupportedDoseUnit(unit: string): unit is DoseUnit {
    return (SUPPORTED_DOSE_UNITS as readonly string[]).includes(unit);
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

    if (envelope.min > envelope.target) {
        issues.push({
            code: 'INVERTED_DOSE_BOUNDS_MIN_TARGET',
            message: `Dose min (${envelope.min}) cannot exceed target (${envelope.target})`,
            path: `${path}.min`,
        });
    }

    if (envelope.target > envelope.max) {
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

export function validateProgressionContract(
    contract: BlockProgressionContract,
    validObjectiveIds: Set<string>,
    path: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!contract.targetBinding || !contract.targetBinding.objectiveId) {
        issues.push({
            code: 'MISSING_TARGET_OBJECTIVE_ID',
            message: 'Progression contract must bind to an objectiveId',
            path: `${path}.targetBinding.objectiveId`,
        });
    } else if (!validObjectiveIds.has(contract.targetBinding.objectiveId)) {
        issues.push({
            code: 'DANGLING_PROGRESSION_TARGET_OBJECTIVE',
            message: `Progression target objectiveId ${contract.targetBinding.objectiveId} is not in block objectives`,
            path: `${path}.targetBinding.objectiveId`,
        });
    }

    if (!contract.variable || typeof contract.variable !== 'string' || contract.variable.trim() === '') {
        issues.push({
            code: 'INVALID_PROGRESSION_VARIABLE',
            message: 'Progression variable must be a non-empty string',
            path: `${path}.variable`,
        });
    }

    if (!contract.unit || typeof contract.unit !== 'string' || contract.unit.trim() === '') {
        issues.push({
            code: 'INVALID_PROGRESSION_UNIT',
            message: 'Progression unit must be a non-empty string',
            path: `${path}.unit`,
        });
    }

    if (!Number.isFinite(contract.increment) || contract.increment <= 0) {
        issues.push({
            code: 'INVALID_PROGRESSION_INCREMENT',
            message: `Progression increment must be a positive finite number: ${contract.increment}`,
            path: `${path}.increment`,
        });
    }

    if (!contract.permittedRange || !Number.isFinite(contract.permittedRange.min) || !Number.isFinite(contract.permittedRange.max)) {
        issues.push({
            code: 'INVALID_PERMITTED_RANGE',
            message: 'Permitted range min and max must be finite numbers',
            path: `${path}.permittedRange`,
        });
    } else {
        if (contract.permittedRange.min >= contract.permittedRange.max) {
            issues.push({
                code: 'INVERTED_PERMITTED_RANGE',
                message: `Permitted range min (${contract.permittedRange.min}) must be less than max (${contract.permittedRange.max})`,
                path: `${path}.permittedRange`,
            });
        }
        if (contract.currentValue < contract.permittedRange.min || contract.currentValue > contract.permittedRange.max) {
            issues.push({
                code: 'CURRENT_VALUE_OUT_OF_RANGE',
                message: `Current value (${contract.currentValue}) is outside permitted range [${contract.permittedRange.min}, ${contract.permittedRange.max}]`,
                path: `${path}.currentValue`,
            });
        }
    }

    if (!Number.isFinite(contract.observationWindowDays) || contract.observationWindowDays <= 0) {
        issues.push({
            code: 'INVALID_OBSERVATION_WINDOW',
            message: `Observation window must be a positive integer days: ${contract.observationWindowDays}`,
            path: `${path}.observationWindowDays`,
        });
    }

    if (!Number.isFinite(contract.minCompletedExposures) || contract.minCompletedExposures < 1) {
        issues.push({
            code: 'INVALID_MIN_COMPLETED_EXPOSURES',
            message: `Min completed exposures must be at least 1: ${contract.minCompletedExposures}`,
            path: `${path}.minCompletedExposures`,
        });
    }

    if (
        !Number.isFinite(contract.requiredFollowUpCoveragePct) ||
        contract.requiredFollowUpCoveragePct < 0 ||
        contract.requiredFollowUpCoveragePct > 100
    ) {
        issues.push({
            code: 'INVALID_FOLLOW_UP_COVERAGE_PCT',
            message: `Required follow-up coverage percent must be between 0 and 100: ${contract.requiredFollowUpCoveragePct}`,
            path: `${path}.requiredFollowUpCoveragePct`,
        });
    }

    if (!Number.isFinite(contract.reviewCadenceDays) || contract.reviewCadenceDays <= 0) {
        issues.push({
            code: 'INVALID_REVIEW_CADENCE',
            message: `Review cadence days must be a positive integer: ${contract.reviewCadenceDays}`,
            path: `${path}.reviewCadenceDays`,
        });
    }

    if (contract.reductionAlternative) {
        if (!Number.isFinite(contract.reductionAlternative.decrement) || contract.reductionAlternative.decrement <= 0) {
            issues.push({
                code: 'INVALID_REDUCTION_DECREMENT',
                message: `Reduction decrement must be a positive finite number: ${contract.reductionAlternative.decrement}`,
                path: `${path}.reductionAlternative.decrement`,
            });
        }
    }

    return issues;
}

export function validateIntentBlock(block: IntentBlock): IntentBlockValidationResult {
    const issues: ValidationIssue[] = [];
    const rootPath = `intentBlock[${block.id || 'unknown'}]`;

    if (!block.id || typeof block.id !== 'string' || block.id.trim() === '') {
        issues.push({
            code: 'MISSING_BLOCK_ID',
            message: 'Block ID must be a non-empty string',
            path: `${rootPath}.id`,
        });
    }

    if (!Number.isInteger(block.revision) || block.revision < 1) {
        issues.push({
            code: 'INVALID_BLOCK_REVISION',
            message: `Block revision must be a positive integer: ${block.revision}`,
            path: `${rootPath}.revision`,
        });
    }

    if (!block.dateRange || !block.dateRange.startDate || !block.dateRange.endDate) {
        issues.push({
            code: 'MISSING_DATE_RANGE',
            message: 'Block date range must specify startDate and endDate',
            path: `${rootPath}.dateRange`,
        });
    } else if (block.dateRange.startDate > block.dateRange.endDate) {
        issues.push({
            code: 'INVERTED_DATE_RANGE',
            message: `Block startDate (${block.dateRange.startDate}) cannot be after endDate (${block.dateRange.endDate})`,
            path: `${rootPath}.dateRange`,
        });
    }

    if (!Array.isArray(block.objectives) || block.objectives.length === 0) {
        issues.push({
            code: 'NO_OBJECTIVES',
            message: 'Block must contain at least one objective',
            path: `${rootPath}.objectives`,
        });
    } else {
        const objectiveIds = new Set<string>();
        for (let i = 0; i < block.objectives.length; i++) {
            const obj = block.objectives[i];
            const objPath = `${rootPath}.objectives[${i}]`;

            if (!obj.id || typeof obj.id !== 'string' || obj.id.trim() === '') {
                issues.push({
                    code: 'MISSING_OBJECTIVE_ID',
                    message: 'Objective ID must be a non-empty string',
                    path: `${objPath}.id`,
                });
            } else if (objectiveIds.has(obj.id)) {
                issues.push({
                    code: 'DUPLICATE_OBJECTIVE_ID',
                    message: `Duplicate objective ID: ${obj.id}`,
                    path: `${objPath}.id`,
                });
            } else {
                objectiveIds.add(obj.id);
            }

            if (obj.intent !== 'develop' && obj.intent !== 'maintain') {
                issues.push({
                    code: 'INVALID_OBJECTIVE_INTENT',
                    message: `Objective intent must be 'develop' or 'maintain', got: ${obj.intent}`,
                    path: `${objPath}.intent`,
                });
            }

            if (obj.doseEnvelope) {
                issues.push(...validateDoseEnvelope(obj.doseEnvelope, `${objPath}.doseEnvelope`));
            } else {
                issues.push({
                    code: 'MISSING_DOSE_ENVELOPE',
                    message: 'Objective must specify a doseEnvelope',
                    path: `${objPath}.doseEnvelope`,
                });
            }
        }

        if (block.progressionContract) {
            issues.push(...validateProgressionContract(block.progressionContract, objectiveIds, `${rootPath}.progressionContract`));
        }
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

export function validatePlanIntentBlocks(blocks: readonly IntentBlock[]): IntentBlockValidationResult {
    const issues: ValidationIssue[] = [];
    const blockIds = new Set<string>();

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const singleResult = validateIntentBlock(block);
        issues.push(...singleResult.issues);

        if (blockIds.has(block.id)) {
            issues.push({
                code: 'DUPLICATE_BLOCK_ID',
                message: `Duplicate block ID across plan: ${block.id}`,
                path: `blocks[${i}].id`,
            });
        }
        blockIds.add(block.id);
    }

    // Check for overlapping active intervals
    const sorted = [...blocks].sort((a, b) => a.dateRange.startDate.localeCompare(b.dateRange.startDate));
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].dateRange.endDate >= sorted[i + 1].dateRange.startDate) {
            issues.push({
                code: 'OVERLAPPING_INTENT_BLOCKS',
                message: `Intent blocks ${sorted[i].id} and ${sorted[i + 1].id} overlap: ${sorted[i].dateRange.endDate} >= ${sorted[i + 1].dateRange.startDate}`,
                path: `blocks[${sorted[i].id}]`,
            });
        }
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}
