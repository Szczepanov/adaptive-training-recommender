import type { EventPlanCoverageKey, EventPlanPhase, EventPlanSessionCoverage } from '../workouts/event-plan.ts';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan.ts';
import type { DataIssue, DataState } from './dataState.ts';
import type { ObjectiveKey, ObjectivePriority, UserEvent } from './models.ts';

// Named PlanSessionRole (not SessionRole) to avoid colliding with the unrelated
// SessionRole type in models.ts ('anchor' | 'supporting' | 'recovery', added in Phase 3
// for optimizer.ts's history/recovery-constraint role tagging) -- same name, incompatible
// value sets, different concepts (a plan objective's role within its block vs. a
// completed/candidate session's role in the recovery-constraint history).
export type PlanSessionRole = 'primary_developmental' | 'secondary_support' | 'taper_sharpening' | 'recovery_active';

export interface PlanBlock {
  id: string; // objectives reference this, not the phase
  phase: EventPlanPhase;
  startDate: string; // YYYY-MM-DD, Warsaw-local, inclusive
  endDate: string; // YYYY-MM-DD, Warsaw-local, inclusive
  volumeScale: number;
  intensityScale: number;
}

export interface PlanObjectiveDefinition {
  key: ObjectiveKey;
  coverageKey: EventPlanCoverageKey; // ties back to event-plan.ts
  blockId: string; // exactly one — NOT `phases`, and not a list
  requiredCredit: number;
  priority: ObjectivePriority; // declared in models.ts
  minGapHoursFrom?: ObjectiveKey[];
  /** Phase 5.7: the session's role within its block, from the same named vocabulary
   *  event-plan.ts's coverage keys and templates.ts's phaseEligibility already imply --
   *  optional so existing plan authoring is unaffected, but generateWeeklyObjectives
   *  (microcycle.ts) uses a block's `phase === 'taper'` (not this field) to decide
   *  taper-appropriate calibration; `role` here is the legible label for *why*. */
  role?: PlanSessionRole;
}

export interface SequencingRule {
  id: string;
  ruleType: 'min_gap_hours' | 'max_consecutive_days' | 'recovery_window';
  targetObjectiveKeys: ObjectiveKey[];
  paramValue: number;
}

export interface PlanDefinition {
  id: string;
  eventId: string;
  blocks: PlanBlock[];
  objectives: PlanObjectiveDefinition[];
  sequencingRules: SequencingRule[];
}

export function buildPlanDefinition(
  coverage: EventPlanSessionCoverage[],
  blockSchedule: PlanBlock[],
  event: UserEvent,
  objectives: PlanObjectiveDefinition[] = [],
  sequencingRules: SequencingRule[] = [],
  id: string = `plan_${event.id}`
): DataState<PlanDefinition> {
  const issues: DataIssue[] = [];

  // 1. Check unique block IDs and date ordering
  const blockIds = new Set<string>();
  for (const block of blockSchedule) {
    if (blockIds.has(block.id)) {
      issues.push({ code: 'DUPLICATE_BLOCK_ID', field: `blocks.${block.id}`, documentPath: `plan/${id}` });
    }
    blockIds.add(block.id);
    if (block.startDate > block.endDate) {
      issues.push({ code: 'INVALID_BLOCK_DATE_RANGE', field: `blocks.${block.id}`, documentPath: `plan/${id}` });
    }
  }

  // 2. Check for overlapping blocks
  const sortedBlocks = [...blockSchedule].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 0; i < sortedBlocks.length - 1; i++) {
    if (sortedBlocks[i].endDate >= sortedBlocks[i + 1].startDate) {
      issues.push({
        code: 'OVERLAPPING_BLOCKS',
        field: `blocks.${sortedBlocks[i].id}`,
        documentPath: `plan/${id}`,
      });
    }
  }

  // 3. Validate objective block references & coverage keys
  const coverageByKey = new Map(coverage.map((item) => [item.key, item]));
  for (const obj of objectives) {
    const block = blockSchedule.find((item) => item.id === obj.blockId);
    if (!block) {
      issues.push({
        code: 'DANGLING_BLOCK_ID',
        field: `objectives.${obj.key}`,
        documentPath: `plan/${id}`,
      });
    }
    const coverageItem = coverageByKey.get(obj.coverageKey);
    if (!coverageItem) {
      issues.push({
        code: 'UNKNOWN_COVERAGE_KEY',
        field: `objectives.${obj.key}`,
        documentPath: `plan/${id}`,
      });
    } else if (block && !coverageItem.phases.includes(block.phase)) {
      issues.push({
        code: 'COVERAGE_UNAVAILABLE_IN_BLOCK_PHASE',
        field: `objectives.${obj.key}`,
        documentPath: `plan/${id}`,
      });
    }
  }

  if (issues.length > 0) {
    return { status: 'INVALID', issues };
  }

  return {
    status: 'AVAILABLE',
    revision: null,
    data: {
      id,
      eventId: event.id,
      blocks: blockSchedule,
      objectives,
      sequencingRules,
    },
  };
}

