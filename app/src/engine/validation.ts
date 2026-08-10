/**
 * This module validates *untyped external input* (raw Firestore documents / client
 * payloads) before it becomes a typed model — the point of these functions is that the
 * shape of `raw` is not yet known or trusted. `any` is used deliberately here rather than
 * `unknown` so the runtime checks below (`.includes()`, `.trim()`, `Number.isInteger()`,
 * nested `raw.availability.*` access, etc.) don't require a cast at every access; each
 * field is still validated at runtime before being written into a typed model. Do not use
 * `any` this way outside of a validation/parsing boundary like this one.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
    DailySubjectiveCheckin,
    DailyRecommendation,
    UserGoal,
    UserConstraint,
    UserPreferences,
    GoalCategory,
    GoalDomain,
    GoalStatus,
    UserEvent,
    EventTiming,
    EventTaperSpec,
    ConstraintType,
    ConstraintSeverity,
    ConstraintCategory,
    RecoveryStyle,
    TimeOfDay,
    ExplanationVerbosity,
    FixedActivity,
    WorkoutStimulusProfile,
    WorkoutCostProfile,
    TrainingEnvironment,
    BodyRegion,
    RegionTissueResponse,
    TissueResponseLevel,
    AuthoredPlanBlock,
    TrainingIntentProfile,
    PlanningMode,
    TrainingPriority,
} from './models';
import { validateEventTiming, BODY_REGIONS, TISSUE_LEVELS } from './models';
import { deriveGoalCategory } from './periodization';
import { EVENT_PRESETS } from './eventPresets';
import { getLocalDateString } from '../utils/localDate';

// --- Validation Result Types ---

export interface ValidationError {
    field: string;
    message: string;
    value?: any;
}

export interface ValidationResult<T = any> {
    isValid: boolean;
    data?: T;
    errors: ValidationError[];
}

// --- Helper Functions ---

export function isValidDate(date: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(date)) return false;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

function isInRange(value: number, min: number, max: number): boolean {
    return typeof value === 'number' && value >= min && value <= max;
}

function normalizeEmptyToNull(value: any): any {
    if (value === '' || value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    return value;
}

// --- Daily Subjective Check-in Validation ---

function isValidTissueLevel(value: unknown): value is TissueResponseLevel {
    return typeof value === 'string' && (TISSUE_LEVELS as readonly string[]).includes(value);
}

/** Validates and rebuilds the optional per-region tissue-response map (Phase 5.4).
 *  Unknown region keys or malformed entries are reported as errors rather than silently
 *  dropped -- a client that gets this shape wrong is exactly the case validation exists
 *  to catch, same as every other field here. */
function validateTissueResponses(raw: any, errors: ValidationError[]): Partial<Record<BodyRegion, RegionTissueResponse>> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: 'tissueResponses', message: 'tissueResponses must be an object keyed by body region' });
        return undefined;
    }

    const result: Partial<Record<BodyRegion, RegionTissueResponse>> = {};
    for (const key of Object.keys(raw)) {
        if (!(BODY_REGIONS as readonly string[]).includes(key)) {
            errors.push({ field: 'tissueResponses', message: `tissueResponses has unrecognized region '${key}'` });
            continue;
        }
        const region = key as BodyRegion;
        const entry = raw[key];
        if (!entry || typeof entry !== 'object') {
            errors.push({ field: `tissueResponses.${region}`, message: 'Each region entry must be an object' });
            continue;
        }
        if (entry.region !== undefined && entry.region !== region) {
            errors.push({ field: `tissueResponses.${region}.region`, message: `region must match the containing key '${region}', got '${entry.region}'` });
            continue;
        }
        if (!isValidTissueLevel(entry.morningState)) {
            errors.push({ field: `tissueResponses.${region}.morningState`, message: `morningState must be one of: ${TISSUE_LEVELS.join(', ')}` });
            continue;
        }
        const optionalFields: (keyof RegionTissueResponse)[] = ['painDuringTraining', 'afterTrainingState', 'nextMorningReaction'];
        let hasInvalidOptional = false;
        for (const field of optionalFields) {
            if (entry[field] !== undefined && entry[field] !== null && !isValidTissueLevel(entry[field])) {
                errors.push({ field: `tissueResponses.${region}.${field}`, message: `${field} must be one of: ${TISSUE_LEVELS.join(', ')}` });
                hasInvalidOptional = true;
            }
        }
        if (hasInvalidOptional) continue;

        result[region] = {
            region,
            morningState: entry.morningState,
            ...(isValidTissueLevel(entry.painDuringTraining) ? { painDuringTraining: entry.painDuringTraining } : {}),
            ...(isValidTissueLevel(entry.afterTrainingState) ? { afterTrainingState: entry.afterTrainingState } : {}),
            ...(isValidTissueLevel(entry.nextMorningReaction) ? { nextMorningReaction: entry.nextMorningReaction } : {}),
        };
    }
    return result;
}

