/**
 * ADR-0036 (H4) D-PLACEMENT follow-up: persists a v4 intraday bundle's resolved window
 * placement for display, at `users/{userId}/intraday_bundle_placements/{date}`.
 *
 * This module now contains both the backward-compatible display reader/writer and the
 * immutable, replayable placement-audit slice of D-AUDIT. The latter stores the exact
 * placement inputs and plan/ledger snapshots beside the proposal and is replayed from
 * that snapshot only. Occurrence execution/response lifecycle fields remain owned by
 * `intradayDecisionService.ts` until the broader D-AUDIT follow-up is completed.
 *
 * Why a separate sibling document rather than a `recommendationAudit.externalPlan`
 * field: that path was already attempted and re-verified insufficient.
 * `hasValidRecommendationAudit` (`firestore.rules`) is already at Firestore's per-request
 * rule-evaluation ceiling; PR #468's cost reduction did not create enough headroom for
 * even a minimal `intradayBundle` check (see that function's own comment). Following
 * `daily_ledgers`/`intraday_decisions`'s existing precedent of a named sibling document
 * keeps this write inside its own, independent expression budget.
 *
 * The write is best-effort and non-blocking by design (mirrors Phase 5's `SessionResponse`
 * write discipline): a failure here must never fail or delay generating today's
 * recommendation, since this document is display evidence, not a decision input.
 */

