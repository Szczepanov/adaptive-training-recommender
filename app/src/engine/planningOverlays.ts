import type { AuthoredPlanBlock, PlannedDose } from './models';
import type { PlanDefinition } from './planSchedule';

/** Applies user-authored calendar overlays independently of plan capability. A travel
 * block therefore constrains structured, demand-derived, and evergreen decisions alike.
 * Fixed activities remain schedule-owned and are applied by resolveAvailability. */
export function applyPlanningOverlays(
    plannedDose: PlannedDose,
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[],
    planDefinition?: PlanDefinition | null,
): PlannedDose {
    const active = authoredPlanBlocks.filter(block => block.startDate <= date && date <= block.endDate)
        .filter(block => !planDefinition?.blocks.some(planBlock => planBlock.id === `authored_${block.id}`));
    if (active.length === 0) return plannedDose;
    return active.reduce((dose, block) => ({
        volume: dose.volume * block.volumeScale,
        intensity: dose.intensity * block.intensityScale,
    }), plannedDose);
}