export function validateCheckin(raw: any): ValidationResult<DailySubjectiveCheckin> {
    const errors: ValidationError[] = [];

    // Required fields
    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.date || !isValidDate(raw.date)) {
        errors.push({ field: 'date', message: 'Valid date (YYYY-MM-DD) is required' });
    }

    // Readiness dimensions (1-10 scale, reject invalid values)
    const readinessFields = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'];
    readinessFields.forEach(field => {
        const value = normalizeEmptyToNull(raw[field]);
        if (value !== null) {
            if (!isInRange(value, 1, 10)) {
                errors.push({ 
                    field, 
                    message: `${field} must be between 1 and 10 or empty`,
                    value 
                });
            }
        }
    });

    // Boolean flags (default to false if not provided)
    const booleanFlags = ['painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime', 'alreadyTrainedToday'];
    booleanFlags.forEach(field => {
        if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
            errors.push({ 
                field, 
                message: `${field} must be a boolean`,
                value: raw[field] 
            });
        }
    });

    // Availability block
    if (raw.availability) {
        if (raw.availability.timeAvailableMin !== undefined) {
            const timeMin = normalizeEmptyToNull(raw.availability.timeAvailableMin);
            if (timeMin !== null && (!isInRange(timeMin, 0, 1440) || !Number.isInteger(timeMin))) {
                errors.push({
                    field: 'availability.timeAvailableMin',
                    message: 'Time available must be a whole number between 0 and 1440 minutes',
                    value: timeMin
                });
            }
        }
        
        if (raw.availability.preferredModalityToday !== undefined) {
            const modality = normalizeEmptyToNull(raw.availability.preferredModalityToday);
            if (modality !== null && typeof modality !== 'string') {
                errors.push({
                    field: 'availability.preferredModalityToday',
                    message: 'Preferred modality must be a string or empty',
                    value: modality
                });
            }
        }

        if (raw.availability.indoorOnly !== undefined && typeof raw.availability.indoorOnly !== 'boolean') {
            errors.push({
                field: 'availability.indoorOnly',
                message: 'Indoor only must be a boolean',
                value: raw.availability.indoorOnly
            });
        }
    }

    // Notes (optional, normalize empty to null)
    const notes = normalizeEmptyToNull(raw.notes);
    if (notes !== null && typeof notes !== 'string') {
        errors.push({
            field: 'notes',
            message: 'Notes must be a string or empty',
            value: notes
        });
    }

    // Per-region tissue response (Phase 5.4)
    const tissueResponses = validateTissueResponses(raw.tissueResponses, errors);

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    // Build validated check-in object
    const checkin: DailySubjectiveCheckin = {
        userId: raw.userId,
        date: raw.date,
        readiness: normalizeEmptyToNull(raw.readiness),
        sleepQuality: normalizeEmptyToNull(raw.sleepQuality),
        fatigue: normalizeEmptyToNull(raw.fatigue),
        soreness: normalizeEmptyToNull(raw.soreness),
        mentalStress: normalizeEmptyToNull(raw.mentalStress),
        motivation: normalizeEmptyToNull(raw.motivation),
        painOrInjury: raw.painOrInjury ?? false,
        illnessSymptoms: raw.illnessSymptoms ?? false,
        unusuallyLimitedTime: raw.unusuallyLimitedTime ?? false,
        alreadyTrainedToday: raw.alreadyTrainedToday ?? false,
        ...(tissueResponses && Object.keys(tissueResponses).length > 0 ? { tissueResponses } : {}),
        availability: {
            timeAvailableMin: normalizeEmptyToNull(raw.availability?.timeAvailableMin),
            preferredModalityToday: normalizeEmptyToNull(raw.availability?.preferredModalityToday),
            indoorOnly: raw.availability?.indoorOnly ?? false
        },
        notes: notes,
        submittedAt: raw.submittedAt || new Date().toISOString(),
        ...(raw.initialSubmittedAt ? { initialSubmittedAt: raw.initialSubmittedAt } : {}),
        ...(typeof raw.editedAfterWearableReveal === 'boolean' ? { editedAfterWearableReveal: raw.editedAfterWearableReveal } : {}),
        dataQuality: computeDataQuality(raw),
        schemaVersion: raw.schemaVersion ?? 1,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return { isValid: true, data: checkin, errors: [] };
}

// --- Data Quality Computation ---

export function computeDataQuality(raw: any): { isComplete: boolean; missingFields: string[] } {
    const missingFields: string[] = [];
    
    // Required fields for completeness
    const readinessFields = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'];
    readinessFields.forEach(field => {
        const value = normalizeEmptyToNull(raw[field]);
        if (value === null) {
            missingFields.push(field);
        }
    });

    // Boolean flags must be present (even if false)
    if (raw.painOrInjury === undefined) missingFields.push('painOrInjury');
    if (raw.illnessSymptoms === undefined) missingFields.push('illnessSymptoms');
    if (raw.unusuallyLimitedTime === undefined) missingFields.push('unusuallyLimitedTime');
    if (raw.alreadyTrainedToday === undefined) missingFields.push('alreadyTrainedToday');

    // Time available must be present
    const timeAvailable = normalizeEmptyToNull(raw.availability?.timeAvailableMin);
    if (timeAvailable === null) {
        missingFields.push('timeAvailableMin');
    }

    return {
        isComplete: missingFields.length === 0,
        missingFields
    };
}

// --- Goal Validation ---

