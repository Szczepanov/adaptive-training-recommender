import { describe, expect, it } from 'vitest';
import { deriveObjectiveCredit, getUnresolvedObjectivesV2, readStimulusProfile } from './stimulus';
import type { PlannerState, WeeklyObjective, WorkoutStimulusProfile } from './models';

describe('deriveObjectiveCredit', () => {
    const sampleObjective: WeeklyObjective = {
        id: 'obj_z2_1',
        key: 'zone2_aerobic',
        title: 'Aerobic Base Building',
        requiredCredit: 1.0,
        targetExposures: 1,
        completedExposures: 0,
        targetStimulus: { aerobicEndurance: 0.8 },
    };

    const sampleStimulus: WorkoutStimulusProfile = {
        aerobicEndurance: 0.8,
        thresholdPower: 0.2,
        vo2MaxPower: 0,
        repeatedSurges: 0,
        sprintPower: 0,
        fatigueResistance: 0,
        maxStrength: 0,
        hypertrophy: 0,
    };

    it('derives full fractional credit when fully completed', () => {
        const result = deriveObjectiveCredit(sampleObjective, sampleStimulus, { completionRatio: 1.0 }, { modality: 'Cycling' });
        expect(result.qualifies).toBe(true);
        expect(result.earnedCredit).toBe(0.8);
    });

    it('scales fractional credit when partially completed', () => {
        const result = deriveObjectiveCredit(sampleObjective, sampleStimulus, { completionRatio: 0.5 }, { modality: 'Cycling' });
        expect(result.qualifies).toBe(true);
        expect(result.earnedCredit).toBe(0.4);
    });

    it('disqualifies credit when modality restriction fails', () => {
        const restrictedObj: WeeklyObjective = {
            ...sampleObjective,
            qualification: { allowedModalities: ['Running'] },
        };
        const result = deriveObjectiveCredit(restrictedObj, sampleStimulus, { completionRatio: 1.0 }, { modality: 'Cycling' });
        expect(result.qualifies).toBe(false);
        expect(result.earnedCredit).toBe(0);
        expect(result.reason).toBe('Modality not allowed');
    });

    it('disqualifies credit when category restriction fails', () => {
        const restrictedObj: WeeklyObjective = {
            ...sampleObjective,
            qualification: { allowedCategories: ['Race-Specific Endurance'] },
        };
        const result = deriveObjectiveCredit(restrictedObj, sampleStimulus, { completionRatio: 1.0 }, { modality: 'Cycling', category: 'Easy Endurance' });
        expect(result.qualifies).toBe(false);
        expect(result.earnedCredit).toBe(0);
        expect(result.reason).toBe('Category not allowed');
    });

    it('disqualifies credit when a minimum-stimulus qualification axis is not met', () => {
        const restrictedObj: WeeklyObjective = {
            ...sampleObjective,
            qualification: { minimumStimulus: { aerobicEndurance: 0.9 } },
        };
        const result = deriveObjectiveCredit(restrictedObj, sampleStimulus, { completionRatio: 1.0 });
        expect(result.qualifies).toBe(false);
        expect(result.earnedCredit).toBe(0);
        expect(result.reason).toBe('Minimum aerobicEndurance stimulus not met');
    });

    it('defaults completionRatio to 1.0 and clamps out-of-range values', () => {
        const fullCredit = deriveObjectiveCredit(sampleObjective, sampleStimulus, {});
        expect(fullCredit.earnedCredit).toBe(0.8);

        const clampedHigh = deriveObjectiveCredit(sampleObjective, sampleStimulus, { completionRatio: 1.5 });
        expect(clampedHigh.earnedCredit).toBe(0.8);

        const clampedLow = deriveObjectiveCredit(sampleObjective, sampleStimulus, { completionRatio: -0.5 });
        expect(clampedLow.earnedCredit).toBe(0);
        expect(clampedLow.qualifies).toBe(true);
    });

    it('derives credit for threshold_quality, surge_repeatability, vo2_max, strength_maintenance and race_specific_endurance objectives', () => {
        const richStimulus: WorkoutStimulusProfile = {
            aerobicEndurance: 0.4,
            thresholdPower: 0.7,
            vo2MaxPower: 0.6,
            repeatedSurges: 0.5,
            sprintPower: 0.1,
            fatigueResistance: 0.55,
            maxStrength: 0.9,
            hypertrophy: 0.3,
        };

        const thresholdResult = deriveObjectiveCredit({ ...sampleObjective, key: 'threshold_quality' }, richStimulus);
        expect(thresholdResult.earnedCredit).toBe(0.7);

        const surgeResult = deriveObjectiveCredit({ ...sampleObjective, key: 'surge_repeatability' }, richStimulus);
        expect(surgeResult.earnedCredit).toBe(0.5);

        const vo2Result = deriveObjectiveCredit({ ...sampleObjective, key: 'vo2_max' }, richStimulus);
        expect(vo2Result.earnedCredit).toBe(0.6);

        const strengthResult = deriveObjectiveCredit({ ...sampleObjective, key: 'strength_maintenance' }, richStimulus);
        expect(strengthResult.earnedCredit).toBe(0.9); // max(maxStrength, hypertrophy)

        const raceSpecificResult = deriveObjectiveCredit({ ...sampleObjective, key: 'race_specific_endurance' }, richStimulus);
        // max(fatigueResistance, 0.5*aerobicEndurance + 0.5*repeatedSurges) = max(0.55, 0.45)
        expect(raceSpecificResult.earnedCredit).toBe(0.55);
    });

    it('falls back to legacy stimulus field names when canonical axes are absent', () => {
        const legacyOnlyStimulus = {
            aerobicCapacity: 0.8,
            thresholdDevelopment: 0.6,
            surgeRepeatability: 0.4,
        };
        const result = deriveObjectiveCredit({ ...sampleObjective, key: 'zone2_aerobic' }, legacyOnlyStimulus);
        expect(result.earnedCredit).toBe(0.8);
    });

    it('does not credit an invalid stimulus record as if it were a zero-stimulus workout', () => {
        const result = deriveObjectiveCredit(sampleObjective, null);
        expect(result).toMatchObject({ earnedCredit: 0, qualifies: false, reason: 'Invalid stimulus profile' });
    });
});

