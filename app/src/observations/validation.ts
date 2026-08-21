import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MetricObservationHead,
    MetricObservationRevision,
    ObservationContext,
    ObservationValidity,
} from './models';
import { assertMetricUnit, getMetricDefinition } from './registry';

const OBSERVATION_SOURCES = new Set(['manual', 'garmin_activity', 'garmin_lap', 'derived']);
const VALIDITIES = new Set<ObservationValidity>(['valid', 'invalid', 'practice', 'questionable']);
const ATTEMPT_STATES = new Set(['scheduled', 'in_progress', 'completed', 'abandoned']);
const ATTEMPT_PURPOSES = new Set(['familiarization', 'baseline', 'checkpoint', 'post_block']);
const COMPETITION_SPORTS = new Set(['cycling', 'running', 'field', 'other']);
const COMPETITION_SOURCES = new Set(['manual', 'garmin_activity', 'imported_result']);

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
    assertNonEmptyString(value, label);
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp`);
}

function assertLocalDate(value: unknown, label: string): asserts value is string {
    assertNonEmptyString(value, label);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error(`${label} must be a real calendar date`);
    }
}

function assertFiniteNonNegative(value: unknown, label: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a finite non-negative number`);
    }
}

function assertContext(context: ObservationContext, label: string): void {
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error(`${label} must be an object`);
    for (const [key, value] of Object.entries(context)) {
        if (key.trim().length === 0) throw new Error(`${label} cannot contain an empty key`);
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw new Error(`${label}.${key} must be a scalar or null`);
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new Error(`${label}.${key} must be finite`);
        }
    }
}

export function observationKeyFor(assessmentAttemptId: string, metricId: string): string {
    assertNonEmptyString(assessmentAttemptId, 'assessmentAttemptId');
    getMetricDefinition(metricId);
    return `${assessmentAttemptId}:${metricId}`;
}

export function assertValidMetricObservationHead(head: MetricObservationHead): void {
    const expectedKey = observationKeyFor(head.assessmentAttemptId, head.metricId);
    if (head.observationKey !== expectedKey) throw new Error(`Observation key must equal ${expectedKey}`);
    if (!Number.isInteger(head.headRevision) || head.headRevision < 1) {
        throw new Error('headRevision must be a positive integer');
    }
    assertTimestamp(head.createdAt, 'createdAt');
    assertTimestamp(head.updatedAt, 'updatedAt');
}

export function assertValidMetricObservationRevision(revision: MetricObservationRevision): void {
    const expectedKey = observationKeyFor(revision.assessmentAttemptId, revision.metricId);
    if (revision.observationKey !== expectedKey) throw new Error(`Observation key must equal ${expectedKey}`);
    if (!Number.isInteger(revision.revision) || revision.revision < 1) {
        throw new Error('revision must be a positive integer');
    }
    if (revision.revision === 1 && revision.supersedesRevision !== undefined) {
        throw new Error('Revision 1 cannot supersede another revision');
    }
    if (revision.revision > 1 && revision.supersedesRevision !== revision.revision - 1) {
        throw new Error(`Revision ${revision.revision} must supersede revision ${revision.revision - 1}`);
    }
    if (typeof revision.value !== 'number' || !Number.isFinite(revision.value)) {
        throw new Error('Observation value must be finite');
    }
    assertMetricUnit(revision.metricId, revision.unit);
    assertTimestamp(revision.observedAt, 'observedAt');
    assertTimestamp(revision.createdAt, 'createdAt');
    if (!OBSERVATION_SOURCES.has(revision.source)) throw new Error(`Unsupported observation source: ${revision.source}`);
    assertNonEmptyString(revision.protocolRef.id, 'protocolRef.id');
    if (!Number.isInteger(revision.protocolRef.revision) || revision.protocolRef.revision < 1) {
        throw new Error('protocolRef.revision must be a positive integer');
    }
    assertNonEmptyString(revision.comparisonSeriesKey, 'comparisonSeriesKey');
    assertNonEmptyString(revision.comparisonCanonicalizationVersion, 'comparisonCanonicalizationVersion');
    if (!VALIDITIES.has(revision.validity)) throw new Error(`Unsupported observation validity: ${revision.validity}`);
    if (revision.validity === 'invalid') assertNonEmptyString(revision.invalidReason, 'invalidReason');
    if (revision.invalidReason !== undefined) assertNonEmptyString(revision.invalidReason, 'invalidReason');
    if (revision.validityNote !== undefined) {
        assertNonEmptyString(revision.validityNote, 'validityNote');
        if (revision.validityNote.length > 2000) throw new Error('validityNote is too long');
    }
    assertContext(revision.context, 'context');

    if (revision.device !== undefined) {
        assertNonEmptyString(revision.device.provider, 'device.provider');
        if (revision.device.model !== undefined) assertNonEmptyString(revision.device.model, 'device.model');
        if (revision.device.deviceId !== undefined) assertNonEmptyString(revision.device.deviceId, 'device.deviceId');
    }
    if (revision.sourceRef !== undefined) assertNonEmptyString(revision.sourceRef, 'sourceRef');
    if (revision.correctionReason !== undefined) assertNonEmptyString(revision.correctionReason, 'correctionReason');

    if (revision.source === 'derived') {
        if (!revision.derivedFromObservationIds || revision.derivedFromObservationIds.length === 0) {
            throw new Error('Derived observations require source observation IDs');
        }
        if (new Set(revision.derivedFromObservationIds).size !== revision.derivedFromObservationIds.length) {
            throw new Error('Derived observation source IDs must be unique');
        }
        revision.derivedFromObservationIds.forEach((id, index) => assertNonEmptyString(id, `derivedFromObservationIds[${index}]`));
        assertNonEmptyString(revision.algorithmVersion, 'algorithmVersion');
    } else if (revision.derivedFromObservationIds !== undefined || revision.algorithmVersion !== undefined) {
        throw new Error('Only derived observations may declare derivedFromObservationIds/algorithmVersion');
    }
}