export function validateGoal(raw: any): ValidationResult<UserGoal> {
    const errors: ValidationError[] = [];

    // Required fields
    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.title || typeof raw.title !== 'string' || raw.title.trim() === '') {
        errors.push({ field: 'title', message: 'Title is required' });
    }

    // Category: only ever taken from the caller for an OPEN-ENDED goal (no targetDate).
    // A dated goal's category is derived below from targetDate, regardless of what raw
    // sends -- see deriveGoalCategory. This is what keeps category from ever going stale:
    // it's never trusted as stored input for a dated goal, only ever recomputed.
    const rawTargetDate = normalizeEmptyToNull(raw.targetDate);
    const validCategories: GoalCategory[] = ['short-term', 'mid-term', 'long-term'];
    if (!rawTargetDate && (!raw.category || !validCategories.includes(raw.category))) {
        errors.push({
            field: 'category',
            message: `Category must be one of: ${validCategories.join(', ')} (required for an open-ended goal with no target date)`
        });
    }

    // Domain validation
    const validDomains: GoalDomain[] = ['endurance', 'strength', 'mobility', 'weight_loss', 'general_fitness', 'other'];
    if (!raw.domain || !validDomains.includes(raw.domain)) {
        errors.push({ 
            field: 'domain', 
            message: `Domain must be one of: ${validDomains.join(', ')}` 
        });
    }

    // Priority validation (1-5)
    if (!isInRange(raw.priority, 1, 5) || !Number.isInteger(raw.priority)) {
        errors.push({ 
            field: 'priority', 
            message: 'Priority must be an integer between 1 and 5' 
        });
    }

    // Status validation
    const validStatuses: GoalStatus[] = ['active', 'paused', 'completed', 'archived'];
    if (!raw.status || !validStatuses.includes(raw.status)) {
        errors.push({ 
            field: 'status', 
            message: `Status must be one of: ${validStatuses.join(', ')}` 
        });
    }

    // Optional fields validation
    if (raw.description !== undefined) {
        const desc = normalizeEmptyToNull(raw.description);
        if (desc !== null && typeof desc !== 'string') {
            errors.push({
                field: 'description',
                message: 'Description must be a string or empty'
            });
        }
    }

    if (rawTargetDate !== null && !isValidDate(rawTargetDate)) {
        errors.push({
            field: 'targetDate',
            message: 'Target date must be a valid date (YYYY-MM-DD) or empty'
        });
    }

    // Event fields: only meaningful alongside a target date (a race needs a date).
    const validEventCategories: UserEvent['category'][] = ['running_race', 'cycling_event', 'triathlon', 'strength_meet', 'general_target'];
    const rawEventCategory = normalizeEmptyToNull(raw.eventCategory);
    if (rawEventCategory !== null) {
        if (!validEventCategories.includes(rawEventCategory)) {
            errors.push({
                field: 'eventCategory',
                message: `Event category must be one of: ${validEventCategories.join(', ')}`
            });
        }
        if (!rawTargetDate) {
            errors.push({
                field: 'eventCategory',
                message: 'An event needs a target date'
            });
        }
    }

    const rawEventPreset = normalizeEmptyToNull(raw.eventPreset);
    if (rawEventPreset !== null) {
        const presetIds = validEventCategories.includes(rawEventCategory) ? EVENT_PRESETS[rawEventCategory as UserEvent['category']].map(p => p.id) : [];
        if (!rawEventCategory || !presetIds.includes(rawEventPreset)) {
            errors.push({
                field: 'eventPreset',
                message: 'Event preset must be a valid style for the selected event category'
            });
        }
    }

    const validEventLifecycles: NonNullable<UserGoal['eventLifecycle']>[] = ['scheduled', 'completed', 'DNS', 'DNF', 'cancelled'];
    if (raw.eventLifecycle !== undefined && raw.eventLifecycle !== null && !validEventLifecycles.includes(raw.eventLifecycle)) {
        errors.push({
            field: 'eventLifecycle',
            message: `Event status must be one of: ${validEventLifecycles.join(', ')}`
        });
    }
    if (raw.eventLifecycle !== undefined && raw.eventLifecycle !== null && (!rawTargetDate || !rawEventCategory)) {
        errors.push({
            field: 'eventLifecycle',
            message: 'Event status requires a dated event category'
        });
    }

    // Race-date uncertainty (ADR-0012 Task 2.3): only meaningful alongside a dated event.
    // Structural checks happen here (validation's job is guarding untyped raw input);
    // validateEventTiming's own ordering/confirmation invariants run once the shape is
    // already known to be a real EventTiming.
    const rawTiming: EventTiming | null = raw.timing !== undefined && raw.timing !== null ? raw.timing : null;
    if (rawTiming !== null) {
        if (!rawTargetDate || !rawEventCategory) {
            errors.push({ field: 'timing', message: 'Event timing requires a dated event category' });
        } else if (
            typeof rawTiming.earliestDate !== 'string' || !isValidDate(rawTiming.earliestDate) ||
            typeof rawTiming.latestDate !== 'string' || !isValidDate(rawTiming.latestDate) ||
            typeof rawTiming.planningDate !== 'string' || !isValidDate(rawTiming.planningDate) ||
            (rawTiming.confirmedDate !== undefined && rawTiming.confirmedDate !== null
                && (typeof rawTiming.confirmedDate !== 'string' || !isValidDate(rawTiming.confirmedDate)))
        ) {
            errors.push({ field: 'timing', message: 'Event timing dates must be valid dates (YYYY-MM-DD)' });
        } else {
            const timingResult = validateEventTiming(rawTiming, `goal/${raw.userId ?? 'unknown'}`);
            if (timingResult.status === 'INVALID') {
                errors.push({
                    field: 'timing',
                    message: `Event timing is inconsistent: ${timingResult.issues.map(i => i.code).join(', ')}`
                });
            }
        }
    }

    const rawTaper: EventTaperSpec | null = raw.taper !== undefined && raw.taper !== null ? raw.taper : null;
    if (rawTaper !== null) {
        const planningDate = rawTiming?.planningDate ?? rawTargetDate;
        if (!rawTargetDate || !rawEventCategory) {
            errors.push({ field: 'taper', message: 'Taper requires a dated event category' });
        } else if (typeof rawTaper.startDate !== 'string' || !isValidDate(rawTaper.startDate)) {
            errors.push({ field: 'taper', message: 'Taper start date must be a valid date (YYYY-MM-DD)' });
        } else if (planningDate && rawTaper.startDate >= planningDate) {
            errors.push({ field: 'taper', message: 'Taper start date must precede the planned event date' });
        }
    }

    if (raw.targetOutcome !== undefined) {
        const outcome = normalizeEmptyToNull(raw.targetOutcome);
        if (outcome !== null && typeof outcome !== 'string') {
            errors.push({ field: 'targetOutcome', message: 'Target outcome must be a string or empty' });
        }
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const goal: UserGoal = {
        userId: raw.userId,
        // Derived, never trusted from raw, whenever a target date exists -- see the
        // module doc comment on UserGoal.category in models.ts.
        category: rawTargetDate ? deriveGoalCategory(rawTargetDate, getLocalDateString()) : raw.category,
        domain: raw.domain,
        title: raw.title.trim(),
        description: normalizeEmptyToNull(raw.description),
        priority: raw.priority,
        status: raw.status,
        targetMetric: normalizeEmptyToNull(raw.targetMetric),
        targetValue: normalizeEmptyToNull(raw.targetValue),
        targetUnit: normalizeEmptyToNull(raw.targetUnit),
        targetDate: rawTargetDate,
        targetOutcome: normalizeEmptyToNull(raw.targetOutcome),
        ...(rawEventCategory ? { eventCategory: rawEventCategory as UserEvent['category'] } : {}),
        ...(rawEventPreset ? { eventPreset: rawEventPreset } : {}),
        ...(raw.eventLifecycle ? { eventLifecycle: raw.eventLifecycle } : {}),
        // Rebuilt from only the recognized sub-fields (not a raw pass-through), same as
        // every other field above -- already known valid at this point (errors.length
        // guard returned above otherwise).
        ...(rawTiming ? {
            timing: {
                earliestDate: rawTiming.earliestDate,
                latestDate: rawTiming.latestDate,
                planningDate: rawTiming.planningDate,
                ...(rawTiming.confirmedDate ? { confirmedDate: rawTiming.confirmedDate } : {}),
            }
        } : {}),
        ...(rawTaper ? { taper: { startDate: rawTaper.startDate } } : {}),
        schemaVersion: raw.schemaVersion ?? 1,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return { isValid: true, data: goal, errors: [] };
}

// --- Constraint Validation ---

export function validateConstraint(raw: any): ValidationResult<UserConstraint> {
    const errors: ValidationError[] = [];

    // Required fields
    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.key || typeof raw.key !== 'string' || raw.key.trim() === '') {
        errors.push({ field: 'key', message: 'Key is required' });
    }
    if (!raw.displayName || typeof raw.displayName !== 'string' || raw.displayName.trim() === '') {
        errors.push({ field: 'displayName', message: 'Display name is required' });
    }

    if (raw.label !== undefined && typeof raw.label !== 'string') {
        errors.push({ field: 'label', message: 'Label must be a string when provided' });
    }

    // Type validation
    const validTypes: ConstraintType[] = ['boolean', 'number', 'string', 'string_array'];
    if (!raw.type || !validTypes.includes(raw.type)) {
        errors.push({ 
            field: 'type', 
            message: `Type must be one of: ${validTypes.join(', ')}` 
        });
    }

    // Severity validation
    const validSeverities: ConstraintSeverity[] = ['hard', 'soft'];
    if (!raw.severity || !validSeverities.includes(raw.severity)) {
        errors.push({ 
            field: 'severity', 
            message: `Severity must be one of: ${validSeverities.join(', ')}` 
        });
    }

    // Category validation
    const validCategories: ConstraintCategory[] = ['equipment', 'physical_caution', 'schedule', 'environment', 'custom'];
    if (!raw.category || !validCategories.includes(raw.category)) {
        errors.push({ 
            field: 'category', 
            message: `Category must be one of: ${validCategories.join(', ')}` 
        });
    }

    // Value type consistency
    if (raw.type && raw.value !== undefined) {
        switch (raw.type) {
            case 'boolean':
                if (typeof raw.value !== 'boolean') {
                    errors.push({
                        field: 'value',
                        message: 'Value must be a boolean for boolean type'
                    });
                }
                break;
            case 'number':
                if (typeof raw.value !== 'number') {
                    errors.push({
                        field: 'value',
                        message: 'Value must be a number for number type'
                    });
                }
                break;
            case 'string':
                if (typeof raw.value !== 'string') {
                    errors.push({
                        field: 'value',
                        message: 'Value must be a string for string type'
                    });
                }
                break;
            case 'string_array':
                if (!Array.isArray(raw.value) || !raw.value.every((v: any) => typeof v === 'string')) {
                    errors.push({
                        field: 'value',
                        message: 'Value must be an array of strings for string_array type'
                    });
                }
                break;
        }
    }

    // Active status validation
    if (typeof raw.isActive !== 'boolean') {
        errors.push({
            field: 'isActive',
            message: 'Active status must be a boolean'
        });
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const constraint: UserConstraint = {
        userId: raw.userId,
        key: raw.key.trim(),
        label: (raw.label || raw.displayName).trim(),
        valueType: raw.valueType || raw.type,
        type: raw.type,
        value: raw.value,
        severity: raw.severity,
        isActive: raw.isActive ?? true,
        category: raw.category,
        displayName: raw.displayName.trim(),
        description: normalizeEmptyToNull(raw.description),
        schemaVersion: raw.schemaVersion ?? 1,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return { isValid: true, data: constraint, errors: [] };
}

// --- Preferences Validation ---

export function validatePreferences(raw: any): ValidationResult<UserPreferences> {
    const errors: ValidationError[] = [];

    // Required fields
    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }

    // Recovery style validation
    const validRecoveryStyles: RecoveryStyle[] = ['passive', 'active', 'mixed'];
    if (!raw.preferredRecoveryStyle || !validRecoveryStyles.includes(raw.preferredRecoveryStyle)) {
        errors.push({ 
            field: 'preferredRecoveryStyle', 
            message: `Preferred recovery style must be one of: ${validRecoveryStyles.join(', ')}` 
        });
    }

    // Time preferences validation
    if (!isInRange(raw.defaultWeekdayTimeMin, 1, 1440) || !Number.isInteger(raw.defaultWeekdayTimeMin)) {
        errors.push({
            field: 'defaultWeekdayTimeMin',
            message: 'Default weekday time must be a whole number between 1 and 1440 minutes'
        });
    }

    if (!isInRange(raw.defaultWeekendTimeMin, 1, 1440) || !Number.isInteger(raw.defaultWeekendTimeMin)) {
        errors.push({
            field: 'defaultWeekendTimeMin',
            message: 'Default weekend time must be a whole number between 1 and 1440 minutes'
        });
    }

    // Time of day validation
    const validTimesOfDay: TimeOfDay[] = ['morning', 'midday', 'evening', 'flexible'];
    if (!raw.preferredTimeOfDay || !validTimesOfDay.includes(raw.preferredTimeOfDay)) {
        errors.push({ 
            field: 'preferredTimeOfDay', 
            message: `Preferred time of day must be one of: ${validTimesOfDay.join(', ')}` 
        });
    }

    // Modality arrays validation
    if (!Array.isArray(raw.preferredModalities)) {
        errors.push({
            field: 'preferredModalities',
            message: 'Preferred modalities must be an array'
        });
    } else if (!raw.preferredModalities.every((m: any) => typeof m === 'string')) {
        errors.push({
            field: 'preferredModalities',
            message: 'All preferred modalities must be strings'
        });
    }

    if (!Array.isArray(raw.avoidedModalities)) {
        errors.push({
            field: 'avoidedModalities',
            message: 'Avoided modalities must be an array'
        });
    } else if (!raw.avoidedModalities.every((m: any) => typeof m === 'string')) {
        errors.push({
            field: 'avoidedModalities',
            message: 'All avoided modalities must be strings'
        });
    }

    if (raw.deprioritizedModalities !== undefined) {
        if (!Array.isArray(raw.deprioritizedModalities)) {
            errors.push({
                field: 'deprioritizedModalities',
                message: 'Deprioritized modalities must be an array'
            });
        } else if (!raw.deprioritizedModalities.every((m: any) => typeof m === 'string')) {
            errors.push({
                field: 'deprioritizedModalities',
                message: 'All deprioritized modalities must be strings'
            });
        }
    }

    // Explanation verbosity validation
    const validVerbosity: ExplanationVerbosity[] = ['brief', 'detailed', 'technical'];
    if (!raw.explanationVerbosity || !validVerbosity.includes(raw.explanationVerbosity)) {
        errors.push({ 
            field: 'explanationVerbosity', 
            message: `Explanation verbosity must be one of: ${validVerbosity.join(', ')}` 
        });
    }

    if (raw.conservativeBias !== undefined && typeof raw.conservativeBias !== 'boolean') {
        errors.push({
            field: 'conservativeBias',
            message: 'Conservative bias must be a boolean'
        });
    }

    // Preferred units validation
    if (!raw.preferredUnits || typeof raw.preferredUnits !== 'object') {
        errors.push({
            field: 'preferredUnits',
            message: 'Preferred units object is required'
        });
    } else {
        const validDistance = ['km', 'miles'];
        const validWeight = ['kg', 'lbs'];
        const validTemperature = ['celsius', 'fahrenheit'];

        if (!validDistance.includes(raw.preferredUnits.distance)) {
            errors.push({
                field: 'preferredUnits.distance',
                message: `Distance unit must be one of: ${validDistance.join(', ')}`
            });
        }

        if (!validWeight.includes(raw.preferredUnits.weight)) {
            errors.push({
                field: 'preferredUnits.weight',
                message: `Weight unit must be one of: ${validWeight.join(', ')}`
            });
        }

        if (!validTemperature.includes(raw.preferredUnits.temperature)) {
            errors.push({
                field: 'preferredUnits.temperature',
                message: `Temperature unit must be one of: ${validTemperature.join(', ')}`
            });
        }
    }

    if (raw.performanceProfile !== undefined) {
        if (typeof raw.performanceProfile !== 'object' || raw.performanceProfile === null) {
            errors.push({ field: 'performanceProfile', message: 'Performance profile must be an object' });
        } else {
            for (const key of ['ftpWatts', 'thresholdPaceSecPerKm', 'lthrBpm'] as const) {
                const value = raw.performanceProfile[key];
                if (value !== undefined && value !== null && (!Number.isFinite(value) || value <= 0)) {
                    errors.push({ field: `performanceProfile.${key}`, message: 'Must be a positive number when supplied' });
                }
            }
            if (raw.performanceProfile.targetSources !== undefined &&
                (typeof raw.performanceProfile.targetSources !== 'object' || raw.performanceProfile.targetSources === null ||
                 !Object.entries(raw.performanceProfile.targetSources).every(([key, value]) =>
                    ['ftpWatts', 'thresholdPaceSecPerKm', 'lthrBpm'].includes(key) && (value === 'garmin' || value === 'manual')))) {
                errors.push({ field: 'performanceProfile.targetSources', message: 'Target sources must be manual or garmin for a supported target' });
            }
            if (raw.performanceProfile.garmin !== undefined) {
                const garmin = raw.performanceProfile.garmin;
                if (typeof garmin !== 'object' || garmin === null || typeof garmin.fetchedAt !== 'string') {
                    errors.push({ field: 'performanceProfile.garmin', message: 'Garmin profile must include a fetchedAt timestamp' });
                } else {
                    for (const key of ['ftpWatts', 'thresholdPaceSecPerKm', 'lthrBpm'] as const) {
                        const value = garmin[key];
                        if (value !== undefined && value !== null && (!Number.isFinite(value) || value <= 0)) {
                            errors.push({ field: `performanceProfile.garmin.${key}`, message: 'Must be a positive number when supplied' });
                        }
                    }
                }
            }
            if (raw.performanceProfile.estimated1RmKg !== undefined &&
                (typeof raw.performanceProfile.estimated1RmKg !== 'object' ||
                 !Object.values(raw.performanceProfile.estimated1RmKg).every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0))) {
                errors.push({ field: 'performanceProfile.estimated1RmKg', message: 'All estimated 1RM values must be positive numbers' });
            }
        }
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const preferences: UserPreferences = {
        userId: raw.userId,
        preferredRecoveryStyle: raw.preferredRecoveryStyle,
        defaultWeekdayTimeMin: raw.defaultWeekdayTimeMin,
        defaultWeekendTimeMin: raw.defaultWeekendTimeMin,
        preferredTimeOfDay: raw.preferredTimeOfDay,
        preferredModalities: raw.preferredModalities,
        deprioritizedModalities: raw.deprioritizedModalities ?? [],
        avoidedModalities: raw.avoidedModalities,
        explanationVerbosity: raw.explanationVerbosity,
        conservativeBias: raw.conservativeBias ?? false,
        preferredUnits: raw.preferredUnits,
        ...(raw.performanceProfile ? { performanceProfile: raw.performanceProfile } : {}),
        schemaVersion: raw.schemaVersion ?? 1,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return { isValid: true, data: preferences, errors: [] };
}

// --- Fixed Activity Validation ---

const STIMULUS_AXES: (keyof WorkoutStimulusProfile)[] = [
    'aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges',
    'sprintPower', 'fatigueResistance', 'maxStrength', 'hypertrophy',
];

const COST_DIMENSIONS: (keyof WorkoutCostProfile)[] = [
    'systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular',
];

const TRAINING_ENVIRONMENTS: TrainingEnvironment[] = ['indoor', 'outdoor', 'either'];

const MAX_EQUIPMENT_ITEMS = 20;
const MAX_EQUIPMENT_ITEM_LENGTH = 50;

/** Every key must be a recognized axis and every value a finite 0..1 number -- mirrors
 *  firestore.rules' hasValidExpectedStimulus/hasValidExpectedCost, which can bound a
 *  map's keys and size but (per the 5.3 storage contract) cannot iterate a list to type
 *  check items, so equipment item type/length is enforced here, not just at the rule. */
function validateProfileMap<K extends string>(
    raw: any,
    axes: readonly K[],
    field: string,
    errors: ValidationError[]
): Partial<Record<K, number>> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field, message: `${field} must be an object` });
        return undefined;
    }
    const keys = Object.keys(raw);
    const result: Partial<Record<K, number>> = {};
    for (const key of keys) {
        if (!(axes as readonly string[]).includes(key)) {
            errors.push({ field, message: `${field} has unrecognized key '${key}'` });
            continue;
        }
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
            errors.push({ field, message: `${field}.${key} must be a number in [0, 1]` });
            continue;
        }
        result[key as K] = value;
    }
    return result;
}

