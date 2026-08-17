import type { DataIssue, DataState } from '../../engine/dataState';
import type { IntensityGauge, LoggedExercise, LoggedSet, StrengthSession, StrengthSessionState } from '../../engine/models';
import { isValidDate } from '../../engine/validation';

/** Parses users/{uid}/strength_sessions/{sessionId} (ADR-0021). House style matches
 *  trainingHistory.ts's parseNormalizedGarminActivity: unrecognised keys are ignored, and
 *  a malformed field degrades rather than invalidating the whole read -- but the *scope* of
 *  that degradation differs by nesting level. A malformed top-level field (date, state,
 *  schemaVersion) invalidates the document, matching every other parser in this directory.
 *  A malformed set or exercise is instead dropped from its parent array and the rest of the
 *  session still parses AVAILABLE: D-SETLOG's raw log should survive one bad entry from a
 *  flaky offline write, not vanish along with every other set in the session. */

const STRENGTH_SESSION_STATES: readonly StrengthSessionState[] = ['in_progress', 'completed', 'abandoned'];
const NOTE_MAX_LENGTH = 2000;
const FREE_TEXT_NAME_MAX_LENGTH = 200;

type RawDocument = Record<string, unknown>;

function invalid(documentPath: string, code: string, field?: string, schemaVersion?: number): DataState<never> {
    const issue: DataIssue = { code, documentPath, ...(field ? { field } : {}), ...(schemaVersion !== undefined ? { schemaVersion } : {}) };
    return { status: 'INVALID', issues: [issue] };
}

