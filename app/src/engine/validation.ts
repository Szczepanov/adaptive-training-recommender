import type {
    DailySubjectiveCheckin,
    UserGoal,
    UserConstraint,
    UserPreferences,
    GoalCategory,
    GoalDomain,
    GoalStatus,
    ConstraintType,
    ConstraintSeverity,
    ConstraintCategory,
    RecoveryStyle,
    TimeOfDay,
    ExplanationVerbosity
} from './models';

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

function isValidDate(date: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(date)) return false;
    const d = new Date(date);
    return d instanceof Date && !isNaN(d.getTime());
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
    const booleanFlags = ['painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime'];
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
        availability: {
            timeAvailableMin: normalizeEmptyToNull(raw.availability?.timeAvailableMin),
            preferredModalityToday: normalizeEmptyToNull(raw.availability?.preferredModalityToday),
            indoorOnly: raw.availability?.indoorOnly ?? false
        },
        notes: notes,
        submittedAt: raw.submittedAt || new Date().toISOString(),
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

    // Category validation
    const validCategories: GoalCategory[] = ['short-term', 'mid-term', 'long-term'];
    if (!raw.category || !validCategories.includes(raw.category)) {
        errors.push({ 
            field: 'category', 
            message: `Category must be one of: ${validCategories.join(', ')}` 
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

    if (raw.targetDate !== undefined) {
        const date = normalizeEmptyToNull(raw.targetDate);
        if (date !== null && !isValidDate(date)) {
            errors.push({
                field: 'targetDate',
                message: 'Target date must be a valid date (YYYY-MM-DD) or empty'
            });
        }
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const goal: UserGoal = {
        userId: raw.userId,
        category: raw.category,
        domain: raw.domain,
        title: raw.title.trim(),
        description: normalizeEmptyToNull(raw.description),
        priority: raw.priority,
        status: raw.status,
        targetMetric: normalizeEmptyToNull(raw.targetMetric),
        targetValue: normalizeEmptyToNull(raw.targetValue),
        targetUnit: normalizeEmptyToNull(raw.targetUnit),
        targetDate: normalizeEmptyToNull(raw.targetDate),
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
    if (!isInRange(raw.defaultWeekdayTimeMin, 0, 1440) || !Number.isInteger(raw.defaultWeekdayTimeMin)) {
        errors.push({
            field: 'defaultWeekdayTimeMin',
            message: 'Default weekday time must be a whole number between 0 and 1440 minutes'
        });
    }

    if (!isInRange(raw.defaultWeekendTimeMin, 0, 1440) || !Number.isInteger(raw.defaultWeekendTimeMin)) {
        errors.push({
            field: 'defaultWeekendTimeMin',
            message: 'Default weekend time must be a whole number between 0 and 1440 minutes'
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

    if (raw.explanationStyle !== undefined && !validVerbosity.includes(raw.explanationStyle)) {
        errors.push({
            field: 'explanationStyle',
            message: `Explanation style must be one of: ${validVerbosity.join(', ')}`
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
        deprioritizedModalities: raw.deprioritizedModalities ?? raw.avoidedModalities,
        avoidedModalities: raw.avoidedModalities,
        explanationStyle: raw.explanationStyle ?? raw.explanationVerbosity,
        explanationVerbosity: raw.explanationVerbosity,
        conservativeBias: raw.conservativeBias ?? false,
        preferredUnits: raw.preferredUnits,
        schemaVersion: raw.schemaVersion ?? 1,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return { isValid: true, data: preferences, errors: [] };
}