/** Phase 6.2b / D6-B: a TRUE day-wide restriction, deliberately separate from and
 *  independently validated from the activity's own `environment`/`equipment` above --
 *  see FixedActivity's own doc comment in models.ts. Mirrors firestore.rules'
 *  hasValidAvailabilityContextOverride, which this must stay aligned with. */
function validateAvailabilityContextOverride(
    raw: any,
    errors: ValidationError[]
): FixedActivity['availabilityContextOverride'] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: 'availabilityContextOverride', message: 'availabilityContextOverride must be an object' });
        return undefined;
    }
    const allowedKeys = ['environment', 'equipment'];
    const extraKeys = Object.keys(raw).filter(key => !allowedKeys.includes(key));
    if (extraKeys.length > 0) {
        errors.push({ field: 'availabilityContextOverride', message: `availabilityContextOverride has unrecognized key(s): ${extraKeys.join(', ')}` });
    }

    let environment: TrainingEnvironment | undefined;
    if (raw.environment !== undefined) {
        if (!TRAINING_ENVIRONMENTS.includes(raw.environment)) {
            errors.push({ field: 'availabilityContextOverride.environment', message: `environment must be one of: ${TRAINING_ENVIRONMENTS.join(', ')}` });
        } else {
            environment = raw.environment;
        }
    }

    let equipment: string[] | undefined;
    if (raw.equipment !== undefined) {
        if (!Array.isArray(raw.equipment) || raw.equipment.length > MAX_EQUIPMENT_ITEMS) {
            errors.push({ field: 'availabilityContextOverride.equipment', message: `equipment must be a list of at most ${MAX_EQUIPMENT_ITEMS} items` });
        } else if (raw.equipment.some((item: unknown) => typeof item !== 'string' || item.length > MAX_EQUIPMENT_ITEM_LENGTH)) {
            errors.push({ field: 'availabilityContextOverride.equipment', message: `Every equipment item must be a string of at most ${MAX_EQUIPMENT_ITEM_LENGTH} characters` });
        } else {
            equipment = raw.equipment;
        }
    }

    if (environment === undefined && equipment === undefined) return undefined;
    return {
        ...(environment !== undefined ? { environment } : {}),
        ...(equipment !== undefined ? { equipment } : {}),
    };
}

