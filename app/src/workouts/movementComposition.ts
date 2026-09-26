import type { MovementCompositionPattern } from '../sessions/movementCompositionContract';
import type { SessionDefinition, SessionEntry } from '../sessions/models';

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

/** Uses only structured step metadata and performed entries. No exercise title/text inference. */
export function deriveMovementCompositionEvidence(
  definition: SessionDefinition,
  entries: readonly SessionEntry[],
  sessionCompleted: boolean,
): { performed: PerformedMovementCompositionEvidence[]; requirements: MovementCompositionRequirementEvidence[] } {
  const performed: PerformedMovementCompositionEvidence[] = [];
  const entriesByStep = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    if (entry.stepId && entry.payload.kind !== 'choice') {
      const prior = entriesByStep.get(entry.stepId) ?? [];
      prior.push(entry);
      entriesByStep.set(entry.stepId, prior);
    }
  }

  const steps = definition.blocks.flatMap(block => block.steps);
  for (const step of steps) {
    if (!step.compositionPatterns?.length) continue;
    const completedEntries = (entriesByStep.get(step.id) ?? []).filter(entry =>
      entry.payload.kind !== 'checkoff' || entry.payload.completed,
    );
    if (completedEntries.length === 0) continue;
    for (const entry of completedEntries) {
      const ref = entry.exerciseRef ?? step.exerciseRef;
      const sameAuthoredExercise = !entry.exerciseRef
        || (step.exerciseRef?.kind === 'catalog' && entry.exerciseRef.kind === 'catalog'
          && entry.exerciseRef.exerciseId === step.exerciseRef.exerciseId);
      const patterns = sameAuthoredExercise ? step.compositionPatterns : entry.compositionPatterns ?? [];
      if (patterns.length) {
        performed.push({
          stepId: step.id,
          exerciseIds: ref?.kind === 'catalog' ? [ref.exerciseId] : [],
          patterns: [...patterns],
        });
      }
    }
  }

  const requirements = (definition.movementComposition ?? []).map(requirement => {
    const exerciseIds = [...new Set(performed
      .filter(row => requirement.stepIds.includes(row.stepId) && row.patterns.includes(requirement.pattern))
      .flatMap(row => row.exerciseIds))];
    const hasPerformed = performed.some(row => requirement.stepIds.includes(row.stepId) && row.patterns.includes(requirement.pattern));
    const degradedEntries = requirement.stepIds.flatMap(stepId => entriesByStep.get(stepId) ?? [])
      .filter(entry => (entry.payload.kind !== 'checkoff' || entry.payload.completed)
        && entry.degradedComposition?.pattern === requirement.pattern);
    const degradationReason = degradedEntries.find(entry => entry.degradedComposition)?.degradedComposition?.reason;
    const hasUnclassifiedPerformedEntry = !hasPerformed && degradedEntries.length === 0
      && requirement.stepIds.some(stepId => (entriesByStep.get(stepId) ?? []).some(entry => entry.payload.kind !== 'checkoff' || entry.payload.completed));
    const requirementExerciseIds = new Set(exerciseIds);
    if (!hasPerformed && degradedEntries.length) {
      for (const entry of degradedEntries) {
        const step = steps.find(candidate => candidate.id === entry.stepId);
        const ref = entry.exerciseRef ?? step?.exerciseRef;
        if (ref?.kind === 'catalog') requirementExerciseIds.add(ref.exerciseId);
      }
    }
    const status: MovementCompositionEvidenceStatus = requirement.status === 'relaxed'
      ? 'relaxed'
      : hasPerformed ? 'performed' : degradedEntries.length ? 'degraded' : hasUnclassifiedPerformedEntry ? 'unknown' : sessionCompleted ? 'omitted' : 'unknown';
    return { requirementId: requirement.id, pattern: requirement.pattern, status, exerciseIds: [...requirementExerciseIds], ...(status === 'degraded' && degradationReason ? { reason: degradationReason } : {}) };
  });

  return { performed, requirements };
}