export function assertValidAssessmentAttempt(attempt: AssessmentAttempt): void {
    assertNonEmptyString(attempt.id, 'Assessment attempt id');
    assertNonEmptyString(attempt.protocolRef.id, 'protocolRef.id');
    if (!Number.isInteger(attempt.protocolRef.revision) || attempt.protocolRef.revision < 1) {
        throw new Error('protocolRef.revision must be a positive integer');
    }
    if (!ATTEMPT_STATES.has(attempt.state)) throw new Error(`Unsupported assessment state: ${attempt.state}`);
    if (!ATTEMPT_PURPOSES.has(attempt.purpose)) throw new Error(`Unsupported assessment purpose: ${attempt.purpose}`);
    if (attempt.scheduledDate !== undefined) assertLocalDate(attempt.scheduledDate, 'scheduledDate');
    if (attempt.startedAt !== undefined) assertTimestamp(attempt.startedAt, 'startedAt');
    if (attempt.completedAt !== undefined) assertTimestamp(attempt.completedAt, 'completedAt');
    if (attempt.sourceSessionRef !== undefined) assertNonEmptyString(attempt.sourceSessionRef, 'sourceSessionRef');
    if (attempt.notes !== undefined && attempt.notes.length > 4000) throw new Error('Assessment notes are too long');

    if (attempt.state === 'scheduled' && (attempt.startedAt !== undefined || attempt.completedAt !== undefined)) {
        throw new Error('Scheduled assessment cannot already have start/completion timestamps');
    }
    if (attempt.state === 'in_progress' && (attempt.startedAt === undefined || attempt.completedAt !== undefined)) {
        throw new Error('In-progress assessment requires startedAt and no completedAt');
    }
    if (attempt.state === 'completed' && (attempt.startedAt === undefined || attempt.completedAt === undefined)) {
        throw new Error('Completed assessment requires startedAt and completedAt');
    }
    if (attempt.state === 'abandoned' && attempt.completedAt !== undefined) {
        throw new Error('Abandoned assessment cannot have completedAt');
    }
}

export function assertValidCompetitionOutcome(outcome: CompetitionOutcome): void {
    assertNonEmptyString(outcome.id, 'Competition outcome id');
    if (!COMPETITION_SPORTS.has(outcome.sport)) throw new Error(`Unsupported competition sport: ${outcome.sport}`);
    if (!COMPETITION_SOURCES.has(outcome.source)) throw new Error(`Unsupported competition source: ${outcome.source}`);
    assertTimestamp(outcome.occurredAt, 'occurredAt');
    assertTimestamp(outcome.createdAt, 'createdAt');
    if (outcome.eventRef !== undefined) assertNonEmptyString(outcome.eventRef, 'eventRef');
    if (outcome.sourceRef !== undefined) assertNonEmptyString(outcome.sourceRef, 'sourceRef');
    if (!outcome.result || typeof outcome.result !== 'object') throw new Error('Competition result is required');
    if (typeof outcome.result.completed !== 'boolean') throw new Error('Competition result.completed must be boolean');
    if (outcome.result.placing !== undefined) {
        if (!Number.isInteger(outcome.result.placing) || outcome.result.placing < 1) throw new Error('placing must be a positive integer');
    }
    if (outcome.result.fieldSize !== undefined) {
        if (!Number.isInteger(outcome.result.fieldSize) || outcome.result.fieldSize < 1) throw new Error('fieldSize must be a positive integer');
    }
    if (outcome.result.placing !== undefined && outcome.result.fieldSize !== undefined
        && outcome.result.placing > outcome.result.fieldSize) {
        throw new Error('placing cannot exceed fieldSize');
    }
    if (outcome.result.elapsedSeconds !== undefined) assertFiniteNonNegative(outcome.result.elapsedSeconds, 'elapsedSeconds');
    if (outcome.result.distanceM !== undefined) assertFiniteNonNegative(outcome.result.distanceM, 'distanceM');
    if (outcome.result.courseId !== undefined) assertNonEmptyString(outcome.result.courseId, 'courseId');
    if (outcome.result.summary !== undefined && outcome.result.summary.length > 4000) throw new Error('Competition summary is too long');
    assertContext(outcome.metrics, 'metrics');
    assertContext(outcome.context, 'context');
}
