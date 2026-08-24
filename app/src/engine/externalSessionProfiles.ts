import { DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY } from './completedTraining';
import type { GateableSession } from './eligibility';
import { ENRICHED_TEMPLATES } from './templates';
import type {
    GuardrailKey,
    CompletedTrainingIntensity,
    ExternalSessionIntensity,
    ExternalSessionModality,
    ExternalPrescription,
    ExternalPrescriptionStep,
    FixedActivity,
    SessionTemplate,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
// M3.6: most of this module only ever reads gating/isEvent/id/title, identical on v1 and
// v2 sessions -- widened to accept either rather than kept v1-only. `toSyntheticTemplate`
// additionally needs a display summary, which the two schemas carry differently.
import { isV2Session, type AnyExternalPlanSession as ExternalPlanSession } from '../sessions/externalPlanV2';
import type { RangeOrNumber, SessionDefinition, SessionStep } from '../sessions/models';

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

function catalogIntensity(template: SessionTemplate): CompletedTrainingIntensity {
    const systemicCost = template.costProfile?.systemic ?? template.systemicCost;
    if (systemicCost >= 0.55) return 'hard';
    if (systemicCost >= 0.25) return 'moderate';
    return 'easy';
}

function durationReferenceMin(range: Pick<ExternalPlanSession['gating'], 'durationMin' | 'durationMax'>): number {
    return (range.durationMin + range.durationMax) / 2;
}

/**
 * The fallback tables are calibrated against catalog-sized sessions, not against an
 * abstract one-hour constant. Imported sessions are untrusted estimates, so use the
 * upper-quartile duration of comparable catalog templates rather than the median. This is
 * intentionally conservative: adding a new short specialist template must not silently
 * increase inferred load/stimulus or objective credit for every unrelated imported session.
 */
function catalogDurationReferenceMin(
    modality: SessionTemplate['modality'],
    intensity: CompletedTrainingIntensity,
): number | null {
    const durations = ENRICHED_TEMPLATES
        .filter(template => template.modality === modality && catalogIntensity(template) === intensity)
        .map(template => (template.durationMin + template.durationMax) / 2)
        .filter(duration => Number.isFinite(duration) && duration > 0)
        .sort((left, right) => left - right);
    if (durations.length === 0) return null;
    const upperQuartileIndex = Math.ceil((durations.length - 1) * 0.75);
    return durations[upperQuartileIndex];
}

/** Structural profile interfaces intentionally do not expose a string index signature.
 * `Object.entries` is safe here because every field in both supported profiles is numeric;
 * keep the generic bound at `object` so the helper preserves those exact structural types. */
function scaleProfile<T extends object>(profile: T, factor: number): T {
    return Object.fromEntries(
        Object.entries(profile).map(([key, value]) => [key, Math.max(0, Math.min(1, Number(value) * factor))]),
    ) as unknown as T;
}

/**
 * Derives load and adaptation profiles for an imported session from `modality` ×
 * `intensity` × authored duration, reusing the same conservative fallback tables that
 * already handle an unmatched Garmin activity (ADR-0019 D-EXTTIER).
 *
 * Duration is relative to a conservative comparable catalog reference. Short authored
 * sessions therefore receive less inferred load/stimulus; longer ones receive more, with
 * every axis clamped to the engine's existing 0..1 profile contract. No AI-supplied cost
 * is accepted.
 *
 * The schema deliberately accepts no cost input: an AI asked for a calibrated 0–1 load
 * figure supplies a confident one, and it would silently move the `modify`-mode ceiling.
 */
export function deriveExternalSessionProfiles(session: ExternalPlanSession): ExternalSessionProfiles {
    const modality = MODALITY_BY_EXTERNAL[session.gating.modality];
    const intensity = INTENSITY_BY_EXTERNAL[session.gating.intensity];
    const baseCost = DEFAULT_COST_BY_MODALITY[modality][intensity];
    const baseStimulus = DEFAULT_STIMULUS_BY_MODALITY[modality][intensity];
    const referenceDuration = catalogDurationReferenceMin(modality, intensity);
    const factor = referenceDuration === null ? 1 : durationReferenceMin(session.gating) / referenceDuration;
    const costProfile = scaleProfile(baseCost, factor);
    const stimulusProfile = scaleProfile(baseStimulus, factor);
    return {
        systemicCost: costProfile.systemic,
        costProfile,
        stimulusProfile,
    };
}

/**
 * Reconciles an imported target event onto the existing FixedActivity contract for the
 * current in-memory decision. It is deliberately not persisted: the athlete's UserEvent
 * remains the authored calendar record, while this adapter gives availability, fatigue and
 * objective-credit code the same shape they already understand.
 *
 * The transient `externalAuthoredIdentity` is the critical distinction from a catalog
 * FixedActivity: modality/category are known, but the stimulus is inferred from the import
 * contract, so fixed-activity objective credit must keep `authoredExternal` confidence.
 */
export function externalEventAsFixedActivity(
    session: ExternalPlanSession,
    planId: string,
    revision: number,
    userId: string,
    date: string,
): FixedActivity | null {
    if (!session.isEvent) return null;
    const profiles = deriveExternalSessionProfiles(session);
    const gateable = toGateableSession(session);
    return {
        id: `external-event:${planId}:${revision}:${session.id}`,
        userId,
        title: session.title,
        date,
        // Reserve the authored upper bound so another recommendation never relies on time
        // the event itself may legitimately consume.
        durationMin: session.gating.durationMax,
        expectedCost: profiles.costProfile,
        expectedStimulus: profiles.stimulusProfile,
        externalAuthoredIdentity: {
            modality: gateable.modality,
            category: gateable.category,
            stimulusConfidence: 'inferred',
        },
        fixed: true,
        environment: session.gating.environment,
        equipment: [...session.gating.equipment],
        isCompleted: false,
        createdAt: '',
        updatedAt: '',
    };
}

/**
 * Safety tags an imported session must be assumed to carry.
 *
 * `eligibility.ts` matches guardrails against `safetyTags` and nothing else. A manually
 * set guardrail (an athlete who ticks "avoid high impact" with no injury behind it)
 * produces no restricted modality or category at all, so leaving these empty would let an
 * imported running session through a guardrail that excludes every equivalently-tagged
 * catalog template — the exact asymmetry D-CANDIDATE forbids.
 *
 * The import contract has no safety-tag vocabulary and an authoring AI cannot be trusted
 * to declare what its own session trips, so tags are inferred conservatively from modality
 * and intensity. This over-excludes: a strength session that contains no overhead pressing
 * is still withheld from an athlete avoiding it. That is the correct direction to be wrong
 * in for a hard safety gate, and it is recoverable — the athlete can adjust the guardrail
 * or the plan, whereas an unvetted session that hurt them is not.
 */
function inferredSafetyTags(session: ExternalPlanSession): GuardrailKey[] {
    const { modality, intensity } = session.gating;
    const tags: GuardrailKey[] = [];
    if (modality === 'running' || modality === 'field') tags.push('avoid_high_impact');
    // Loaded strength work: the three guardrails a barbell session can plausibly trip.
    // Easy/recovery strength is left alone, so mobility-style sessions stay available.
    if (modality === 'strength' && ['moderate', 'hard', 'max'].includes(intensity)) {
        tags.push('avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading');
    }
    return tags;
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
        safetyTags: inferredSafetyTags(session),
        modality: MODALITY_BY_EXTERNAL[session.gating.modality],
        category: categoryFor(session),
        systemicCost: deriveExternalSessionProfiles(session).systemicCost,
    };
}

