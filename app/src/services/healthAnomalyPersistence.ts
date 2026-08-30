import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import { isHealthAnomalyThresholdPolicy } from '../engine/healthAnomaly';
import type {
    HealthAnomalyAssessmentRevision,
    HealthAnomalySourceIdentity,
    HealthAnomalyThresholdPolicy,
    HealthAnomalyPolicy,
} from '../engine/healthAnomalyModels';

const ASSESSMENT_STATES = [
    'normal',
    'explained_recovery_strain',
    'watch_unexplained',
    'possible_illness_or_systemic_stress',
    'symptoms_reported',
] as const;
const EVIDENCE_LEVELS = ['none', 'low', 'moderate', 'high'] as const;
const NON_OFF_MODES = ['shadow-v1', 'visible-v1', 'tighten-v1'] as const;
const RESPIRATION_ELEVATION_STATUSES = [
    'unavailable',
    'normal',
    'elevated',
    'strongly_elevated',
    'resolving',
] as const;
const RESPIRATION_ELEVATION_REASONS = [
    'MEASUREMENT_INELIGIBLE',
    'MISSING_CURRENT',
    'INVALID_CURRENT',
    'DATE_PROVENANCE_MISMATCH',
    'INCOMPATIBLE_BASELINE_VERSION',
    'INSUFFICIENT_HISTORY',
    'INSUFFICIENT_RECENT_COVERAGE',
    'MISSING_7D_BASELINE',
    'MISSING_28D_BASELINE',
    'ABOVE_ELEVATED_PERSONAL_DELTAS',
    'ABOVE_STRONG_PERSONAL_DELTAS',
    'RECENT_DELTA_NON_POSITIVE',
    'BELOW_ELEVATION_BOUNDARY',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(
            key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`,
        ).join(',')}}`;
    }
    return 'null';
}

