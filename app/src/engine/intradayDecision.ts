/**
 * ADR-0036 (H4) D-AUDIT: Intraday decision record, validation, and replay verification.
 *
 * Persists immutable decision-level audit snapshots of intraday training window
 * placement, ledger capacity, input revisions, and reassessment verdicts in a
 * dedicated user-scoped subcollection (`users/{userId}/intraday_decisions/{decisionId}`).
 *
 * Write-once append-only semantics: decision records are never updated in-place;
 * supersession chains are maintained via `supersededDecisionId`.
 */

import type { BundlePlacementProposal, ResolvedWindowBinding } from './intradayBundlePlacement';
import type { LedgerCeilings, LedgerEntry } from './dailyLedger';
import type { ExternalRevisionEvidence } from './replay';
import { POLICY_VERSION } from './policy';
import { isV4Plan, type ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';

export type IntradayDecisionStatus = 'provisional' | 'confirmed' | 'superseded' | 'dropped';

export type IntradayDecisionVerdictOutcome = 'proceed' | 'scale' | 'defer' | 'skip' | 'pending';

export interface ReassessmentInputRevision {
    availabilityRevision: string;
    completedFactsRevision: string;
    checkinRevision: string;
    ledgerRevision: string;
    placementRevision: string;
}

export interface IntradayDecisionLedgerSnapshot {
    ceilings: LedgerCeilings;
    entries: readonly LedgerEntry[];
}

export interface IntradayDecisionVerdict {
    decision: IntradayDecisionVerdictOutcome;
    reasons: readonly string[];
}

export interface IntradayDecisionRecord {
    /** Unique decision identifier (UUID v4), matches Firestore document ID */
    id: string;
    userId: string;
    /** Warsaw local calendar date (YYYY-MM-DD) */
    date: string;
    /** ISO 8601 evaluation timestamp */
    asOf: string;
    policyVersion: string;
    schemaVersion: 1;

    /** Decision status */
    status: IntradayDecisionStatus;
    /** Points to an earlier decision ID replaced by this evaluation, if any */
    supersededDecisionId: string | null;

    /** Occurrence and window identity bindings */
    occurrenceId: string;
    sessionId: string;
    windowId: string;
    bundleId: string;
    orderInBundle: number;

    /** Saved input revision fingerprints for change detection */
    reassessmentInputRevision: ReassessmentInputRevision;
    /** Scheduled bundle placement proposal */
    bundlePlacement: BundlePlacementProposal;
    /** Saved ledger capacity ceilings and entries snapshot */
    ledgerSnapshot: IntradayDecisionLedgerSnapshot;

    /** Decision outcome and reasons */
    verdict: IntradayDecisionVerdict;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES: ReadonlySet<string> = new Set(['provisional', 'confirmed', 'superseded', 'dropped']);
const VALID_VERDICTS: ReadonlySet<string> = new Set(['proceed', 'scale', 'defer', 'skip', 'pending']);

function assertString(val: unknown, label: string, min = 1, max = 128): string {
    if (typeof val !== 'string' || val.length < min || val.length > max) {
        throw new TypeError(`${label} must be a string with length between ${min} and ${max}`);
    }
    return val;
}

function assertInteger(val: unknown, label: string, min = 0): number {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < min) {
        throw new RangeError(`${label} must be an integer >= ${min}`);
    }
    return val;
}

export function validateIntradayDecisionRecord(raw: unknown): IntradayDecisionRecord {
    if (!raw || typeof raw !== 'object') {
        throw new TypeError('IntradayDecisionRecord must be a non-null object');
    }
    const data = raw as Record<string, unknown>;

    const id = assertString(data.id, 'id', 1, 128);
    const userId = assertString(data.userId, 'userId', 1, 128);
    const date = assertString(data.date, 'date', 10, 10);
    if (!DATE_REGEX.test(date)) {
        throw new TypeError(`date must match YYYY-MM-DD: ${date}`);
    }

    const asOf = assertString(data.asOf, 'asOf', 1, 64);
    if (Number.isNaN(Date.parse(asOf))) {
        throw new TypeError(`asOf must be a valid ISO 8601 timestamp: ${asOf}`);
    }

    const policyVersion = assertString(data.policyVersion, 'policyVersion', 1, 128);
    if (data.schemaVersion !== 1) {
        throw new TypeError(`schemaVersion must be 1, got ${data.schemaVersion}`);
    }

    if (typeof data.status !== 'string' || !VALID_STATUSES.has(data.status)) {
        throw new TypeError(`status must be one of ${Array.from(VALID_STATUSES).join(', ')}`);
    }
    const status = data.status as IntradayDecisionStatus;

    let supersededDecisionId: string | null = null;
    if (data.supersededDecisionId !== null && data.supersededDecisionId !== undefined) {
        supersededDecisionId = assertString(data.supersededDecisionId, 'supersededDecisionId', 1, 128);
    }

    const occurrenceId = assertString(data.occurrenceId, 'occurrenceId', 1, 128);
    const sessionId = assertString(data.sessionId, 'sessionId', 1, 128);
    const windowId = assertString(data.windowId, 'windowId', 1, 128);
    const bundleId = assertString(data.bundleId, 'bundleId', 1, 128);
    const orderInBundle = assertInteger(data.orderInBundle, 'orderInBundle', 0);

    if (!data.reassessmentInputRevision || typeof data.reassessmentInputRevision !== 'object') {
        throw new TypeError('reassessmentInputRevision must be a non-null object');
    }
    const rev = data.reassessmentInputRevision as Record<string, unknown>;
    const reassessmentInputRevision: ReassessmentInputRevision = {
        availabilityRevision: assertString(rev.availabilityRevision, 'reassessmentInputRevision.availabilityRevision', 1, 128),
        completedFactsRevision: assertString(rev.completedFactsRevision, 'reassessmentInputRevision.completedFactsRevision', 1, 128),
        checkinRevision: assertString(rev.checkinRevision, 'reassessmentInputRevision.checkinRevision', 1, 128),
        ledgerRevision: assertString(rev.ledgerRevision, 'reassessmentInputRevision.ledgerRevision', 1, 128),
        placementRevision: assertString(rev.placementRevision, 'reassessmentInputRevision.placementRevision', 1, 128),
    };

    if (!data.bundlePlacement || typeof data.bundlePlacement !== 'object') {
        throw new TypeError('bundlePlacement must be a non-null object');
    }
    const bp = data.bundlePlacement as Record<string, unknown>;
    const placementBundleId = assertString(bp.bundleId, 'bundlePlacement.bundleId', 1, 128);
    if (bp.outcome !== 'placed' && bp.outcome !== 'infeasible') {
        throw new TypeError('bundlePlacement.outcome must be "placed" or "infeasible"');
    }

    let bundlePlacement: BundlePlacementProposal;
    if (bp.outcome === 'placed') {
        if (!Array.isArray(bp.bindings)) {
            throw new TypeError('bundlePlacement.bindings must be an array when outcome is "placed"');
        }
        if (bp.bindings.length === 0) {
            throw new TypeError('bundlePlacement.bindings must contain at least one binding when outcome is "placed"');
        }
        const validatedBindings: ResolvedWindowBinding[] = bp.bindings.map((b, idx) => {
            if (!b || typeof b !== 'object') {
                throw new TypeError(`bundlePlacement.bindings[${idx}] must be a non-null object`);
            }
            const item = b as Record<string, unknown>;
            return {
                sessionId: assertString(item.sessionId, `bundlePlacement.bindings[${idx}].sessionId`, 1, 128),
                windowId: assertString(item.windowId, `bundlePlacement.bindings[${idx}].windowId`, 1, 128),
                boundStartLocal: assertString(item.boundStartLocal, `bundlePlacement.bindings[${idx}].boundStartLocal`, 1, 64),
                boundEndLocal: assertString(item.boundEndLocal, `bundlePlacement.bindings[${idx}].boundEndLocal`, 1, 64),
                startInstant: assertString(item.startInstant, `bundlePlacement.bindings[${idx}].startInstant`, 1, 64),
                endInstant: assertString(item.endInstant, `bundlePlacement.bindings[${idx}].endInstant`, 1, 64),
            };
        });
        bundlePlacement = {
            bundleId: placementBundleId,
            outcome: 'placed',
            bindings: validatedBindings,
        };
    } else {
        const reason = assertString(bp.reason, 'bundlePlacement.reason', 1, 512);
        bundlePlacement = {
            bundleId: placementBundleId,
            outcome: 'infeasible',
            reason,
        };
    }

    if (!data.ledgerSnapshot || typeof data.ledgerSnapshot !== 'object') {
        throw new TypeError('ledgerSnapshot must be a non-null object');
    }
    const ls = data.ledgerSnapshot as Record<string, unknown>;
    if (!ls.ceilings || typeof ls.ceilings !== 'object') {
        throw new TypeError('ledgerSnapshot.ceilings must be an object');
    }
    const ceilings = ls.ceilings as Record<string, unknown>;
    if (typeof ceilings.dailyMinuteCeiling !== 'number' || !Number.isFinite(ceilings.dailyMinuteCeiling) || ceilings.dailyMinuteCeiling < 0) {
        throw new TypeError('ledgerSnapshot.ceilings.dailyMinuteCeiling must be a finite number >= 0');
    }
    if (typeof ceilings.dailySystemicCostCeiling !== 'number' || !Number.isFinite(ceilings.dailySystemicCostCeiling) || ceilings.dailySystemicCostCeiling < 0 || ceilings.dailySystemicCostCeiling > 1) {
        throw new TypeError('ledgerSnapshot.ceilings.dailySystemicCostCeiling must be a finite number in [0, 1]');
    }
    if (!Array.isArray(ls.entries)) {
        throw new TypeError('ledgerSnapshot.entries must be an array');
    }
    const ledgerSnapshot: IntradayDecisionLedgerSnapshot = {
        ceilings: {
            dailyMinuteCeiling: ceilings.dailyMinuteCeiling,
            dailySystemicCostCeiling: ceilings.dailySystemicCostCeiling,
        },
        entries: ls.entries as readonly LedgerEntry[],
    };

    if (!data.verdict || typeof data.verdict !== 'object') {
        throw new TypeError('verdict must be a non-null object');
    }
    const vd = data.verdict as Record<string, unknown>;
    if (typeof vd.decision !== 'string' || !VALID_VERDICTS.has(vd.decision)) {
        throw new TypeError(`verdict.decision must be one of ${Array.from(VALID_VERDICTS).join(', ')}`);
    }
    if (!Array.isArray(vd.reasons)) {
        throw new TypeError('verdict.reasons must be an array of strings');
    }
    const verdict: IntradayDecisionVerdict = {
        decision: vd.decision as IntradayDecisionVerdictOutcome,
        reasons: vd.reasons.map((r, i) => assertString(r, `verdict.reasons[${i}]`, 1, 256)),
    };

    return {
        id,
        userId,
        date,
        asOf,
        policyVersion,
        schemaVersion: 1,
        status,
        supersededDecisionId,
        occurrenceId,
        sessionId,
        windowId,
        bundleId,
        orderInBundle,
        reassessmentInputRevision,
        bundlePlacement,
        ledgerSnapshot,
        verdict,
    };
}

export function intradayDecisionReplayErrors(
    record: IntradayDecisionRecord,
    externalRevision: ExternalRevisionEvidence | null = null,
): string[] {
    const errors: string[] = [];

    if ((record as { schemaVersion?: unknown }).schemaVersion !== 1) {
        errors.push(`Unsupported intraday decision schema version: ${record.schemaVersion}`);
    }

    if (record.policyVersion !== POLICY_VERSION) {
        errors.push(`Policy version ${record.policyVersion} does not match current build policy version ${POLICY_VERSION}`);
    }

    if (!VALID_STATUSES.has(record.status)) {
        errors.push(`Invalid decision status: ${record.status}`);
    }

    const bp = record.bundlePlacement;
    if (!bp) {
        errors.push('Intraday decision record is missing bundlePlacement');
    } else {
        if (bp.bundleId !== record.bundleId) {
            errors.push(`Bundle identity mismatch: record references ${record.bundleId} but bundlePlacement recorded ${bp.bundleId}`);
        }
        if (bp.outcome === 'placed') {
            if (!Array.isArray(bp.bindings) || bp.bindings.length === 0) {
                errors.push('Bundle placement marked placed but contains no window bindings');
            } else {
                const targetBinding = bp.bindings.find(b => b && typeof b === 'object' && b.sessionId === record.sessionId);
                if (!targetBinding) {
                    errors.push(`Bundle placement does not bind target session ${record.sessionId}`);
                } else if (targetBinding.windowId !== record.windowId) {
                    errors.push(`Window binding mismatch: record references ${record.windowId} but bundlePlacement bound ${targetBinding.windowId}`);
                }
            }
        } else if (bp.outcome === 'infeasible') {
            if (typeof bp.reason !== 'string' || bp.reason.trim().length === 0) {
                errors.push('Bundle placement marked infeasible but contains no failure reason');
            }
        } else {
            errors.push(`Unknown bundle placement outcome: ${bp.outcome}`);
        }
    }

    const ls = record.ledgerSnapshot;
    if (!ls) {
        errors.push('Intraday decision record is missing ledgerSnapshot');
    } else {
        if (ls.ceilings.dailyMinuteCeiling < 0 || !Number.isFinite(ls.ceilings.dailyMinuteCeiling)) {
            errors.push('Ledger snapshot contains invalid dailyMinuteCeiling');
        }
        if (ls.ceilings.dailySystemicCostCeiling < 0 || ls.ceilings.dailySystemicCostCeiling > 1 || !Number.isFinite(ls.ceilings.dailySystemicCostCeiling)) {
            errors.push('Ledger snapshot contains invalid dailySystemicCostCeiling');
        }
    }

    if (externalRevision) {
        const rawPlan = externalRevision.plan as unknown as { schema: string };
        if (!isV4Plan(rawPlan)) {
            errors.push('Supplied external plan is not an external-plan@4 revision; cannot verify intraday bundle');
        } else {
            const v4Plan = externalRevision.plan as unknown as ExternalTrainingPlanV4;
            const planSession = v4Plan.sessions.find(s => s.id === record.sessionId);
            if (!planSession) {
                errors.push(`Session ${record.sessionId} is not present in plan ${v4Plan.planId}`);
            } else if (!planSession.intraday) {
                errors.push(`Session ${record.sessionId} in plan ${v4Plan.planId} has no intraday specification`);
            } else {
                if (planSession.intraday.bundleId !== record.bundleId) {
                    errors.push(`Session bundle mismatch: plan specifies bundle ${planSession.intraday.bundleId}, audit recorded ${record.bundleId}`);
                }
                if (planSession.intraday.order !== record.orderInBundle) {
                    errors.push(`Session order mismatch: plan specifies order ${planSession.intraday.order}, audit recorded ${record.orderInBundle}`);
                }
            }
        }
    }

    return errors;
}
