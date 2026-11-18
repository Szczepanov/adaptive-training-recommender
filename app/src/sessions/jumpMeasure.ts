import { EXERCISES_BY_ID } from '../workouts/exercises';
import type { SessionStep } from './models';

export type JumpMeasure = 'height' | 'distance';

// Single-leg hops are measured by how far they travel, like broad and lateral jumps.
const DISTANCE_JUMP_PATTERNS = new Set(['horizontal_jump', 'lateral_jump', 'unilateral_jump']);

/**
 * Which jump result a set of this step can record, if any. Catalog exercises decide by movement
 * pattern: horizontal and lateral jumps record distance, any other jump pattern records height.
 * Free-text exercises fall back to their name ("broad jump" → distance, "box jump" → height).
 */
export function jumpMeasureFor(step: Pick<SessionStep, 'exerciseRef' | 'title'>): JumpMeasure | null {
    const ref = step.exerciseRef;
    if (ref?.kind === 'catalog') {
        const patterns = EXERCISES_BY_ID.get(ref.exerciseId)?.movementPatterns ?? [];
        if (patterns.some(pattern => DISTANCE_JUMP_PATTERNS.has(pattern))) return 'distance';
        return patterns.some(pattern => pattern.includes('jump')) ? 'height' : null;
    }
    const name = (ref?.kind === 'unresolved_free_text' ? ref.name : step.title ?? '').toLowerCase();
    // Conditioning drills that merely contain the word ("jumping jacks", "jump rope") have no result to record.
    if (!/\bjump|\bbound/.test(name) || /jumping jack|jump rope|skipping/.test(name)) return null;
    return /broad|long|lateral|bound|triple/.test(name) ? 'distance' : 'height';
}
