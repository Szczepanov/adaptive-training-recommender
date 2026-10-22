import { EXERCISES_BY_ID } from '../workouts/exercises';
import type { SessionBlock, SessionDefinition, SessionEntry, SessionStep, StepAlternative } from './models';
import type { MovementCompositionPattern } from './movementCompositionContract';

/**
 * The composition evidence a logged entry carries: copied from the active step at log time.
 * `deliveredPatternWork` (#803) and the #813 ledger read only this stamp, so a set logged on an
 * untagged step never claims a movement family.
 */
export function entryCompositionStamp(step: SessionStep): Pick<SessionEntry, 'compositionPatterns' | 'degradedComposition'> {
    return {
        ...(step.compositionPatterns ? { compositionPatterns: step.compositionPatterns } : {}),
        ...(step.degradedComposition ? { degradedComposition: step.degradedComposition } : {}),
    };
}

/**
 * Composition after an athlete swaps a step's exercise. Patterns come from the catalog
 * exercise only -- a free-text replacement carries none, so later sets cannot claim the
 * family. A catalog replacement that loses a required pattern records an explicit
 * degradation; a free-text one does not (its evidence is simply unknown).
 */
export function swappedStepComposition(
    step: SessionStep,
    replacementRef: SessionStep['exerciseRef'],
    movementComposition: SessionDefinition['movementComposition'],
): Pick<SessionStep, 'compositionPatterns' | 'degradedComposition'> {
    const compositionPatterns = replacementRef?.kind === 'catalog'
        ? EXERCISES_BY_ID.get(replacementRef.exerciseId)?.compositionPatterns
        : undefined;
    const requiredPatterns = movementComposition
        ?.filter(requirement => requirement.status === 'required' && requirement.stepIds.includes(step.id))
        .map(requirement => requirement.pattern) ?? step.compositionPatterns ?? [];
    const lostRequiredPattern = requiredPatterns.find(pattern => !compositionPatterns?.includes(pattern));
    return {
        ...(compositionPatterns?.length ? { compositionPatterns } : {}),
        ...(lostRequiredPattern && replacementRef?.kind === 'catalog'
            ? { degradedComposition: { pattern: lostRequiredPattern, reason: 'Athlete selected a catalog exercise that does not preserve this movement component.' } }
            : {}),
    };
}

/**
 * Composition for a manually authored step or alternative after its exercise is chosen
 * (`ManualSessionBuilder`, `sessionDraft.ts`). Patterns come from the catalog exercise only;
 * a free-text movement stays unknown. `componentPatterns` are the movement components the
 * definition requires of the parent step (alternatives only): a choice that does not preserve
 * one declares an explicit degradation, as validation demands. Any earlier stamp or degradation
 * is replaced, because it described the previous exercise. Keys are explicit `undefined` so the
 * result works as a patch.
 */
export function authoredComposition(
    exerciseRef: SessionStep['exerciseRef'],
    componentPatterns: readonly MovementCompositionPattern[] = [],
): Pick<SessionStep, 'compositionPatterns' | 'degradedComposition'> {
    const catalogPatterns = exerciseRef?.kind === 'catalog'
        ? EXERCISES_BY_ID.get(exerciseRef.exerciseId)?.compositionPatterns
        : undefined;
    const compositionPatterns = catalogPatterns?.length ? [...catalogPatterns] : undefined;
    const lostPattern = componentPatterns.find(pattern => !compositionPatterns?.includes(pattern));
    return {
        compositionPatterns,
        degradedComposition: lostPattern
            ? {
                pattern: lostPattern,
                reason: exerciseRef?.kind === 'catalog'
                    ? 'Authored catalog alternative does not preserve this movement component.'
                    : 'Authored custom alternative has no structured evidence for this movement component.',
            }
            : undefined,
    };
}

/** Movement components the definition names for a step, relaxed or not -- validation checks its alternatives against all of them. */
export function componentPatternsForStep(
    movementComposition: SessionDefinition['movementComposition'],
    stepId: string,
): MovementCompositionPattern[] {
    return [...new Set((movementComposition ?? [])
        .filter(requirement => requirement.stepIds.includes(stepId))
        .map(requirement => requirement.pattern))];
}

/**
 * Relaxes each required movement component that no listed step still evidences (the step was
 * removed, or its movement changed to one without the pattern). Used when a session is saved
 * as a template and while a template is edited, so an edit fails closed to `relaxed` instead
 * of leaving an unsatisfiable requirement.
 */
