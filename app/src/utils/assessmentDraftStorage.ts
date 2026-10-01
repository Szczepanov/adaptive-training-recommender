import type {
    AssessmentTrialScalar,
    MetricObservationDevice,
    ObservationValidity,
} from '../observations/models';

/**
 * Unsaved trial-capture rows for one assessment attempt. Drafts hold personal performance data,
 * so persisted keys are Firebase-UID-scoped and live only until the attempt is saved or abandoned,
 * or the user signs out.
 */
export interface DraftTrialRow {
    ordinal: number;
    values: Record<string, AssessmentTrialScalar>;
    validity: ObservationValidity;
    invalidReason?: string;
    notes?: string;
    device?: MetricObservationDevice;
    /**
     * Replay-stable import provenance (e.g. `wl-analysis-csv:sha256:…`). Absent for
     * hand-typed rows and for drafts saved before the WL Analysis importer existed.
     */
    sourceRef?: string;
    /**
     * Scalar import context (e.g. `wl_parser_version`). Merged over the attempt comparison
     * context when trial records are built; keys must not collide with comparison dimensions.
     */
    context?: Record<string, string | number | boolean | null>;
}

const STORAGE_PREFIX = 'assessment_draft_';

function draftStorageKey(userId: string, attemptId: string): string {
    // ':' is percent-encoded by encodeURIComponent, so '::' is an unambiguous separator.
    return `${STORAGE_PREFIX}${encodeURIComponent(userId)}::${encodeURIComponent(attemptId)}`;
}

const VALID_DRAFT_VALIDITIES = new Set<ObservationValidity>(['valid', 'invalid', 'practice', 'questionable']);

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function isDraftSourceRef(value: unknown): boolean {
    return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 512);
}

function isDraftContext(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 32) return false;
    return entries.every(([key, entryValue]) =>
        key.trim().length > 0
        && (typeof entryValue === 'string'
            || typeof entryValue === 'boolean'
            || entryValue === null
            || (typeof entryValue === 'number' && Number.isFinite(entryValue)))
    );
}
function isDraftDevice(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const device = value as Partial<MetricObservationDevice>;
    return typeof device.provider === 'string'
        && isOptionalString(device.model)
        && isOptionalString(device.deviceId);
}

function isDraftRow(value: unknown): value is DraftTrialRow {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Partial<DraftTrialRow>;
    if (!Number.isInteger(row.ordinal) || (row.ordinal ?? 0) < 1) return false;
    if (!VALID_DRAFT_VALIDITIES.has(row.validity as ObservationValidity)) return false;
    if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) return false;
    if (!Object.entries(row.values).every(([fieldId, fieldValue]) =>
        fieldId.trim().length > 0
        && (typeof fieldValue === 'boolean' || (typeof fieldValue === 'number' && Number.isFinite(fieldValue)))
    )) return false;
    return isOptionalString(row.invalidReason)
        && isOptionalString(row.notes)
        && isDraftDevice(row.device)
        && isDraftSourceRef(row.sourceRef)
        && isDraftContext(row.context);
}

/** Storage can be blocked or cleared (private mode, previews); every accessor degrades to "no draft". */
export function loadAssessmentDraft(userId: string, attemptId: string): DraftTrialRow[] | null {
    try {
        const raw = localStorage.getItem(draftStorageKey(userId, attemptId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isDraftRow)) return parsed;
    } catch {
        // Storage unavailable or corrupted draft: fall back to a fresh capture table.
    }
    return null;
}

export function saveAssessmentDraft(userId: string, attemptId: string, rows: readonly DraftTrialRow[]): void {
    try {
        localStorage.setItem(draftStorageKey(userId, attemptId), JSON.stringify(rows));
    } catch {
        // Storage unavailable: the draft simply does not survive a reload.
    }
}

export function clearAssessmentDraft(userId: string, attemptId: string): void {
    try {
        localStorage.removeItem(draftStorageKey(userId, attemptId));
    } catch {
        // Storage unavailable: nothing was persisted.
    }
}

/** Sign-out cleanup: removes every attempt's draft from this browser profile. */
export function clearAllAssessmentDrafts(): void {
    try {
        const keys: string[] = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
        }
        keys.forEach(key => localStorage.removeItem(key));
    } catch {
        // Storage unavailable: nothing was persisted.
    }
}
