/**
 * Pure validators for multidomain session definitions, occurrences, executions, and entries (ADR-0023).
 */

import {
    type SessionDefinition,
    type SessionChoiceAction,
    type SessionOccurrence,
    type SessionExecution,
    type SessionEntry,
    type SessionIntent,
    type BlockRole,
    type BlockExecutionMode,
    SESSION_SCHEMA_VERSION,
} from './models';

export interface ValidationIssue {
    path: string;
    message: string;
}

export type ValidationResult<T> =
    | { ok: true; value: T; issues?: never }
    | { ok: false; issues: ValidationIssue[]; value?: never };

const SESSION_INTENTS = new Set<SessionIntent>([
    'training',
    'testing',
    'competition',
    'rehab_return',
    'recovery',
    'skill_technical',
]);

const BLOCK_ROLES = new Set<BlockRole>([
    'warmup',
    'main',
    'cooldown',
    'accessory',
    'test',
    'recovery',
]);

const EXECUTION_MODES = new Set<BlockExecutionMode>([
    'sequential',
    'circuit',
    'superset',
    'density',
    'amrap',
    'alternating',
]);

const CHOICE_ACTION_KINDS = new Set<SessionChoiceAction['kind']>([
    'select_alternative',
    'reduce_load_percent',
    'reduce_sets',
    'reduce_reps',
    'omit_step',
    'end_block',
    'end_session',
]);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const SESSION_DEFINITION_KEYS = [
    'schemaVersion', 'id', 'revision', 'title', 'summary', 'intent', 'modalities',
    'dominantModality', 'duration', 'defaultScheduledDate', 'sessionTargets',
    'prohibitedAdditions', 'importWarnings', 'companionSessions', 'blocks',
];

function isObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isValidWarsawCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_REGEX.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

function validateSessionSource(raw: unknown, issues: ValidationIssue[]): void {
    if (!isObject(raw) || typeof raw.kind !== 'string') {
        issues.push({ path: 'sessionSource', message: 'Missing or invalid sessionSource' });
        return;
    }
    if (raw.kind === 'catalog') {
        if (typeof raw.workoutId !== 'string' || typeof raw.catalogVersion !== 'string') {
            issues.push({ path: 'sessionSource', message: 'Catalog source requires workoutId and catalogVersion' });
        }
    } else if (raw.kind === 'external_plan') {
        if (typeof raw.planId !== 'string' || !Number.isInteger(raw.revision)
            || typeof raw.sessionId !== 'string' || typeof raw.contentHash !== 'string') {
            issues.push({ path: 'sessionSource', message: 'External-plan source is incomplete' });
        }
    } else if (raw.kind === 'manual') {
        if (typeof raw.definitionId !== 'string' || !Number.isInteger(raw.revision) || typeof raw.contentHash !== 'string') {
            issues.push({ path: 'sessionSource', message: 'Manual source is incomplete' });
        }
    } else if (raw.kind === 'unplanned_fixture') {
        if (typeof raw.fixtureId !== 'string' || raw.fixtureId.length === 0) {
            issues.push({ path: 'sessionSource.fixtureId', message: 'Fixture source requires fixtureId' });
        }
    } else {
        issues.push({ path: 'sessionSource.kind', message: `Invalid session source kind: ${raw.kind}` });
    }
}

function validateRangeOrNumber(val: unknown, path: string, issues: ValidationIssue[], allowZero = false): void {
    if (typeof val === 'number') {
        if (!Number.isFinite(val) || (allowZero ? val < 0 : val <= 0)) {
            issues.push({ path, message: `Expected positive number, received ${val}` });
        }
        return;
    }
    if (isObject(val)) {
        const min = val.min;
        const max = val.max;
        if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) {
            issues.push({ path, message: 'NumericRange min and max must be finite numbers' });
            return;
        }
        if (min < 0 || max < 0 || (!allowZero && (min === 0 || max === 0))) {
            issues.push({ path, message: 'NumericRange values must be positive' });
            return;
        }
        if (min > max) {
            issues.push({ path, message: `Range minimum (${min}) cannot exceed maximum (${max})` });
        }
        return;
    }
    issues.push({ path, message: 'Expected number or { min, max } range' });
}