describe('readStimulusProfile', () => {
    it('passes canonical fields through unchanged', () => {
        const canonical: WorkoutStimulusProfile = {
            aerobicEndurance: 0.8,
            thresholdPower: 0.7,
            vo2MaxPower: 0.6,
            repeatedSurges: 0.5,
            sprintPower: 0.2,
            fatigueResistance: 0.4,
            maxStrength: 0.9,
            hypertrophy: 0.3,
        };
        const profile = readStimulusProfile(canonical);
        expect(profile).toMatchObject({ status: 'AVAILABLE', data: canonical });
    });

    it('converts legacy-only fields without applying derived fallbacks', () => {
        const legacy = {
            aerobicCapacity: 0.8,
            thresholdDevelopment: 0.6,
            surgeRepeatability: 0.5,
        };
        const profile = readStimulusProfile(legacy);
        expect(profile.status).toBe('AVAILABLE');
        if (profile.status !== 'AVAILABLE') throw new Error('Expected available legacy profile');
        expect(profile.data.aerobicEndurance).toBe(0.8);
        expect(profile.data.thresholdPower).toBe(0.6);
        expect(profile.data.repeatedSurges).toBe(0.5);
        expect(profile.data.vo2MaxPower).toBe(0); // derived multiplier deleted
        expect(profile.data.fatigueResistance).toBe(0); // derived multiplier deleted
    });

    it('prefers canonical values and logs when canonical and legacy fields conflict', () => {
        const conflicting = {
            aerobicEndurance: 0.9,
            aerobicCapacity: 0.4,
        };
        const profile = readStimulusProfile(conflicting);
        expect(profile).toMatchObject({ status: 'AVAILABLE', data: { aerobicEndurance: 0.9 } });
    });

    it('returns INVALID for empty/null inputs', () => {
        const profile = readStimulusProfile(null);
        expect(profile).toMatchObject({ status: 'INVALID', issues: [{ code: 'stimulus_profile_missing_axes' }] });
    });
});

describe('getUnresolvedObjectivesV2', () => {
    const basePlannerState: PlannerState = {
        completedExposures: [],
        projectedExposures: [],
        fatigueState: {
            lastUpdatedDate: '2026-08-07',
            externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        },
        recentSessionHistory: [],
        policyVersion: 'test',
        engineVersion: 'v2',
        weeklyObjectives: [
            { id: 'obj_a', key: 'zone2_aerobic', title: 'Aerobic', requiredCredit: 1.0, targetExposures: 1, completedExposures: 0, targetStimulus: {} },
            { id: 'obj_b', key: 'threshold_quality', title: 'Threshold', requiredCredit: 1.0, targetExposures: 1, completedExposures: 1, targetStimulus: {} },
        ],
    };

    it('treats an objective as unresolved when its fractional progress credit is below the requirement', () => {
        const unresolved = getUnresolvedObjectivesV2(basePlannerState, [
            { objectiveId: 'obj_a', projectedCredit: 0, completedCredit: 0.4, rawCompletedCredit: 0.4 },
        ]);
        expect(unresolved.map(o => o.id)).toEqual(['obj_a']);
    });

    it('resolves an objective once its fractional progress credit meets the requirement', () => {
        const unresolved = getUnresolvedObjectivesV2(basePlannerState, [
            { objectiveId: 'obj_a', projectedCredit: 0, completedCredit: 1.0, rawCompletedCredit: 1.0 },
        ]);
        expect(unresolved.map(o => o.id)).toEqual([]);
    });

    it('falls back to the objective\'s own completedExposures when no progress entry is supplied', () => {
        const unresolved = getUnresolvedObjectivesV2(basePlannerState, []);
        // obj_a: completedExposures 0 < requiredCredit 1 -> unresolved.
        // obj_b: completedExposures 1 >= requiredCredit 1 -> resolved.
        expect(unresolved.map(o => o.id)).toEqual(['obj_a']);
    });
});
