import type { AuthoredPlanBlock, PlannedDose, ScheduleOverlay } from './models';
import type { PlanDefinition } from './planSchedule';

/** Applies user-authored calendar overlays independently of plan capability. A travel
 * block or schedule overlay therefore constrains structured, demand-derived, and evergreen decisions alike.
 * Fixed activities remain schedule-owned and are applied by resolveAvailability. */
export function applyPlanningOverlays(
    plannedDose: PlannedDose,
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    planDefinition?: PlanDefinition | null,
    scheduleOverlays: readonly ScheduleOverlay[] = [],
): PlannedDose {
    const activeBlocks = authoredPlanBlocks.filter(block => block.startDate <= date && date <= block.endDate)
        .filter(block => !planDefinition?.blocks.some(planBlock => planBlock.id === `authored_${block.id}`));
    const activeScheduleOverlays = scheduleOverlays.filter(block => block.startDate <= date && date <= block.endDate);

    let dose = plannedDose;
    for (const block of activeBlocks) {
        dose = {
            volume: dose.volume * block.volumeScale,
            intensity: dose.intensity * block.intensityScale,
        };
    }
    for (const overlay of activeScheduleOverlays) {
        dose = {
            volume: dose.volume * overlay.volumeScale,
            intensity: dose.intensity * overlay.intensityScale,
        };
    }
    return dose;
}