export function validateFixedActivity(raw: any): ValidationResult<FixedActivity> {
    const errors: ValidationError[] = [];

    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.title || typeof raw.title !== 'string' || raw.title.trim() === '') {
        errors.push({ field: 'title', message: 'Title is required' });
    } else if (raw.title.length > 200) {
        errors.push({ field: 'title', message: 'Title must be 200 characters or fewer' });
    }
    if (!raw.date || typeof raw.date !== 'string' || !isValidDate(raw.date)) {
        errors.push({ field: 'date', message: 'Date must be a valid date (YYYY-MM-DD)' });
    }
    if (!Number.isInteger(raw.durationMin) || raw.durationMin <= 0 || raw.durationMin > 1440) {
        errors.push({ field: 'durationMin', message: 'Duration must be an integer between 1 and 1440 minutes' });
    }
    if (typeof raw.fixed !== 'boolean') {
        errors.push({ field: 'fixed', message: 'fixed (movable vs immovable) is required' });
    }
    if (!raw.environment || !TRAINING_ENVIRONMENTS.includes(raw.environment)) {
        errors.push({ field: 'environment', message: `Environment must be one of: ${TRAINING_ENVIRONMENTS.join(', ')}` });
    }
    if (typeof raw.isCompleted !== 'boolean') {
        errors.push({ field: 'isCompleted', message: 'isCompleted is required' });
    }

    let equipment: string[] = [];
    if (raw.equipment !== undefined) {
        if (!Array.isArray(raw.equipment) || raw.equipment.length > MAX_EQUIPMENT_ITEMS) {
            errors.push({ field: 'equipment', message: `equipment must be a list of at most ${MAX_EQUIPMENT_ITEMS} items` });
        } else if (raw.equipment.some((item: unknown) => typeof item !== 'string' || item.length > MAX_EQUIPMENT_ITEM_LENGTH)) {
            errors.push({ field: 'equipment', message: `Every equipment item must be a string of at most ${MAX_EQUIPMENT_ITEM_LENGTH} characters` });
        } else {
            equipment = raw.equipment;
        }
    }

    if (raw.startTime !== undefined && raw.startTime !== null && typeof raw.startTime !== 'string') {
        errors.push({ field: 'startTime', message: 'startTime must be a string' });
    }

    if (raw.availabilityOverride !== undefined && raw.availabilityOverride !== null) {
        if (typeof raw.availabilityOverride !== 'number' || !Number.isFinite(raw.availabilityOverride) || raw.availabilityOverride < 0 || raw.availabilityOverride > 1440) {
            errors.push({ field: 'availabilityOverride', message: 'availabilityOverride must be a number of minutes in [0, 1440]' });
        }
    }

    const expectedStimulus = validateProfileMap(raw.expectedStimulus, STIMULUS_AXES, 'expectedStimulus', errors);
    const expectedCost = validateProfileMap(raw.expectedCost, COST_DIMENSIONS, 'expectedCost', errors);
    const availabilityContextOverride = validateAvailabilityContextOverride(raw.availabilityContextOverride, errors);

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const activity: FixedActivity = {
        id: raw.id ?? '',
        userId: raw.userId,
        title: raw.title.trim(),
        date: raw.date,
        durationMin: raw.durationMin,
        fixed: raw.fixed,
        environment: raw.environment,
        equipment,
        isCompleted: raw.isCompleted,
        ...(raw.startTime ? { startTime: raw.startTime } : {}),
        ...(expectedStimulus && Object.keys(expectedStimulus).length > 0 ? { expectedStimulus } : {}),
        ...(expectedCost && Object.keys(expectedCost).length > 0 ? { expectedCost } : {}),
        ...(typeof raw.availabilityOverride === 'number' ? { availabilityOverride: raw.availabilityOverride } : {}),
        ...(availabilityContextOverride ? { availabilityContextOverride } : {}),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    return { isValid: true, data: activity, errors: [] };
}

