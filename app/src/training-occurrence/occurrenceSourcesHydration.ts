import { activityService } from '../services/activityService';
import type { ActivityOverride, NormalizedGarminActivity } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { performedTrainingOccurrenceRepository } from './repository';
import { isProviderActivityRef, type PerformedTrainingOccurrence, type ProviderActivitySourceRef } from './models';

export interface HydratedProviderSource {
    ref: ProviderActivitySourceRef;
    activity?: NormalizedGarminActivity;
    override?: ActivityOverride;
}

export interface HydratedOccurrenceSources {
    occurrence: PerformedTrainingOccurrence;
    providerSources: HydratedProviderSource[];
}

/** Query canonical rows once and resolve every attached provider source by its stable ID.
 * Callers choose provider-specific authority after this boundary; no source is collapsed. */
export async function hydrateOccurrenceSourcesInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
    options: {
        preloadedActivities?: readonly NormalizedGarminActivity[];
        activityDatePaddingDays?: number;
        activityOverrides?: Readonly<Record<string, ActivityOverride>> | ReadonlyMap<string, ActivityOverride>;
    } = {},
): Promise<{
    rows: HydratedOccurrenceSources[];
    activitiesReadable: boolean;
    activities: NormalizedGarminActivity[];
}> {
    const padding = options.activityDatePaddingDays ?? 0;
    const activityStart = addDaysToLocalDateString(fromDateInclusive, -padding);
    const activityEnd = addDaysToLocalDateString(toDateExclusive, padding);
    const [occurrences, activitiesState] = await Promise.all([
        performedTrainingOccurrenceRepository.queryActiveInDateWindow(
            userId,
            fromDateInclusive,
            addDaysToLocalDateString(toDateExclusive, -1),
        ),
        options.preloadedActivities !== undefined
            ? Promise.resolve({ status: 'AVAILABLE' as const, data: [...options.preloadedActivities], revision: null })
            : activityService.getActivitiesInRange(userId, activityStart, activityEnd),
    ]);
    const activities = activitiesState.status === 'AVAILABLE' ? activitiesState.data : [];
    const activitiesById = new Map(
        activities
            .map(activity => [activity.activityId, activity] as const),
    );
    const rows = occurrences.map(occurrence => ({
        occurrence,
        providerSources: occurrence.sourceRefs.filter(isProviderActivityRef).map(ref => {
            const overrides = options.activityOverrides;
            const override = overrides
                ? ('get' in overrides && typeof overrides.get === 'function'
                    ? (overrides as ReadonlyMap<string, ActivityOverride>).get(ref.activityId)
                    : (overrides as Readonly<Record<string, ActivityOverride>>)[ref.activityId])
                : undefined;
            return {
                ref,
                // activityService currently hydrates Garmin only. An unrelated provider may
                // reuse the same opaque activity ID; provider is part of source identity.
                ...(ref.provider.toLowerCase() === 'garmin'
                    ? { activity: activitiesById.get(ref.activityId) }
                    : {}),
                ...(override ? { override } : {}),
            };
        }),
    }));
    return { rows, activitiesReadable: activitiesState.status === 'AVAILABLE', activities };
}