function isObject(value: unknown): value is RawDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidInstant(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function boundedString(value: unknown, maxLength: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function finiteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Explicit `null` is bodyweight and is accepted. Anything else that isn't a valid
 *  non-negative number is treated as malformed -- silently coercing a corrupt numeric
 *  value to `null` would misreport a real loaded set as bodyweight, which is worse than
 *  dropping the set. */
function parseWeightKg(raw: unknown): { ok: true; value: number | null } | { ok: false } {
    if (raw === null) return { ok: true, value: null };
    if (finiteNumber(raw) && raw >= 0) return { ok: true, value: raw };
    return { ok: false };
}

function parseGauge(raw: unknown): IntensityGauge | undefined {
    if (!isObject(raw) || typeof raw.scale !== 'string') return undefined;
    switch (raw.scale) {
        case 'rir':
        case 'rpe_rts':
            return finiteNumber(raw.value) ? { scale: raw.scale, value: raw.value } : undefined;
        case 'velocity_loss':
            return finiteNumber(raw.percent) && raw.percent >= 0 ? { scale: 'velocity_loss', percent: raw.percent } : undefined;
        case 'technical': {
            if (typeof raw.met !== 'boolean') return undefined;
            const note = boundedString(raw.note, NOTE_MAX_LENGTH);
            return { scale: 'technical', met: raw.met, ...(note !== undefined ? { note } : {}) };
        }
        default:
            return undefined;
    }
}

/** Required fields (setIndex, reps, isWarmup, completedAt) missing or malformed drop the
 *  whole set rather than invalidating the session -- see module docstring. Optional fields
 *  degrade individually. */
function parseSet(raw: unknown): LoggedSet | undefined {
    if (!isObject(raw)) return undefined;
    if (!finiteNumber(raw.setIndex) || raw.setIndex < 1) return undefined;
    if (!finiteNumber(raw.reps) || raw.reps <= 0) return undefined;
    if (typeof raw.isWarmup !== 'boolean') return undefined;
    if (!isValidInstant(raw.completedAt)) return undefined;

    const weightKg = parseWeightKg(raw.weightKg);
    if (!weightKg.ok) return undefined;

    const gauge = parseGauge(raw.gauge);
    const notes = boundedString(raw.notes, NOTE_MAX_LENGTH);

    return {
        setIndex: raw.setIndex,
        weightKg: weightKg.value,
        reps: raw.reps,
        isWarmup: raw.isWarmup,
        completedAt: raw.completedAt,
        ...(gauge !== undefined ? { gauge } : {}),
        ...(notes !== undefined ? { notes } : {}),
    };
}

/** Required fields (exerciseId, sets) missing or malformed drop the whole exercise. A null
 *  exerciseId with no freeTextName is still accepted -- unlabeled is recoverable, losing
 *  the sets is not. */
function parseExercise(raw: unknown): LoggedExercise | undefined {
    if (!isObject(raw)) return undefined;
    if (raw.exerciseId !== null && typeof raw.exerciseId !== 'string') return undefined;
    if (!Array.isArray(raw.sets)) return undefined;

    const sets = raw.sets.map(parseSet).filter((set): set is LoggedSet => set !== undefined);
    const freeTextName = boundedString(raw.freeTextName, FREE_TEXT_NAME_MAX_LENGTH);

    return {
        exerciseId: raw.exerciseId,
        sets,
        ...(freeTextName !== undefined ? { freeTextName } : {}),
    };
}

export function parseStrengthSession(raw: unknown, documentPath: string, documentId: string, userId: string): DataState<StrengthSession> {
    if (!isObject(raw)) return invalid(documentPath, 'not-an-object');

    // Matches decisionInputs.ts's parseDecisionJournalEntry: this collection is
    // client-writable, so the document's own userId is checked against the caller's
    // expected owner as defense in depth alongside the Firestore rules path binding.
    if (raw.userId !== userId) return invalid(documentPath, 'user-id-mismatch', 'userId');

    if (raw.schemaVersion !== 1) {
        return invalid(documentPath, 'unsupported-schema-version', 'schemaVersion', typeof raw.schemaVersion === 'number' ? raw.schemaVersion : undefined);
    }
    if (typeof raw.date !== 'string' || !isValidDate(raw.date)) return invalid(documentPath, 'invalid-date', 'date');
    if (!isValidInstant(raw.startedAt)) return invalid(documentPath, 'invalid-type', 'startedAt');
    if (!isValidInstant(raw.updatedAt)) return invalid(documentPath, 'invalid-type', 'updatedAt');
    if (typeof raw.state !== 'string' || !STRENGTH_SESSION_STATES.includes(raw.state as StrengthSessionState)) {
        return invalid(documentPath, 'invalid-type', 'state');
    }
    if (!Array.isArray(raw.exercises)) return invalid(documentPath, 'invalid-type', 'exercises');

    const sessionId = typeof raw.sessionId === 'string' && raw.sessionId.trim() !== '' ? raw.sessionId : documentId;
    const exercises = raw.exercises.map(parseExercise).filter((exercise): exercise is LoggedExercise => exercise !== undefined);

    const completedAt = isValidInstant(raw.completedAt) ? raw.completedAt : undefined;
    const sourceRecommendationDate = typeof raw.sourceRecommendationDate === 'string' && isValidDate(raw.sourceRecommendationDate) ? raw.sourceRecommendationDate : undefined;
    const sessionRpe = finiteNumber(raw.sessionRpe) && raw.sessionRpe >= 0 && raw.sessionRpe <= 10 ? raw.sessionRpe : undefined;
    const notes = boundedString(raw.notes, NOTE_MAX_LENGTH);

    return {
        status: 'AVAILABLE',
        data: {
            userId,
            sessionId,
            date: raw.date,
            startedAt: raw.startedAt,
            updatedAt: raw.updatedAt,
            state: raw.state as StrengthSessionState,
            exercises,
            schemaVersion: 1,
            ...(completedAt !== undefined ? { completedAt } : {}),
            ...(sourceRecommendationDate !== undefined ? { sourceRecommendationDate } : {}),
            ...(sessionRpe !== undefined ? { sessionRpe } : {}),
            ...(notes !== undefined ? { notes } : {}),
        },
        revision: raw.updatedAt,
    };
}