export function relaxUnevidencedRequirements(
    movementComposition: NonNullable<SessionDefinition['movementComposition']>,
    blocks: readonly SessionBlock[],
    reason = 'Saved template no longer has structured evidence for this movement component.',
): NonNullable<SessionDefinition['movementComposition']> {
    const steps = blocks.flatMap(block => block.steps);
    return movementComposition.map(requirement => {
        const hasStructuredEvidence = requirement.stepIds.some(stepId => steps
            .some(step => step.id === stepId && step.compositionPatterns?.includes(requirement.pattern)));
        return !hasStructuredEvidence && requirement.status === 'required'
            ? { ...requirement, status: 'relaxed' as const, reason }
            : requirement;
    });
}

const IMPORTED_UNEVIDENCED_REASON = 'Imported session has no structured evidence for this movement component.';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Stamps catalog composition tags onto a JSON-imported session definition's steps and alternatives
 * when they name a catalog exercise id (`EXERCISES_BY_ID`) but carry no `compositionPatterns`,
 * using `authoredComposition`.
 *
 * Tags the JSON carries itself are kept, and free-text movements stay untagged.
 * Alternatives that do not preserve a step's component declare an explicit `degradedComposition`,
 * and `relaxUnevidencedRequirements` relaxes any required components that no step still evidences.
 * It runs before validation on untrusted JSON, so a shape it cannot read is returned unchanged
 * and `validateSessionDefinition` reports the precise issue instead of a thrown TypeError.
 */
export function stampImportedSessionComposition(
    definition: SessionDefinition,
): SessionDefinition {
    try {
        return stampWellFormedImport(definition);
    } catch {
        return definition;
    }
}

function stampWellFormedImport(definition: SessionDefinition): SessionDefinition {
    if (!isRecord(definition) || !Array.isArray(definition.blocks)) {
        return definition;
    }

    const movementComposition = Array.isArray(definition.movementComposition)
        ? definition.movementComposition
        : undefined;

    const blocks = definition.blocks.map(block => {
        if (!isRecord(block) || !Array.isArray(block.steps)) {
            return block;
        }

        const steps = block.steps.map(step => {
            if (!isRecord(step)) {
                return step;
            }

            const stepComposition = step.compositionPatterns !== undefined
                ? { ...(step.compositionPatterns ? { compositionPatterns: step.compositionPatterns as SessionStep['compositionPatterns'] } : {}) }
                : authoredComposition(step.exerciseRef as SessionStep['exerciseRef']);

            const componentPatterns = componentPatternsForStep(movementComposition, typeof step.id === 'string' ? step.id : '');

            const alternatives = Array.isArray(step.alternatives)
                ? step.alternatives.map(alt => {
                    if (!isRecord(alt)) {
                        return alt;
                    }
                    if (alt.compositionPatterns === undefined) {
                        const authored = authoredComposition(alt.exerciseRef as SessionStep['exerciseRef'], componentPatterns);
                        return {
                            ...alt,
                            ...(authored.compositionPatterns ? { compositionPatterns: authored.compositionPatterns } : {}),
                            ...(alt.degradedComposition
                                ? { degradedComposition: alt.degradedComposition as StepAlternative['degradedComposition'] }
                                : authored.degradedComposition
                                    ? { degradedComposition: authored.degradedComposition }
                                    : {}),
                        };
                    }
                    const lostPattern = componentPatterns.find(pattern => !(alt.compositionPatterns as string[])?.includes(pattern));
                    const degradedComposition = alt.degradedComposition ?? (lostPattern
                        ? {
                            pattern: lostPattern,
                            reason: (alt.exerciseRef as SessionStep['exerciseRef'])?.kind === 'catalog'
                                ? 'Authored catalog alternative does not preserve this movement component.'
                                : 'Authored custom alternative has no structured evidence for this movement component.',
                        }
                        : undefined);
                    return {
                        ...alt,
                        ...(degradedComposition ? { degradedComposition } : {}),
                    };
                })
                : step.alternatives;

            return {
                ...step,
                ...(stepComposition.compositionPatterns ? { compositionPatterns: stepComposition.compositionPatterns } : {}),
                ...(alternatives !== undefined ? { alternatives } : {}),
            };
        });

        return {
            ...block,
            steps,
        };
    });

    const relaxedMovementComposition = movementComposition
        ? relaxUnevidencedRequirements(movementComposition, blocks, IMPORTED_UNEVIDENCED_REASON)
        : definition.movementComposition;

    return {
        ...definition,
        blocks,
        ...(relaxedMovementComposition !== undefined ? { movementComposition: relaxedMovementComposition } : {}),
    };
}
