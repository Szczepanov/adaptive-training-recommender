import { collection, doc, documentId, getDocs, limit, orderBy, query, runTransaction, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { FlagEvaluation } from '../derived/flags/flagEvaluation';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import { LEDGER_FLAG_IDS, LEDGER_STATES } from '../ledger/export/schema';
import { assertLocalDate } from '../ledger/export/window';
import { canonicalizeSessionData } from '../sessions/sessionDefinitionHash';
import type { DataState } from '../engine/dataState';

export const FLAG_EVALUATION_PAGE_SIZE = 200;
export const MAX_SCANNED_FLAG_EVALUATIONS = 2000;
const KEYS = ['schemaVersion', 'userId', 'revisionId', 'idempotencyKey', 'id', 'observedOn', 'evaluatedAt',
    'sessionRef', 'active', 'state', 'reasonCode', 'definitionVersion', 'threshold', 'baselineWindow', 'inputs'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
function jsonValue(v: unknown, depth = 0): boolean {
    if (depth > 8) return false;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.length <= 256 && v.every(item => jsonValue(item, depth + 1));
    return object(v) && Object.keys(v).length <= 128 && Object.values(v).every(item => jsonValue(item, depth + 1));
}
function userId(value: string): void {
    if (!value.trim() || value.includes('/')) throw new Error('Invalid flag owner');
}
function semantic(value: PersistedFlagEvaluation): unknown {
    const { evaluatedAt: _time, revisionId: _revision, idempotencyKey: _key, ...content } = value;
    void _time; void _revision; void _key;
    return canonicalizeSessionData(content);
}
export async function flagEvidenceDigest(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalizeSessionData(value))));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function identity(value: PersistedFlagEvaluation): Promise<string> {
    return 'flag-' + await flagEvidenceDigest(semantic(value));
}

export function parsePersistedFlagEvaluation(raw: unknown, expectedUserId: string, expectedRevisionId?: string): PersistedFlagEvaluation {
    userId(expectedUserId);
    if (!object(raw) || Object.keys(raw).some(key => !KEYS.includes(key)) || raw.schemaVersion !== 1
        || raw.userId !== expectedUserId || !text(raw.revisionId, 69) || !/^flag-[a-f0-9]{64}$/.test(raw.revisionId)
        || raw.idempotencyKey !== raw.revisionId || (expectedRevisionId !== undefined && raw.revisionId !== expectedRevisionId)
        || !LEDGER_FLAG_IDS.includes(raw.id as never) || !LEDGER_STATES.includes(raw.state as never)
        || (raw.active !== null && typeof raw.active !== 'boolean')
        || (raw.active !== null && raw.state !== 'measured' && !(raw.active === false && raw.state === 'not_applicable'))
        || !text(raw.definitionVersion, 160) || !text(raw.reasonCode, 160)
        || !(raw.threshold === null || text(raw.threshold, 8192))
        || !(raw.sessionRef === undefined || text(raw.sessionRef, 256))
        || !(raw.baselineWindow === undefined || text(raw.baselineWindow, 512))
        || !text(raw.evaluatedAt, 40) || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.evaluatedAt)
        || !Number.isFinite(Date.parse(raw.evaluatedAt))
        || !Array.isArray(raw.inputs) || raw.inputs.length > 16) throw new Error('Invalid flag evaluation');
    assertLocalDate(raw.observedOn as string, 'observedOn');
    assertLocalDate(raw.evaluatedAt.slice(0, 10), 'evaluatedAt');
    for (const input of raw.inputs) {
        if (!object(input) || Object.keys(input).some(key => !['name', 'value'].includes(key)) || !text(input.name, 128)
            || !object(input.value) || Object.keys(input.value).some(key => !['value', 'source', 'state', 'unit', 'observedOn'].includes(key))
            || !('value' in input.value) || !jsonValue(input.value.value) || !text(input.value.source, 128)
            || !LEDGER_STATES.includes(input.value.state as never)
            || (input.value.state === 'measured' && input.value.value === null)
            || !(input.value.unit === undefined || text(input.value.unit, 40))) throw new Error('Invalid flag input');
        if (input.value.observedOn !== undefined) assertLocalDate(input.value.observedOn as string, 'input.observedOn');
    }
    if (JSON.stringify(raw).length > 32768) throw new Error('Flag evaluation exceeds size limit');
    return raw as unknown as PersistedFlagEvaluation;
}