export function validateSessionDefinition(raw: unknown): ValidationResult<SessionDefinition> {
    const issues: ValidationIssue[] = [];

    if (!isObject(raw)) {
        return { ok: false, issues: [{ path: '', message: 'Expected object' }] };
    }

    // Top-level only (M3.6): an invented field here -- e.g. an authoring AI hallucinating
    // `stimulusProfile` alongside the explicit `systemicCost` rejection below -- must fail
    // closed rather than pass through silently. Deliberately not a deep sweep of every
    // nested SessionStep/SessionBlock field; that risks rejecting a legitimate field this
    // check wasn't updated to know about.
    const unknownTopLevelKeys = Object.keys(raw).filter(key => !SESSION_DEFINITION_KEYS.includes(key));
    if (unknownTopLevelKeys.length > 0) {
        issues.push({ path: '', message: `Unrecognized session definition field(s): ${unknownTopLevelKeys.join(', ')}` });
    }

    if (raw.schemaVersion !== SESSION_SCHEMA_VERSION) {
        issues.push({ path: 'schemaVersion', message: `Expected schemaVersion ${SESSION_SCHEMA_VERSION}` });
    }

    if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
        issues.push({ path: 'id', message: 'Missing or empty session ID' });
    }

    if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) {
        issues.push({ path: 'revision', message: 'Revision must be an integer >= 1' });
    }

    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
        issues.push({ path: 'title', message: 'Title must be non-empty string' });
    }

    if (!raw.intent || typeof raw.intent !== 'string' || !SESSION_INTENTS.has(raw.intent as SessionIntent)) {
        issues.push({ path: 'intent', message: `Invalid or missing session intent: ${String(raw.intent)}` });
    }

    if ('systemicCost' in raw) {
        issues.push({ path: 'systemicCost', message: 'Authored systemicCost cannot be specified on session definition' });
    }

    if (typeof raw.defaultScheduledDate === 'string') {
        if (!isValidWarsawCalendarDate(raw.defaultScheduledDate)) {
            issues.push({ path: 'defaultScheduledDate', message: 'Date must be a Warsaw YYYY-MM-DD calendar date string' });
        }
    }

    if (raw.duration !== undefined) {
        validateRangeOrNumber(raw.duration, 'duration', issues, false);
    }

    if (!Array.isArray(raw.blocks)) {
        issues.push({ path: 'blocks', message: 'blocks must be an array' });
        return { ok: false, issues };
    }

    const blockIds = new Set<string>();
    const allStepIds = new Set<string>();
    const stepOrder: string[] = [];
    const stepAlternativeIds = new Map<string, Set<string>>();

    // First pass to collect step IDs and check duplicates
    raw.blocks.forEach((block, bIdx) => {
        if (!isObject(block)) {
            issues.push({ path: `blocks[${bIdx}]`, message: 'Block must be an object' });
            return;
        }
        if (typeof block.id === 'string' && block.id.length > 0) {
            if (blockIds.has(block.id)) {
                issues.push({ path: `blocks[${bIdx}].id`, message: `Duplicate block id: ${block.id}` });
            }
            blockIds.add(block.id);
        } else {
            issues.push({ path: `blocks[${bIdx}].id`, message: 'Block ID must be non-empty string' });
        }

        if (Array.isArray(block.steps)) {
            block.steps.forEach((step, sIdx) => {
                if (isObject(step) && typeof step.id === 'string' && step.id.length > 0) {
                    if (allStepIds.has(step.id)) {
                        issues.push({ path: `blocks[${bIdx}].steps[${sIdx}].id`, message: `Duplicate step id: ${step.id}` });
                    }
                    allStepIds.add(step.id);
                    stepOrder.push(step.id);
                    const altIds = new Set<string>();
                    if (Array.isArray(step.alternatives)) {
                        step.alternatives.forEach(alt => {
                            if (isObject(alt) && typeof alt.id === 'string' && alt.id.length > 0) altIds.add(alt.id);
                        });
                    }
                    stepAlternativeIds.set(step.id, altIds);
                }
            });
        }
    });

    // Second pass to validate block contents, steps, loads, and optionSets
    raw.blocks.forEach((block, bIdx) => {
        if (!isObject(block)) return;

        if (typeof block.role !== 'string' || !BLOCK_ROLES.has(block.role as BlockRole)) {
            issues.push({ path: `blocks[${bIdx}].role`, message: `Invalid block role: ${String(block.role)}` });
        }

        if (typeof block.executionMode !== 'string' || !EXECUTION_MODES.has(block.executionMode as BlockExecutionMode)) {
            issues.push({ path: `blocks[${bIdx}].executionMode`, message: `Invalid block executionMode: ${String(block.executionMode)}` });
        }

        if (block.rounds !== undefined) {
            validateRangeOrNumber(block.rounds, `blocks[${bIdx}].rounds`, issues, false);
        }

        if (!Array.isArray(block.steps)) {
            issues.push({ path: `blocks[${bIdx}].steps`, message: 'steps must be an array' });
        } else {
            block.steps.forEach((step, sIdx) => {
                const sPath = `blocks[${bIdx}].steps[${sIdx}]`;
                if (!isObject(step)) {
                    issues.push({ path: sPath, message: 'Step must be an object' });
                    return;
                }

                if (typeof step.id !== 'string' || step.id.trim().length === 0) {
                    issues.push({ path: `${sPath}.id`, message: 'Step ID must be non-empty string' });
                }

                if (!step.kind || !['exercise', 'transition', 'rest'].includes(String(step.kind))) {
                    issues.push({ path: `${sPath}.kind`, message: `Invalid step kind: ${String(step.kind)}` });
                }

                // Exercise ref
                if (step.kind === 'exercise') {
                    if (!isObject(step.exerciseRef)) {
                        issues.push({ path: `${sPath}.exerciseRef`, message: 'Missing exerciseRef on exercise step' });
                    } else {
                        const exRef = step.exerciseRef;
                        if (exRef.kind === 'catalog') {
                            if (typeof exRef.exerciseId !== 'string' || exRef.exerciseId.length === 0) {
                                issues.push({ path: `${sPath}.exerciseRef.exerciseId`, message: 'Missing catalog exerciseId' });
                            }
                        } else if (exRef.kind === 'unresolved_free_text') {
                            if (typeof exRef.name !== 'string' || exRef.name.length === 0) {
                                issues.push({ path: `${sPath}.exerciseRef.name`, message: 'Missing unresolved exercise name' });
                            }
                        } else {
                            issues.push({ path: `${sPath}.exerciseRef.kind`, message: `Invalid exerciseRef kind: ${String(exRef.kind)}` });
                        }
                    }
                }

                // Dose
                if (step.dose !== undefined) {
                    if (!isObject(step.dose)) {
                        issues.push({ path: `${sPath}.dose`, message: 'Dose must be an object' });
                    } else {
                        const dose = step.dose;
                        if (dose.kind === 'repetition') {
                            if (typeof dose.sets !== 'number' || !Number.isInteger(dose.sets) || dose.sets <= 0) {
                                issues.push({ path: `${sPath}.dose.sets`, message: 'Dose sets must be a positive integer' });
                            }
                            validateRangeOrNumber(dose.reps, `${sPath}.dose.reps`, issues, false);
                        } else if (dose.kind === 'duration') {
                            if (dose.sets !== undefined && (typeof dose.sets !== 'number' || !Number.isInteger(dose.sets) || dose.sets <= 0)) {
                                issues.push({ path: `${sPath}.dose.sets`, message: 'Dose sets must be a positive integer' });
                            }
                            validateRangeOrNumber(dose.seconds, `${sPath}.dose.seconds`, issues, false);
                        } else if (dose.kind === 'distance') {
                            if (dose.sets !== undefined && (typeof dose.sets !== 'number' || !Number.isInteger(dose.sets) || dose.sets <= 0)) {
                                issues.push({ path: `${sPath}.dose.sets`, message: 'Dose sets must be a positive integer' });
                            }
                            const distanceVal = dose.meters !== undefined ? dose.meters : dose.metres;
                            validateRangeOrNumber(distanceVal, `${sPath}.dose.meters`, issues, false);
                        } else if (dose.kind === 'checkoff') {
                            if (dose.rounds !== undefined && (typeof dose.rounds !== 'number' || !Number.isInteger(dose.rounds) || dose.rounds <= 0)) {
                                issues.push({ path: `${sPath}.dose.rounds`, message: 'Dose rounds must be a positive integer' });
                            }
                        } else {
                            issues.push({ path: `${sPath}.dose.kind`, message: `Invalid dose kind: ${String(dose.kind)}` });
                        }
                    }
                }

                if (step.stopConditions !== undefined
                    && (!Array.isArray(step.stopConditions) || !step.stopConditions.every(condition => typeof condition === 'string' && condition.trim().length > 0))) {
                    issues.push({ path: `${sPath}.stopConditions`, message: 'stopConditions must be non-empty strings' });
                }

                // Load
                if (step.load !== undefined) {
                    if (!isObject(step.load)) {
                        issues.push({ path: `${sPath}.load`, message: 'Load must be an object' });
                    } else {
                        const load = step.load;
                        if (load.kind === 'percent_one_rm') {
                            if (isObject(step.exerciseRef) && step.exerciseRef.kind === 'unresolved_free_text') {
                                issues.push({ path: `${sPath}.load.kind`, message: 'Unresolved movement cannot claim 1RM load' });
                            }
                        } else if (load.kind === 'relative_step') {
                            const refStepId = String(load.stepId);
                            const currentIdx = stepOrder.indexOf(String(step.id));
                            const targetIdx = stepOrder.indexOf(refStepId);
                            if (targetIdx === -1 || targetIdx >= currentIdx) {
                                issues.push({ path: `${sPath}.load.stepId`, message: `Relative step '${refStepId}' does not reference an earlier step` });
                            }
                        } else if (load.kind === 'mass') {
                            validateRangeOrNumber(load.kg, `${sPath}.load.kg`, issues, true);
                        } else if (load.kind === 'band') {
                            if (typeof load.bandColor !== 'string') {
                                issues.push({ path: `${sPath}.load.bandColor`, message: 'Band color must be a string' });
                            }
                        } else if (
                            load.kind === 'bodyweight' ||
                            load.kind === 'percent_max' ||
                            load.kind === 'descriptive' ||
                            load.kind === 'unloaded'
                        ) {
                            // valid load representations
                        } else {
                            issues.push({ path: `${sPath}.load.kind`, message: `Invalid load kind: ${String(load.kind)}` });
                        }
                    }
                }
            });
        }

        // optionSets
        if (Array.isArray(block.optionSets)) {
            block.optionSets.forEach((choice, cIdx) => {
                const cPath = `blocks[${bIdx}].optionSets[${cIdx}]`;
                if (!isObject(choice)) {
                    issues.push({ path: cPath, message: 'Choice must be an object' });
                    return;
                }
                if (typeof choice.appliesAtStepId !== 'string' || !allStepIds.has(choice.appliesAtStepId)) {
                    issues.push({ path: `${cPath}.appliesAtStepId`, message: 'Choice appliesAtStepId must reference a valid step in the definition' });
                }
                if (!Array.isArray(choice.options)) {
                    issues.push({ path: `${cPath}.options`, message: 'Choice options must be an array' });
                } else if (choice.options.length === 0) {
                    issues.push({ path: `${cPath}.options`, message: 'Choice options must contain at least one option' });
                } else {
                    choice.options.forEach((opt, oIdx) => {
                        const oPath = `${cPath}.options[${oIdx}]`;
                        if (!isObject(opt)) {
                            issues.push({ path: oPath, message: 'Option must be an object' });
                            return;
                        }
                        if (!Array.isArray(opt.actions)) {
                            issues.push({ path: `${oPath}.actions`, message: 'Option actions must be an array' });
                        } else {
                            opt.actions.forEach((act, aIdx) => {
                                const aPath = `${oPath}.actions[${aIdx}]`;
                                if (!isObject(act)) {
                                    issues.push({ path: aPath, message: 'Action must be an object' });
                                    return;
                                }
                                const kind = act.kind as SessionChoiceAction['kind'];
                                if (!CHOICE_ACTION_KINDS.has(kind)) {
                                    issues.push({ path: `${aPath}.kind`, message: `Invalid or disallowed choice action kind: ${String(act.kind)}` });
                                }
                                if ('targetStepId' in act && (typeof act.targetStepId !== 'string' || !allStepIds.has(act.targetStepId))) {
                                    issues.push({ path: `${aPath}.targetStepId`, message: `targetStepId '${String(act.targetStepId)}' not found in definition` });
                                }
                                if ('targetBlockId' in act && (typeof act.targetBlockId !== 'string' || !blockIds.has(act.targetBlockId))) {
                                    issues.push({ path: `${aPath}.targetBlockId`, message: `targetBlockId '${String(act.targetBlockId)}' not found in definition` });
                                }
                                if (kind === 'select_alternative') {
                                    const validAlternativeIds = typeof act.targetStepId === 'string' ? stepAlternativeIds.get(act.targetStepId) : undefined;
                                    if (typeof act.alternativeId !== 'string' || act.alternativeId.length === 0 || !validAlternativeIds?.has(act.alternativeId)) {
                                        issues.push({ path: `${aPath}.alternativeId`, message: `alternativeId '${String(act.alternativeId)}' not found among targetStepId's alternatives` });
                                    }
                                }
                            });
                        }
                    });
                }
            });
        }
    });

    if (issues.length > 0) {
        return { ok: false, issues };
    }

    return { ok: true, value: raw as unknown as SessionDefinition };
}

