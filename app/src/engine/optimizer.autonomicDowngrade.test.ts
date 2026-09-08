import { describe, it, expect } from 'vitest';
import { rankCandidates } from './optimizer';
import { evaluateTraining } from './rules';
import { ENRICHED_TEMPLATES } from './templates';
import type { DailyReadiness, EngineObjectiveInput, FatigueState, SubjectiveInput, UserContext, UserEvent, UserPreferences, WeeklyObjective } from './models';

function cyclingEvent(): UserEvent {
    return {
        id: 'crit-a',
        title: 'City Criterium',
        category: 'cycling_event',
        date: '2026-09-20',
        priority: 'A',
        lifecycle: 'scheduled',
        demandProfile: {
            aerobicEndurance: 0.8,
            thresholdPower: 0.85,
            vo2MaxPower: 0.9,
            repeatedSurges: 0.95,
            sprintPower: 0.7,
            fatigueResistance: 0.8,
            neuromuscular: 0.3,
        },
    };
}

function fullPreferences(): UserPreferences {
    return {
        userId: 'u1',
        preferredRecoveryStyle: 'mixed',
        defaultWeekdayTimeMin: 60,
        defaultWeekendTimeMin: 90,
        preferredTimeOfDay: 'flexible',
        avoidedModalities: [],
        deprioritizedModalities: [],
        preferredModalities: ['Cycling'],
        explanationVerbosity: 'brief',
        conservativeBias: false,
        preferredUnits: {
            distance: 'km',
            weight: 'kg',
            temperature: 'celsius',
        },
        schemaVersion: 1,
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
    };
}

function baseContext(): UserContext {
    return {
        focusEvent: cyclingEvent(),
        goals: { shortTerm: 'Podium at Crit', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: fullPreferences(),
    };
}

function autonomicFatigue(): FatigueState {
    return {
        lastUpdatedDate: '2026-09-08',
        externalLoadFatigue: { systemic: 0.2, cardiovascular: 0.2, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
        internalResponseStrain: { systemic: 0.45, cardiovascular: 0.50, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
        combinedFatigue: { systemic: 0.45, cardiovascular: 0.50, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
    };
}

describe('Autonomic stress modality preservation', () => {
    it('demotes strength candidates in candidate ranking during autonomic stress for endurance athletes', () => {
        const unresolvedObjectives: WeeklyObjective[] = [
            { id: 'obj_1', key: 'zone2_aerobic', title: 'Zone 2 Aerobic', targetExposures: 2, completedExposures: 1, targetStimulus: { aerobicEndurance: 0.8 } },
            { id: 'obj_2', key: 'strength_maintenance', title: 'Strength Maintenance', targetExposures: 1, completedExposures: 0, targetStimulus: { maxStrength: 0.5 } },
        ];

        const ranked = rankCandidates(
            ENRICHED_TEMPLATES,
            unresolvedObjectives,
            autonomicFatigue(),
            {
                date: '2026-09-08',
                maxTimeMinutes: 90,
                availableEquipment: ['indoor_bike', 'free_weights'],
                fixedActivities: [],
                reservedCapacityCost: 0,
                reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                environmentOverride: null,
            },
            [],
            fullPreferences(),
            { focusEvent: cyclingEvent(), date: '2026-09-08', fatigueTier: 'modify' }
        );

        const accepted = ranked.accepted;
        const topCandidate = accepted[0];

        // The top candidate should preserve the primary event modality (Cycling), not gym strength
        expect(topCandidate.template.modality).toBe('Cycling');
    });

    it('rules.evaluateTraining selects a cycling endurance session rather than Upper-body Strength on autonomic dip', () => {
        const subjective: SubjectiveInput = {
            readiness: 6,
            sleepQuality: 6,
            fatigue: 3,
            soreness: 2,
            stress: 3,
            motivation: 7,
            timeAvailable: 60,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        };

        const objective: EngineObjectiveInput = {
            total_steps: 8000,
            steps_7d_avg: 8000,
            sleep_score: 80,
            sleep_duration_min: 480,
            sleep_score_delta_7d: 0,
            sleep_score_delta_28d: 0,
            sleep_score_stdev_28d: 5,
            rhr: 57,
            rhr_7d_avg: 50,
            rhr_delta: 7, // +2 SD elevated RHR
            rhr_delta_28d: 7,
            rhr_stdev_28d: 2,
            hrv_weekly_avg: 50,
            hrv_last_night: 33,
            hrv_delta: -17, // -2 SD depressed HRV
            hrv_delta_28d: -17,
            hrv_stdev_28d: 5,
            respiration: 14,
            respiration_delta: 0,
            respiration_delta_28d: 0,
            respiration_mad_28d: 1,
            body_battery_wake: 55,
            yesterday_training: null,
            today_training: null,
            last_3_days_hard_sessions_count: 0,
        };

        const readiness: DailyReadiness = { subjective, objective };
        const rec = evaluateTraining(readiness, baseContext(), '2026-09-08');

        expect(rec.mode).toBe('modify');
        // Must preserve primary cycling modality rather than pivoting to Upper-body Strength
        expect(rec.template.modality).toBe('Cycling');
        expect(rec.template.category).toBe('Easy Endurance');
    });
});
