export const HEALTH_ANOMALY_OUTCOME_EXPLANATIONS = [
    'illness_symptoms',
    'allergy_or_hay_fever',
    'hard_training_recovery',
    'poor_sleep',
    'alcohol',
    'travel_jetlag',
    'stress',
    'heat_dehydration',
    'vaccination_medication',
    'nothing_obvious',
    'other_not_sure',
] as const;

export type HealthAnomalyOutcomeExplanation = typeof HEALTH_ANOMALY_OUTCOME_EXPLANATIONS[number];
export type HealthAnomalyRespiratoryTestResult = 'positive' | 'negative';

export interface HealthAnomalySymptomOnsetLabel {
    /** Approximate Warsaw-local onset date; day precision is sufficient for HA6 lead-time analysis. */
    date: string;
    precision: 'day';
}

export interface HealthAnomalyRespiratoryTestLabel {
    /** Absence of this object is unknown, never a negative test. */
    result: HealthAnomalyRespiratoryTestResult;
    testedOn: string;
    source: 'user_reported';
}

/**
 * Mutable prospective outcome label for one immutable health-anomaly episode.
 *
 * The assessment revision remains untouched. A later answer can change as the episode becomes
 * clearer (for example nothing_obvious -> illness_symptoms), while source identity and createdAt
 * stay fixed. HA6 labels are evidence only and have no recommendation authority.
 */
export interface HealthAnomalyEpisodeOutcome {
    userId: string;
    episodeId: string;
    sourceAssessment: {
        date: string;
        revisionId: string;
    };
    explanation: HealthAnomalyOutcomeExplanation;
    symptomOnset: HealthAnomalySymptomOnsetLabel | null;
    respiratoryTest: HealthAnomalyRespiratoryTestLabel | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
}

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REVISION_ID_RE = /^ha-[0-9a-f]{16}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRealLocalDate(value: unknown): value is string {
    if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const instant = Date.UTC(year, month - 1, day);
    const date = new Date(instant);
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

/**
 * Validate and narrow a raw Firestore document (or candidate write payload) into a
 * {@link HealthAnomalyEpisodeOutcome}.
 *
 * Mirrors the Firestore security rule's field-level checks so a malformed document is rejected
 * client-side with the same shape it would be rejected server-side. When provided,
 * `expectedUserId`/`expectedEpisodeId` additionally guard against a document read under the
 * wrong owner or episode path.
 */
export function parseHealthAnomalyEpisodeOutcome(
    value: unknown,
    expectedUserId?: string,
    expectedEpisodeId?: string,
): HealthAnomalyEpisodeOutcome {
    if (!isPlainObject(value)) throw new Error('Health anomaly outcome must be an object');
    const outcome = value as unknown as HealthAnomalyEpisodeOutcome;

    if (outcome.schemaVersion !== 1) throw new Error('Unsupported health anomaly outcome schemaVersion');
    if (typeof outcome.userId !== 'string' || outcome.userId.length === 0) throw new Error('Invalid health anomaly outcome userId');
    if (expectedUserId && outcome.userId !== expectedUserId) throw new Error('Health anomaly outcome ownership mismatch');
    if (typeof outcome.episodeId !== 'string' || outcome.episodeId.length === 0 || outcome.episodeId.length > 160 || outcome.episodeId.includes('/')) {
        throw new Error('Invalid health anomaly outcome episodeId');
    }
    if (expectedEpisodeId && outcome.episodeId !== expectedEpisodeId) throw new Error('Health anomaly outcome episode mismatch');

    if (!isPlainObject(outcome.sourceAssessment)
        || !isRealLocalDate(outcome.sourceAssessment.date)
        || typeof outcome.sourceAssessment.revisionId !== 'string'
        || !REVISION_ID_RE.test(outcome.sourceAssessment.revisionId)) {
        throw new Error('Invalid health anomaly outcome source assessment');
    }
    if (!(HEALTH_ANOMALY_OUTCOME_EXPLANATIONS as readonly string[]).includes(outcome.explanation)) {
        throw new Error('Invalid health anomaly outcome explanation');
    }

    if (outcome.symptomOnset !== null) {
        if (!isPlainObject(outcome.symptomOnset)
            || outcome.symptomOnset.precision !== 'day'
            || !isRealLocalDate(outcome.symptomOnset.date)) {
            throw new Error('Invalid health anomaly symptom onset');
        }
    }

    if (outcome.respiratoryTest !== null) {
        if (!isPlainObject(outcome.respiratoryTest)
            || !['positive', 'negative'].includes(outcome.respiratoryTest.result)
            || !isRealLocalDate(outcome.respiratoryTest.testedOn)
            || outcome.respiratoryTest.source !== 'user_reported') {
            throw new Error('Invalid health anomaly respiratory test label');
        }
    }

    if (outcome.note !== null && (typeof outcome.note !== 'string' || outcome.note.length > 2000)) {
        throw new Error('Invalid health anomaly outcome note');
    }
    if (typeof outcome.createdAt !== 'string' || outcome.createdAt.length === 0) throw new Error('Invalid health anomaly outcome createdAt');
    if (typeof outcome.updatedAt !== 'string' || outcome.updatedAt.length === 0) throw new Error('Invalid health anomaly outcome updatedAt');

    return outcome;
}

/**
 * Build a new-or-updated {@link HealthAnomalyEpisodeOutcome}, enforcing that episode/source
 * identity and `createdAt` never change once `existing` is supplied. Only the conclusion
 * (explanation, symptom onset, respiratory test, note) is allowed to evolve on an update; a
 * caller attempting to move an outcome onto a different episode or assessment revision gets a
 * thrown error rather than a silently reassigned record.
 */
export function buildHealthAnomalyEpisodeOutcome(input: {
    userId: string;
    episodeId: string;
    sourceAssessment: HealthAnomalyEpisodeOutcome['sourceAssessment'];
    explanation: HealthAnomalyOutcomeExplanation;
    symptomOnset?: HealthAnomalySymptomOnsetLabel | null;
    respiratoryTest?: HealthAnomalyRespiratoryTestLabel | null;
    note?: string | null;
    now: string;
    existing?: HealthAnomalyEpisodeOutcome | null;
}): HealthAnomalyEpisodeOutcome {
    if (input.existing) {
        if (input.existing.userId !== input.userId
            || input.existing.episodeId !== input.episodeId
            || input.existing.sourceAssessment.date !== input.sourceAssessment.date
            || input.existing.sourceAssessment.revisionId !== input.sourceAssessment.revisionId) {
            throw new Error('Health anomaly outcome immutable identity cannot change');
        }
    }

    return parseHealthAnomalyEpisodeOutcome({
        userId: input.userId,
        episodeId: input.episodeId,
        sourceAssessment: input.sourceAssessment,
        explanation: input.explanation,
        symptomOnset: input.symptomOnset ?? null,
        respiratoryTest: input.respiratoryTest ?? null,
        note: input.note?.trim() || null,
        createdAt: input.existing?.createdAt ?? input.now,
        updatedAt: input.now,
        schemaVersion: 1,
    }, input.userId, input.episodeId);
}