export function validateSessionOccurrence(raw: unknown): ValidationResult<SessionOccurrence> {
    const issues: ValidationIssue[] = [];
    if (!isObject(raw)) return { ok: false, issues: [{ path: '', message: 'Expected object' }] };

    if (typeof raw.userId !== 'string' || raw.userId.length === 0) {
        issues.push({ path: 'userId', message: 'Missing userId' });
    }
    if (typeof raw.occurrenceId !== 'string' || raw.occurrenceId.length === 0) {
        issues.push({ path: 'occurrenceId', message: 'Missing occurrenceId' });
    }
    if (!isValidWarsawCalendarDate(raw.date)) {
        issues.push({ path: 'date', message: 'date must be Warsaw YYYY-MM-DD string' });
    }
    if (!['unplanned_log', 'schedule', 'replace_recommendation', 'additional_session'].includes(String(raw.authority))) {
        issues.push({ path: 'authority', message: `Invalid authority: ${String(raw.authority)}` });
    }
    if (!['scheduled', 'active', 'superseded', 'completed', 'abandoned', 'missed'].includes(String(raw.state))) {
        issues.push({ path: 'state', message: `Invalid state: ${String(raw.state)}` });
    }
    if (!isObject(raw.definitionRef)
        || typeof raw.definitionRef.definitionId !== 'string' || raw.definitionRef.definitionId.length === 0
        || typeof raw.definitionRef.revision !== 'number' || !Number.isInteger(raw.definitionRef.revision) || raw.definitionRef.revision < 1
        || typeof raw.definitionRef.contentHash !== 'string' || raw.definitionRef.contentHash.length === 0) {
        issues.push({ path: 'definitionRef', message: 'Invalid definitionRef' });
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw as unknown as SessionOccurrence };
}

