import { describe, expect, it } from 'vitest';
import type { EvidenceTier } from '../../ledger/models';
import {
    GARMIN_CYCLING_ACTIVITY_TYPES,
    classifyGarminTier,
    isGarminCyclingActivityType,
    type GarminEvidenceSignals,
} from './providerEvidence';

// Frozen pre-move oracle copied verbatim from engine/completedTraining.ts and
// engine/garminTelemetryEvidence.ts (#1183 / ADR-0052 PR1-8).
const ORACLE_GARMIN_CYCLING_POWER_TYPES = new Set([
    'cycling', 'cyclocross', 'gravel_cycling', 'indoor_cycling',
    'mountain_biking', 'road_biking', 'virtual_ride',
]);

function oracleIsGarminCyclingActivityType(type: string): boolean {
    return ORACLE_GARMIN_CYCLING_POWER_TYPES.has(type.trim().toLowerCase());
}

function oracleClassifyGarminTier(signals: GarminEvidenceSignals): EvidenceTier {
    const hasTrainingEffect = (signals.trainingEffectAerobic ?? 0) > 0 || (signals.trainingEffectAnaerobic ?? 0) > 0;
    const hasTrainingLoad = signals.activityTrainingLoad !== null && signals.activityTrainingLoad > 0;
    if (hasTrainingEffect && hasTrainingLoad) return 'measuredEffort';
    if (hasTrainingEffect) return 'garminTrainingEffect';
    if (signals.intensityTag && signals.intensityTag.trim() !== '') return 'durationIntensity';
    if (signals.modalityKnown) return 'athleteClassification';
    return 'genericModalityFallback';
}

describe('derived/training/providerEvidence frozen-oracle parity (#1183)', () => {
    it('exports the exact 7-member Garmin cycling activity-type set', () => {
        expect([...GARMIN_CYCLING_ACTIVITY_TYPES]).toEqual([...ORACLE_GARMIN_CYCLING_POWER_TYPES]);
    });

    it('matches oracleIsGarminCyclingActivityType over a superset activity-type vocabulary sweep', () => {
        const canonical = [
            'cycling',
            'cyclocross',
            'gravel_cycling',
            'indoor_cycling',
            'mountain_biking',
            'road_biking',
            'virtual_ride',
        ];
        const variants = canonical.flatMap(type => [
            type,
            type.toUpperCase(),
            `  ${type}  `,
            `\t${type.slice(0, 3).toUpperCase()}${type.slice(3)}\n`,
            `${type}_extra`,
            `_${type}`,
        ]);
        const nearMissesAndOthers = [
            '',
            '   ',
            '\t\n',
            'bike',
            'biking',
            'cycl',
            'cycle',
            'e_bike',
            'ebike_fitness',
            'bmx',
            'track_cycling',
            'hand_cycling',
            'recumbent_cycling',
            'road_bike',
            'mountain_bike',
            'virtual_cycling',
            'indoor_bike',
            'running',
            'trail_running',
            'treadmill_running',
            'strength_training',
            'weight_training',
            'lap_swimming',
            'open_water_swimming',
            'walking',
            'hiking',
            'yoga',
            'pilates',
            'rowing',
            'indoor_rowing',
            'elliptical',
            'soccer',
            'tennis',
            'other',
            'unknown',
        ];

        for (const candidate of [...variants, ...nearMissesAndOthers]) {
            expect(isGarminCyclingActivityType(candidate)).toBe(oracleIsGarminCyclingActivityType(candidate));
        }
    });

    it('matches oracleClassifyGarminTier across the full signal grid', () => {
        const aerobicValues: Array<number | null> = [null, -0.5, 0, 0.1, 2.4, 5.0];
        const anaerobicValues: Array<number | null> = [null, -0.5, 0, 0.1, 2.4, 5.0];
        const loadValues: Array<number | null> = [null, -5, 0, 0.5, 25, 180];
        const intensityTags = ['', '   ', '\t\n', 'easy', 'moderate', 'hard', 'unknown', ' recovery '];
        const modalityFlags = [true, false];

        for (const trainingEffectAerobic of aerobicValues) {
            for (const trainingEffectAnaerobic of anaerobicValues) {
                for (const activityTrainingLoad of loadValues) {
                    for (const intensityTag of intensityTags) {
                        for (const modalityKnown of modalityFlags) {
                            const signals: GarminEvidenceSignals = {
                                trainingEffectAerobic,
                                trainingEffectAnaerobic,
                                intensityTag,
                                activityTrainingLoad,
                                modalityKnown,
                            };
                            expect(classifyGarminTier(signals)).toBe(oracleClassifyGarminTier(signals));
                        }
                    }
                }
            }
        }
    });
});
