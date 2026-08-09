import type { EventPlanCoverageKey, EventPlanPhase, EventPlanSessionCoverage } from '../workouts/event-plan.ts';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan.ts';
import type { DataIssue, DataState } from './dataState.ts';
import type { ObjectiveKey, ObjectivePriority, UserEvent } from './models.ts';
import { addDaysToLocalDateString } from '../utils/localDate.ts';

// Named PlanSessionRole (not SessionRole) to avoid colliding with the unrelated
// SessionRole type in models.ts ('anchor' | 'supporting' | 'recovery').
export type PlanSessionRole = 'primary_developmental' | 'secondary_support' | 'taper_sharpening' | 'recovery_active';

export interface PlanBlock {
  id: string;
  phase: EventPlanPhase;
  startDate: string;
  endDate: string;
  volumeScale: number;
  intensityScale: number;
}

export interface PlanObjectiveDefinition {
  key: ObjectiveKey;
  coverageKey: EventPlanCoverageKey;
  blockId: string;
  requiredCredit: number;
  priority: ObjectivePriority;
  minGapHoursFrom?: ObjectiveKey[];
  role?: PlanSessionRole;
  /** Phase 6.2c / ADR-0016: programming-role count is independent from physiological
   * requiredCredit. A session may earn adaptation on several axes without silently
   * replacing a distinct weekly role. */
  coverageMinimumSessions?: number;
  coverageTargetSessions?: number;
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
    if (obj.coverageMinimumSessions !== undefined && obj.coverageMinimumSessions < 0) {
      issues.push({ code: 'INVALID_COVERAGE_MINIMUM', field: `objectives.${obj.key}`, documentPath: `plan/${id}` });
    }
    if (obj.coverageTargetSessions !== undefined
      && obj.coverageTargetSessions < (obj.coverageMinimumSessions ?? 0)) {
      issues.push({ code: 'COVERAGE_TARGET_BELOW_MINIMUM', field: `objectives.${obj.key}`, documentPath: `plan/${id}` });
    }
  }

  if (issues.length > 0) return { status: 'INVALID', issues };

  return {
    status: 'AVAILABLE',
    revision: null,
    data: { id, eventId: event.id, blocks: blockSchedule, objectives, sequencingRules },
  };
}

function eventPlanningDate(event: UserEvent): string {
  return event.timing?.planningDate ?? event.date;
}

function developmentalObjectives(
  blockId: 'block_build' | 'block_peak',
  event: UserEvent,
): PlanObjectiveDefinition[] {
  const objectives: PlanObjectiveDefinition[] = [
    {
      key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId,
      requiredCredit: blockId === 'block_build' ? 2 : 1,
      priority: 'must_have', role: 'primary_developmental',
      coverageMinimumSessions: 1, coverageTargetSessions: 2,
    },
    {
      key: 'race_specific_endurance', coverageKey: 'outdoor_event_specific', blockId,
      requiredCredit: 1, priority: 'must_have', role: 'primary_developmental',
      coverageMinimumSessions: 1, coverageTargetSessions: 1,
    },
    {
      key: 'strength_maintenance', coverageKey: 'primary_strength', blockId,
      requiredCredit: 1, priority: 'must_have', role: 'secondary_support',
      coverageMinimumSessions: 1, coverageTargetSessions: 1,
    },
  ];

  if (event.demandProfile.thresholdPower >= 0.5) {
    objectives.push({
      key: 'threshold_quality', coverageKey: 'sustained_quality', blockId,
      requiredCredit: 1, priority: 'must_have', role: 'primary_developmental',
      coverageMinimumSessions: 1, coverageTargetSessions: 1,
    });
  }
  if (event.demandProfile.repeatedSurges >= 0.6 || event.demandProfile.vo2MaxPower >= 0.6) {
    objectives.push({
      key: 'surge_repeatability', coverageKey: 'short_surges', blockId,
      requiredCredit: 1, priority: 'should_have', role: 'secondary_support',
      coverageMinimumSessions: 0, coverageTargetSessions: 1,
    });
  }
  return objectives;
}