function fnv32(input: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function stableHealthAnomalyHash(value: unknown): string {
    const serialized = stableSerialize(value);
    return `${fnv32(serialized, 0x811c9dc5)}${fnv32(serialized, 0x1b873593)}`;
}

export function healthAnomalyRevisionIdentity(input: {
    date: string;
    mode: Exclude<HealthAnomalyPolicy, 'off'>;
    policyVersion: string;
    thresholdPolicy: HealthAnomalyThresholdPolicy;
    source: HealthAnomalySourceIdentity;
}): { revisionId: string; idempotencyKey: string } {
    const digest = stableHealthAnomalyHash(input);
    return {
        revisionId: `ha-${digest}`,
        idempotencyKey: `${input.date}:${digest}`,
    };
}

export function buildHealthAnomalyAssessmentRevision(input: {
    userId: string;
    date: string;
    computedAt: string;
    mode: Exclude<HealthAnomalyPolicy, 'off'>;
    thresholdPolicy: HealthAnomalyThresholdPolicy;
    source: HealthAnomalySourceIdentity;
    assessment: HealthAnomalyAssessmentRevision['assessment'];
}): HealthAnomalyAssessmentRevision {
    const identity = healthAnomalyRevisionIdentity({
        date: input.date,
        mode: input.mode,
        policyVersion: input.assessment.policyVersion,
        thresholdPolicy: input.thresholdPolicy,
        source: input.source,
    });
    return {
        userId: input.userId,
        date: input.date,
        revisionId: identity.revisionId,
        idempotencyKey: identity.idempotencyKey,
        computedAt: input.computedAt,
        policyVersion: input.assessment.policyVersion,
        thresholdPolicy: input.thresholdPolicy,
        mode: input.mode,
        source: input.source,
        assessment: input.assessment,
        schemaVersion: 1,
    };
}

function isSourceIdentity(value: unknown): value is HealthAnomalySourceIdentity {
    if (!isPlainObject(value)) return false;
    if (value.timezone !== 'Europe/Warsaw') return false;
    if (typeof value.historyWindowStart !== 'string' || typeof value.historyWindowEndExclusive !== 'string') return false;
    if (typeof value.persistenceLookbackStart !== 'string') return false;
    if (value.recoverySnapshotRevision !== null && typeof value.recoverySnapshotRevision !== 'string') return false;
    if (value.checkinRevision !== null && typeof value.checkinRevision !== 'string') return false;
    if (value.travelContextRevision !== null && typeof value.travelContextRevision !== 'string') return false;
    if (!Array.isArray(value.historySnapshotRevisions)) return false;
    return value.historySnapshotRevisions.every(item => isPlainObject(item)
        && typeof item.date === 'string'
        && typeof item.revision === 'string');
}

function isNullableFiniteNumber(value: unknown): boolean {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isRespirationElevationEvidence(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    return (RESPIRATION_ELEVATION_STATUSES as readonly unknown[]).includes(value.status)
        && isNullableFiniteNumber(value.currentValue)
        && isNullableFiniteNumber(value.baseline7dValue)
        && isNullableFiniteNumber(value.baseline28dValue)
        && isNullableFiniteNumber(value.deltaVs7d)
        && isNullableFiniteNumber(value.deltaVs28d)
        && (value.baselineVersion === null || (Number.isInteger(value.baselineVersion) && (value.baselineVersion as number) >= 0))
        && Number.isInteger(value.historyCount)
        && (value.historyCount as number) >= 0
        && typeof value.recentDayCoverage === 'number'
        && Number.isFinite(value.recentDayCoverage)
        && value.recentDayCoverage >= 0
        && value.recentDayCoverage <= 1
        && Array.isArray(value.reasonCodes)
        && value.reasonCodes.length <= RESPIRATION_ELEVATION_REASONS.length
        && value.reasonCodes.every(reason => (RESPIRATION_ELEVATION_REASONS as readonly unknown[]).includes(reason))
        && typeof value.policyVersion === 'string'
        && value.policyVersion.length > 0;
}

export function parseHealthAnomalyAssessmentRevision(
    value: unknown,
    expectedUserId?: string,
    expectedDate?: string,
): HealthAnomalyAssessmentRevision {
    if (!isPlainObject(value)) throw new Error('Health anomaly revision must be an object');
    const revision = value as unknown as HealthAnomalyAssessmentRevision;
    if (revision.schemaVersion !== 1) throw new Error('Unsupported health anomaly schemaVersion');
    if (typeof revision.userId !== 'string' || revision.userId.length === 0) throw new Error('Invalid health anomaly userId');
    if (expectedUserId && revision.userId !== expectedUserId) throw new Error('Health anomaly ownership mismatch');
    if (typeof revision.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(revision.date)) throw new Error('Invalid health anomaly date');
    if (expectedDate && revision.date !== expectedDate) throw new Error('Health anomaly date mismatch');
    if (typeof revision.revisionId !== 'string' || !/^ha-[0-9a-f]{16}$/.test(revision.revisionId)) throw new Error('Invalid health anomaly revisionId');
    if (typeof revision.idempotencyKey !== 'string' || revision.idempotencyKey.length === 0) throw new Error('Invalid health anomaly idempotencyKey');
    if (typeof revision.computedAt !== 'string' || revision.computedAt.length === 0) throw new Error('Invalid health anomaly computedAt');
    if (typeof revision.policyVersion !== 'string' || revision.policyVersion.length === 0) throw new Error('Invalid health anomaly policyVersion');
    if (!(NON_OFF_MODES as readonly string[]).includes(revision.mode)) throw new Error('Invalid health anomaly mode');
    if (!isHealthAnomalyThresholdPolicy(revision.thresholdPolicy)) throw new Error('Invalid health anomaly threshold policy');
    if (!isSourceIdentity(revision.source)) throw new Error('Invalid health anomaly source identity');
    if (!revision.assessment || !(ASSESSMENT_STATES as readonly string[]).includes(revision.assessment.state)) throw new Error('Invalid health anomaly assessment state');
    if (!(EVIDENCE_LEVELS as readonly string[]).includes(revision.assessment.evidenceLevel)) throw new Error('Invalid health anomaly evidence level');
    if (revision.assessment.policyVersion !== revision.policyVersion) throw new Error('Health anomaly policy version mismatch');
    if (revision.assessment.thresholdPolicyVersion !== revision.thresholdPolicy.policyVersion) throw new Error('Health anomaly threshold version mismatch');
    if (revision.assessment.mode !== revision.mode) throw new Error('Health anomaly mode mismatch');
    if (
        revision.assessment.respirationElevation !== undefined
        && !isRespirationElevationEvidence(revision.assessment.respirationElevation)
    ) throw new Error('Invalid respiration elevation evidence');
    if (!Array.isArray(revision.assessment.coreSignals) || revision.assessment.coreSignals.length !== 3) throw new Error('Health anomaly revision requires three core signal traces');
    for (const signal of revision.assessment.coreSignals) {
        if (!['rhr', 'respiration', 'hrv'].includes(signal.signal)) throw new Error('Invalid health anomaly core signal');
        if (!['unavailable', 'normal', 'moderate_anomaly', 'strong_anomaly'].includes(signal.status)) throw new Error('Invalid health anomaly core status');
        if (signal.standardizedDeviation !== null && !Number.isFinite(signal.standardizedDeviation)) throw new Error('Non-finite health anomaly deviation');
    }
    if (!Array.isArray(revision.assessment.unexplainedEvidence)) throw new Error('Invalid health anomaly unexplained evidence');
    if (!Number.isInteger(revision.assessment.persistenceDays) || revision.assessment.persistenceDays < 0) throw new Error('Invalid health anomaly persistenceDays');
    if (revision.assessment.episodeDay !== null && (!Number.isInteger(revision.assessment.episodeDay) || revision.assessment.episodeDay < 1)) throw new Error('Invalid health anomaly episodeDay');

    const expectedIdentity = healthAnomalyRevisionIdentity({
        date: revision.date,
        mode: revision.mode,
        policyVersion: revision.policyVersion,
        thresholdPolicy: revision.thresholdPolicy,
        source: revision.source,
    });
    if (revision.revisionId !== expectedIdentity.revisionId || revision.idempotencyKey !== expectedIdentity.idempotencyKey) {
        throw new Error('Health anomaly immutable identity mismatch');
    }
    return revision;
}

/**
 * The stored document at this path was necessarily written keyed by this same revisionId, so
 * its idempotencyKey (derived from the identical digest) can never actually disagree -- that
 * comparison alone cannot detect a real digest collision between different inputs. Compare the
 * exact identity-defining content instead.
 */
function identityContent(revision: HealthAnomalyAssessmentRevision): string {
    return stableSerialize({
        date: revision.date,
        mode: revision.mode,
        policyVersion: revision.policyVersion,
        thresholdPolicy: revision.thresholdPolicy,
        source: revision.source,
    });
}

/** Immutable, create-only nested revisions; no mutable health-anomaly head is required. */
export class HealthAnomalyAssessmentRepository {
    async persistImmutable(revision: HealthAnomalyAssessmentRevision): Promise<HealthAnomalyAssessmentRevision> {
        const validated = parseHealthAnomalyAssessmentRevision(revision, revision.userId, revision.date);
        const ref = doc(
            getDb(),
            'users', validated.userId,
            'health_anomaly_assessments', validated.date,
            'revisions', validated.revisionId,
        );
        return runTransaction(getDb(), async transaction => {
            const existing = await transaction.get(ref);
            if (existing.exists()) {
                const parsed = parseHealthAnomalyAssessmentRevision(existing.data(), validated.userId, validated.date);
                if (identityContent(parsed) !== identityContent(validated)) {
                    throw new Error('Health anomaly revision-id collision');
                }
                return parsed;
            }
            transaction.set(ref, validated);
            return validated;
        });
    }

    async getLatestForDate(userId: string, date: string): Promise<HealthAnomalyAssessmentRevision | null> {
        const ref = collection(getDb(), 'users', userId, 'health_anomaly_assessments', date, 'revisions');
        const result = await getDocs(ref);
        if (result.empty) return null;
        const revisions = result.docs.map(item => parseHealthAnomalyAssessmentRevision(item.data(), userId, date));
        revisions.sort((left, right) => right.computedAt.localeCompare(left.computedAt)
            || right.revisionId.localeCompare(left.revisionId));
        return revisions[0] ?? null;
    }
}

export const healthAnomalyAssessmentRepository = new HealthAnomalyAssessmentRepository();