import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import { proposeBundlePlacement, type BundlePlacementProposal, type IntradayBundleMember, type ResolvedWindowBinding } from '../engine/intradayBundlePlacement';
import type { FixedActivity, ScheduleWindow } from '../engine/models';
import { resolveRelativeLocalDate } from '../engine/externalPlacement';
import { computeDailyLedger, type DailyLedgerResult, type LedgerCeilings, type LedgerEntry } from '../engine/dailyLedger';
import { computeContentHash } from '../engine/externalPlanHash';
import { POLICY_VERSION } from '../engine/policy';
import { validateScheduleWindow, validateScheduleWindowSet } from '../engine/scheduleWindows';
import { validateFixedActivity } from '../engine/validation';
import { validateExternalTrainingPlanV4, type ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';

export interface IntradayBundlePlacementRecord {
    userId: string;
    date: string;
    bundleId: string;
    outcome: 'placed' | 'infeasible';
    bindings: ResolvedWindowBinding[];
    reason: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface IntradayBundlePlacementAuditInput {
    userId: string;
    date: string;
    asOf: string;
    policyVersion: string;
    plan: { planId: string; revision: number; contentHash: string };
    /** Exact immutable plan revision used to project the bundle members. */
    planSnapshot: ExternalTrainingPlanV4;
    bundleId: string;
    scheduleWindows: readonly ScheduleWindow[];
    fixedActivities: readonly FixedActivity[];
    restDates: readonly string[];
    planSessions: readonly { sessionId: string; date: string; status: 'planned' | 'moved' }[];
    members: readonly IntradayBundleMember[];
    ledger: { ceilings: LedgerCeilings; entries: readonly LedgerEntry[]; result: DailyLedgerResult };
    proposal: BundlePlacementProposal;
}

export interface IntradayBundlePlacementAudit extends IntradayBundlePlacementAuditInput {
    schemaVersion: 'intraday_bundle_placement_audit_v1';
    auditId: string;
    snapshotHash: string;
    createdAt: string;
}

export interface IntradayBundlePlacementReplayResult {
    valid: boolean;
    failures: string[];
}

const AUDIT_SCHEMA_VERSION = 'intraday_bundle_placement_audit_v1' as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function docRef(db: Firestore, userId: string, date: string) {
    return doc(db, 'users', userId, 'intraday_bundle_placements', date);
}

function auditDocRef(db: Firestore, userId: string, auditId: string) {
    return doc(db, 'users', userId, 'intraday_bundle_placement_audits', auditId);
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonical(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateAuditInput(input: IntradayBundlePlacementAuditInput): void {
    if (!input || typeof input !== 'object') throw new Error('Invalid intraday placement audit');
    if (!input.userId || !DATE_PATTERN.test(input.date) || !input.asOf || Number.isNaN(Date.parse(input.asOf)) || !input.policyVersion || !input.bundleId) {
        throw new Error('Invalid intraday placement audit identity');
    }
    if (!input.plan || typeof input.plan !== 'object'
        || !Number.isInteger(input.plan.revision) || input.plan.revision < 1
        || !input.plan.planId || !SHA256_PATTERN.test(input.plan.contentHash)) {
        throw new Error('Invalid external plan identity');
    }
    if (!input.planSnapshot || typeof input.planSnapshot !== 'object'
        || input.planSnapshot.planId !== input.plan.planId
        || input.planSnapshot.revision !== input.plan.revision
        || input.planSnapshot.schema !== 'adaptive-training-recommender/external-plan@4') {
        throw new Error('Invalid frozen external plan snapshot');
    }
    const planValidation = validateExternalTrainingPlanV4(input.planSnapshot);
    if (!planValidation.isValid) throw new Error('Invalid frozen external plan snapshot');
    if (input.proposal?.bundleId !== input.bundleId) throw new Error('Placement proposal bundle identity mismatch');
    if (!Array.isArray(input.scheduleWindows) || input.scheduleWindows.length > 8
        || !Array.isArray(input.fixedActivities) || input.fixedActivities.length > 32
        || !Array.isArray(input.restDates) || input.restDates.length > 64
        || !Array.isArray(input.planSessions) || input.planSessions.length === 0 || input.planSessions.length > 8
        || !Array.isArray(input.members) || input.members.length === 0 || input.members.length > 8) {
        throw new Error('Invalid placement replay inputs');
    }
    input.scheduleWindows.forEach((window, index) => {
        const validation = validateScheduleWindow(window);
        if (!validation.isValid || !validation.data || validation.data.userId !== input.userId) {
            throw new Error(`Invalid schedule window snapshot at index ${index}`);
        }
    });
    if (validateScheduleWindowSet(input.scheduleWindows).length > 0) throw new Error('Invalid schedule window snapshot');
    input.fixedActivities.forEach((activity, index) => {
        const validation = validateFixedActivity(activity);
        if (!validation.isValid || !validation.data || validation.data.userId !== input.userId) {
            throw new Error(`Invalid fixed-activity snapshot at index ${index}`);
        }
    });
    input.restDates.forEach((date, index) => {
        if (typeof date !== 'string' || !DATE_PATTERN.test(date)) throw new Error(`Invalid rest-date snapshot at index ${index}`);
    });
    const expectedRestDates = input.planSnapshot.restDays
        .map(directive => resolveRelativeLocalDate(input.planSnapshot.startDate, directive.week, directive.day))
        .sort();
    if (!equalJson(expectedRestDates, [...input.restDates].sort())) throw new Error('Rest-date snapshot does not match the frozen plan');
    input.members.forEach((member, index) => {
        if (!member || typeof member !== 'object' || !member.sessionId || !Number.isInteger(member.order) || member.order < 0) {
            throw new Error(`Invalid placement replay member at index ${index}`);
        }
        if (!member.requestedWindow || typeof member.requestedWindow !== 'object'
            || typeof member.requestedWindow.startLocal !== 'string' || typeof member.requestedWindow.endLocal !== 'string'
            || !Number.isFinite(member.estimatedMinutes) || member.estimatedMinutes < 0
            || !Number.isFinite(member.estimatedSystemicCost) || member.estimatedSystemicCost < 0 || member.estimatedSystemicCost > 1
            || typeof member.started !== 'boolean') {
            throw new Error(`Invalid placement replay member at index ${index}`);
        }
        if (member.started && !member.existingBinding) throw new Error(`Started placement replay member at index ${index} is missing its binding`);
        if (member.requiredEquipment !== undefined
            && (!Array.isArray(member.requiredEquipment) || member.requiredEquipment.some((item: unknown) => typeof item !== 'string'))) {
            throw new Error(`Invalid placement replay member at index ${index}`);
        }
        if (member.requiredEnvironment !== undefined && !['indoor', 'outdoor', 'either'].includes(member.requiredEnvironment)) {
            throw new Error(`Invalid placement replay member at index ${index}`);
        }
        if (member.existingBinding !== undefined) validateBinding(member.existingBinding, `member ${index} binding`);
    });
    const memberIds = new Set(input.members.map(member => member.sessionId));
    const projectionIds = new Set<string>();
    input.planSessions.forEach((projection, index) => {
        if (!projection || typeof projection !== 'object' || !projection.sessionId || !DATE_PATTERN.test(projection.date)
            || !['planned', 'moved'].includes(projection.status) || projection.date !== input.date
            || projectionIds.has(projection.sessionId)) {
            throw new Error(`Invalid plan-session projection at index ${index}`);
        }
        projectionIds.add(projection.sessionId);
        const session = input.planSnapshot.sessions.find(candidate => candidate.id === projection.sessionId);
        const member = input.members.find(candidate => candidate.sessionId === projection.sessionId);
        if (!session?.intraday || !member || session.intraday.bundleId !== input.bundleId
            || session.intraday.order !== member.order
            || !equalJson(session.intraday.window, member.requestedWindow)
            || !equalJson(session.intraday.afterSessionId, member.afterSessionId)
            || !equalJson(session.intraday.minimumSeparationMinutes, member.minimumSeparationMinutes)) {
            throw new Error(`Plan-session projection does not match the frozen plan at index ${index}`);
        }
    });
    if (projectionIds.size !== memberIds.size || [...memberIds].some(id => !projectionIds.has(id))) {
        throw new Error('Plan-session projection does not match placement members');
    }
    if (!input.ledger || !input.ledger.ceilings || !Array.isArray(input.ledger.entries) || !input.ledger.result) throw new Error('Invalid ledger snapshot');
    if (input.ledger.entries.length > 50) throw new Error('Invalid ledger snapshot');
    const recomputedLedger = computeDailyLedger(input.ledger.ceilings, input.ledger.entries);
    if (!equalJson(recomputedLedger, input.ledger.result)) throw new Error('Ledger snapshot result mismatch');
    validateProposal(input.proposal, input.bundleId);
}

function validateAudit(audit: IntradayBundlePlacementAudit): void {
    validateAuditInput(audit);
    if (audit.schemaVersion !== AUDIT_SCHEMA_VERSION) throw new Error('Unsupported intraday placement audit schema version');
    if (!audit.auditId || !audit.auditId.startsWith('audit_')) throw new Error('Invalid intraday placement audit id');
    if (!audit.createdAt || Number.isNaN(Date.parse(audit.createdAt))) throw new Error('Invalid intraday placement audit creation timestamp');
}

function validateBinding(binding: unknown, label: string): void {
    if (!binding || typeof binding !== 'object') throw new Error(`Invalid ${label}`);
    const value = binding as Partial<ResolvedWindowBinding>;
    if (!value.sessionId || !value.windowId || !value.boundStartLocal || !value.boundEndLocal
        || !value.startInstant || Number.isNaN(Date.parse(value.startInstant))
        || !value.endInstant || Number.isNaN(Date.parse(value.endInstant))) {
        throw new Error(`Invalid ${label}`);
    }
}

function validateProposal(proposal: BundlePlacementProposal, bundleId: string): void {
    if (!proposal || typeof proposal !== 'object' || proposal.bundleId !== bundleId
        || !['placed', 'infeasible'].includes(proposal.outcome)) {
        throw new Error('Invalid placement proposal snapshot');
    }
    if (proposal.outcome === 'placed') {
        if (!Array.isArray(proposal.bindings) || proposal.bindings.length === 0) throw new Error('Invalid placed proposal snapshot');
        proposal.bindings.forEach((binding, index) => validateBinding(binding, `proposal binding ${index}`));
    } else if (typeof proposal.reason !== 'string' || proposal.reason.length === 0) {
        throw new Error('Invalid infeasible proposal snapshot');
    }
}

function equalJson(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }

function withoutUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => withoutUndefined(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, withoutUndefined(item)]));
    }
    return value;
}