/** Reserved id namespace for sessions that are not catalog templates. `prescription.ts`
 * `workoutForTemplate` is deliberately left unaware of it: a synthetic id must never
 * resolve to a catalog workout, and the UI reads `Recommendation.externalPrescription`
 * instead (ADR-0019 D-SHIM). */
export const EXTERNAL_TEMPLATE_ID_PREFIX = 'ext:';

export function externalTemplateId(planId: string, revision: number, sessionId: string): string {
    return `${EXTERNAL_TEMPLATE_ID_PREFIX}${planId}:${revision}:${sessionId}`;
}

export function isExternalTemplateId(templateId: string): boolean {
    return templateId.startsWith(EXTERNAL_TEMPLATE_ID_PREFIX);
}

/**
 * Adapts an imported session to a `SessionTemplate`-shaped record so persistence,
 * provenance, replay and adherence keep working unchanged.
 *
 * This is the deliberate trade ADR-0019 D-SHIM records: `Recommendation.template` no
 * longer always refers to a real catalog entry. The alternative -- widening it to a union
 * -- is more honest in the type system and touches six modules. The reserved `ext:`
 * namespace and `externalTemplateNeverInCatalog.test.ts` keep the two populations apart.
 */
/** v1 requires `prescription.summary`; a v2 session's content is a `SessionDefinition`,
 * whose `summary` is optional (falls back to `title`, which is guaranteed on both). */
