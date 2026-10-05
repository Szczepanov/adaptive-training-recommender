import { runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ExternalPlanSessionOccurrence, OccurrenceWindowBinding } from '../sessions/models';
import { isExternalPlanOccurrence } from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import { isV4Plan } from '../sessions/externalPlanV4';
import { SessionOccurrenceService, sessionOccurrenceService } from './sessionOccurrenceService';
import {
    adjudicateIntradayBundleMembers as adjudicateIntradayBundleMembersCore,
    type AdjudicateIntradayBundleMembersParams,
    type IntradayBundleMemberAdjudicationResult,
} from './intradayBundleMemberAdjudicationCore';

export type {
    AdjudicateIntradayBundleMembersParams,
    IntradayBundleMemberAdjudicationResult,
    IntradayBundleMemberStatus,
} from './intradayBundleMemberAdjudicationCore';

function sameWindowBinding(left: OccurrenceWindowBinding, right: OccurrenceWindowBinding): boolean {
    return left.windowId === right.windowId
        && left.bundleId === right.bundleId
        && left.order === right.order
        && left.boundStartLocal === right.boundStartLocal
        && left.boundEndLocal === right.boundEndLocal
        && left.startInstant === right.startInstant
        && left.endInstant === right.endInstant;
}

/**
 * Persist the primary member's resolved intraday binding while the occurrence is still
 * scheduled. Started history is immutable: a started/completed member without the exact
 * binding fails closed instead of being reconstructed from today's placement proposal.
 *
 * This wrapper deliberately leaves the existing D-REASSESS/D-AUDIT implementation in the
 * core module unchanged. The only new responsibility is the lifecycle invariant required by
 * #952 / #893 V9: once a bundle member can be launched, replay must have durable placement
 * evidence for that exact occurrence.
 */
