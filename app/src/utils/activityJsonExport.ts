import type { NormalizedGarminActivity } from '../engine/models';

export interface ActivityExportMetadata {
    exportedAt: string;
    format: 'activity_export_v1' | 'recent_activities_bundle_v1';
    userId?: string;
    dateRange?: {
        startDateInclusive: string;
        throughDateExclusive: string;
    };
    totalActivities: number;
}

export interface SingleActivityExport {
    schemaVersion: 'activity_export_v1';
    exportedAt: string;
    activity: NormalizedGarminActivity;
}

export interface RecentActivitiesBundleExport {
    schemaVersion: 'recent_activities_bundle_v1';
    metadata: ActivityExportMetadata;
    activities: NormalizedGarminActivity[];
}

/**
 * Normalizes a single activity into an AI-ready export envelope.
 */
export function exportActivityToJson(activity: NormalizedGarminActivity): SingleActivityExport {
    return {
        schemaVersion: 'activity_export_v1',
        exportedAt: new Date().toISOString(),
        activity,
    };
}

/**
 * Packages a list of activities (e.g. recent 7-day window) into a structured AI bundle.
 */
export function exportActivitiesBundleToJson(
    activities: readonly NormalizedGarminActivity[],
    metadata?: {
        userId?: string;
        startDateInclusive?: string;
        throughDateExclusive?: string;
    },
): RecentActivitiesBundleExport {
    return {
        schemaVersion: 'recent_activities_bundle_v1',
        metadata: {
            exportedAt: new Date().toISOString(),
            format: 'recent_activities_bundle_v1',
            ...(metadata?.userId ? { userId: metadata.userId } : {}),
            ...(metadata?.startDateInclusive && metadata?.throughDateExclusive
                ? {
                    dateRange: {
                        startDateInclusive: metadata.startDateInclusive,
                        throughDateExclusive: metadata.throughDateExclusive,
                    },
                }
                : {}),
            totalActivities: activities.length,
        },
        activities: [...activities].sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId)),
    };
}

export function formatActivityJson(activity: NormalizedGarminActivity): string {
    return JSON.stringify(exportActivityToJson(activity), null, 2);
}

export function formatActivitiesBundleJson(
    activities: readonly NormalizedGarminActivity[],
    metadata?: {
        userId?: string;
        startDateInclusive?: string;
        throughDateExclusive?: string;
    },
): string {
    return JSON.stringify(exportActivitiesBundleToJson(activities, metadata), null, 2);
}

export async function copyActivityJsonToClipboard(activity: NormalizedGarminActivity): Promise<void> {
    const jsonStr = formatActivityJson(activity);
    await navigator.clipboard.writeText(jsonStr);
}

export async function copyActivitiesBundleToClipboard(
    activities: readonly NormalizedGarminActivity[],
    metadata?: {
        userId?: string;
        startDateInclusive?: string;
        throughDateExclusive?: string;
    },
): Promise<void> {
    const jsonStr = formatActivitiesBundleJson(activities, metadata);
    await navigator.clipboard.writeText(jsonStr);
}

export function downloadActivitiesJsonFile(filename: string, data: unknown): void {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
