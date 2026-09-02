import type { ActivityZoneBucket } from '../engine/models';
import { formatDuration } from './activityTelemetryFormat';

/** Shared between `ActivityTelemetry` and `CompletedWorkoutList` -- split into its own
 * component-only file (alongside `activityTelemetryFormat.ts`'s pure helpers) to satisfy
 * `react-refresh/only-export-components`. */
export function ZoneBars({ title, unit, zones }: { title: string; unit: string; zones: ActivityZoneBucket[] }) {
    const total = zones.reduce((sum, zone) => sum + zone.secondsInZone, 0);
    return (
        <section className="activity-zone-section" aria-label={title}>
            <h5>{title}</h5>
            <div className="activity-zone-list">
                {zones.map((zone) => {
                    const percent = total > 0 ? (zone.secondsInZone / total) * 100 : 0;
                    return (
                        <div className="activity-zone-row" key={zone.zoneNumber}>
                            <span className="activity-zone-label">Z{zone.zoneNumber}</span>
                            <div className="activity-zone-track" aria-hidden="true">
                                <span style={{ width: `${percent}%` }} />
                            </div>
                            <span className="activity-zone-value">
                                {formatDuration(zone.secondsInZone)}
                                {zone.lowBoundary !== undefined ? ` · ≥${zone.lowBoundary} ${unit}` : ''}
                            </span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
