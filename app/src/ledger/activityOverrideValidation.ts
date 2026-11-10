/**
 * Write-side validator for `users/{uid}/activity_overrides/{activityId}` (issue #1202,
 * ADR-0053). `ActivityOverrideService.saveOverride` runs {@link assertValidActivityOverride}
 * before its whole-document `setDoc`; the Firestore rules keep ownership, the activityId
 * binding, the key allow-lists, the string caps and the update immutability, and no longer
 * check the values below.
 *
 * Self-contained on purpose: `ledger/` may not import from `engine/`
 * (`models.architecture.test.ts`), so the calendar-date check is repeated here.
 */
import type { ActivityOverride } from './models';

export interface ActivityOverrideIssue {
    path: string;
    message: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** `Modality` minus 'Walking' / 'None', plus 'Unknown': the set the rules accepted. */
export const OVERRIDE_MODALITIES: readonly string[] = [
    'Running', 'Cycling', 'Swimming', 'Strength', 'Mobility', 'Field', 'Cross Training', 'Unknown',
];
export const OVERRIDE_INTENSITIES: readonly string[] = ['easy', 'moderate', 'hard', 'unknown'];
export const OVERRIDE_STIMULUS_FOCI: readonly string[] = [
    'aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges',
    'sprintPower', 'fatigueResistance', 'maxStrength', 'hypertrophy',
];

function isRealCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_REGEX.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateActivityOverride(raw: unknown): ActivityOverrideIssue[] {
    if (!isObject(raw)) return [{ path: '', message: 'Expected object' }];
    const issues: ActivityOverrideIssue[] = [];

    if (!isRealCalendarDate(raw.date)) {
        issues.push({ path: 'date', message: 'date must be a real YYYY-MM-DD calendar date' });
    }
    if (typeof raw.overriddenModality !== 'string' || !OVERRIDE_MODALITIES.includes(raw.overriddenModality)) {
        issues.push({ path: 'overriddenModality', message: 'overriddenModality is not a recognised modality' });
    }
    if (typeof raw.overriddenIntensity !== 'string' || !OVERRIDE_INTENSITIES.includes(raw.overriddenIntensity)) {
        issues.push({ path: 'overriddenIntensity', message: 'overriddenIntensity is not a recognised intensity' });
    }
    // Number.isFinite also rejects NaN, which a bare `< 1 || > 10` comparison lets through.
    if (raw.rpe !== undefined && raw.rpe !== null
        && !(typeof raw.rpe === 'number' && Number.isFinite(raw.rpe) && raw.rpe >= 1 && raw.rpe <= 10)) {
        issues.push({ path: 'rpe', message: 'rpe must be a finite number between 1 and 10, or null' });
    }
    if (raw.stimulusFocus !== undefined && raw.stimulusFocus !== null
        && !(typeof raw.stimulusFocus === 'string' && OVERRIDE_STIMULUS_FOCI.includes(raw.stimulusFocus))) {
        issues.push({ path: 'stimulusFocus', message: 'stimulusFocus is not a recognised stimulus axis' });
    }
    if (typeof raw.originalIntensityTag !== 'string') {
        issues.push({ path: 'originalIntensityTag', message: 'originalIntensityTag must be a string' });
    }
    return issues;
}

export function assertValidActivityOverride(raw: unknown): asserts raw is ActivityOverride {
    const issues = validateActivityOverride(raw);
    if (issues.length > 0) {
        throw new Error(`Invalid activity override: ${issues.map(issue => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ')}`);
    }
}
