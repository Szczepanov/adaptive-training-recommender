import { MAX_CAPTURE_FIELDS } from './assessmentCapture';
import type {
    AssessmentAttempt,
    AssessmentCaptureDefinition,
    AssessmentTrial,
    MeasurementProtocol,
    ObservationValidity,
} from './models';
import { assertValidMeasurementProtocol } from './protocols';
import { assertObservationContext } from './validation';
import { assertFixedLoadComparisonContext, assertFixedLoadTrialEligibility } from './fixedLoadVelocity';

/** Upper bound on append-only corrections per ordinal; mirrored by `app/firestore.rules`. */
export const MAX_TRIAL_CORRECTIONS = 20;
export const MAX_TRIAL_CONTEXT_KEYS = 32;

const VALIDITIES = new Set<ObservationValidity>(['valid', 'invalid', 'practice', 'questionable']);

/**
 * Deterministic trial document id (ADR-0046 D-AT-CORRECTION). Because the id is a pure
 * function of (ordinal, correctionIndex), a second correction racing the first targets the
 * same immutable document and is rejected rather than forking the chain.
 */
export function assessmentTrialIdFor(ordinal: number, correctionIndex = 0): string {
    return correctionIndex === 0 ? `trial-${ordinal}` : `trial-${ordinal}-c${correctionIndex}`;
}

function assertNonEmpty(value: unknown, label: string, maxLength: number): void {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
    if (value.length > maxLength) throw new Error(`${label} cannot exceed ${maxLength} characters`);
}

function assertTimestamp(value: unknown, label: string): void {
    assertNonEmpty(value, label, 64);
    if (!Number.isFinite(Date.parse(value as string))) throw new Error(`${label} must be a valid timestamp`);
}

function requireCapture(protocol: MeasurementProtocol): AssessmentCaptureDefinition {
    assertValidMeasurementProtocol(protocol);
    if (!protocol.capture) {
        throw new Error(`Protocol ${protocol.id}@${protocol.revision} does not declare trial capture`);
    }
    return protocol.capture;
}

function assertTrialIdentity(trial: AssessmentTrial, capture: AssessmentCaptureDefinition): void {
    assertNonEmpty(trial.assessmentAttemptId, 'assessmentAttemptId', 160);
    if (!Number.isInteger(trial.ordinal) || trial.ordinal < 1 || trial.ordinal > capture.maxTrials) {
        throw new Error(`Trial ordinal must be an integer from 1 to ${capture.maxTrials}`);
    }
    if (!Number.isInteger(trial.correctionIndex) || trial.correctionIndex < 0
        || trial.correctionIndex > MAX_TRIAL_CORRECTIONS) {
        throw new Error(`Trial correctionIndex must be an integer from 0 to ${MAX_TRIAL_CORRECTIONS}`);
    }
    const expectedId = assessmentTrialIdFor(trial.ordinal, trial.correctionIndex);
    if (trial.id !== expectedId) throw new Error(`Trial id must equal ${expectedId}`);

    if (trial.correctionIndex === 0) {
        if (trial.supersedesTrialId !== undefined || trial.correctionReason !== undefined) {
            throw new Error('An original trial cannot declare supersedesTrialId or correctionReason');
        }
        return;
    }
    const expectedSuperseded = assessmentTrialIdFor(trial.ordinal, trial.correctionIndex - 1);
    if (trial.supersedesTrialId !== expectedSuperseded) {
        throw new Error(`Trial correction ${trial.id} must supersede ${expectedSuperseded}`);
    }
    assertNonEmpty(trial.correctionReason, 'correctionReason', 2000);
}