function withoutAsOf(input: IntradayBundlePlacementAuditInput): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'asOf'));
}

function withoutAuditMetadata(audit: IntradayBundlePlacementAudit): Record<string, unknown> {
    return Object.fromEntries(Object.entries(audit).filter(([key]) => !['schemaVersion', 'auditId', 'snapshotHash', 'createdAt'].includes(key)));
}

function auditSemanticPayload(audit: IntradayBundlePlacementAudit): Record<string, unknown> {
    return Object.fromEntries(Object.entries(withoutAuditMetadata(audit)).filter(([key]) => key !== 'asOf'));
}

function proposalForAudit(audit: IntradayBundlePlacementAudit): BundlePlacementProposal {
    return proposeBundlePlacement(
        audit.bundleId,
        audit.date,
        audit.members,
        audit.scheduleWindows,
        audit.fixedActivities,
        new Set(audit.restDates),
        audit.ledger.result,
    );
}

/** Verifies only the immutable snapshot; it never reads current plan, clock, or wearable state. */
export async function replayIntradayBundlePlacementAudit(audit: IntradayBundlePlacementAudit): Promise<IntradayBundlePlacementReplayResult> {
    const failures: string[] = [];
    try {
        validateAudit(audit);
        if (audit.schemaVersion !== AUDIT_SCHEMA_VERSION) failures.push('schema version mismatch');
        if (audit.policyVersion !== POLICY_VERSION) failures.push('policy version mismatch');
        if (await computeContentHash(audit.planSnapshot) !== audit.plan.contentHash) failures.push('external plan content hash mismatch');
        if (audit.proposal.bundleId !== audit.bundleId) failures.push('proposal bundle identity mismatch');
        const recomputedLedger = computeDailyLedger(audit.ledger.ceilings, audit.ledger.entries);
        if (!equalJson(recomputedLedger, audit.ledger.result)) failures.push('ledger snapshot mismatch');
        const proposal = proposalForAudit(audit);
        if (!equalJson(proposal, audit.proposal)) failures.push('placement proposal mismatch');
        if (await sha256(canonical(withoutAuditMetadata(audit))) !== audit.snapshotHash) failures.push('snapshot integrity/hash mismatch');
        const semanticInput = auditSemanticPayload(audit);
        if (`audit_${await sha256(canonical(semanticInput))}` !== audit.auditId) failures.push('audit identity/hash mismatch');
    } catch (error) {
        failures.push(error instanceof Error ? error.message : 'invalid audit contract');
    }
    return { valid: failures.length === 0, failures };
}