export function externalSessionDisplaySummary(session: ExternalPlanSession): string {
    return isV2Session(session) ? (session.definition.summary ?? session.definition.title) : session.prescription.summary;
}

function rangeMidpoint(value: RangeOrNumber | undefined): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'number' ? value : Math.round((value.min + value.max) / 2);
}

function stepDisplayName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    if (step.exerciseRef?.kind === 'catalog') return step.exerciseRef.exerciseId;
    return 'Step';
}

/**
 * Flattens a v2 session's normalized `SessionDefinition` into v1's flat
 * `Recommendation.externalPrescription` shape, so every existing display consumer
 * (Home.tsx, DetailedTodayPlan, ...) keeps working unchanged (M3.6). Lossy for display
 * only -- laterality, load, option sets and companions have no v1 display equivalent and
 * are dropped here; `sessionDefinitionResolver.ts` uses the full-fidelity definition for
 * execution instead.
 */
export function sessionDefinitionToDisplayPrescription(definition: SessionDefinition): ExternalPrescription {
    const steps: ExternalPrescriptionStep[] = definition.blocks.flatMap(block =>
        block.steps.map((step): ExternalPrescriptionStep => {
            const durationSec = step.dose?.kind === 'duration' ? rangeMidpoint(step.dose.seconds) : undefined;
            const recoverySec = rangeMidpoint(step.rest);
            const sets = step.dose && 'sets' in step.dose ? step.dose.sets : undefined;
            return {
                name: stepDisplayName(step),
                ...(sets !== undefined ? { sets } : {}),
                ...(step.dose?.kind === 'repetition' ? { repeat: rangeMidpoint(step.dose.reps) } : {}),
                ...(durationSec !== undefined ? { durationSec } : {}),
                ...(recoverySec !== undefined ? { recoverySec } : {}),
                ...(step.notes ? { notes: step.notes } : {}),
            };
        }),
    );
    return {
        summary: definition.summary ?? definition.title,
        ...(steps.length > 0 ? { steps } : {}),
    };
}

/** The single dispatch point every display consumer (rules.ts, ExternalPlanWeek.tsx, ...)
 * should use rather than reading `.prescription` directly, which only exists on v1. */
export function externalSessionDisplayPrescription(session: ExternalPlanSession): ExternalPrescription {
    return isV2Session(session) ? sessionDefinitionToDisplayPrescription(session.definition) : session.prescription;
}

export function toSyntheticTemplate(session: ExternalPlanSession, planId: string, revision: number): SessionTemplate {
    const gateable = toGateableSession(session);
    const profiles = deriveExternalSessionProfiles(session);
    return {
        id: externalTemplateId(planId, revision, session.id),
        title: session.title,
        description: externalSessionDisplaySummary(session),
        category: gateable.category,
        modality: gateable.modality,
        durationMin: gateable.durationMin,
        durationMax: gateable.durationMax,
        requiredEquipment: [...gateable.requiredEquipment],
        environment: gateable.environment,
        safetyTags: [],
        systemicCost: profiles.systemicCost,
        costProfile: profiles.costProfile,
        stimulusProfile: profiles.stimulusProfile,
        // No phaseEligibility: an imported session's timing is owned by its own placement,
        // not by the engine's event-relative phase gating.
    };
}