/**
 * Phase 6.2c: reusable event-relative cycling plan. Training phases are derived from the
 * event planning date and the same 84/35/taper boundaries used by generic periodization.
 * Travel is deliberately NOT fabricated here; it is an explicit availability/day-context
 * overlay (or an explicitly authored plan block) rather than a property of every event.
 */
export function buildCyclingEventPlan(event: UserEvent): DataState<PlanDefinition> {
  const raceDate = eventPlanningDate(event);
  const taperDays = event.priority === 'A' ? 14 : event.priority === 'B' ? 5 : 0;
  const peakEnd = addDaysToLocalDateString(raceDate, -(taperDays > 0 ? taperDays + 1 : 1));

  const blocks: PlanBlock[] = [
    {
      id: 'block_build', phase: 'build',
      startDate: addDaysToLocalDateString(raceDate, -84),
      endDate: addDaysToLocalDateString(raceDate, -36),
      volumeScale: 1.0, intensityScale: 0.9,
    },
    {
      id: 'block_peak', phase: 'peak',
      startDate: addDaysToLocalDateString(raceDate, -35),
      endDate: peakEnd,
      volumeScale: 1.0, intensityScale: 1.1,
    },
  ];

  if (taperDays > 0) {
    blocks.push({
      id: 'block_taper', phase: 'taper',
      startDate: addDaysToLocalDateString(raceDate, -taperDays),
      endDate: addDaysToLocalDateString(raceDate, -1),
      volumeScale: 0.6, intensityScale: 1.0,
    });
  }
  blocks.push(
    { id: 'block_race', phase: 'race', startDate: raceDate, endDate: raceDate, volumeScale: 1.0, intensityScale: 1.2 },
    {
      id: 'block_recovery', phase: 'recovery',
      startDate: addDaysToLocalDateString(raceDate, 1),
      endDate: addDaysToLocalDateString(raceDate, 7),
      volumeScale: 0.3, intensityScale: 0.5,
    },
  );

  const objectives: PlanObjectiveDefinition[] = [
    ...developmentalObjectives('block_build', event),
    ...developmentalObjectives('block_peak', event),
  ];

  if (taperDays > 0) {
    objectives.push(
      {
        key: 'zone2_aerobic', coverageKey: 'easy_aerobic', blockId: 'block_taper',
        requiredCredit: 1, priority: 'must_have', role: 'primary_developmental',
        coverageMinimumSessions: 1, coverageTargetSessions: 1,
      },
      {
        key: 'race_specific_endurance', coverageKey: 'taper_sharpening', blockId: 'block_taper',
        requiredCredit: 1, priority: 'must_have', role: 'taper_sharpening',
        coverageMinimumSessions: 1, coverageTargetSessions: 1,
      },
      {
        key: 'strength_maintenance', coverageKey: 'race_week_strength', blockId: 'block_taper',
        requiredCredit: 1, priority: 'should_have', role: 'secondary_support',
        coverageMinimumSessions: 1, coverageTargetSessions: 1,
      },
    );
  }

  return buildPlanDefinition(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE, blocks, event, objectives);
}

/** Backward-compatible name retained for tests/docs written around the original fixture. */
export function buildSeptemberCyclingEventPlan(event: UserEvent): DataState<PlanDefinition> {
  return buildCyclingEventPlan(event);
}

/** Every scheduled cycling event receives the richer authored plan, relative to its own
 * planning date. Other event categories keep the generic demand-derived path. */
export function resolvePlanDefinitionForEvent(event: UserEvent | null): PlanDefinition | null {
  if (!event || event.category !== 'cycling_event') return null;
  const result = buildCyclingEventPlan(event);
  return result.status === 'AVAILABLE' ? result.data : null;
}
