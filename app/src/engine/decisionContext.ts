/** Immutable, user-scoped inputs for one prospective same-day decision revision. */
import { buildInfo } from '../buildInfo';
import { canonicalise } from './externalPlanHash';
import type { CheckinRecord } from './mechanicalProgression';
import { BODY_REGIONS, TISSUE_LEVELS, type BodyRegion, type DailySubjectiveCheckin, type RegionTissueResponse } from './models';
import type { PerformedTrainingFactsSnapshot } from './performedTrainingFacts';
import { POLICY_VERSION } from './policy';
import type { MinimumSafetyCheckinStatus } from './safetyCheckin';
import type { SameDayRecommendationInputs } from './sameDayRecommendation';

export const DECISION_CONTEXT_SCHEMA_VERSION = 1 as const;
export const DECISION_CONTEXT_CAPTURE_VERSION = 'same-day-capture-v1' as const;
export const MAX_DECISION_CONTEXT_PAYLOAD_BYTES = 900 * 1024;

type MechanicalTissueResponse = Pick<RegionTissueResponse,
    'morningState' | 'painDuringTraining' | 'afterTrainingState' | 'nextMorningReaction'>;

/** Only fields read by evaluateMechanicalStageProgression; no check-in notes or source refs. */
export interface CapturedMechanicalCheckin {
    date: string;
    checkin: Pick<DailySubjectiveCheckin, 'soreness' | 'painOrInjury' | 'illnessSymptoms'> & {
        tissueResponses?: Partial<Record<BodyRegion, MechanicalTissueResponse>>;
    };
}

type CapturedEvaluatorInputs = Omit<SameDayRecommendationInputs,
    'userId' | 'date' | 'historyProvider' | 'preparedHistorySnapshot'
    | 'confirmedProgressionOverrides' | 'mechanicalCheckinHistory'> & {
        /** Firestore-safe representation of the evaluator's ReadonlyMap. */
        confirmedProgressionOverrides: [string, number][];
    };

export interface DecisionContextRecord {
    schemaVersion: typeof DECISION_CONTEXT_SCHEMA_VERSION;
    userId: string;
    date: string;
    recommendationRevision: number;
    evaluatedAt: string;
    policyVersion: string;
    captureVersion: typeof DECISION_CONTEXT_CAPTURE_VERSION;
    appSource: { gitSha: string; dirty: boolean };
    minimumSafetyStatus: MinimumSafetyCheckinStatus;
    /** Null when the minimum-safety gate prevented a normal evaluator call. */
    evaluatorInputs: CapturedEvaluatorInputs | null;
    /** Explicit narrow performed facts; broad training history is never captured here. */
    performedTrainingFacts: PerformedTrainingFactsSnapshot | null;
    mechanicalCheckinHistory?: readonly CapturedMechanicalCheckin[];
    /** SHA-256 of every field above, in canonical key order. */
    contentHash: string;
}

export interface CreateDecisionContextInput {
    userId: string;
    date: string;
    recommendationRevision: number;
    /** The decision's actual, already chosen instant; this helper never reads the clock. */
    evaluatedAt: string;
    minimumSafetyStatus: MinimumSafetyCheckinStatus;
    evaluatorInputs: SameDayRecommendationInputs | null;
    performedTrainingFacts: PerformedTrainingFactsSnapshot | null;
    mechanicalCheckinHistory?: readonly CheckinRecord[];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
    return required.every(key => Object.hasOwn(value, key))
        && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function isPlainJson(value: unknown, allowUndefined = false): boolean {
    if (value === undefined) return allowUndefined; // Input-only optional object fields are omitted when captured.
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => isPlainJson(item));
    return isObject(value) && Object.getPrototypeOf(value) === Object.prototype
        && Object.values(value).every(item => isPlainJson(item, allowUndefined));
}

function copyJson<T>(value: T): T {
    if (!isPlainJson(value, true)) throw new TypeError('Decision context contains a non-JSON value');
    return JSON.parse(JSON.stringify(value)) as T;
}