// --- Daily Recommendation Validation ---

export function validateRecommendation(raw: any): ValidationResult<DailyRecommendation> {
    const errors: ValidationError[] = [];

    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.date || !isValidDate(raw.date)) {
        errors.push({ field: 'date', message: 'Date must be a valid date (YYYY-MM-DD)' });
    }
    if (!raw.templateId || typeof raw.templateId !== 'string') {
        errors.push({ field: 'templateId', message: 'Template ID is required' });
    }
    if (!raw.templateTitle || typeof raw.templateTitle !== 'string') {
        errors.push({ field: 'templateTitle', message: 'Template title is required' });
    }
    if (!raw.category || typeof raw.category !== 'string') {
        errors.push({ field: 'category', message: 'Category is required' });
    }
    if (!raw.modality || typeof raw.modality !== 'string') {
        errors.push({ field: 'modality', message: 'Modality is required' });
    }
    const validModes = ['train', 'modify', 'recover'];
    if (!raw.mode || !validModes.includes(raw.mode)) {
        errors.push({ field: 'mode', message: `Mode must be one of: ${validModes.join(', ')}` });
    }
    if (typeof raw.rationale !== 'string') {
        errors.push({ field: 'rationale', message: 'Rationale must be a string' });
    }
    if (raw.prescription !== undefined) {
        if (typeof raw.prescription !== 'object' || !raw.prescription.workoutId || !Array.isArray(raw.prescription.displayBlocks)) {
            errors.push({ field: 'prescription', message: 'Prescription must include a workout id and display blocks' });
        }
    }

    let recommendationAudit: DailyRecommendation['recommendationAudit'] | undefined;
    if (raw.recommendationAudit !== undefined) {
        const audit = raw.recommendationAudit;
        const validStatuses = ['AVAILABLE', 'MISSING', 'INVALID', 'UNAVAILABLE'];
        const validTiers = ['Rest', 'Mobility', 'Easy', 'Moderate', 'Hard'];
        const validDose = (dose: unknown) => dose && typeof dose === 'object'
            && typeof (dose as Record<string, unknown>).volume === 'number'
            && Number.isFinite((dose as Record<string, number>).volume)
            && (dose as Record<string, number>).volume >= 0
            && (dose as Record<string, number>).volume <= 1
            && typeof (dose as Record<string, unknown>).intensity === 'number'
            && Number.isFinite((dose as Record<string, number>).intensity)
            && (dose as Record<string, number>).intensity >= 0
            && (dose as Record<string, number>).intensity <= 1.2;
        const validAudit = audit && typeof audit === 'object'
            && typeof audit.policyVersion === 'string'
            && typeof audit.evaluatedAt === 'string'
            && typeof audit.decisionContextRevision === 'string'
            && audit.safetyStatus === 'complete'
            && audit.history && typeof audit.history === 'object'
            && Number.isInteger(audit.history.completedEventCount) && audit.history.completedEventCount >= 0
            && Number.isInteger(audit.history.unmatchedEventCount) && audit.history.unmatchedEventCount >= 0
            && audit.history.sourceStatuses && typeof audit.history.sourceStatuses === 'object'
            && ['activities', 'recommendations', 'manualTraining'].every(key => validStatuses.includes(audit.history.sourceStatuses[key]))
            && audit.envelope && typeof audit.envelope === 'object'
            && Number.isInteger(audit.envelope.safetyRestrictedModalityCount) && audit.envelope.safetyRestrictedModalityCount >= 0
            && validTiers.includes(audit.envelope.planMaxAllowableTier)
            && (audit.plannedDose === undefined || validDose(audit.plannedDose))
            && (audit.executionDose === undefined || validDose(audit.executionDose))
            && Array.isArray(audit.candidateScores)
            && audit.candidateScores.every((candidate: any) => candidate && typeof candidate.templateId === 'string'
                && typeof candidate.utilityScore === 'number' && Number.isFinite(candidate.utilityScore)
                && Array.isArray(candidate.excludedReasons) && candidate.excludedReasons.every((reason: any) => typeof reason === 'string'));
        if (!validAudit) {
            errors.push({ field: 'recommendationAudit', message: 'Recommendation audit has an invalid shape' });
        } else {
            recommendationAudit = audit as DailyRecommendation['recommendationAudit'];
        }
    }
    if (raw.schemaVersion === 3 && !recommendationAudit) {
        errors.push({ field: 'recommendationAudit', message: 'Schema version 3 requires a recommendation audit' });
    }

    if (raw.revision !== undefined) {
        if (!Number.isInteger(raw.revision) || raw.revision < 1) {
            errors.push({ field: 'revision', message: 'Revision must be a positive integer' });
        }
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const existingAdherence = raw.adherence ?? {};
    let adjustment = undefined;
    if (raw.adjustment && typeof raw.adjustment === 'object') {
        adjustment = {
            direction: raw.adjustment.direction,
            tier: raw.adjustment.tier,
            originalTemplateId: raw.adjustment.originalTemplateId,
            originalTemplateTitle: raw.adjustment.originalTemplateTitle,
            adjustedDoseLabel: raw.adjustment.adjustedDoseLabel,
            athleteReason: raw.adjustment.athleteReason,
            rationale: raw.adjustment.rationale
        };
    }

    const recommendation: DailyRecommendation = {
        userId: raw.userId,
        date: raw.date,
        templateId: raw.templateId,
        templateTitle: raw.templateTitle,
        category: raw.category,
        modality: raw.modality,
        mode: raw.mode,
        rationale: raw.rationale,
        schemaVersion: raw.schemaVersion ?? (recommendationAudit ? 3 : (raw.prescription ? 2 : 1)),
        ...(raw.revision !== undefined ? { revision: raw.revision } : {}),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(raw.prescription ? { prescription: raw.prescription } : {}),
        ...(adjustment ? { adjustment } : {}),
        ...(recommendationAudit ? { recommendationAudit } : {}),
        adherence: {
            respondedAt: existingAdherence.respondedAt ?? null,
            followed: existingAdherence.followed ?? null,
            actualModality: normalizeEmptyToNull(existingAdherence.actualModality),
            actualDurationMin: existingAdherence.actualDurationMin ?? null,
            skipped: existingAdherence.skipped ?? false,
            notes: normalizeEmptyToNull(existingAdherence.notes)
        }
    };

    return { isValid: true, data: recommendation, errors: [] };
}

