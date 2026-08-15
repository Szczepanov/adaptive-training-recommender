import { DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY } from './completedTraining';
import type { GateableSession } from './eligibility';
import type {
    CompletedTrainingIntensity,
    ExternalPlanSession,
    ExternalSessionIntensity,
    ExternalSessionModality,
    SessionTemplate,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';

/** The import vocabulary is lowercase and sport-facing; the engine's is capitalised and
 * template-facing. One explicit table rather than a case-insensitive match, so an
 * unrecognised value fails loudly at the type level instead of silently becoming Unknown. */
const MODALITY_BY_EXTERNAL: Record<ExternalSessionModality, SessionTemplate['modality']> = {
    cycling: 'Cycling',
    running: 'Running',
    strength: 'Strength',
    field: 'Field',
    mobility: 'Mobility',
    cross_training: 'Cross Training',
};

/**
 * Five authored intensities collapse onto the three the cost/stimulus tables carry.
 * `recovery` maps to `easy` and `max` to `hard` — both deliberately conservative in the
 * safe direction: a recovery session is never costed below the table's easy row, and a max
 * session is never costed below its hard row.
 */
const INTENSITY_BY_EXTERNAL: Record<ExternalSessionIntensity, CompletedTrainingIntensity> = {
    recovery: 'easy',
    easy: 'easy',
    moderate: 'moderate',
    hard: 'hard',
    max: 'hard',
};

/** The engine's coarse session families, inferred from modality and intensity. Only used
 * to satisfy the category-restriction gate; it never selects or ranks anything. */
function categoryFor(session: ExternalPlanSession): SessionTemplate['category'] {
    const { modality, intensity } = session.gating;
    if (modality === 'mobility') return 'Mobility/Recovery';
    if (modality === 'strength') return 'Full-body Strength';
    if (modality === 'field') return 'Field Maintenance';
    if (intensity === 'recovery') return 'Mobility/Recovery';
    if (intensity === 'easy') return 'Easy Endurance';
    if (intensity === 'moderate') return 'Moderate Endurance';
    return 'Hard Endurance';
}

export interface ExternalSessionProfiles {
    systemicCost: number;
    costProfile: WorkoutCostProfile;
    stimulusProfile: WorkoutStimulusProfile;
}

/**
 * Derives load and adaptation profiles for an imported session from `modality` ×
 * `intensity`, reusing the same conservative fallbacks that already handle an unmatched
 * Garmin activity (ADR-0019 D-EXTTIER).
 *
 * The schema deliberately accepts no cost input: an AI asked for a calibrated 0–1 load
 * figure supplies a confident one, and it would silently move the `modify`-mode ceiling.
 */
export function deriveExternalSessionProfiles(session: ExternalPlanSession): ExternalSessionProfiles {
    const modality = MODALITY_BY_EXTERNAL[session.gating.modality];
    const intensity = INTENSITY_BY_EXTERNAL[session.gating.intensity];
    const costProfile = DEFAULT_COST_BY_MODALITY[modality][intensity];
    return {
        systemicCost: costProfile.systemic,
        costProfile,
        stimulusProfile: DEFAULT_STIMULUS_BY_MODALITY[modality][intensity],
    };
}

/**
 * Adapts an imported session to the shape the hard feasibility gates read, so it passes
 * `evaluateTemplateEligibility` on exactly the terms a catalog template does
 * (D-CANDIDATE). Nothing here selects, ranks, or scores.
 */
export function toGateableSession(session: ExternalPlanSession): GateableSession {
    return {
        durationMin: session.gating.durationMin,
        durationMax: session.gating.durationMax,
        requiredEquipment: session.gating.equipment,
        environment: session.gating.environment,
        // The import contract has no safety-tag vocabulary: an authoring AI cannot be
        // trusted to declare which guardrails its session trips. Guardrails therefore act
        // through the athlete's own restricted modalities and categories, which are
        // athlete-owned, rather than through a tag the plan asserts about itself.
        safetyTags: [],
        modality: MODALITY_BY_EXTERNAL[session.gating.modality],
        category: categoryFor(session),
        systemicCost: deriveExternalSessionProfiles(session).systemicCost,
    };
}
