import type { MovementCompositionPattern } from '../sessions/movementCompositionContract';
import type { SessionDefinition, SessionEntry } from '../sessions/models';
import { deliveredPatternWork, isWorkingEntry } from '../sessions/deliveredComposition';

export type MovementCompositionEvidenceStatus = 'performed' | 'omitted' | 'degraded' | 'relaxed' | 'unknown';

export interface PerformedMovementCompositionEvidence {
  stepId: string;
  exerciseIds: string[];
  patterns: MovementCompositionPattern[];
}

export interface MovementCompositionRequirementEvidence {
  requirementId: string;
  pattern: MovementCompositionPattern;
  status: MovementCompositionEvidenceStatus;
  exerciseIds: string[];
  reason?: string;
}

/**
 * Uses only structured composition evidence. No exercise title/text inference.
 *
 * Credit follows the #813/#803 delivered-exposure rule owned by `deliveredPatternWork`: a
 * requirement is performed only by a non-deleted working set whose entry carries the pattern
 * stamped at log time. Authored step metadata never credits a set, so an unstamped (pre-#845)
 * or warm-up-only log stays `unknown` rather than `performed`.
 */
export function deriveMovementCompositionEvidence(
  definition: SessionDefinition,
  entries: readonly SessionEntry[],
  sessionCompleted: boolean,
): { performed: PerformedMovementCompositionEvidence[]; requirements: MovementCompositionRequirementEvidence[] } {
  const steps = definition.blocks.flatMap(block => block.steps);
  const stepById = new Map(steps.map(step => [step.id, step]));
  const catalogExerciseId = (entry: SessionEntry): string | undefined => {
    const ref = entry.exerciseRef ?? (entry.stepId ? stepById.get(entry.stepId)?.exerciseRef : undefined);
    return ref?.kind === 'catalog' ? ref.exerciseId : undefined;
  };
  const logged = entries.filter(entry =>
    entry.stepId && !entry.deletedAt && entry.payload.kind !== 'choice'
    && (entry.payload.kind !== 'checkoff' || entry.payload.completed));
  const working = logged.filter(isWorkingEntry);

  const performed: PerformedMovementCompositionEvidence[] = working
    .filter(entry => entry.compositionPatterns?.length)
    .map(entry => {
      const exerciseId = catalogExerciseId(entry);
      return { stepId: entry.stepId!, exerciseIds: exerciseId ? [exerciseId] : [], patterns: [...entry.compositionPatterns!] };
    });

  const requirements = (definition.movementComposition ?? []).map(requirement => {
    const onRequirementSteps = (entry: SessionEntry) => requirement.stepIds.includes(entry.stepId!);
    const hasPerformed = deliveredPatternWork(working.filter(onRequirementSteps), requirement.pattern) !== null;
    const degradedEntries = working.filter(entry =>
      onRequirementSteps(entry) && entry.degradedComposition?.pattern === requirement.pattern);
    const evidenceEntries = hasPerformed
      ? working.filter(entry => onRequirementSteps(entry) && entry.compositionPatterns?.includes(requirement.pattern))
      : degradedEntries;
    const exerciseIds = [...new Set(evidenceEntries.map(catalogExerciseId).filter((id): id is string => !!id))];
    const degradationReason = degradedEntries[0]?.degradedComposition?.reason;
    const hasUnclassifiedLoggedEntry = logged.some(onRequirementSteps);
    const status: MovementCompositionEvidenceStatus = requirement.status === 'relaxed'
      ? 'relaxed'
      : hasPerformed ? 'performed' : degradedEntries.length ? 'degraded' : hasUnclassifiedLoggedEntry ? 'unknown' : sessionCompleted ? 'omitted' : 'unknown';
    return { requirementId: requirement.id, pattern: requirement.pattern, status, exerciseIds, ...(status === 'degraded' && degradationReason ? { reason: degradationReason } : {}) };
  });

  return { performed, requirements };
}
