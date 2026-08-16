import { addDaysToLocalDateString } from '../utils/localDate';
import type { DataState } from '../engine/dataState';
import { resolvePlacement, type PlacedSession } from '../engine/externalPlacement';
import type {
    ExternalPlanHeader,
    ExternalPlanPlacement,
    ExternalTrainingPlan,
    FixedActivity,
} from '../engine/models';
import type { ExternalPlanContext } from '../engine/rules';
import { externalPlanService, type ExternalPlanService } from './externalPlanService';

export interface ActiveExternalPlan {
    header: ExternalPlanHeader;
    plan: ExternalTrainingPlan;
    /** Null when the athlete has never rescheduled anything in this revision. */
    placement: ExternalPlanPlacement | null;
    /** Every session resolved to a date, overlay applied. */
    placed: readonly PlacedSession[];
}

/** Last date the plan covers, inclusive. */
export function planEndDate(header: Pick<ExternalPlanHeader, 'startDate' | 'weekCount'>): string {
    return addDaysToLocalDateString(header.startDate, header.weekCount * 7 - 1);
}

/** A session still to be done. `completed` is excluded: the day's decision is already made. */
export function placedSessionForDate(active: ActiveExternalPlan, date: string): PlacedSession | null {
    return active.placed.find(item =>
        item.date === date && (item.status === 'planned' || item.status === 'moved'),
    ) ?? null;
}

/**
 * Builds the adjudication input for one day, or null when nothing is placed. The
 * `contentHash` comes from the stored header rather than being recomputed here, so the
 * decision audit records the hash the import actually agreed to (ADR-0019 D-IMMUT).
 */
export function externalPlanContextForDate(active: ActiveExternalPlan, date: string): ExternalPlanContext | null {
    const placed = placedSessionForDate(active, date);
    if (!placed) return null;
    return {
        planId: active.plan.planId,
        revision: active.plan.revision,
        session: placed.session,
        contentHash: active.header.contentHash,
    };
}

/**
 * Resolves which imported plan governs a given date.
 *
 * There is deliberately no stored "active plan" pointer. A plan already declares the dates
 * it covers, so a pointer would be a second source of truth that can disagree with them —
 * and the disagreement would surface as a session silently vanishing from the athlete's
 * day. When two plans overlap a date the most recently imported one wins, which is the
 * only ordering an athlete who just pasted a new block would expect.
 *
 * `supersededFrom` is also an effective-from boundary, not documentation: a newly imported
 * revision must never be used to recompute a date before the athlete said it takes effect.
 * Historical days already have persisted recommendations/audits, so before that boundary
 * this resolver fails closed instead of rewriting history with newer bytes.
 */
export class ActiveExternalPlanService {
    private readonly plans: ExternalPlanService;

    constructor(plans: ExternalPlanService = externalPlanService) {
        this.plans = plans;
    }

    async getActivePlanState(
        userId: string,
        date: string,
        fixedActivities: readonly FixedActivity[] = [],
    ): Promise<DataState<ActiveExternalPlan>> {
        const ids = await this.plans.listPlanIds(userId);
        if (ids.status !== 'AVAILABLE') return ids;
        if (ids.data.length === 0) return { status: 'MISSING' };

        const headerStates = await Promise.all(ids.data.map(planId => this.plans.getHeaderState(userId, planId)));
        const unavailable = headerStates.find(state => state.status === 'UNAVAILABLE');
        if (unavailable) return unavailable;

        const covering = headerStates
            .flatMap(state => (state.status === 'AVAILABLE' ? [state.data] : []))
            .filter(header => header.startDate <= date && date <= planEndDate(header))
            .filter(header => header.supersededFrom === null || date >= header.supersededFrom)
            .sort((left, right) => right.importedAt.localeCompare(left.importedAt)
                || right.planId.localeCompare(left.planId));
        if (covering.length === 0) return { status: 'MISSING' };
        const header = covering[0];

        const revision = await this.plans.getRevisionState(userId, header.planId, header.revision);
        if (revision.status !== 'AVAILABLE') return revision;

        const placementState = await this.plans.getPlacementState(userId, header.planId);
        // An INVALID or unreadable overlay is not "no overlay": ignoring malformed current
        // placement could undo reschedules the athlete already confirmed.
        if (placementState.status === 'INVALID' || placementState.status === 'UNAVAILABLE') return placementState;
        // A valid overlay belonging to an older immutable revision is different: it is
        // stale metadata, not a corrupt current overlay. Never apply it to newer plan bytes,
        // but do not brick a fresh re-import either — the new revision starts unmodified.
        const placement = placementState.status === 'AVAILABLE' && placementState.data.revision === header.revision
            ? placementState.data
            : null;

        return {
            status: 'AVAILABLE',
            data: {
                header,
                plan: revision.data,
                placement,
                placed: resolvePlacement(revision.data, placement, { fixedActivities }),
            },
            revision: `${header.contentHash}:${placement?.updatedAt ?? 'no-overlay'}`,
        };
    }
}

export const activeExternalPlanService = new ActiveExternalPlanService();
