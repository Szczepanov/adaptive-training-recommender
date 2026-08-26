/* eslint-disable @typescript-eslint/no-explicit-any -- validating untrusted raw ingestion payloads, matching engine/validationCore.ts's own convention */

export interface IngestionSnapshotContractResult {
    valid: boolean;
    errors: string[];
}

export function validateIngestionSnapshotContract(snapshot: unknown): IngestionSnapshotContractResult {
    const errors: string[] = [];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { valid: false, errors: ['Snapshot must be a non-null object'] };
    }

    const s = snapshot as Record<string, any>;
    if (typeof s.userId !== 'string' || !s.userId.trim()) {
        errors.push('userId must be a non-empty string');
    }
    if (typeof s.date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.date)) {
        errors.push('date must match YYYY-MM-DD format');
    }

    // Source block
    if (!s.source || typeof s.source !== 'object') {
        errors.push('source metadata block is required');
    } else {
        if (![2, 3].includes(s.source.sourceSchemaVersion)) {
            errors.push('sourceSchemaVersion must be 2 or 3, got ' + s.source.sourceSchemaVersion);
        }
        if (typeof s.source.garminSyncedAt !== 'string' || !s.source.garminSyncedAt) {
            errors.push('source.garminSyncedAt must be a valid ISO-8601 string');
        }
    }

    // Raw metrics block
    if (!s.raw || typeof s.raw !== 'object') {
        errors.push('raw metrics block is required');
    } else {
        const r = s.raw;
        if (r.sleepScore !== null && r.sleepScore !== undefined && (typeof r.sleepScore !== 'number' || r.sleepScore < 0 || r.sleepScore > 100)) {
            errors.push('raw.sleepScore must be null or [0, 100]');
        }
        if (r.restingHr !== null && r.restingHr !== undefined && (typeof r.restingHr !== 'number' || r.restingHr < 20 || r.restingHr > 240)) {
            errors.push('raw.restingHr must be null or [20, 240]');
        }
        if (r.hrvOvernightAvg !== null && r.hrvOvernightAvg !== undefined && (typeof r.hrvOvernightAvg !== 'number' || r.hrvOvernightAvg < 0 || r.hrvOvernightAvg > 350)) {
            errors.push('raw.hrvOvernightAvg must be null or [0, 350]');
        }
        if (r.respirationAvg !== null && r.respirationAvg !== undefined && (typeof r.respirationAvg !== 'number' || r.respirationAvg < 4 || r.respirationAvg > 50)) {
            errors.push('raw.respirationAvg must be null or [4, 50]');
        }
        if (r.totalSteps !== null && r.totalSteps !== undefined && (typeof r.totalSteps !== 'number' || r.totalSteps < 0)) {
            errors.push('raw.totalSteps must be null or non-negative number');
        }
        if (r.bodyBatteryWake !== null && r.bodyBatteryWake !== undefined && (typeof r.bodyBatteryWake !== 'number' || r.bodyBatteryWake < 0 || r.bodyBatteryWake > 100)) {
            errors.push('raw.bodyBatteryWake must be null or [0, 100]');
        }
        if (typeof r.last3DaysHardSessionsCount !== 'number' || r.last3DaysHardSessionsCount < 0) {
            errors.push('raw.last3DaysHardSessionsCount must be a non-negative integer');
        }
    }

    // Derived metrics block
    if (!s.derived || typeof s.derived !== 'object') {
        errors.push('derived metrics block is required');
    } else {
        const d = s.derived;
        if (!d.deltas || typeof d.deltas !== 'object') {
            errors.push('derived.deltas block is required');
        }
    }

    // Data quality block
    if (!s.dataQuality || typeof s.dataQuality !== 'object') {
        errors.push('dataQuality block is required');
    } else {
        const dq = s.dataQuality;
        const requiredFlags = ['sleepScoreAvailable', 'restingHrAvailable', 'hrvAvailable', 'baseline7dReady', 'baseline28dReady'];
        for (const flag of requiredFlags) {
            if (typeof dq[flag] !== 'boolean') {
                errors.push('dataQuality.' + flag + ' must be a boolean');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

export function validateNormalizedActivityContract(activity: unknown): IngestionSnapshotContractResult {
    const errors: string[] = [];
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)) {
        return { valid: false, errors: ['Activity must be a non-null object'] };
    }

    const a = activity as Record<string, any>;
    if (typeof a.activityId !== 'string' || !a.activityId.trim()) {
        errors.push('activityId must be a non-empty string');
    }
    if (a.date !== null && a.date !== undefined && (typeof a.date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a.date))) {
        errors.push('date must match YYYY-MM-DD format if provided');
    }
    if (typeof a.type !== 'string' || !a.type.trim()) {
        errors.push('type must be a non-empty string');
    }
    if (typeof a.durationMin !== 'number' || a.durationMin < 0) {
        errors.push('durationMin must be a non-negative number');
    }
    if (typeof a.intensityTag !== 'string' || !a.intensityTag.trim()) {
        errors.push('intensityTag must be a non-empty string');
    }
    if (typeof a.syncRunId !== 'string' || !a.syncRunId.trim()) {
        errors.push('syncRunId must be a non-empty string');
    }
    if (typeof a.syncedAt !== 'string' || !a.syncedAt.trim()) {
        errors.push('syncedAt must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
}