/**
  Authors a default dated block schedule for the September cycling event.
 */
export function buildSeptemberCyclingEventPlan(event: UserEvent): DataState<PlanDefinition> {
  const blocks: PlanBlock[] = [
    { id: 'block_build', phase: 'build', startDate: '2026-08-01', endDate: '2026-08-23', volumeScale: 1.0, intensityScale: 1.0 },
    { id: 'block_travel', phase: 'travel', startDate: '2026-08-24', endDate: '2026-08-30', volumeScale: 0.6, intensityScale: 0.8 },
    { id: 'block_peak', phase: 'peak', startDate: '2026-08-31', endDate: '2026-09-06', volumeScale: 1.1, intensityScale: 1.1 },
    { id: 'block_taper', phase: 'taper', startDate: '2026-09-07', endDate: '2026-09-19', volumeScale: 0.5, intensityScale: 1.0 },
    { id: 'block_race', phase: 'race', startDate: '2026-09-20', endDate: '2026-09-20', volumeScale: 1.0, intensityScale: 1.2 },
    { id: 'block_recovery', phase: 'recovery', startDate: '2026-09-21', endDate: '2026-09-27', volumeScale: 0.3, intensityScale: 0.5 },
  ];

  const objectives: PlanObjectiveDefinition[] = [
    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_build', requiredCredit: 2, priority: 'must_have', role: 'primary_developmental' },
    { key: 'threshold_quality', coverageKey: 'sustained_quality', blockId: 'block_build', requiredCredit: 1, priority: 'must_have', role: 'primary_developmental' },
    { key: 'surge_repeatability', coverageKey: 'short_surges', blockId: 'block_build', requiredCredit: 1, priority: 'should_have', role: 'secondary_support' },
    { key: 'strength_maintenance', coverageKey: 'primary_strength', blockId: 'block_build', requiredCredit: 1, priority: 'should_have', role: 'secondary_support' },

    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have', role: 'primary_developmental' },
    { key: 'threshold_quality', coverageKey: 'sustained_quality', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have', role: 'primary_developmental' },
    { key: 'race_specific_endurance', coverageKey: 'outdoor_event_specific', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have', role: 'primary_developmental' },

    // Phase 5.7: the taper block previously only ever authored the generic easy_aerobic
    // objective, leaving its own declared taper_sharpening/race_week_strength coverage
    // keys (SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE above) with no objective demanding
    // them at all -- exactly the "emergent side effect" the plan describes. These two
    // additions close that: generateWeeklyObjectives detects blockId -> phase 'taper' and
    // calibrates both to TAPER_SHARPENING_TARGET_STIMULUS / TAPER_STRENGTH_TARGET_STIMULUS
    // rather than the peak-block full-volume targets.
    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_taper', requiredCredit: 1, priority: 'must_have', role: 'primary_developmental' },
    { key: 'race_specific_endurance', coverageKey: 'taper_sharpening', blockId: 'block_taper', requiredCredit: 1, priority: 'should_have', role: 'taper_sharpening' },
    // 'secondary_support', not 'taper_sharpening' -- PlanSessionRole's four values are a
    // generic block-role axis, not a 1:1 restatement of event-plan.ts's four taper
    // coverage keys; the race-week strength primer is support work that happens to fall
    // in the taper block, distinct from the endurance-specific sharpening role above.
    { key: 'strength_maintenance', coverageKey: 'race_week_strength', blockId: 'block_taper', requiredCredit: 1, priority: 'should_have', role: 'secondary_support' },
  ];

  return buildPlanDefinition(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE, blocks, event, objectives);
}

/**
 * Resolves the concrete `PlanDefinition` for a focus event, when one has actually been
 * authored for it.
 *
 * Intentionally narrow, not a generic plan-authoring mechanism: only the specific
 * September cycling event that `buildSeptemberCyclingEventPlan`'s block calendar and
 * `requiredCredit` numbers were authored against resolves to a `PlanDefinition` here.
 * Every other event continues through `periodization.ts`'s generic `daysToEvent`
 * fallback (ADR-0012 "Generic Mode") -- there is no per-event plan-builder UI or
 * persistence layer yet (`Goals.tsx` collects a target date and event category, not a
 * block/objective schedule), so a user-authored plan for an arbitrary event isn't
 * possible until that lands.
 */
export function resolvePlanDefinitionForEvent(event: UserEvent | null): PlanDefinition | null {
  if (!event || event.category !== 'cycling_event' || event.date !== '2026-09-20') return null;
  const result = buildSeptemberCyclingEventPlan(event);
  return result.status === 'AVAILABLE' ? result.data : null;
}
