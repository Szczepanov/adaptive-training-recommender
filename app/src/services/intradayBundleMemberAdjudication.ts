/**
 * ADR-0036 (H4) D-REASSESS / D-AUDIT: Intraday bundle member adjudication loop and transaction wiring.
 * (docs/plans/h4-434-pr3-bundle-second-member-launch.md, Phase 3 steps 8, 8/2a, 9).
 *
 * Surfaces non-primary members of a placed v4 intraday bundle as launchable `additionalSessions`
 * entries on Home.tsx, evaluates D-REASSESS per member, manages atomic multi-document
 * occurrence/ledger/decision transactions, and handles rejection/recovery cycles.
 */

import {
    doc,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    DailyReadiness,
    SubjectiveInput,
    EngineObjectiveInput,
    UserContext,
    PlannedDose,
    RegionTissueResponse,
} from '../engine/models';
import type {
    SessionReferenceBinding,
    OccurrenceWindowBinding,
    ExternalPlanOccurrenceRef,
    ExternalPlanSessionOccurrence,
} from '../sessions/models';
import { isExternalPlanOccurrence } from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import type { BundlePlacementProposal } from '../engine/intradayBundlePlacement';
import type { LedgerCeilings } from '../engine/dailyLedger';
import { computeDailyLedger } from '../engine/dailyLedger';
import { buildLedgerEntries, type OccurrenceLedgerInput } from '../engine/intradayLedgerInputs';
import {
    reassessDependentBundleMember,
    computeReassessmentInputRevision,
    type DependentBundleMemberTarget,
    type PredecessorEvidence,
    type ReassessmentInputRevision,
} from '../engine/intradayReassessment';
import {
    type IntradayDecisionRecord,
    validateIntradayDecisionRecord,
} from '../engine/intradayDecision';
import {
    deterministicIntradayDecisionId,
    writeProvisionalDecisionInTransaction,
    getIntradayDecisionDocPath,
} from './intradayDecisionService';
import {
    SessionOccurrenceService,
    sessionOccurrenceService,
    deterministicExternalPlanOccurrenceId,
} from './sessionOccurrenceService';
import {
    DailyLedgerAggregateService,
    dailyLedgerAggregateService,
    type DailyLedgerAggregate,
} from './dailyLedgerAggregateService';
import {
    prepareExternalPlanSessionLaunch,
} from './sessionAuthoringService';
import {
    SessionResponseService,
    sessionResponseService,
} from './sessionResponseService';
import {
    SessionExecutionService,
    sessionExecutionService,
} from './sessionExecutionService';
import type { ActiveExternalPlan } from './activeExternalPlanService';
import { isV4Plan, type ExternalPlanSessionV4 } from '../sessions/externalPlanV4';
import { estimateAuthoredSessionSystemicCost } from '../engine/authoredSessionGates';
import { POLICY_VERSION } from '../engine/policy';

export interface IntradayBundleMemberStatus {
    sessionId: string;
    status: 'proceed' | 'scale' | 'reject' | 'pending';
    reason: string;
    occurrenceId?: string;
    binding?: SessionReferenceBinding;
}

export interface IntradayBundleMemberAdjudicationResult {
    bindings: SessionReferenceBinding[];
    statuses: IntradayBundleMemberStatus[];
    notices: string[];
}

export interface AdjudicateIntradayBundleMembersParams {
    userId: string;
    date: string;
    activePlan: ActiveExternalPlan;
    bundlePlacement: BundlePlacementProposal;
    subjective: SubjectiveInput;
    objective: EngineObjectiveInput;
    subjectiveBaseline?: DailyReadiness['subjectiveBaseline'];
    userContext: UserContext;
    availability: import('../engine/schedule').ResolvedAvailability;
    ceilings: LedgerCeilings;
    inputRevision?: Partial<Omit<ReassessmentInputRevision, 'ledgerRevision' | 'postPredecessorConfirmationRevision'>>;
    plannedDose?: PlannedDose;
    tissueResponses?: RegionTissueResponse[];
    existingAdditionalBindingsCount?: number;
    now?: string;
    evaluationInstant?: string;
    db?: Firestore;
    services?: {
        occurrenceService?: SessionOccurrenceService;
        aggregateService?: DailyLedgerAggregateService;
        responseService?: SessionResponseService;
        executionService?: SessionExecutionService;
    };
}