async function hashPayload(payload: Omit<DecisionContextRecord, 'contentHash'>): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(canonicalise(payload)));
    if (bytes.byteLength > MAX_DECISION_CONTEXT_PAYLOAD_BYTES) {
        throw new RangeError('Decision context exceeds Firestore payload limit');
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validPayload(value: unknown): value is Omit<DecisionContextRecord, 'contentHash'> {
    if (!isObject(value) || !isPlainJson(value) || !exactKeys(value, [
        'schemaVersion', 'userId', 'date', 'recommendationRevision', 'evaluatedAt',
        'policyVersion', 'captureVersion', 'appSource', 'minimumSafetyStatus', 'evaluatorInputs', 'performedTrainingFacts',
    ], ['mechanicalCheckinHistory'])) return false;
    if (value.schemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION
        || typeof value.userId !== 'string' || !value.userId.trim() || !isDate(value.date)
        || !Number.isSafeInteger(value.recommendationRevision)
        || (value.minimumSafetyStatus === 'complete'
            ? (value.recommendationRevision as number) < 1
            : value.recommendationRevision !== 0)
        || typeof value.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(value.evaluatedAt))
        || new Date(value.evaluatedAt).toISOString() !== value.evaluatedAt
        || typeof value.policyVersion !== 'string' || !value.policyVersion.trim()
        || value.captureVersion !== DECISION_CONTEXT_CAPTURE_VERSION
        || !isObject(value.appSource) || !exactKeys(value.appSource, ['gitSha', 'dirty'])
        || typeof value.appSource.gitSha !== 'string' || !value.appSource.gitSha.trim()
        || typeof value.appSource.dirty !== 'boolean'
        || !['complete', 'missing', 'incomplete'].includes(String(value.minimumSafetyStatus))) return false;

    const inputs = value.evaluatorInputs;
    if (value.minimumSafetyStatus === 'complete') {
        if (!isObject(inputs) || !exactKeys(inputs, [
            'readiness', 'context', 'events', 'fixedActivities', 'authoredPlanBlocks',
            'trainingIntentProfile', 'preferences', 'externalPlan', 'externalRest',
            'scheduleOverlays', 'confirmedProgressionOverrides',
        ], ['previousMode'])) return false;
        if (!isObject(inputs.readiness) || !isObject(inputs.readiness.subjective)
            || !isObject(inputs.readiness.objective) || !isObject(inputs.context)
            || !Array.isArray(inputs.events) || !Array.isArray(inputs.fixedActivities)
            || !Array.isArray(inputs.authoredPlanBlocks) || !Array.isArray(inputs.scheduleOverlays)
            || !Array.isArray(inputs.confirmedProgressionOverrides)) return false;
        if (inputs.previousMode !== undefined && !['train', 'modify', 'recover'].includes(String(inputs.previousMode))) return false;
        if ([inputs.trainingIntentProfile, inputs.preferences, inputs.externalPlan, inputs.externalRest]
            .some(item => item !== null && !isObject(item))) return false;
        const overrides = inputs.confirmedProgressionOverrides;
        if (!overrides.every(entry => Array.isArray(entry) && entry.length === 2
            && typeof entry[0] === 'string' && entry[0].length > 0
            && typeof entry[1] === 'number' && Number.isFinite(entry[1]))) return false;
        if (overrides.some((entry, index) => index > 0 && overrides[index - 1][0] >= entry[0])) return false;
    } else if (inputs !== null) return false;

    const facts = value.performedTrainingFacts;
    if (facts !== null && (!isObject(facts) || !exactKeys(facts,
        ['asOfDate', 'windowDays', 'revision', 'exposures', 'coverageCredits'])
        || facts.asOfDate !== value.date || !Number.isSafeInteger(facts.windowDays)
        || (facts.windowDays as number) < 1 || typeof facts.revision !== 'string' || !facts.revision
        || !Array.isArray(facts.exposures) || !Array.isArray(facts.coverageCredits))) return false;
    if (value.mechanicalCheckinHistory !== undefined
        && (!Array.isArray(value.mechanicalCheckinHistory)
            || !value.mechanicalCheckinHistory.every(item => isObject(item)
                && exactKeys(item, ['date', 'checkin']) && isDate(item.date)
                && isObject(item.checkin)
                && exactKeys(item.checkin, ['soreness', 'painOrInjury', 'illnessSymptoms'], ['tissueResponses'])
                && (item.checkin.soreness === null || typeof item.checkin.soreness === 'number')
                && typeof item.checkin.painOrInjury === 'boolean'
                && typeof item.checkin.illnessSymptoms === 'boolean'
                && (item.checkin.tissueResponses === undefined || (
                    isObject(item.checkin.tissueResponses)
                    && Object.entries(item.checkin.tissueResponses).every(([region, response]) =>
                        BODY_REGIONS.includes(region as BodyRegion) && isObject(response)
                        && exactKeys(response, ['morningState'], [
                            'painDuringTraining', 'afterTrainingState', 'nextMorningReaction',
                        ])
                        && TISSUE_LEVELS.includes(response.morningState as typeof TISSUE_LEVELS[number])
                        && ['painDuringTraining', 'afterTrainingState', 'nextMorningReaction'].every(key =>
                            response[key] === undefined
                            || TISSUE_LEVELS.includes(response[key] as typeof TISSUE_LEVELS[number]))
                    )
                ))))) return false;
    return true;
}

