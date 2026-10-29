/**
 * ADR-0052 Phase 1 (#1144 PR1-10; issue #813): pure capability-exposure fact derivation
 * from canonical performed-training facts and imported planned sessions.
 *
 * Ownership: presentation/evidence only. It owns no exposure policy — no cadence, no
 * max-gap, no dose threshold — and never reaches `app/src/engine/`.
 *
 * - Canonical performed-training facts (`PerformedExposureFact`, ADR-0034) confirm
 *   capabilities with their own provenance, including in-app structured executions that
 *   have no Garmin record or adherence answer.
 * - Issue #802: neuromuscular power is confirmed only by `grantsPowerExposureCredit` on a
 *   canonical fact with a known authored variant at a non-modified dose.
 * - Issue #803: unilateral lower-body work is confirmed only from logged working sets whose
 *   entries carry `unilateral_lower_body` (`deliveredUnilateralLowerBody`). Unreadable sets
 *   are reported as `deliveredCompositionUnavailableCount` so callers keep the row unknown.
 * - Issue #804: impact/jump-land is confirmed only by `grantsMechanicalExposureCredit` on a
 *   canonical fact with a known authored variant at a non-modified dose.
 * - Issue #805: linear speed, acceleration/deceleration, change of direction and sport skill
 *   are confirmed only through exact `grantsAthleticCapabilityCredit` identities with a
 *   known authored variant. Unknown-variant facts are surfaced per date so callers with a
 *   resolved planner cadence can explain the provenance gap.
 */
import { normalizeModality, type PerformedExposureFact } from '../training/performedTrainingFacts';
import { grantsPowerExposureCredit } from '../../workouts/powerExposure';
import { grantsMechanicalExposureCredit, type MechanicalDoseVariant } from '../../workouts/mechanicalExposure';
import {
    ATHLETIC_CAPABILITY_WORKOUT_IDS,
    athleticCapabilitiesCreditedBy,
    grantsAthleticCapabilityCredit,
} from '../../workouts/athleticCapability';
import type { AthleticCapabilityKey, Modality } from '../../ledger/models';

type ExposureModality = Modality | 'Unknown';

export const AEROBIC_EXPOSURE_MODALITIES: ReadonlySet<ExposureModality> = new Set<ExposureModality>([
    'Cycling',
    'Running',
    'Swimming',
    'Cross Training',
]);

/** Future sessions from an authoritative plan (imported external plan). Never completed. */
export interface ExposurePlannedSession {
    date: string;
    modality: string;
    intensity: string;
    title: string;
}

export interface CapabilityFactSpec {
    key: string;
    label: string;
    /** Canonical facts carry modality but no stimulus intensity, so quality cannot use them. */
    confirmsFact: (fact: PerformedExposureFact) => boolean;
    plans: (session: ExposurePlannedSession) => boolean;
    /** Extra provenance appended when a canonical fact confirms the row. */
    factDetail?: (fact: PerformedExposureFact) => string;
    /** Issue #805: the athletic capability this row corresponds to, if any. */
    athleticCapability?: AthleticCapabilityKey;
}

export interface CapabilityFactKeyEvidence {
    key: string;
    lastConfirmingFact: PerformedExposureFact | null;
    lastConfirmingFactProvenance: string | null;
    nextPlannedSession: ExposurePlannedSession | null;
    /** Issue #803: count of in-window facts whose structured execution entries were unreadable. */
    deliveredCompositionUnavailableCount: number;
    /** Issue #805: local dates in the input facts array where an unknown-variant capability
     * workout would be credited by planner compatibility history (`athleticCapabilitiesCreditedBy`). */
    unknownVariantDates: ReadonlySet<string>;
}

export interface CapabilityFactEvidence {
    byKey: Readonly<Record<string, CapabilityFactKeyEvidence>>;
}

/** Exact #805 capability confirmation from a canonical fact with a known authored variant. */
export const confirmsAthleticCapability = (capability: AthleticCapabilityKey) => (fact: PerformedExposureFact): boolean =>
    fact.workoutVariantId !== undefined && grantsAthleticCapabilityCredit({
        workoutId: fact.workoutId,
        capability,
        variant: fact.workoutVariantId as MechanicalDoseVariant,
        isReadinessModifiedDose: fact.isReadinessModifiedDose,
    });

export const plannedModality = (session: ExposurePlannedSession): ExposureModality =>
    normalizeModality(session.modality);

export function factProvenance(fact: PerformedExposureFact): string {
    return `canonical performed occurrence (${fact.sourceKinds.join('+')}; ${fact.confidence}`
        + `${fact.category ? `; ${fact.category}` : ''})`;
}