async function sealPreparedPrimaryBinding(params: AdjudicateIntradayBundleMembersParams): Promise<void> {
    const { activePlan, bundlePlacement, userId, date, now = new Date().toISOString() } = params;
    if (!isV4Plan(activePlan.plan) || bundlePlacement.outcome !== 'placed' || !bundlePlacement.bindings?.length) {
        return;
    }

    const primaryPlacement = bundlePlacement.bindings[0];
    const primarySession = activePlan.plan.sessions.find(session => session.id === primaryPlacement.sessionId);
    if (!primarySession?.intraday || primarySession.isEvent || primarySession.definition.id === 'rest_01') {
        return;
    }

    const db = params.db ?? getDb();
    const occurrenceService = params.services?.occurrenceService
        ?? (params.db ? new SessionOccurrenceService(params.db) : sessionOccurrenceService);
    const allOccurrences = await occurrenceService.getOccurrencesForDate(userId, date);
    const candidates = allOccurrences.filter(
        (occurrence): occurrence is ExternalPlanSessionOccurrence =>
            isExternalPlanOccurrence(occurrence)
            && occurrence.date === date
            && occurrence.externalPlanRef.planId === activePlan.plan.planId
            && occurrence.externalPlanRef.revision === activePlan.plan.revision
            && occurrence.externalPlanRef.sessionId === primarySession.id
            && occurrence.externalPlanRef.contentHash === activePlan.header.contentHash
            && occurrence.state !== 'superseded',
    );

    // Some isolated adjudicator callers/tests intentionally do not prepare a primary occurrence.
    // Preserve that contract rather than inventing one here. Home's real launch path does prepare it.
    if (candidates.length === 0) return;
    if (candidates.length > 1) {
        throw new Error(`Primary bundle member '${primarySession.id}' has ambiguous prepared occurrences.`);
    }

    const candidate = candidates[0];
    const expectedWindowBinding: OccurrenceWindowBinding = {
        windowId: primaryPlacement.windowId,
        bundleId: primarySession.intraday.bundleId,
        order: primarySession.intraday.order,
        boundStartLocal: primaryPlacement.boundStartLocal,
        boundEndLocal: primaryPlacement.boundEndLocal,
        startInstant: primaryPlacement.startInstant,
        endInstant: primaryPlacement.endInstant,
    };
    const hasExactBinding = candidate.placementOrder === primarySession.intraday.order
        && candidate.windowBinding !== undefined
        && sameWindowBinding(candidate.windowBinding, expectedWindowBinding);

    if (candidate.placementOrder !== undefined && candidate.placementOrder !== primarySession.intraday.order) {
        throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} has conflicting placement order.`);
    }
    if (candidate.windowBinding && !sameWindowBinding(candidate.windowBinding, expectedWindowBinding)) {
        throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} has conflicting window binding.`);
    }
    if (candidate.state !== 'scheduled') {
        if (!hasExactBinding) {
            throw new Error(`Started bundle primary occurrence ${candidate.occurrenceId} is missing its exact binding.`);
        }
        return;
    }
    if (hasExactBinding) return;

    const occurrenceRef = occurrenceService.occurrenceRef(userId, candidate.occurrenceId);
    const windowRef = occurrenceService.windowReservationRef(userId, date, primaryPlacement.windowId);
    let sealed: ExternalPlanSessionOccurrence | null = null;

    await runTransaction(db, async transaction => {
        const occurrenceSnap = await transaction.get(occurrenceRef);
        const windowSnap = await transaction.get(windowRef);

        // Production should always have the prepared document. Unit-level callers often inject
        // the already-parsed occurrence through the service seam without mirroring Firestore;
        // use that exact object only when the document is absent, never a same-day/title lookup.
        let current: ExternalPlanSessionOccurrence = candidate;
        if (occurrenceSnap.exists()) {
            const parsed = parseSessionOccurrenceDocument(occurrenceSnap.data(), occurrenceRef.path);
            if (parsed.status !== 'AVAILABLE' || !isExternalPlanOccurrence(parsed.data)) {
                throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} is invalid.`);
            }
            current = parsed.data;
        }

        const exactSource = current.externalPlanRef.planId === activePlan.plan.planId
            && current.externalPlanRef.revision === activePlan.plan.revision
            && current.externalPlanRef.sessionId === primarySession.id
            && current.externalPlanRef.contentHash === activePlan.header.contentHash;
        if (!exactSource || current.date !== date || current.userId !== userId) {
            throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} does not match the active plan identity.`);
        }
        if (current.state !== 'scheduled') {
            throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} is already '${current.state}'.`);
        }
        if (current.placementOrder !== undefined && current.placementOrder !== primarySession.intraday.order) {
            throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} has conflicting placement order.`);
        }
        if (current.windowBinding && !sameWindowBinding(current.windowBinding, expectedWindowBinding)) {
            throw new Error(`Prepared bundle primary occurrence ${candidate.occurrenceId} has conflicting window binding.`);
        }
        if (windowSnap.exists()) {
            const owner = windowSnap.data()?.occurrenceId as string | undefined;
            if (owner !== candidate.occurrenceId) {
                throw new Error(`Primary bundle window '${primaryPlacement.windowId}' is already bound to '${owner ?? 'unknown'}'.`);
            }
        }

        sealed = {
            ...current,
            placementOrder: primarySession.intraday.order,
            windowBinding: expectedWindowBinding,
            updatedAt: now,
        };
        transaction.set(occurrenceRef, sealed);
        if (!windowSnap.exists()) {
            transaction.set(windowRef, {
                userId,
                date,
                windowId: primaryPlacement.windowId,
                occurrenceId: candidate.occurrenceId,
                createdAt: now,
            });
        }
    });

    // Preserve service-seam callers that reuse the returned object array; production reloads
    // the persisted value in the core path, so this assignment is only an in-memory mirror.
    if (sealed) Object.assign(candidate, sealed);
}

export async function adjudicateIntradayBundleMembers(
    params: AdjudicateIntradayBundleMembersParams,
): Promise<IntradayBundleMemberAdjudicationResult> {
    await sealPreparedPrimaryBinding(params);
    return adjudicateIntradayBundleMembersCore(params);
}