export async function recordIntradayBundlePlacementAudit(input: IntradayBundlePlacementAuditInput): Promise<IntradayBundlePlacementAudit> {
    validateAuditInput(input);
    const normalizedInput = withoutUndefined(input) as IntradayBundlePlacementAuditInput;
    if (input.policyVersion !== POLICY_VERSION) throw new Error('Placement audit policy version must match the active policy');
    if (await computeContentHash(normalizedInput.planSnapshot) !== normalizedInput.plan.contentHash) throw new Error('External plan content hash does not match the frozen plan snapshot');
    const auditId = `audit_${await sha256(canonical(withoutAsOf(normalizedInput)))}`;
    const snapshotHash = await sha256(canonical(normalizedInput));
    const audit: IntradayBundlePlacementAudit = { ...normalizedInput, schemaVersion: 'intraday_bundle_placement_audit_v1', auditId, snapshotHash, createdAt: new Date().toISOString() };
    let persistedAudit = audit;
    try {
        const db = getDb();
        await runTransaction(db, async transaction => {
            const ref = auditDocRef(db, normalizedInput.userId, auditId);
            const snapshot = await transaction.get(ref);
            if (snapshot.exists()) {
                const existing = snapshot.data() as IntradayBundlePlacementAudit;
                if (!equalJson(auditSemanticPayload(existing), auditSemanticPayload(audit))) throw new Error('Immutable placement audit identity collision');
                persistedAudit = existing;
                return;
            }
            transaction.set(ref, audit);
        });
    } catch (error) {
        console.error('recordIntradayBundlePlacementAudit: best-effort write failed', error);
    }
    return persistedAudit;
}