export function validateSessionExecution(raw: unknown): ValidationResult<SessionExecution> {
    const issues: ValidationIssue[] = [];
    if (!isObject(raw)) return { ok: false, issues: [{ path: '', message: 'Expected object' }] };

    if (typeof raw.userId !== 'string' || raw.userId.length === 0) issues.push({ path: 'userId', message: 'Missing userId' });
    if (typeof raw.executionId !== 'string' || raw.executionId.length === 0) issues.push({ path: 'executionId', message: 'Missing executionId' });
    if (!isValidWarsawCalendarDate(raw.date)) issues.push({ path: 'date', message: 'date must be Warsaw YYYY-MM-DD string' });
    if (!['in_progress', 'completed', 'abandoned'].includes(String(raw.state))) issues.push({ path: 'state', message: `Invalid state: ${String(raw.state)}` });
    if (typeof raw.startedAt !== 'string' || raw.startedAt.length === 0) issues.push({ path: 'startedAt', message: 'Missing startedAt' });
    if (typeof raw.updatedAt !== 'string' || raw.updatedAt.length === 0) issues.push({ path: 'updatedAt', message: 'Missing updatedAt' });
    validateSessionSource(raw.sessionSource, issues);

    if (raw.state === 'completed' && (typeof raw.completedAt !== 'string' || raw.completedAt.length === 0)) {
        issues.push({ path: 'completedAt', message: 'completed state requires completedAt timestamp' });
    }
    if (raw.state !== 'completed' && raw.completedAt !== undefined) {
        issues.push({ path: 'completedAt', message: 'Only completed executions may have completedAt' });
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw as unknown as SessionExecution };
}