function assertTrialValues(trial: AssessmentTrial, capture: AssessmentCaptureDefinition): void {
    const values = trial.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Trial values must be an object');
    const entries = Object.entries(values);
    if (entries.length > MAX_CAPTURE_FIELDS) throw new Error(`Trial values cannot exceed ${MAX_CAPTURE_FIELDS} fields`);

    const fields = new Map(capture.fields.map(field => [field.id, field] as const));
    for (const [fieldId, value] of entries) {
        const field = fields.get(fieldId);
        if (!field) throw new Error(`Trial field ${fieldId} is not declared by the protocol capture schema`);
        if (field.valueKind === 'boolean') {
            if (typeof value !== 'boolean') throw new Error(`Trial field ${fieldId} requires a boolean`);
            continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`Trial field ${fieldId} requires a finite number in ${field.unit}`);
        }
        if (value < field.minimum || value > field.maximum) {
            throw new Error(`Trial field ${fieldId} must be within ${field.minimum}-${field.maximum} ${field.unit}`);
        }
    }

    // A measured result is only required when the trial claims to be usable evidence; an
    // invalid or practice attempt may legitimately have nothing to measure.
    if (trial.validity === 'valid' || trial.validity === 'questionable') {
        for (const field of capture.fields) {
            if (field.required && !(field.id in values)) {
                throw new Error(`Trial ${trial.id} requires field ${field.id}`);
            }
        }
    }
}

export function assertValidAssessmentTrial(trial: AssessmentTrial, protocol: MeasurementProtocol): void {
    const capture = requireCapture(protocol);
    assertTrialIdentity(trial, capture);
    if (!VALIDITIES.has(trial.validity)) throw new Error(`Unsupported trial validity: ${trial.validity}`);
    if (trial.validity === 'invalid') assertNonEmpty(trial.invalidReason, 'invalidReason', 2000);
    if (trial.invalidReason !== undefined) assertNonEmpty(trial.invalidReason, 'invalidReason', 2000);
    assertTrialValues(trial, capture);

    assertObservationContext(trial.context, 'context');
    assertFixedLoadTrialEligibility(trial, protocol);
    if (Object.keys(trial.context).length > MAX_TRIAL_CONTEXT_KEYS) {
        throw new Error(`Trial context cannot exceed ${MAX_TRIAL_CONTEXT_KEYS} keys`);
    }
    if (trial.performedAt !== undefined) assertTimestamp(trial.performedAt, 'performedAt');
    assertTimestamp(trial.createdAt, 'createdAt');
    if (trial.sourceRef !== undefined) assertNonEmpty(trial.sourceRef, 'sourceRef', 512);
    if (trial.notes !== undefined && trial.notes.length > 4000) throw new Error('Trial notes cannot exceed 4000 characters');
    if (trial.device !== undefined) {
        assertNonEmpty(trial.device.provider, 'device.provider', 128);
        if (trial.device.model !== undefined) assertNonEmpty(trial.device.model, 'device.model', 128);
        if (trial.device.deviceId !== undefined) assertNonEmpty(trial.device.deviceId, 'device.deviceId', 256);
    }
}

/**
 * Validate a full attempt's trial set: every record individually, one attempt, unique ids and
 * an unbroken correction chain per ordinal (each index k > 0 needs k - 1 to be present).
 */
export function assertValidAssessmentTrialSet(
    trials: readonly AssessmentTrial[],
    protocol: MeasurementProtocol,
    assessmentAttemptId: string,
): void {
    const ids = new Set<string>();
    for (const trial of trials) {
        assertValidAssessmentTrial(trial, protocol);
        if (trial.assessmentAttemptId !== assessmentAttemptId) {
            throw new Error(`Trial ${trial.id} belongs to attempt ${trial.assessmentAttemptId}, not ${assessmentAttemptId}`);
        }
        if (ids.has(trial.id)) throw new Error(`Duplicate trial id: ${trial.id}`);
        ids.add(trial.id);
    }
    for (const trial of trials) {
        if (trial.supersedesTrialId !== undefined && !ids.has(trial.supersedesTrialId)) {
            throw new Error(`Trial ${trial.id} supersedes missing trial ${trial.supersedesTrialId}`);
        }
    }
    if (trials.length > 0) assertFixedLoadComparisonContext(protocol, trials, trials[0].context);
}