export const CAPABILITY_FACT_SPECS: readonly CapabilityFactSpec[] = [
    {
        key: 'aerobic_endurance',
        label: 'Aerobic endurance',
        confirmsFact: f => AEROBIC_EXPOSURE_MODALITIES.has(f.modality),
        plans: s => AEROBIC_EXPOSURE_MODALITIES.has(plannedModality(s)),
    },
    {
        key: 'cycling_quality',
        label: 'Cycling quality (tempo+ / race)',
        confirmsFact: () => false,
        plans: s => plannedModality(s) === 'Cycling' && s.intensity === 'hard',
    },
    {
        key: 'strength',
        label: 'Strength',
        confirmsFact: f => f.modality === 'Strength',
        plans: s => plannedModality(s) === 'Strength',
    },
    {
        // Issue #802: only an exact authored power identity at a non-modified dose counts.
        // Garmin records and imported-plan titles cannot prove power content, so they never
        // confirm or plan it; strength/VO2/threshold history leaves power `unknown`.
        key: 'neuromuscular_power',
        label: 'Neuromuscular power',
        confirmsFact: f => f.workoutVariantId !== undefined && grantsPowerExposureCredit({
            workoutId: f.workoutId,
            variant: f.workoutVariantId,
            isReadinessModifiedDose: f.isReadinessModifiedDose,
        }),
        plans: () => false,
    },
    {
        // Issue #803 (owner decision 2026-10-17): only logged unilateral working sets count --
        // never authored composition, warm-ups, imported-plan titles or Garmin records.
        key: 'unilateral_lower_body',
        label: 'Unilateral lower-body',
        confirmsFact: f => (f.deliveredUnilateralLowerBody?.workingSets ?? 0) > 0,
        factDetail: f => `${f.deliveredUnilateralLowerBody?.workingSets ?? 0} unilateral lower-body working set(s) logged`,
        plans: () => false,
    },
    {
        key: 'running',
        label: 'Running familiarity',
        confirmsFact: f => f.modality === 'Running',
        plans: s => plannedModality(s) === 'Running',
    },
    {
        key: 'field',
        label: 'Field / multidirectional sport',
        confirmsFact: f => f.modality === 'Field',
        plans: s => plannedModality(s) === 'Field',
    },
    {
        // Issue #804: only an exact authored mechanical/impact identity at a qualifying dose counts.
        // Garmin records and imported-plan titles cannot prove mechanical/plyometric content, so they never
        // confirm or plan it; generic running/strength leaves impact_jump `unknown`.
        key: 'impact_jump',
        label: 'Impact / jump-land',
        confirmsFact: f => f.workoutVariantId !== undefined && grantsMechanicalExposureCredit({
            workoutId: f.workoutId,
            variant: f.workoutVariantId as MechanicalDoseVariant,
            isReadinessModifiedDose: f.isReadinessModifiedDose,
        }),
        plans: () => false,
    },
    {
        key: 'linear_speed_skill',
        label: 'Linear speed',
        confirmsFact: confirmsAthleticCapability('linear_speed_skill'),
        plans: () => false,
        athleticCapability: 'linear_speed_skill',
    },
    {
        key: 'acceleration_deceleration',
        label: 'Acceleration / deceleration',
        confirmsFact: confirmsAthleticCapability('acceleration_deceleration'),
        plans: () => false,
        athleticCapability: 'acceleration_deceleration',
    },
    {
        // Issue #805: only exact authored capability identities whose defining steps were
        // retained count; Garmin field records, running and imported-plan titles never do.
        key: 'multidirectional_change_of_direction',
        label: 'Change of direction / multidirectional',
        confirmsFact: confirmsAthleticCapability('multidirectional_change_of_direction'),
        plans: () => false,
        athleticCapability: 'multidirectional_change_of_direction',
    },
    {
        key: 'sport_skill',
        label: 'Sport skill',
        confirmsFact: confirmsAthleticCapability('sport_skill'),
        plans: () => false,
        athleticCapability: 'sport_skill',
    },
];

export function deriveCapabilityFactEvidence(
    performedFacts: readonly PerformedExposureFact[] | null,
    plannedSessions: readonly ExposurePlannedSession[] | null,
    lookbackStart: string,
    asOfDate: string,
): CapabilityFactEvidence {
    const facts = performedFacts ?? [];
    const windowFacts = facts.filter(fact => fact.localDate >= lookbackStart && fact.localDate <= asOfDate);
    const futureSessions = (plannedSessions ?? []).filter(session => session.date >= asOfDate);
    const deliveredCompositionUnavailableCount = windowFacts.filter(fact => fact.deliveredCompositionUnavailable).length;

    const byKey: Record<string, CapabilityFactKeyEvidence> = {};
    for (const spec of CAPABILITY_FACT_SPECS) {
        const lastConfirmingFact = windowFacts
            .filter(spec.confirmsFact)
            .sort((a, b) => a.localDate.localeCompare(b.localDate))
            .at(-1) ?? null;
        const lastConfirmingFactProvenance = lastConfirmingFact
            ? `${factProvenance(lastConfirmingFact)}${spec.factDetail ? `; ${spec.factDetail(lastConfirmingFact)}` : ''}`
            : null;
        const nextPlannedSession = futureSessions
            .filter(spec.plans)
            .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
        const unknownVariantDates = new Set<string>(
            spec.athleticCapability
                ? facts
                    .filter(fact =>
                        fact.workoutVariantId === undefined
                        && fact.workoutId !== undefined
                        && ATHLETIC_CAPABILITY_WORKOUT_IDS.includes(fact.workoutId)
                        && athleticCapabilitiesCreditedBy({
                            workoutId: fact.workoutId,
                            isReadinessModifiedDose: fact.isReadinessModifiedDose,
                        }).includes(spec.athleticCapability!),
                    )
                    .map(fact => fact.localDate)
                : [],
        );
        byKey[spec.key] = {
            key: spec.key,
            lastConfirmingFact,
            lastConfirmingFactProvenance,
            nextPlannedSession,
            deliveredCompositionUnavailableCount: spec.key === 'unilateral_lower_body'
                ? deliveredCompositionUnavailableCount
                : 0,
            unknownVariantDates,
        };
    }

    return { byKey };
}
