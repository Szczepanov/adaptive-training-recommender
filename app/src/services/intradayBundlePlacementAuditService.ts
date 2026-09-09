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

/**
 * Records the latest resolved placement for one date's bundle. Revision-gated (mirrors
 * `daily_ledgers`'s optimistic-concurrency rule) so a slower, stale computation can never
 * clobber a newer one that already committed -- it simply loses the race silently, which
 * is correct for passive display evidence.
 *
 * Never throws: a write failure is logged and swallowed so a display-only write can never
 * fail the caller's recommendation generation.
 */
export async function recordIntradayBundlePlacement(
    userId: string,
    date: string,
    proposal: BundlePlacementProposal,
): Promise<void> {
    try {
        const db = getDb();
        const ref = docRef(db, userId, date);
        const now = new Date().toISOString();
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists() ? (snapshot.data() as IntradayBundlePlacementRecord) : null;
            const record: IntradayBundlePlacementRecord = {
                userId,
                date,
                bundleId: proposal.bundleId,
                outcome: proposal.outcome,
                bindings: proposal.outcome === 'placed' ? (proposal.bindings ?? []) : [],
                reason: proposal.outcome === 'infeasible' ? (proposal.reason ?? null) : null,
                revision: (current?.revision ?? 0) + 1,
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
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