export async function buildFlagEvaluationRevision(input: {
    userId: string; observedOn: string; evaluatedAt: string; evaluation: FlagEvaluation; sessionRef?: string; baselineWindow?: string;
}): Promise<PersistedFlagEvaluation> {
    const pending: PersistedFlagEvaluation = {
        ...input.evaluation, schemaVersion: 1, userId: input.userId, observedOn: input.observedOn, evaluatedAt: input.evaluatedAt,
        revisionId: 'flag-' + '0'.repeat(64), idempotencyKey: 'flag-' + '0'.repeat(64),
        ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
        ...(input.baselineWindow ? { baselineWindow: input.baselineWindow } : {}),
    };
    parsePersistedFlagEvaluation(pending, input.userId);
    const key = await identity(pending);
    return { ...pending, revisionId: key, idempotencyKey: key };
}

export const flagEvaluationRepository = {
    async persistImmutable(input: PersistedFlagEvaluation): Promise<PersistedFlagEvaluation> {
        const value = parsePersistedFlagEvaluation(input, input.userId);
        if (await identity(value) !== value.revisionId) throw new Error('Flag identity mismatch');
        const ref = doc(getDb(), 'users', value.userId, 'flag_evaluations', value.revisionId);
        return runTransaction(getDb(), async tx => {
            const existing = await tx.get(ref);
            if (existing.exists()) {
                const prior = parsePersistedFlagEvaluation(existing.data(), value.userId, value.revisionId);
                if (JSON.stringify(semantic(prior)) !== JSON.stringify(semantic(value))) throw new Error('Immutable flag conflict');
                return prior;
            }
            tx.set(ref, value);
            return value;
        });
    },
    async getInRangeState(owner: string, start: string, end: string): Promise<DataState<PersistedFlagEvaluation[]>> {
        userId(owner); assertLocalDate(start, 'startDate'); assertLocalDate(end, 'endDate');
        if (start > end) throw new Error('Invalid flag date range');
        const data: PersistedFlagEvaluation[] = [];
        let cursor: QueryDocumentSnapshot | undefined;
        try {
            while (true) {
                const remaining = MAX_SCANNED_FLAG_EVALUATIONS - data.length;
                const page = await getDocs(query(collection(getDb(), 'users', owner, 'flag_evaluations'),
                    where('observedOn', '>=', start), where('observedOn', '<=', end), orderBy('observedOn'), orderBy(documentId()),
                    ...(cursor ? [startAfter(cursor)] : []), limit(Math.min(FLAG_EVALUATION_PAGE_SIZE, remaining + 1))));
                if (page.docs.length > remaining) return { status: 'UNAVAILABLE', operation: 'scan_limit_exceeded', retryable: false };
                for (const item of page.docs) {
                    try {
                        const value = parsePersistedFlagEvaluation(item.data(), owner, item.id);
                        if (value.observedOn < start || value.observedOn > end || await identity(value) !== value.revisionId) throw new Error('Flag identity mismatch');
                        data.push(value);
                    } catch {
                        return { status: 'INVALID', issues: [{ code: 'corrupt_record', documentPath: 'flag_evaluations' }] };
                    }
                }
                if (page.docs.length < Math.min(FLAG_EVALUATION_PAGE_SIZE, remaining + 1)) break;
                cursor = page.docs.at(-1);
            }
            return { status: 'AVAILABLE', data, revision: String(data.length) };
        } catch {
            return { status: 'UNAVAILABLE', operation: 'read flag evaluations', retryable: true };
        }
    },
};