function windowDurationMinutes(boundStartLocal: string, boundEndLocal: string, fallback = 60): number {
    const [sH, sM] = boundStartLocal.split(':').map(Number);
    const [eH, eM] = boundEndLocal.split(':').map(Number);
    if (!Number.isFinite(sH) || !Number.isFinite(sM) || !Number.isFinite(eH) || !Number.isFinite(eM)) {
        return fallback;
    }
    const diff = (eH * 60 + eM) - (sH * 60 + sM);
    return diff > 0 ? diff : fallback;
}

/**
 * Adjudicates non-primary intraday bundle members for today, managing occurrence lifecycle,
 * shared ledger reservations, provisional audit records, and launch bindings.
 */
export async function adjudicateIntradayBundleMembers(
    params: AdjudicateIntradayBundleMembersParams,
): Promise<IntradayBundleMemberAdjudicationResult> {
    const {
        userId,
        date,
        activePlan,
        bundlePlacement,
        subjective,
        objective,
        subjectiveBaseline,
        userContext,
        availability,
        ceilings,
        inputRevision: baseInputRevision,
        plannedDose,
        tissueResponses = [],
        existingAdditionalBindingsCount = 0,
        now = new Date().toISOString(),
        evaluationInstant = now,
        db = getDb(),
    } = params;

    if (!isV4Plan(activePlan.plan) || bundlePlacement.outcome !== 'placed' || !bundlePlacement.bindings) {
        return { bindings: [], statuses: [], notices: [] };
    }

    const v4Plan = activePlan.plan;
    const contentHash = activePlan.header.contentHash;

    const occurrenceService = params.services?.occurrenceService ?? (params.db ? new SessionOccurrenceService(params.db) : sessionOccurrenceService);
    const aggregateService = params.services?.aggregateService ?? (params.db ? new DailyLedgerAggregateService(params.db) : dailyLedgerAggregateService);
    const responseService = params.services?.responseService ?? (params.db ? new SessionResponseService(params.db) : sessionResponseService);
    const executionService = params.services?.executionService ?? (params.db ? new SessionExecutionService(params.db) : sessionExecutionService);

    const readiness: DailyReadiness = { subjective, objective, subjectiveBaseline };

    // 1. Gather existing day state (occurrences, executions, aggregate)
    const allOccurrences = await occurrenceService.getOccurrencesForDate(userId, date);
    const { executions } = await executionService.getExecutionsInRange(userId, date, date);
    let aggregate = await aggregateService.get(userId, date);

    // Build initial ledger inputs from today's occurrences & executions
    const currentLedgerInputs: OccurrenceLedgerInput[] = allOccurrences.map(occ => {
        let estimatedMinutes = 45;
        let estimatedSystemicCost = 0.3;
        if (isExternalPlanOccurrence(occ)) {
            const sess = v4Plan.sessions.find(s => s.id === occ.externalPlanRef.sessionId);
            if (sess) {
                estimatedMinutes = sess.definition.duration?.min ?? 45;
                estimatedSystemicCost = estimateAuthoredSessionSystemicCost(sess.definition);
            }
        }
        const linkedExec = executions.find(e => e.execution.occurrenceId === occ.occurrenceId);
        return {
            occurrenceId: occ.occurrenceId,
            occurrenceState: occ.state,
            estimatedMinutes,
            estimatedSystemicCost,
            revision: Date.parse(occ.updatedAt ?? occ.createdAt) || 0,
            ...(linkedExec ? {
                execution: {
                    state: linkedExec.execution.state,
                    startedAt: linkedExec.execution.startedAt,
                    completedAt: linkedExec.execution.completedAt,
                },
            } : {}),
        };
    });

    const bindings: SessionReferenceBinding[] = [];
    const statuses: IntradayBundleMemberStatus[] = [];
    const notices: string[] = [];

    // The non-primary members are all bindings after bindings[0] (primary)
    const nonPrimaryBindings = bundlePlacement.bindings.slice(1);

    for (const binding of nonPrimaryBindings) {
        const targetSession = v4Plan.sessions.find(s => s.id === binding.sessionId);
        if (!targetSession) {
            notices.push(`Session '${binding.sessionId}' not found in active plan.`);
            continue;
        }

        // Guard rails
        if (targetSession.isEvent) {
            statuses.push({
                sessionId: targetSession.id,
                status: 'reject',
                reason: 'Target event cannot be an executable intraday bundle session.',
            });
            continue;
        }
        if (targetSession.definition.id === 'rest_01') {
            statuses.push({
                sessionId: targetSession.id,
                status: 'reject',
                reason: 'Rest sessions cannot be bound as intraday bundle members.',
            });
            continue;
        }
        if (!targetSession.intraday) {
            statuses.push({
                sessionId: targetSession.id,
                status: 'reject',
                reason: 'Session lacks intraday specification.',
            });
            continue;
        }
        const intraday = targetSession.intraday;

        const externalPlanRef: ExternalPlanOccurrenceRef = {
            planId: v4Plan.planId,
            revision: v4Plan.revision,
            sessionId: targetSession.id,
            contentHash,
        };

        const targetExistingOccurrences = allOccurrences.filter(
            (occ): occ is ExternalPlanSessionOccurrence =>
                isExternalPlanOccurrence(occ)
                && occ.externalPlanRef.planId === v4Plan.planId
                && occ.externalPlanRef.sessionId === targetSession.id,
        );
        const targetScheduledOccurrence = targetExistingOccurrences.find(occ => occ.state === 'scheduled');
        const targetSkippedOccurrence = targetExistingOccurrences.find(occ => occ.state === 'skipped');
        const targetActiveOrCompleted = targetExistingOccurrences.find(occ => occ.state === 'active' || occ.state === 'completed');

        // Resolve predecessor evidence if required
        let predecessor: PredecessorEvidence | undefined;
        let predecessorExecutionId: string | null = null;
        let predecessorOccurrenceId: string | null = null;

        if (targetSession.intraday.afterSessionId) {
            const predSessionId = targetSession.intraday.afterSessionId;
            const predOccurrence = allOccurrences.find(
                (occ): occ is ExternalPlanSessionOccurrence =>
                    isExternalPlanOccurrence(occ)
                    && occ.externalPlanRef.planId === v4Plan.planId
                    && occ.externalPlanRef.sessionId === predSessionId
                    && occ.state !== 'superseded',
            );

            if (predOccurrence) {
                predecessorOccurrenceId = predOccurrence.occurrenceId;
                const predExec = executions.find(e => e.execution.occurrenceId === predOccurrence.occurrenceId);
                let immediateResponse = null;
                if (predExec) {
                    predecessorExecutionId = predExec.execution.executionId;
                    immediateResponse = await responseService.getResponseForWindow(
                        userId,
                        { kind: 'execution', id: predExec.execution.executionId },
                        'immediate',
                    );
                }
                predecessor = {
                    sessionId: predSessionId,
                    occurrenceId: predOccurrence.occurrenceId,
                    state: predOccurrence.state,
                    completedAt: predExec?.execution.completedAt ?? null,
                    response: immediateResponse,
                    tissueResponses,
                };
            }
        }

        // 8.1 Refresh aggregate and existing decision atomically before computing candidate capacity
        let decData: IntradayDecisionRecord | null = null;
        const aggRef = aggregateService.ref(userId, date);
        if (targetScheduledOccurrence && aggregate?.reservations[targetScheduledOccurrence.occurrenceId]?.decisionId) {
            // Target already held a reservation from this load or earlier:
            // Read aggregate and decision atomically in one transaction so stale aggregate revision
            // can never falsely match postReservationLedgerRevision if another reservation advanced the aggregate.
            const existingDecisionId = aggregate.reservations[targetScheduledOccurrence.occurrenceId].decisionId!;
            const existingDecDoc = doc(db, getIntradayDecisionDocPath(userId, existingDecisionId));

            const res = await runTransaction(db, async transaction => {
                const aggSnap = await transaction.get(aggRef);
                const decSnap = await transaction.get(existingDecDoc);
                return {
                    freshAgg: aggSnap.exists() ? (aggSnap.data() as DailyLedgerAggregate) : null,
                    decData: decSnap.exists() ? (decSnap.data() as IntradayDecisionRecord) : null,
                };
            });

            if (res.freshAgg) {
                aggregate = res.freshAgg;
            }
            decData = res.decData;
        } else {
            const freshAgg = await aggregateService.get(userId, date);
            if (freshAgg) {
                aggregate = freshAgg;
            }
        }

        // Reconcile currentLedgerInputs against the refreshed aggregate reservations
        // so capacity evaluation includes any reservations committed concurrently
        if (aggregate?.reservations) {
            for (const [resOccId, res] of Object.entries(aggregate.reservations)) {
                const existingIdx = currentLedgerInputs.findIndex(inp => inp.occurrenceId === resOccId);
                if (res.state === 'reserved' || res.state === 'in_progress') {
                    if (existingIdx < 0) {
                        currentLedgerInputs.push({
                            occurrenceId: resOccId,
                            occurrenceState: res.state === 'in_progress' ? 'active' : 'scheduled',
                            estimatedMinutes: res.minutes,
                            estimatedSystemicCost: res.systemicCost,
                            revision: Date.now(),
                        });
                    }
                }
            }
        }

        // Exclude target's own reservation and occurrence from its candidate ledger
        const generation = aggregate ? aggregateService.currentGeneration(aggregate, targetSession.id) : 0;
        const deterministicOccId = await deterministicExternalPlanOccurrenceId(date, externalPlanRef, generation);
        const targetIdsToExclude = new Set([
            ...targetExistingOccurrences.map(o => o.occurrenceId),
            deterministicOccId,
        ]);
        const inputsExcludingTarget = currentLedgerInputs.filter(inp => !targetIdsToExclude.has(inp.occurrenceId));
        const entriesExcludingTarget = buildLedgerEntries(inputsExcludingTarget);
        const targetLedger = computeDailyLedger(ceilings, entriesExcludingTarget);

        const candidateWindowMinutes = windowDurationMinutes(
            binding.boundStartLocal,
            binding.boundEndLocal,
            targetSession.definition.duration?.min ?? 60,
        );

        // Derive pre-reservation ledgerRevision
        let preReservationLedgerRevision = String(aggregate?.revision ?? 0);
        if (decData && decData.postReservationLedgerRevision && String(aggregate?.revision) === decData.postReservationLedgerRevision) {
            preReservationLedgerRevision = decData.reassessmentInputRevision.ledgerRevision;
        }

        const computedRevision = computeReassessmentInputRevision({
            availabilityRevision: baseInputRevision?.availabilityRevision ?? `${date}:${availability.maxTimeMinutes}`,
            completedFactsRevision: baseInputRevision?.completedFactsRevision ?? 'facts-0',
            checkinRevision: baseInputRevision?.checkinRevision ?? 'checkin-0',
            placementRevision: baseInputRevision?.placementRevision ?? `${v4Plan.planId}:${v4Plan.revision}`,
            ledgerRevision: preReservationLedgerRevision,
            ...(predecessor?.response ? {
                postPredecessorConfirmationRevision: predecessor.response.updatedAt ?? predecessor.response.createdAt,
            } : {}),
        });

        const targetTarget: DependentBundleMemberTarget = {
            sessionId: targetSession.id,
            definition: targetSession.definition,
            requestedWindow: {
                startLocal: binding.boundStartLocal,
                endLocal: binding.boundEndLocal,
            },
            afterSessionId: intraday.afterSessionId,
            minimumSeparationMinutes: intraday.minimumSeparationMinutes,
        };

        // Adjudicate verdict pure
        const verdict = reassessDependentBundleMember({
            target: targetTarget,
            predecessor,
            evaluationInstant,
            readiness,
            context: userContext,
            date,
            availability,
            candidateWindowMinutes,
            dailyLedger: targetLedger,
            acceptedSameDaySystemicCost: 0,
            inputRevision: computedRevision,
            plannedDose,
        });

        const windowBinding: OccurrenceWindowBinding = {
            windowId: binding.windowId,
            bundleId: targetSession.intraday.bundleId,
            order: targetSession.intraday.order,
            boundStartLocal: binding.boundStartLocal,
            boundEndLocal: binding.boundEndLocal,
            startInstant: binding.startInstant,
            endInstant: binding.endInstant,
        };

        const candidateMinutes = targetSession.definition.duration?.min ?? 45;
        const candidateSystemicCost = estimateAuthoredSessionSystemicCost(targetSession.definition);

        if (verdict.decision === 'reject') {
            // 8.2 Reject: If a scheduled occurrence already exists, transition to skipped and drop reservation
            if (targetScheduledOccurrence) {
                const targetOccRef = occurrenceService.occurrenceRef(userId, targetScheduledOccurrence.occurrenceId);
                const aggDocRef = aggregateService.ref(userId, date);
                const winResRef = targetScheduledOccurrence.windowBinding
                    ? occurrenceService.windowReservationRef(userId, date, targetScheduledOccurrence.windowBinding.windowId)
                    : null;

                await runTransaction(db, async transaction => {
                    const occSnap = await transaction.get(targetOccRef);
                    const aggSnap = await transaction.get(aggDocRef);
                    const winSnap = winResRef ? await transaction.get(winResRef) : null;

                    if (occSnap.exists()) {
                        const parsed = parseSessionOccurrenceDocument(occSnap.data(), occSnap.ref.path);
                        if (parsed.status === 'AVAILABLE' && parsed.data.state === 'scheduled') {
                            transaction.set(targetOccRef, { ...parsed.data, state: 'skipped', updatedAt: now });
                        }
                    }

                    if (winSnap?.exists() && winSnap.data()?.occurrenceId === targetScheduledOccurrence.occurrenceId) {
                        transaction.delete(winResRef!);
                    }

                    if (aggSnap.exists()) {
                        const currentAgg = aggSnap.data() as DailyLedgerAggregate;
                        const { aggregate: nextAgg } = aggregateService.rejectReservationAndIncrementGeneration(
                            transaction,
                            userId,
                            date,
                            currentAgg,
                            targetScheduledOccurrence.occurrenceId,
                            targetSession.id,
                            now,
                        );
                        aggregate = nextAgg;
                    }
                });

                targetScheduledOccurrence.state = 'skipped';
                targetScheduledOccurrence.updatedAt = now;

                // The reject transaction removed this occurrence's ledger reservation.
                // Drop it locally too, so later bundle members are evaluated against the
                // capacity that was just released.
                const releasedIndex = currentLedgerInputs.findIndex(
                    inp => inp.occurrenceId === targetScheduledOccurrence.occurrenceId,
                );
                if (releasedIndex >= 0) {
                    currentLedgerInputs.splice(releasedIndex, 1);
                }
            }

            statuses.push({
                sessionId: targetSession.id,
                status: 'reject',
                reason: verdict.reason,
                occurrenceId: targetScheduledOccurrence?.occurrenceId ?? targetActiveOrCompleted?.occurrenceId,
            });
            continue;
        }

        const occRef = occurrenceService.occurrenceRef(userId, deterministicOccId);
        const winRef = occurrenceService.windowReservationRef(userId, date, binding.windowId);

        if (verdict.decision === 'pending' || verdict.decision === 'scale') {
            // 8.3 / 8.4: Create occurrence and reserve capacity; emit no binding
            await runTransaction(db, async transaction => {
                const occSnap = await transaction.get(occRef);
                const winSnap = await transaction.get(winRef);
                const aggSnap = await transaction.get(aggRef);

                let currentAgg = aggSnap.exists()
                    ? (aggSnap.data() as DailyLedgerAggregate)
                    : null;

                if (!currentAgg) {
                    currentAgg = aggregateService.seedIfAbsent(
                        transaction,
                        userId,
                        date,
                        null,
                        ceilings,
                        currentLedgerInputs,
                        now,
                    );
                }

                if (!occSnap.exists()) {
                    const newOcc: ExternalPlanSessionOccurrence = {
                        userId,
                        occurrenceId: deterministicOccId,
                        date,
                        authority: 'external_plan',
                        externalPlanRef,
                        state: 'scheduled',
                        placementOrder: intraday.order,
                        windowBinding,
                        createdAt: now,
                        updatedAt: now,
                    };
                    transaction.set(occRef, newOcc);

                    if (winSnap.exists()) {
                        const owner = winSnap.data()?.occurrenceId as string | undefined;
                        const isOwnedBySkipped = generation > 0 && targetSkippedOccurrence && owner === targetSkippedOccurrence.occurrenceId;
                        if (owner !== deterministicOccId && !isOwnedBySkipped) {
                            throw new Error(`Window '${binding.windowId}' is already bound to '${owner}'.`);
                        }
                    }
                    transaction.set(winRef, {
                        userId,
                        date,
                        windowId: binding.windowId,
                        occurrenceId: deterministicOccId,
                        createdAt: now,
                    });
                }

                // Check if already reserved in aggregate
                const existingRes = currentAgg.reservations?.[deterministicOccId];
                if (!existingRes || existingRes.state !== 'reserved') {
                    const nextAgg = aggregateService.applyReservation(
                        transaction,
                        userId,
                        date,
                        currentAgg,
                        deterministicOccId,
                        {
                            minutes: candidateMinutes,
                            systemicCost: candidateSystemicCost,
                            state: 'reserved',
                            postReservationLedgerRevision: String(currentAgg.revision + 1),
                        },
                        now,
                    );
                    aggregate = nextAgg;
                }
            });

            // Update local ledger inputs for subsequent members
            currentLedgerInputs.push({
                occurrenceId: deterministicOccId,
                occurrenceState: 'scheduled',
                estimatedMinutes: candidateMinutes,
                estimatedSystemicCost: candidateSystemicCost,
                revision: Date.parse(now),
            });

            statuses.push({
                sessionId: targetSession.id,
                status: verdict.decision,
                reason: verdict.reason,
                occurrenceId: deterministicOccId,
            });
            continue;
        }

        // Enforce 4 additional sessions cap before writing any transaction state
        if (existingAdditionalBindingsCount + bindings.length >= 4) {
            notices.push(`Bundle member '${targetSession.id}' omitted: maximum 4 additional sessions cap reached.`);
            statuses.push({
                sessionId: targetSession.id,
                status: 'proceed',
                reason: 'Maximum 4 additional sessions cap reached',
            });
            continue;
        }

        // 8.5 / Step 9: Proceed verdict -> create occurrence + aggregate reservation + provisional decision in ONE transaction
        const decisionId = await deterministicIntradayDecisionId(deterministicOccId, computedRevision);
        const decRef = doc(db, getIntradayDecisionDocPath(userId, decisionId));

        let updatedAggregateRevision: number | null = null;

        await runTransaction(db, async transaction => {
            const occSnap = await transaction.get(occRef);
            const winSnap = await transaction.get(winRef);
            const aggSnap = await transaction.get(aggRef);
            const decSnap = await transaction.get(decRef);

            let currentAgg = aggSnap.exists()
                ? (aggSnap.data() as DailyLedgerAggregate)
                : null;

            if (!currentAgg) {
                currentAgg = aggregateService.seedIfAbsent(
                    transaction,
                    userId,
                    date,
                    null,
                    ceilings,
                    currentLedgerInputs,
                    now,
                );
            }

            if (!occSnap.exists()) {
                const newOcc: ExternalPlanSessionOccurrence = {
                    userId,
                    occurrenceId: deterministicOccId,
                    date,
                    authority: 'external_plan',
                    externalPlanRef,
                    state: 'scheduled',
                    placementOrder: intraday.order,
                    windowBinding,
                    createdAt: now,
                    updatedAt: now,
                };
                transaction.set(occRef, newOcc);

                if (winSnap.exists()) {
                    const owner = winSnap.data()?.occurrenceId as string | undefined;
                    const isOwnedBySkipped = generation > 0 && targetSkippedOccurrence && owner === targetSkippedOccurrence.occurrenceId;
                    if (owner !== deterministicOccId && !isOwnedBySkipped) {
                        throw new Error(`Window '${binding.windowId}' is already bound to '${owner}'.`);
                    }
                }
                transaction.set(winRef, {
                    userId,
                    date,
                    windowId: binding.windowId,
                    occurrenceId: deterministicOccId,
                    createdAt: now,
                });
            }

            const existingRes = currentAgg.reservations?.[deterministicOccId];
            if (!existingRes || existingRes.state !== 'reserved' || existingRes.decisionId !== decisionId) {
                const nextAgg = aggregateService.applyReservation(
                    transaction,
                    userId,
                    date,
                    currentAgg,
                    deterministicOccId,
                    {
                        minutes: candidateMinutes,
                        systemicCost: candidateSystemicCost,
                        state: 'reserved',
                        decisionId,
                        postReservationLedgerRevision: String(currentAgg.revision + 1),
                    },
                    now,
                );
                currentAgg = nextAgg;
                aggregate = nextAgg;
            }
            updatedAggregateRevision = currentAgg.revision;

            const existingDec = decSnap.exists()
                ? validateIntradayDecisionRecord(decSnap.data())
                : null;

            const decisionRecord: IntradayDecisionRecord = {
                id: decisionId,
                userId,
                date,
                asOf: now,
                policyVersion: POLICY_VERSION,
                schemaVersion: 1,
                status: 'provisional',
                supersededDecisionId: null,
                occurrenceId: deterministicOccId,
                sessionId: targetSession.id,
                windowId: binding.windowId,
                bundleId: intraday.bundleId,
                orderInBundle: intraday.order,
                predecessorExecutionId,
                predecessorOccurrenceId,
                reassessmentInputRevision: computedRevision,
                bundlePlacement,
                ledgerSnapshot: {
                    ceilings,
                    entries: entriesExcludingTarget,
                },
                verdict: {
                    decision: 'proceed',
                    reasons: [verdict.reason],
                },
                postReservationLedgerRevision: String(updatedAggregateRevision),
            };

            writeProvisionalDecisionInTransaction(transaction, userId, existingDec, decisionRecord);
        });

        // Prepare launch binding
        const launch = await prepareExternalPlanSessionLaunch(
            userId,
            {
                planId: v4Plan.planId,
                revision: v4Plan.revision,
                contentHash,
                session: targetSession as ExternalPlanSessionV4,
            },
            {
                date,
                occurrenceId: deterministicOccId,
                placementOrder: intraday.order,
                windowBinding,
                now,
            },
        );

        bindings.push(launch.binding);
        statuses.push({
            sessionId: targetSession.id,
            status: 'proceed',
            reason: verdict.reason,
            occurrenceId: deterministicOccId,
            binding: launch.binding,
        });

        // Add this member's reservation to local ledger inputs for subsequent bundle members
        currentLedgerInputs.push({
            occurrenceId: deterministicOccId,
            occurrenceState: 'scheduled',
            estimatedMinutes: candidateMinutes,
            estimatedSystemicCost: candidateSystemicCost,
            revision: Date.parse(now),
        });
    }

    return { bindings, statuses, notices };
}
