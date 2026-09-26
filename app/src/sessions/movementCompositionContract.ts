/**
 * Source-neutral movement-family vocabulary used by authored session composition.
 *
 * These values describe structured movement roles only. They do not imply dose,
 * stimulus credit, correction, or recommendation authority.
 */
export type MovementCompositionPattern =
    | 'knee_dominant_bilateral'
    | 'hip_dominant_hinge'
    | 'unilateral_lower_body'
    | 'upper_push'
    | 'upper_pull'
    | 'trunk_tissue_capacity';

export const MOVEMENT_COMPOSITION_PATTERNS: ReadonlySet<string> = new Set<MovementCompositionPattern>([
    'knee_dominant_bilateral',
    'hip_dominant_hinge',
    'unilateral_lower_body',
    'upper_push',
    'upper_pull',
    'trunk_tissue_capacity',
]);

export interface MovementCompositionRequirementBase {
    id: string;
    pattern: MovementCompositionPattern;
    /** Stable authored step identities which can deliver this requirement. */
    stepIds: string[];
}

export interface SessionMovementCompositionRequirement extends MovementCompositionRequirementBase {
    status: 'required' | 'relaxed';
    reason?: string;
}
