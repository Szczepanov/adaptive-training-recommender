import { describe, expect, it } from 'vitest';
import {
    CAPABILITY_FACT_SPECS,
    confirmsAthleticCapability,
    deriveCapabilityFactEvidence,
    factProvenance,
    plannedModality,
    type ExposurePlannedSession,
} from './capabilityExposure';
import { ENGINE_CAPABILITY_SPECS } from '../../engine/contextBriefExposureLedger';
import type { PerformedExposureFact } from '../training/performedTrainingFacts';

const AS_OF = '2026-09-24';
const START = '2026-09-11';

function fact(overrides: Partial<PerformedExposureFact> = {}): PerformedExposureFact {
    return {
        performedOccurrenceId: 'occ-1',
        localDate: '2026-09-20',
        modality: 'Strength',
        category: 'Full-body Strength',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
        ...overrides,
    };
}

describe('derived/exposure/capabilityExposure (#1144 PR1-10)', () => {
    it('keeps CAPABILITY_FACT_SPECS keys and labels in exact parity and order with ENGINE_CAPABILITY_SPECS', () => {
        expect(CAPABILITY_FACT_SPECS.map(spec => spec.key)).toEqual(
            ENGINE_CAPABILITY_SPECS.map(spec => spec.key),
        );
        expect(CAPABILITY_FACT_SPECS.map(spec => spec.label)).toEqual(
            ENGINE_CAPABILITY_SPECS.map(spec => spec.label),
        );
    });

    it('derives last confirming fact, provenance, and next planned session per capability key', () => {
        const powerFact = fact({
            performedOccurrenceId: 'occ-power',
            localDate: '2026-09-20',
            modality: 'Strength',
            category: 'Full-body Strength',
            workoutId: 'strength_full_body_maintenance_01',
            workoutVariantId: 'full',
            deliveredUnilateralLowerBody: { workingSets: 5, stepIds: ['split-squat'] },
        });
        const runFact = fact({
            performedOccurrenceId: 'occ-run',
            localDate: '2026-09-22',
            modality: 'Running',
            category: 'Easy Endurance',
            workoutId: 'running_easy_continuous_01',
            workoutVariantId: 'full',
        });
        const planned: readonly ExposurePlannedSession[] = [
            { date: '2026-09-23', modality: 'Running', intensity: 'easy', title: 'Past planned ignored' },
            { date: '2026-09-27', modality: 'Cycling', intensity: 'hard', title: 'Threshold ride' },
            { date: '2026-09-25', modality: 'Strength', intensity: 'moderate', title: 'Strength A' },
        ];

        const evidence = deriveCapabilityFactEvidence([powerFact, runFact], planned, START, AS_OF);

        expect(evidence.byKey.aerobic_endurance.lastConfirmingFact).toEqual(runFact);
        expect(evidence.byKey.aerobic_endurance.nextPlannedSession?.date).toBe('2026-09-27');
        expect(evidence.byKey.cycling_quality.lastConfirmingFact).toBeNull();
        expect(evidence.byKey.cycling_quality.nextPlannedSession?.date).toBe('2026-09-27');
        expect(evidence.byKey.strength.lastConfirmingFact).toEqual(powerFact);
        expect(evidence.byKey.strength.nextPlannedSession?.date).toBe('2026-09-25');
        expect(evidence.byKey.neuromuscular_power.lastConfirmingFact).toEqual(powerFact);
        expect(evidence.byKey.neuromuscular_power.nextPlannedSession).toBeNull();
        expect(evidence.byKey.unilateral_lower_body.lastConfirmingFact).toEqual(powerFact);
        expect(evidence.byKey.unilateral_lower_body.lastConfirmingFactProvenance).toBe(
            'canonical performed occurrence (structured_execution; exact; Full-body Strength); 5 unilateral lower-body working set(s) logged',
        );
        expect(evidence.byKey.impact_jump.lastConfirmingFact).toEqual(runFact);
        expect(evidence.byKey.running.nextPlannedSession).toBeNull();
    });

    it('tracks deliveredCompositionUnavailableCount and unknown-variant athletic capability dates', () => {
        const unavailableFact = fact({
            performedOccurrenceId: 'occ-unreadable',
            localDate: '2026-09-21',
            deliveredCompositionUnavailable: true,
        });
        const outOfWindowUnavailable = fact({
            performedOccurrenceId: 'occ-old',
            localDate: '2026-09-01',
            deliveredCompositionUnavailable: true,
        });
        const unknownVariantField = fact({
            performedOccurrenceId: 'occ-field-unknown',
            localDate: AS_OF,
            modality: 'Field',
            category: 'Field Maintenance',
            workoutId: 'field_controlled_maintenance_01',
        });

        const evidence = deriveCapabilityFactEvidence(
            [unavailableFact, outOfWindowUnavailable, unknownVariantField],
            null,
            START,
            AS_OF,
        );

        expect(evidence.deliveredCompositionUnavailableCount).toBe(1);
        expect(evidence.byKey.unilateral_lower_body.deliveredCompositionUnavailableCount).toBe(1);
        expect(evidence.byKey.strength.deliveredCompositionUnavailableCount).toBe(0);
        expect([...evidence.byKey.sport_skill.unknownVariantDates]).toEqual([AS_OF]);
        expect([...evidence.byKey.multidirectional_change_of_direction.unknownVariantDates]).toEqual([AS_OF]);
        expect([...evidence.byKey.acceleration_deceleration.unknownVariantDates]).toEqual([AS_OF]);
        expect([...evidence.byKey.linear_speed_skill.unknownVariantDates]).toEqual([]);
    });

    it('exposes pure helpers confirmsAthleticCapability, plannedModality and factProvenance', () => {
        expect(plannedModality({ date: AS_OF, modality: 'road_biking', intensity: 'easy', title: 'Ride' })).toBe('Cycling');
        const fieldFull = fact({
            modality: 'Field',
            category: 'Field Maintenance',
            workoutId: 'field_controlled_maintenance_01',
            workoutVariantId: 'full',
        });
        expect(confirmsAthleticCapability('sport_skill')(fieldFull)).toBe(true);
        expect(confirmsAthleticCapability('sport_skill')({ ...fieldFull, workoutVariantId: undefined })).toBe(false);
        expect(factProvenance(fieldFull)).toBe('canonical performed occurrence (structured_execution; exact; Field Maintenance)');
    });
});