/**
 * #1202: the largest readable subset of an attempt's stored trials, for read-only views.
 *
 * A record that fails `assertValidAssessmentTrial`, belongs to another attempt or repeats an
 * id is dropped, then any correction whose superseded trial was dropped (repeated until
 * stable, since corrections chain). Every other trial of an ordinal that an unreadable record
 * belongs to is dropped too, so an older trial never shows as current when its correction
 * could not be read. The ordinal comes from the record's id (`assessmentTrialIdFor`), including
 * `unreadableIds` for records the caller rejected before this check (for example a path
 * mismatch); an id that does not follow that format cannot be attributed and is only counted.
 * If the remaining set still fails the set-level checks (for example inconsistent fixed-load
 * context, where no single record is to blame), nothing is returned. The result always passes
 * `assertValidAssessmentTrialSet`; `unreadableCount` is every input record not returned.
 *
 * Write and derivation paths must not use this: dropping a stored trial there would change
 * benchmark evidence. They keep the throwing `assertValidAssessmentTrialSet`.
 */
export function readableAssessmentTrialSubset(
    trials: readonly AssessmentTrial[],
    protocol: MeasurementProtocol,
    assessmentAttemptId: string,
    unreadableIds: readonly string[] = [],
): { trials: AssessmentTrial[]; unreadableCount: number } {
    const ids = new Set<string>();
    const rejectedIds = [...unreadableIds];
    let kept = trials.filter(trial => {
        try {
            assertValidAssessmentTrial(trial, protocol);
        } catch {
            rejectedIds.push(trial.id);
            return false;
        }
        if (trial.assessmentAttemptId !== assessmentAttemptId || ids.has(trial.id)) {
            rejectedIds.push(trial.id);
            return false;
        }
        ids.add(trial.id);
        return true;
    });
    for (let changed = true; changed;) {
        const keptIds = new Set(kept.map(trial => trial.id));
        const next = kept.filter(trial => trial.supersedesTrialId === undefined || keptIds.has(trial.supersedesTrialId));
        changed = next.length !== kept.length;
        kept = next;
    }
    const uncertainOrdinals = new Set(rejectedIds.flatMap(id => {
        const match = typeof id === 'string' ? /^trial-(\d+)(?:-c\d+)?$/.exec(id) : null;
        return match ? [Number(match[1])] : [];
    }));
    kept = kept.filter(trial => !uncertainOrdinals.has(trial.ordinal));
    try {
        assertValidAssessmentTrialSet(kept, protocol, assessmentAttemptId);
    } catch {
        return { trials: [], unreadableCount: trials.length };
    }
    return { trials: kept, unreadableCount: trials.length - kept.length };
}

/** The current (latest unsuperseded) trial for each ordinal, in ordinal order. */
export function resolveActiveAssessmentTrials(
    trials: readonly AssessmentTrial[],
    protocol: MeasurementProtocol,
    assessmentAttemptId: string,
): AssessmentTrial[] {
    assertValidAssessmentTrialSet(trials, protocol, assessmentAttemptId);
    const heads = new Map<number, AssessmentTrial>();
    for (const trial of trials) {
        const current = heads.get(trial.ordinal);
        if (!current || trial.correctionIndex > current.correctionIndex) heads.set(trial.ordinal, trial);
    }
    return [...heads.values()].sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * ADR-0046 D-AT-CORRECTION lifecycle: new ordinals only while the attempt is in progress;
 * after completion only supersession trials; never on scheduled or abandoned attempts.
 */
export function assertAssessmentTrialWriteAllowed(attempt: AssessmentAttempt, trial: AssessmentTrial): void {
    if (trial.assessmentAttemptId !== attempt.id) {
        throw new Error(`Trial ${trial.id} does not belong to attempt ${attempt.id}`);
    }
    switch (attempt.state) {
        case 'in_progress':
            return;
        case 'completed':
            if (trial.correctionIndex === 0) {
                throw new Error('A completed assessment only accepts supersession (correction) trials');
            }
            return;
        default:
            throw new Error(`Cannot record assessment trials on a ${attempt.state} attempt`);
    }
}