/** Validates just the adherence-answer payload (a merge-patch onto an existing
 *  DailyRecommendation doc, not a full document). */
export function validateAdherenceUpdate(raw: any): ValidationResult<DailyRecommendation['adherence']> {
    const errors: ValidationError[] = [];

    if (typeof raw.followed !== 'boolean') {
        errors.push({ field: 'followed', message: 'followed must be a boolean' });
    }
    if (raw.skipped !== undefined && typeof raw.skipped !== 'boolean') {
        errors.push({ field: 'skipped', message: 'skipped must be a boolean' });
    }
    if (raw.actualDurationMin !== undefined && raw.actualDurationMin !== null) {
        if (typeof raw.actualDurationMin !== 'number' || raw.actualDurationMin < 0) {
            errors.push({ field: 'actualDurationMin', message: 'actualDurationMin must be a non-negative number' });
        }
    }
    if (raw.actualModality !== undefined && raw.actualModality !== null && typeof raw.actualModality !== 'string') {
        errors.push({ field: 'actualModality', message: 'actualModality must be a string' });
    }
    if (raw.notes !== undefined && raw.notes !== null && typeof raw.notes !== 'string') {
        errors.push({ field: 'notes', message: 'notes must be a string' });
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const adherence: DailyRecommendation['adherence'] = {
        respondedAt: new Date().toISOString(),
        followed: raw.followed,
        actualModality: normalizeEmptyToNull(raw.actualModality),
        actualDurationMin: raw.actualDurationMin ?? null,
        skipped: raw.skipped ?? false,
        notes: normalizeEmptyToNull(raw.notes)
    };

    return { isValid: true, data: adherence, errors: [] };
}

export function validateAuthoredPlanBlock(raw: any): ValidationResult<AuthoredPlanBlock> {
    const errors: ValidationError[] = [];
    if (!raw.userId || typeof raw.userId !== 'string') errors.push({ field: 'userId', message: 'User ID is required' });
    if (raw.phase !== 'travel') errors.push({ field: 'phase', message: 'Only explicit travel blocks are supported' });
    if (!isValidDate(raw.startDate) || !isValidDate(raw.endDate) || raw.startDate > raw.endDate) errors.push({ field: 'dates', message: 'Travel block dates must be valid and ordered' });
    if (typeof raw.volumeScale !== 'number' || raw.volumeScale < 0 || raw.volumeScale > 1) errors.push({ field: 'volumeScale', message: 'Volume scale must be between 0 and 1' });
    if (typeof raw.intensityScale !== 'number' || raw.intensityScale < 0 || raw.intensityScale > 1) errors.push({ field: 'intensityScale', message: 'Intensity scale must be between 0 and 1' });
    if (raw.eventId !== undefined && raw.eventId !== null && typeof raw.eventId !== 'string') errors.push({ field: 'eventId', message: 'Event ID must be a string or empty' });
    if (errors.length > 0) return { isValid: false, errors };
    const now = new Date().toISOString();
    return { isValid: true, errors: [], data: {
        id: typeof raw.id === 'string' ? raw.id : '', userId: raw.userId, phase: 'travel', startDate: raw.startDate, endDate: raw.endDate,
        volumeScale: raw.volumeScale, intensityScale: raw.intensityScale, ...(raw.eventId ? { eventId: raw.eventId } : {}),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now, updatedAt: now,
    } };
}

const TRAINING_INTENT_PROFILE_KEYS = [
    'userId', 'planningMode', 'priorities', 'weeklyCommitment', 'organizationPreference',
    'schemaVersion', 'createdAt', 'updatedAt',
] as const;
const TRAINING_PRIORITIES: TrainingPriority[] = [
    'health', 'balanced_performance', 'endurance', 'strength_muscle', 'speed_power', 'sport_readiness',
];

/** Strict boundary for `users/{userId}/training_intent/profile`. Per-day duration and
 * execution preferences intentionally remain validated by `validatePreferences`. */
export function validateTrainingIntentProfile(raw: any): ValidationResult<TrainingIntentProfile> {
    const errors: ValidationError[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { isValid: false, errors: [{ field: 'profile', message: 'Profile must be an object' }] };
    const keys = Object.keys(raw);
    const extra = keys.filter(key => !(TRAINING_INTENT_PROFILE_KEYS as readonly string[]).includes(key));
    const missing = TRAINING_INTENT_PROFILE_KEYS.filter(key => !(key in raw));
    if (extra.length) errors.push({ field: 'profile', message: `Unrecognized profile field(s): ${extra.join(', ')}` });
    if (missing.length) errors.push({ field: 'profile', message: `Missing profile field(s): ${missing.join(', ')}` });
    if (typeof raw.userId !== 'string' || !raw.userId) errors.push({ field: 'userId', message: 'User ID is required' });
    if (!(['evergreen', 'event_directed'] as PlanningMode[]).includes(raw.planningMode)) errors.push({ field: 'planningMode', message: 'Planning mode must be evergreen or event_directed' });
    if (!Array.isArray(raw.priorities) || raw.priorities.some((priority: unknown) => !TRAINING_PRIORITIES.includes(priority as TrainingPriority))
        || new Set(raw.priorities).size !== raw.priorities.length) {
        errors.push({ field: 'priorities', message: 'Priorities must be unique supported values' });
    }
    const commitment = raw.weeklyCommitment;
    if (!commitment || typeof commitment !== 'object' || Array.isArray(commitment)
        || Object.keys(commitment).length !== 3 || !['minSessions', 'targetSessions', 'maxSessions'].every(key => key in commitment)) {
        errors.push({ field: 'weeklyCommitment', message: 'Weekly commitment must contain exactly minSessions, targetSessions and maxSessions' });
    } else {
        const values = [commitment.minSessions, commitment.targetSessions, commitment.maxSessions];
        if (values.some(value => !Number.isInteger(value) || value < 1 || value > 14)
            || commitment.minSessions > commitment.targetSessions || commitment.targetSessions > commitment.maxSessions) {
            errors.push({ field: 'weeklyCommitment', message: 'Session counts must be integers 1..14 with min <= target <= max' });
        }
    }
    if (raw.organizationPreference !== 'auto') errors.push({ field: 'organizationPreference', message: 'Only auto organization is supported' });
    if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) errors.push({ field: 'schemaVersion', message: 'Schema version must be a positive integer' });
    if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') errors.push({ field: 'timestamps', message: 'createdAt and updatedAt must be strings' });
    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as TrainingIntentProfile };
}
