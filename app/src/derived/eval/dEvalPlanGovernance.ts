import { getLocalDateString } from '../../utils/localDate.ts';
import { parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalRawPlanRevision } from './dEvalRawLedger.ts';

export type PlanGovernance = (date: string) => DEvalRawPlanRevision | null;

/**
 * Resolves the stored revision that governed a Warsaw date. Mirrors `ActiveExternalPlanService`:
 * within a plan, the latest activation effective by the date whose own horizon covers it; across
 * plans, the most recently imported. A revision imported after the date never governed it, because
 * the criteria use the assignments as they stood on that date. Results are memoized per date.
 */
export function createPlanGovernance(revisions: Iterable<DEvalRawPlanRevision>): PlanGovernance {
    const dated = [...revisions].flatMap(revision => {
        const importedMs = parseUtcTimestampMs(revision.importedAt);
        if (importedMs === null) return [];
        return [{ revision, importedMs, importedOn: getLocalDateString(new Date(importedMs)) }];
    });
    const cache = new Map<string, DEvalRawPlanRevision | null>();

    const resolve: PlanGovernance = date => {
        const byPlan = new Map<string, { revision: DEvalRawPlanRevision; importedMs: number }>();
        for (const { revision, importedMs, importedOn } of dated) {
            const { effectiveFrom, startDate, endDate } = revision.horizon;
            if (effectiveFrom > date || startDate > date || endDate < date) continue;
            if (importedOn > date) continue;
            const current = byPlan.get(revision.planId)?.revision;
            if (
                !current
                || effectiveFrom > current.horizon.effectiveFrom
                || (effectiveFrom === current.horizon.effectiveFrom && revision.revision > current.revision)
            ) {
                byPlan.set(revision.planId, { revision, importedMs });
            }
        }
        return [...byPlan.values()].sort((a, b) =>
            b.importedMs - a.importedMs || b.revision.planId.localeCompare(a.revision.planId))[0]?.revision ?? null;
    };

    return date => {
        const cached = cache.get(date);
        if (cached !== undefined) return cached;
        const governing = resolve(date);
        cache.set(date, governing);
        return governing;
    };
}
