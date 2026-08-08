import type { EventPlanCoverageKey, EventPlanPhase, EventPlanSessionCoverage } from '../workouts/event-plan.ts';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan.ts';
import type { DataIssue, DataState } from './dataState.ts';
import type { ObjectiveKey, ObjectivePriority, UserEvent } from './models.ts';

export type SessionRole = 'primary_developmental' | 'secondary_support' | 'taper_sharpening' | 'recovery_active';

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
  const coverageKeys = new Set(coverage.map((c) => c.key));
  for (const obj of objectives) {
    if (!blockIds.has(obj.blockId)) {
      issues.push({
        code: 'DANGLING_BLOCK_ID',
        field: `objectives.${obj.key}`,
        documentPath: `plan/${id}`,
      });
    }
    if (!coverageKeys.has(obj.coverageKey)) {
      issues.push({
        code: 'UNKNOWN_COVERAGE_KEY',
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
    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_build', requiredCredit: 2, priority: 'must_have' },
    { key: 'threshold_quality', coverageKey: 'sustained_quality', blockId: 'block_build', requiredCredit: 1, priority: 'must_have' },
    { key: 'surge_repeatability', coverageKey: 'short_surges', blockId: 'block_build', requiredCredit: 1, priority: 'should_have' },
    { key: 'strength_maintenance', coverageKey: 'primary_strength', blockId: 'block_build', requiredCredit: 1, priority: 'should_have' },

    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have' },
    { key: 'threshold_quality', coverageKey: 'sustained_quality', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have' },
    { key: 'race_specific_endurance', coverageKey: 'outdoor_event_specific', blockId: 'block_peak', requiredCredit: 1, priority: 'must_have' },

    { key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_taper', requiredCredit: 1, priority: 'must_have' },
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