export async function createDecisionContext(input: CreateDecisionContextInput): Promise<DecisionContextRecord> {
    const evaluator = input.evaluatorInputs;
    const payload = {
        schemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
        userId: input.userId,
        date: input.date,
        recommendationRevision: input.recommendationRevision,
        evaluatedAt: input.evaluatedAt,
        policyVersion: POLICY_VERSION,
        captureVersion: DECISION_CONTEXT_CAPTURE_VERSION,
        appSource: { gitSha: buildInfo.gitSha, dirty: buildInfo.dirty },
        minimumSafetyStatus: input.minimumSafetyStatus,
        evaluatorInputs: evaluator && {
            readiness: evaluator.readiness,
            context: evaluator.context,
            events: evaluator.events,
            ...(evaluator.previousMode === undefined ? {} : { previousMode: evaluator.previousMode }),
            fixedActivities: evaluator.fixedActivities,
            authoredPlanBlocks: evaluator.authoredPlanBlocks,
            trainingIntentProfile: evaluator.trainingIntentProfile,
            preferences: evaluator.preferences,
            externalPlan: evaluator.externalPlan,
            externalRest: evaluator.externalRest,
            scheduleOverlays: evaluator.scheduleOverlays,
            confirmedProgressionOverrides: [...(evaluator.confirmedProgressionOverrides ?? new Map()).entries()]
                .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
        },
        performedTrainingFacts: input.performedTrainingFacts,
        ...(input.mechanicalCheckinHistory === undefined ? {} : {
            mechanicalCheckinHistory: input.mechanicalCheckinHistory.map(({ date, checkin }) => ({
                date,
                checkin: {
                    soreness: checkin.soreness,
                    // The legacy painFlag alias is read by the evaluator; fold it into the canonical flag.
                    painOrInjury: checkin.painOrInjury || Boolean((checkin as { painFlag?: boolean }).painFlag),
                    illnessSymptoms: checkin.illnessSymptoms,
                    ...(checkin.tissueResponses === undefined ? {} : {
                        tissueResponses: Object.fromEntries(Object.entries(checkin.tissueResponses)
                            .filter((entry): entry is [string, RegionTissueResponse] => Boolean(entry[1]))
                            .map(([region, response]) => [region, {
                                morningState: response.morningState,
                                ...(response.painDuringTraining === undefined ? {} : { painDuringTraining: response.painDuringTraining }),
                                ...(response.afterTrainingState === undefined ? {} : { afterTrainingState: response.afterTrainingState }),
                                ...(response.nextMorningReaction === undefined ? {} : { nextMorningReaction: response.nextMorningReaction }),
                            }])),
                    }),
                },
            })),
        }),
    };
    if (evaluator && (evaluator.userId !== input.userId || evaluator.date !== input.date)) {
        throw new TypeError('Decision context evaluator identity mismatch');
    }
    const captured = copyJson(payload);
    if (!validPayload(captured)) throw new TypeError('Invalid decision context payload');
    return { ...captured, contentHash: await hashPayload(captured) };
}

/** Rejects untrusted records before offline replay or an audit binding uses them. */
export async function validateDecisionContext(
    raw: unknown,
    expected: { userId: string; date: string; recommendationRevision: number },
): Promise<DecisionContextRecord> {
    if (!isObject(raw) || !exactKeys(raw, [
        'schemaVersion', 'userId', 'date', 'recommendationRevision', 'evaluatedAt',
        'policyVersion', 'captureVersion', 'appSource', 'minimumSafetyStatus', 'evaluatorInputs', 'performedTrainingFacts', 'contentHash',
    ], ['mechanicalCheckinHistory'])) throw new TypeError('Invalid decision context fields');
    const { contentHash, ...payload } = raw;
    if (!validPayload(payload) || payload.userId !== expected.userId || payload.date !== expected.date
        || payload.recommendationRevision !== expected.recommendationRevision
        || typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash)
        || await hashPayload(payload) !== contentHash) throw new TypeError('Invalid decision context or content hash');
    return raw as unknown as DecisionContextRecord;
}
