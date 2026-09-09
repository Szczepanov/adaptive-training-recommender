/**
 * ADR-0036 (H4) D-PLACEMENT follow-up: persists a v4 intraday bundle's resolved window
 * placement for display, at `users/{userId}/intraday_bundle_placements/{date}`.
 *
 * Scope note (see `docs/plans/cycling-primary-hybrid-evaluation.md`, "Work item 2"):
 * this is deliberately the smaller, **display-only** slice of ADR-0036 D-AUDIT, not the
 * full contract. It does NOT satisfy D-AUDIT's complete bar -- there is no daily-ledger
 * ceiling/reservation snapshot, no override/supersession id, and replay does not
 * recompute or verify this document. It exists so a bundle's already-made placement
 * decision (computed live every time by `intradayBundlePlacement.ts`'s
 * `proposeBundlePlacement`, already wired into primary-session selection) can also be
 * shown after the fact, without depending on schedule-window/ledger state that may have
 * since changed.
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
import type { BundlePlacementProposal, ResolvedWindowBinding } from '../engine/intradayBundlePlacement';

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

function docRef(db: Firestore, userId: string, date: string) {
    return doc(db, 'users', userId, 'intraday_bundle_placements', date);
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