export function validateSessionEntry(raw: unknown): ValidationResult<SessionEntry> {
    const issues: ValidationIssue[] = [];
    if (!isObject(raw)) return { ok: false, issues: [{ path: '', message: 'Expected object' }] };

    if (typeof raw.id !== 'string' || raw.id.length === 0) issues.push({ path: 'id', message: 'Missing entry id' });
    if (typeof raw.executionId !== 'string' || raw.executionId.length === 0) issues.push({ path: 'executionId', message: 'Missing executionId' });
    if (typeof raw.completedAt !== 'string' || raw.completedAt.length === 0) issues.push({ path: 'completedAt', message: 'Missing completedAt' });
    if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) issues.push({ path: 'createdAt', message: 'Missing createdAt' });
    if (typeof raw.updatedAt !== 'string' || raw.updatedAt.length === 0) issues.push({ path: 'updatedAt', message: 'Missing updatedAt' });

    if (!isObject(raw.payload)) {
        issues.push({ path: 'payload', message: 'Missing entry payload' });
    } else {
        const payload = raw.payload;
        const kind = String(payload.kind);
        if (!['repetition', 'duration', 'distance', 'sprint', 'jump_attempt', 'checkoff', 'choice'].includes(kind)) {
            issues.push({ path: 'payload.kind', message: `Invalid entry payload kind: ${kind}` });
        } else if (kind === 'repetition') {
            if (typeof payload.setIndex !== 'number' || !Number.isInteger(payload.setIndex) || payload.setIndex < 1) issues.push({ path: 'payload.setIndex', message: 'setIndex must be an integer >= 1' });
            if (typeof payload.reps !== 'number' || !Number.isInteger(payload.reps) || payload.reps < 1) issues.push({ path: 'payload.reps', message: 'reps must be an integer >= 1' });
            if (payload.weightKg !== undefined && (typeof payload.weightKg !== 'number' || !Number.isFinite(payload.weightKg) || payload.weightKg < 0)) issues.push({ path: 'payload.weightKg', message: 'weightKg must be a finite non-negative number' });
        } else if (kind === 'duration') {
            if (typeof payload.seconds !== 'number' || !Number.isFinite(payload.seconds) || payload.seconds <= 0) issues.push({ path: 'payload.seconds', message: 'seconds must be a finite positive number' });
        } else if (kind === 'distance') {
            if (typeof payload.meters !== 'number' || !Number.isFinite(payload.meters) || payload.meters <= 0) issues.push({ path: 'payload.meters', message: 'meters must be a finite positive number' });
        } else if (kind === 'sprint') {
            if (typeof payload.meters !== 'number' || payload.meters <= 0) issues.push({ path: 'payload.meters', message: 'meters must be positive' });
            if (typeof payload.splitSeconds !== 'number' || payload.splitSeconds <= 0) issues.push({ path: 'payload.splitSeconds', message: 'splitSeconds must be positive' });
        } else if (kind === 'jump_attempt') {
            if (typeof payload.attemptIndex !== 'number' || !Number.isInteger(payload.attemptIndex) || payload.attemptIndex < 1) issues.push({ path: 'payload.attemptIndex', message: 'attemptIndex must be an integer >= 1' });
            if (typeof payload.heightInches !== 'number' && typeof payload.distanceMeters !== 'number') issues.push({ path: 'payload', message: 'jump_attempt requires heightInches or distanceMeters' });
        } else if (kind === 'checkoff' && typeof payload.completed !== 'boolean') {
            issues.push({ path: 'payload.completed', message: 'checkoff completed must be boolean' });
        } else if (kind === 'choice') {
            if (typeof payload.choiceId !== 'string' || payload.choiceId.length === 0) issues.push({ path: 'payload.choiceId', message: 'choiceId must be a non-empty string' });
            if (typeof payload.optionId !== 'string' || payload.optionId.length === 0) issues.push({ path: 'payload.optionId', message: 'optionId must be a non-empty string' });
            if (payload.reason !== undefined && typeof payload.reason !== 'string') issues.push({ path: 'payload.reason', message: 'reason must be a string' });
        }
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw as unknown as SessionEntry };
}