export async function getIntradayBundlePlacementAudit(userId: string, auditId: string): Promise<IntradayBundlePlacementAudit | null> {
    const snapshot = await getDoc(auditDocRef(getDb(), userId, auditId));
    if (!snapshot.exists()) return null;
    const audit = snapshot.data() as IntradayBundlePlacementAudit;
    validateAudit(audit);
    if (audit.auditId !== auditId || audit.userId !== userId) throw new Error('Intraday placement audit path identity mismatch');
    return audit;
}

function bindingsEqual(left: ResolvedWindowBinding[], right: ResolvedWindowBinding[]): boolean {
    return left.length === right.length && left.every((binding, index) => {
        const other = right[index];
        return other !== undefined
            && binding.sessionId === other.sessionId
            && binding.windowId === other.windowId
            && binding.boundStartLocal === other.boundStartLocal
            && binding.boundEndLocal === other.boundEndLocal
            && binding.startInstant === other.startInstant
            && binding.endInstant === other.endInstant;
    });
}

function samePlacement(
    current: IntradayBundlePlacementRecord,
    proposal: BundlePlacementProposal,
): boolean {
    const bindings = proposal.outcome === 'placed' ? (proposal.bindings ?? []) : [];
    const reason = proposal.outcome === 'infeasible' ? (proposal.reason ?? null) : null;
    return current.bundleId === proposal.bundleId
        && current.outcome === proposal.outcome
        && current.reason === reason
        && bindingsEqual(current.bindings, bindings);
}

/**
 * Records the latest resolved placement for one date's bundle.
 *
 * Firestore transactions retry when a document read by the transaction changes. A plain
 * `revision + 1` therefore serializes writes but does **not** prove freshness: an older
 * computation can retry after a newer one and otherwise become the last writer. Capture
 * `observedAt` before entering the retriable callback and keep it fixed across retries;
 * when a later observation has already committed, this attempt no-ops. Re-saving the
 * exact same placement also no-ops so passive dashboard refreshes do not manufacture audit
 * revisions with no evidence change.
 *
 * Never throws: a write failure is logged and swallowed so a display-only write can never
 * fail the caller's recommendation generation.
 */
export async function recordIntradayBundlePlacement(
    userId: string,
    date: string,
    proposal: BundlePlacementProposal,
): Promise<void> {
    const observedAt = new Date().toISOString();
    try {
        const db = getDb();
        const ref = docRef(db, userId, date);
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists() ? (snapshot.data() as IntradayBundlePlacementRecord) : null;

            if (current) {
                if (samePlacement(current, proposal)) return;
                const currentUpdatedAt = Date.parse(current.updatedAt);
                const observedAtMs = Date.parse(observedAt);
                if (Number.isFinite(currentUpdatedAt)
                    && Number.isFinite(observedAtMs)
                    && currentUpdatedAt >= observedAtMs) {
                    return;
                }
            }

            const record: IntradayBundlePlacementRecord = {
                userId,
                date,
                bundleId: proposal.bundleId,
                outcome: proposal.outcome,
                bindings: proposal.outcome === 'placed' ? (proposal.bindings ?? []) : [],
                reason: proposal.outcome === 'infeasible' ? (proposal.reason ?? null) : null,
                revision: (current?.revision ?? 0) + 1,
                createdAt: current?.createdAt ?? observedAt,
                updatedAt: observedAt,
            };
            transaction.set(ref, record);
        });
    } catch (error) {
        console.error('recordIntradayBundlePlacement: best-effort write failed', error);
    }
}

/** Reads the persisted placement for one date, or null when never recorded. Read-only;
 * callers must not treat this as authoritative for any decision -- it is display evidence
 * of what `proposeBundlePlacement` already resolved live. */
export async function getIntradayBundlePlacement(
    userId: string,
    date: string,
): Promise<IntradayBundlePlacementRecord | null> {
    const db = getDb();
    const snapshot = await getDoc(docRef(db, userId, date));
    return snapshot.exists() ? (snapshot.data() as IntradayBundlePlacementRecord) : null;
}
