import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    where,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import {
    IDENTITY_REASON_CODES,
    deriveEffectiveIdentityDecision,
    freezeAutomaticIdentityAssessment,
    type AutomaticIdentityAssessment,
    type IdentityReviewEvent,
    type ObservationBundleRef,
} from '../observations/identityModels';
import type {
    PhysiologicalIdentityPassportCurrent,
    PhysiologicalIdentityPassportVersion,
    RobustLocationEstimate,
    RobustRatioEstimate,
    RobustScalarEstimate,
} from '../engine/identityPassport';
import type { EffectiveBundleIdentityProjection } from '../engine/identityEligibility';

const IDENTITY_STATUSES = ['USER', 'NOT_USER', 'UNCERTAIN'] as const;
const CONFIDENCE_TIERS = ['HIGH', 'MODERATE', 'LOW', 'NONE'] as const;
const OCCUPANCY_ATTESTATIONS = ['EXCLUSIVE', 'MIXED', 'UNKNOWN'] as const;
const PASSPORT_CHANGE_REASONS = [
    'GARMIN_DEVICE_OR_ALGORITHM_CHANGE',
    'EIGHT_SLEEP_ALGORITHM_OR_API_CHANGE',
    'GOOGLE_HEALTH_MAPPING_CHANGE',
    'MEASUREMENT_SYSTEM_SHIFT_CONFIRMED_BY_REPLAY',
    'INITIAL_BOOTSTRAP',
    'OTHER',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteOrNull(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function normalizeIsoTimestamp(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) {
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
    }
    if (value && typeof value === 'object' && 'toDate' in value) {
        const toDate = (value as { toDate?: unknown }).toDate;
        if (typeof toDate === 'function') {
            const date = toDate.call(value) as unknown;
            return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : null;
        }
    }
    return null;
}

function assertBundleRef(value: unknown): asserts value is ObservationBundleRef {
    if (!isPlainObject(value)) throw new Error('Identity bundle ref must be an object');
    if (!isNonEmptyString(value.id)) throw new Error('Identity bundle ref id is invalid');
    if (!isNonEmptyString(value.provider) || !isNonEmptyString(value.transport)) {
        throw new Error('Identity bundle ref source is invalid');
    }
    if (!Number.isInteger(value.revision) || (value.revision as number) < 1) {
        throw new Error('Identity bundle ref revision is invalid');
    }
    if (!isNonEmptyString(value.sourcePayloadHash) || !isNonEmptyString(value.lineageKey)) {
        throw new Error('Identity bundle ref replay evidence is incomplete');
    }
}

function assertScalarEstimate(value: unknown): asserts value is RobustScalarEstimate {
    if (!isPlainObject(value)) throw new Error('Passport scalar estimate must be an object');
    if (!isFiniteOrNull(value.median) || !isFiniteOrNull(value.mad) || !isFiniteOrNull(value.iqr)) {
        throw new Error('Passport scalar estimate contains a non-finite value');
    }
    if (!Number.isInteger(value.n) || (value.n as number) < 0) {
        throw new Error('Passport scalar estimate count is invalid');
    }
}

function assertLocationEstimate(value: unknown): asserts value is RobustLocationEstimate {
    if (!isPlainObject(value)) throw new Error('Passport location estimate must be an object');
    if (!isFiniteOrNull(value.median) || !isFiniteOrNull(value.mad)) {
        throw new Error('Passport location estimate contains a non-finite value');
    }
    if (!Number.isInteger(value.n) || (value.n as number) < 0) {
        throw new Error('Passport location estimate count is invalid');
    }
}

function assertRatioEstimate(value: unknown): asserts value is RobustRatioEstimate {
    if (!isPlainObject(value)) throw new Error('Passport ratio estimate must be an object');
    if (!isFiniteOrNull(value.median) || !isFiniteOrNull(value.iqr)) {
        throw new Error('Passport ratio estimate contains a non-finite value');
    }
    if (!Number.isInteger(value.n) || (value.n as number) < 0) {
        throw new Error('Passport ratio estimate count is invalid');
    }
}

function assertPassportCore(value: unknown): asserts value is PhysiologicalIdentityPassportCurrent {
    if (!isPlainObject(value)) throw new Error('Identity passport must be an object');
    if (value.schemaVersion !== 1) throw new Error('Unsupported identity passport schemaVersion');
    for (const field of ['passportVersion', 'createdAt', 'policyVersion', 'featureSchemaVersion']) {
        if (!isNonEmptyString(value[field])) throw new Error(`Identity passport ${field} is invalid`);
    }
    if (!isPlainObject(value.anchorPolicy)) throw new Error('Identity passport anchor policy is invalid');
    if (
        !isNonEmptyString(value.anchorPolicy.primaryProvider) ||
        !isNonEmptyString(value.anchorPolicy.primaryTransport) ||
        !isNonEmptyString(value.anchorPolicy.role) ||
        typeof value.anchorPolicy.requireIndependentLineage !== 'boolean'
    ) {
        throw new Error('Identity passport anchor policy is incomplete');
    }
    if (!isPlainObject(value.sourceProfiles) || !isPlainObject(value.crossSourceProfiles)) {
        throw new Error('Identity passport profiles are invalid');
    }
    for (const profile of Object.values(value.sourceProfiles)) {
        if (!isPlainObject(profile) || !Number.isInteger(profile.trustedNightCount)) {
            throw new Error('Identity passport source profile is invalid');
        }
        assertScalarEstimate(profile.restingHeartRate);
        assertScalarEstimate(profile.respirationRate);
        assertScalarEstimate(profile.logHrv);
        assertLocationEstimate(profile.sleepStartMinutesLocal);
        assertLocationEstimate(profile.sleepDurationMinutes);
    }
    for (const profile of Object.values(value.crossSourceProfiles)) {
        if (!isPlainObject(profile)) throw new Error('Identity passport cross-source profile is invalid');
        assertScalarEstimate(profile.rhrResidual);
        assertScalarEstimate(profile.respirationResidual);
        assertScalarEstimate(profile.hrvLogResidual);
        assertLocationEstimate(profile.startDeltaMinutes);
        assertLocationEstimate(profile.endDeltaMinutes);
        assertLocationEstimate(profile.durationDeltaMinutes);
        assertRatioEstimate(profile.sessionJaccard);
    }
    if (!isPlainObject(value.calibration)) throw new Error('Identity passport calibration is invalid');
    for (const field of ['manualUserCount', 'manualNotUserCount', 'mixedOccupancyCount', 'uncertainCount']) {
        const count = value.calibration[field];
        if (!Number.isInteger(count) || (count as number) < 0) {
            throw new Error(`Identity passport calibration ${field} is invalid`);
        }
    }
}

export function parseIdentityPassportCurrent(value: unknown): PhysiologicalIdentityPassportCurrent {
    assertPassportCore(value);
    if (!isNonEmptyString(value.updatedAt)) throw new Error('Identity passport updatedAt is invalid');
    return value;
}

export function parseIdentityPassportVersion(
    value: unknown,
    expectedVersion?: string,
): PhysiologicalIdentityPassportVersion {
    assertPassportCore(value);
    const version = value as unknown as PhysiologicalIdentityPassportVersion;
    if (expectedVersion && version.passportVersion !== expectedVersion) {
        throw new Error('Identity passport version/path mismatch');
    }
    if (!/^[0-9a-f]{64}$/.test(version.trainingSetHash)) {
        throw new Error('Identity passport training-set hash is invalid');
    }
    if (!Number.isInteger(version.trainingObservationCount) || version.trainingObservationCount < 0) {
        throw new Error('Identity passport training observation count is invalid');
    }
    if (!isNonEmptyString(version.trainingWindowStart) || !isNonEmptyString(version.trainingWindowEnd)) {
        throw new Error('Identity passport training window is invalid');
    }
    if (version.previousVersion !== null && !isNonEmptyString(version.previousVersion)) {
        throw new Error('Identity passport previous version is invalid');
    }
    if (!(PASSPORT_CHANGE_REASONS as readonly string[]).includes(version.changeReason)) {
        throw new Error('Identity passport change reason is invalid');
    }
    if (!isNonEmptyString(version.algorithmVersion)) {
        throw new Error('Identity passport algorithm version is invalid');
    }
    return version;
}

export function parseAutomaticIdentityAssessment(
    value: unknown,
    expectedId?: string,
): Readonly<AutomaticIdentityAssessment> {
    if (!isPlainObject(value)) throw new Error('Automatic identity assessment must be an object');
    const assessment = value as unknown as AutomaticIdentityAssessment;
    if (!isNonEmptyString(assessment.id) || (expectedId && assessment.id !== expectedId)) {
        throw new Error('Automatic identity assessment id/path mismatch');
    }
    if (!isNonEmptyString(assessment.sourceNightKey)) throw new Error('Identity sourceNightKey is invalid');
    if (!isPlainObject(assessment.sharedSource) || !isNonEmptyString(assessment.sharedSource.provider) || !isNonEmptyString(assessment.sharedSource.transport)) {
        throw new Error('Identity shared source is invalid');
    }
    if (!(IDENTITY_STATUSES as readonly string[]).includes(assessment.automaticStatus)) {
        throw new Error('Automatic identity status is invalid');
    }
    if (!isFiniteOrNull(assessment.identityScore)) throw new Error('Identity score must be finite or null');
    if (!(CONFIDENCE_TIERS as readonly string[]).includes(assessment.confidenceTier)) {
        throw new Error('Identity confidence tier is invalid');
    }
    if (!Array.isArray(assessment.reasonCodes) || !assessment.reasonCodes.every((code) =>
        (IDENTITY_REASON_CODES as readonly string[]).includes(code))) {
        throw new Error('Identity reason codes are invalid');
    }
    if (assessment.passportVersion !== null && !isNonEmptyString(assessment.passportVersion)) {
        throw new Error('Identity passport version is invalid');
    }
    if (!isNonEmptyString(assessment.policyVersion) || !isNonEmptyString(assessment.featureSchemaVersion) || !isNonEmptyString(assessment.assessedAt)) {
        throw new Error('Identity assessment version/timestamp metadata is invalid');
    }
    assertBundleRef(assessment.sharedBundleRef);
    if (!Array.isArray(assessment.anchorBundleRefs)) throw new Error('Identity anchor refs are invalid');
    assessment.anchorBundleRefs.forEach(assertBundleRef);
    return freezeAutomaticIdentityAssessment(assessment);
}

export function parseIdentityReviewEvent(
    value: unknown,
    expectedId?: string,
): IdentityReviewEvent {
    if (!isPlainObject(value)) throw new Error('Identity review event must be an object');
    const stored = value as unknown as IdentityReviewEvent & { recordedAt: unknown };
    const recordedAt = normalizeIsoTimestamp(stored.recordedAt);
    const event: IdentityReviewEvent = { ...stored, recordedAt: recordedAt ?? '' };
    if (!isNonEmptyString(event.id) || (expectedId && event.id !== expectedId)) {
        throw new Error('Identity review event id/path mismatch');
    }
    if (!isNonEmptyString(event.assessmentId) || event.schemaVersion !== 1) {
        throw new Error('Identity review event schema/assessment is invalid');
    }
    if (!(IDENTITY_STATUSES as readonly string[]).includes(event.label)) {
        throw new Error('Identity review label is invalid');
    }
    if (!(OCCUPANCY_ATTESTATIONS as readonly string[]).includes(event.occupancyAttestation)) {
        throw new Error('Identity review occupancy attestation is invalid');
    }
    if (event.supersedesReviewEventId !== null && !isNonEmptyString(event.supersedesReviewEventId)) {
        throw new Error('Identity review supersession is invalid');
    }
    if (!recordedAt || !['user_ui', 'admin_replay'].includes(event.source)) {
        throw new Error('Identity review source/timestamp is invalid');
    }
    return event;
}

function assertUserReviewSemantics(event: IdentityReviewEvent): void {
    if (event.source !== 'user_ui') throw new Error('User review submissions must use user_ui source');
    if (event.label === 'USER' && event.occupancyAttestation !== 'EXCLUSIVE') {
        throw new Error('USER review requires exclusive/full-interval attribution');
    }
    if (event.label === 'NOT_USER' && event.occupancyAttestation !== 'UNKNOWN') {
        throw new Error('NOT_USER review must use UNKNOWN occupancy');
    }
    if (event.label === 'UNCERTAIN' && event.occupancyAttestation === 'EXCLUSIVE') {
        throw new Error('UNCERTAIN review cannot claim exclusive attribution');
    }
}

function stableSerialize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

export class IdentityPersistenceService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    async getCurrentPassport(userId: string): Promise<PhysiologicalIdentityPassportCurrent | null> {
        const snapshot = await getDoc(doc(this.db, 'users', userId, 'physiological_identity_passports', 'current'));
        return snapshot.exists() ? parseIdentityPassportCurrent(snapshot.data()) : null;
    }

    async getPassportVersion(userId: string, version: string): Promise<PhysiologicalIdentityPassportVersion | null> {
        const snapshot = await getDoc(doc(this.db, 'users', userId, 'physiological_identity_passport_versions', version));
        return snapshot.exists() ? parseIdentityPassportVersion(snapshot.data(), version) : null;
    }

    async getAssessment(userId: string, assessmentId: string): Promise<Readonly<AutomaticIdentityAssessment> | null> {
        const snapshot = await getDoc(doc(this.db, 'users', userId, 'health_identity_assessments', assessmentId));
        return snapshot.exists() ? parseAutomaticIdentityAssessment(snapshot.data(), assessmentId) : null;
    }

    async getReviewEvents(userId: string, assessmentId: string): Promise<IdentityReviewEvent[]> {
        const ref = collection(this.db, 'users', userId, 'health_identity_review_events');
        const snapshot = await getDocs(query(ref, where('assessmentId', '==', assessmentId)));
        return snapshot.docs
            .map((item) => parseIdentityReviewEvent(item.data(), item.id))
            .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    }

    async getEffectiveProjection(
        userId: string,
        assessmentId: string,
    ): Promise<EffectiveBundleIdentityProjection | null> {
        const assessment = await this.getAssessment(userId, assessmentId);
        if (!assessment) return null;
        const reviewEvents = await this.getReviewEvents(userId, assessmentId);
        return {
            assessment,
            decision: deriveEffectiveIdentityDecision(assessment, reviewEvents),
        };
    }

    async getEffectiveProjectionsInRange(
        userId: string,
        startNightKey: string,
        endNightKey: string,
    ): Promise<EffectiveBundleIdentityProjection[]> {
        const ref = collection(this.db, 'users', userId, 'health_identity_assessments');
        const snapshot = await getDocs(query(
            ref,
            where('sourceNightKey', '>=', startNightKey),
            where('sourceNightKey', '<=', endNightKey),
        ));
        const assessments = snapshot.docs.map((item) =>
            parseAutomaticIdentityAssessment(item.data(), item.id));
        const projections = await Promise.all(assessments.map(async (assessment) => ({
            assessment,
            decision: deriveEffectiveIdentityDecision(
                assessment,
                await this.getReviewEvents(userId, assessment.id),
            ),
        })));
        return projections.sort((a, b) =>
            a.assessment.sourceNightKey.localeCompare(b.assessment.sourceNightKey) ||
            a.assessment.id.localeCompare(b.assessment.id));
    }

    async submitUserReview(params: {
        userId: string;
        id: string;
        assessmentId: string;
        label: IdentityReviewEvent['label'];
        occupancyAttestation: IdentityReviewEvent['occupancyAttestation'];
        supersedesReviewEventId: string | null;
    }): Promise<IdentityReviewEvent> {
        const eventWithoutTimestamp: Omit<IdentityReviewEvent, 'recordedAt'> = {
            id: params.id,
            assessmentId: params.assessmentId,
            schemaVersion: 1,
            label: params.label,
            occupancyAttestation: params.occupancyAttestation,
            supersedesReviewEventId: params.supersedesReviewEventId,
            source: 'user_ui',
        };
        assertUserReviewSemantics({
            ...eventWithoutTimestamp,
            recordedAt: new Date(0).toISOString(),
        });

        const assessmentRef = doc(this.db, 'users', params.userId, 'health_identity_assessments', params.assessmentId);
        const eventRef = doc(this.db, 'users', params.userId, 'health_identity_review_events', params.id);
        const supersededRef = params.supersedesReviewEventId
            ? doc(this.db, 'users', params.userId, 'health_identity_review_events', params.supersedesReviewEventId)
            : null;

        const existing = await runTransaction(this.db, async (transaction) => {
            const [assessmentSnapshot, existingSnapshot, supersededSnapshot] = await Promise.all([
                transaction.get(assessmentRef),
                transaction.get(eventRef),
                supersededRef ? transaction.get(supersededRef) : Promise.resolve(null),
            ]);
            if (!assessmentSnapshot.exists()) throw new Error('Identity assessment does not exist');
            parseAutomaticIdentityAssessment(assessmentSnapshot.data(), params.assessmentId);

            if (existingSnapshot.exists()) {
                const existing = parseIdentityReviewEvent(existingSnapshot.data(), params.id);
                const existingWithoutTimestamp: Partial<IdentityReviewEvent> = { ...existing };
                delete existingWithoutTimestamp.recordedAt;
                if (stableSerialize(existingWithoutTimestamp) !== stableSerialize(eventWithoutTimestamp)) {
                    throw new Error('Identity review event id already exists with different content');
                }
                return existing;
            }

            if (supersededRef) {
                if (!supersededSnapshot?.exists()) throw new Error('Superseded identity review event does not exist');
                const superseded = parseIdentityReviewEvent(
                    supersededSnapshot.data(),
                    params.supersedesReviewEventId ?? undefined,
                );
                if (superseded.assessmentId !== params.assessmentId) {
                    throw new Error('Identity review cannot supersede an event for another assessment');
                }
            }

            transaction.set(eventRef, {
                ...eventWithoutTimestamp,
                recordedAt: serverTimestamp(),
            });
            return null;
        });
        if (existing) return existing;
        const createdSnapshot = await getDoc(eventRef);
        if (!createdSnapshot.exists()) throw new Error('Identity review event was not persisted');
        return parseIdentityReviewEvent(createdSnapshot.data(), params.id);
    }
}

export const identityPersistenceService = new IdentityPersistenceService();
