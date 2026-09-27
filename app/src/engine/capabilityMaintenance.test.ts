import { describe, expect, it } from 'vitest';
import {
    activeCapabilityPlacements,
    ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS,
    capabilityProgressionTargetStage,
    evaluateCapabilityCadence,
    evaluateCapabilityMaintenance,
    type CapabilityExposureRecord,
    type CapabilityMaintenanceInput,
} from './capabilityMaintenance';
import type { CapabilityMaintenancePreference } from './models';
import type { MechanicalProgressionVerdict } from './mechanicalProgression';
import { addDaysToLocalDateString } from '../utils/localDate';
import {
    athleticCapabilitiesCreditedBy,
    grantsAthleticCapabilityCredit,
    validateAthleticCapabilityIdentities,
    ATHLETIC_CAPABILITY_WORKOUT_IDS,
} from '../workouts/athleticCapability';
import { WORKOUTS } from '../workouts/catalog';
import { MECHANICAL_QUALIFYING_IDENTITIES } from '../workouts/mechanicalExposure';

const D = '2026-09-10';
const ALL: CapabilityMaintenancePreference = {
    enabled: true,
    capabilities: ['linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill'],
};
const daysAgo = (days: number) => addDaysToLocalDateString(D, -days);
const fieldMaint = (date: string, variant?: CapabilityExposureRecord['variant']): CapabilityExposureRecord =>
    ({ date, workoutId: 'field_controlled_maintenance_01', ...(variant ? { variant } : {}) });

const cadenceOf = (exposures: CapabilityExposureRecord[], overrides: Partial<Parameters<typeof evaluateCapabilityCadence>[0]> = {}) =>
    evaluateCapabilityCadence({ asOfDate: D, planningHorizonDays: 7, preference: ALL, exposures, observedWindowDays: 28, ...overrides });
const statusOf = (cadence: ReturnType<typeof cadenceOf>, capability: string) => cadence.find(item => item.capability === capability)!;

const verdict = (stage: 1 | 2 | 3 | 4, eligibleWorkoutIds: string[]): MechanicalProgressionVerdict => ({
    stage, eligible: true, status: 'eligible', recentExposureCount: 2,
    tissueResponse: { verdict: 'normal', affectedRegions: [], notes: [] }, eligibleWorkoutIds,
});
const STAGE_4_IDS = MECHANICAL_QUALIFYING_IDENTITIES.filter(item => item.planningUse === 'maintenance_candidate').map(item => item.workoutId);
const noGates = (): CapabilityMaintenanceInput['gates'] => ({
    guardrailBlocked: new Set(), unavailable: new Set(), avoided: new Set(), environmentUnavailable: new Set(), deprioritized: new Set(),
});
const FIELD_IDS = new Set(ATHLETIC_CAPABILITY_WORKOUT_IDS);
const HORIZON = Array.from({ length: 7 }, (_, index) => addDaysToLocalDateString(D, index));

function evaluate(overrides: Partial<CapabilityMaintenanceInput> = {}) {
    return evaluateCapabilityMaintenance({
        asOfDate: D, planningHorizonDays: 7, preference: ALL, exposures: [fieldMaint(daysAgo(20))], observedWindowDays: 28,
        mode: 'evergreen', mechanicalSuspension: null, mechanicalRequirementPresent: true,
        mechanicalVerdict: verdict(4, STAGE_4_IDS), gates: noGates(), supportCapacityDates: HORIZON,
        ...overrides,
    });
}
const sportSkill = (result: ReturnType<typeof evaluate>) => result.capabilities.find(item => item.capability === 'sport_skill')!;

describe('capability cadence (#805 Phase 3)', () => {
    it('uses a fixed 14-day interval: day 13 is due tomorrow, day 14 due today, day 15 overdue', () => {
        expect(ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS).toBe(14);
        expect(statusOf(cadenceOf([fieldMaint(daysAgo(13))]), 'sport_skill')).toMatchObject({
            status: 'due', nextDueDate: daysAgo(-1), notBeforeDate: daysAgo(-1), targetDate: daysAgo(-1),
        });
        expect(statusOf(cadenceOf([fieldMaint(daysAgo(14))]), 'sport_skill')).toMatchObject({ status: 'due', notBeforeDate: D });
        expect(statusOf(cadenceOf([fieldMaint(daysAgo(15))]), 'sport_skill')).toMatchObject({
            status: 'overdue', nextDueDate: daysAgo(1), notBeforeDate: D,
        });
        expect(statusOf(cadenceOf([fieldMaint(daysAgo(13))], { planningHorizonDays: 1 }), 'sport_skill').status).toBe('satisfied');
    });

    it('makes a horizon-entry target visible as due without pulling placement earlier (F12)', () => {
        const entry = statusOf(cadenceOf([fieldMaint(daysAgo(8))]), 'sport_skill');
        expect(entry).toMatchObject({ status: 'due', notBeforeDate: addDaysToLocalDateString(D, 6), targetDate: addDaysToLocalDateString(D, 6) });
    });

    it('never infers due from partial history and reports disabled capabilities', () => {
        const partial = cadenceOf([], { observedWindowDays: 13 });
        expect(partial.every(item => item.status === 'insufficient_history')).toBe(true);
        expect(cadenceOf([], { preference: undefined }).every(item => item.status === 'disabled')).toBe(true);
        expect(cadenceOf([], { preference: { enabled: false, capabilities: ALL.capabilities } }).every(item => item.status === 'disabled')).toBe(true);
        const subset = cadenceOf([], { preference: { enabled: true, capabilities: ['sport_skill'] } });
        expect(statusOf(subset, 'sport_skill').status).toBe('overdue');
        expect(statusOf(subset, 'linear_speed_skill').status).toBe('disabled');
    });

    it('lets one session credit several capabilities, per retained authored steps', () => {
        expect(athleticCapabilitiesCreditedBy({ workoutId: 'field_controlled_maintenance_01', variant: 'full' }).sort())
            .toEqual(['acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill']);
        const cadence = cadenceOf([fieldMaint(daysAgo(3))]);
        expect(statusOf(cadence, 'sport_skill').status).toBe('satisfied');
        expect(statusOf(cadence, 'multidirectional_change_of_direction').status).toBe('satisfied');
        expect(statusOf(cadence, 'linear_speed_skill').status).toBe('overdue');
    });

    it('credits return_to_training variants only for capabilities whose defining steps remain', () => {
        expect(athleticCapabilitiesCreditedBy({ workoutId: 'field_acceleration_braking_01', variant: 'return_to_training' }))
            .toEqual(['linear_speed_skill']);
        expect(athleticCapabilitiesCreditedBy({ workoutId: 'field_controlled_maintenance_01', variant: 'return_to_training' }))
            .toEqual(['sport_skill']);
        const cadence = cadenceOf([fieldMaint(daysAgo(3), 'return_to_training')]);
        expect(statusOf(cadence, 'sport_skill').status).toBe('satisfied');
        expect(statusOf(cadence, 'multidirectional_change_of_direction').status).toBe('overdue');
    });

    it('fails closed for readiness-modified doses and never credits generic running or plyometrics', () => {
        expect(grantsAthleticCapabilityCredit({ workoutId: 'field_controlled_maintenance_01', capability: 'sport_skill', isReadinessModifiedDose: true })).toBe(false);
        for (const workoutId of ['running_easy_continuous_01', 'running_walk_run_01', 'running_vo2_4x4_01', 'strength_reactive_power_01']) {
            expect(athleticCapabilitiesCreditedBy({ workoutId })).toEqual([]);
        }
        expect(statusOf(cadenceOf([{ date: daysAgo(2), workoutId: 'running_easy_continuous_01' }]), 'multidirectional_change_of_direction').status)
            .toBe('overdue');
    });

    it('validates every authored mapping row against the catalog', () => {
        expect(validateAthleticCapabilityIdentities(WORKOUTS)).toEqual([]);
    });

    it('steers #804 toward the highest owed capability stage', () => {
        expect(capabilityProgressionTargetStage(cadenceOf([]))).toBe(4);
        expect(capabilityProgressionTargetStage(cadenceOf([fieldMaint(daysAgo(2)), { date: daysAgo(2), workoutId: 'field_acceleration_braking_01' }]))).toBeUndefined();
        expect(capabilityProgressionTargetStage(cadenceOf([fieldMaint(daysAgo(2))]))).toBe(2);
    });
});

describe('capability fulfilment (#805 Phase 3, ADR-0044 D9)', () => {
    it('is plannable with exact stage-eligible identities and a placement from the not-before date', () => {
        const result = evaluate();
        expect(sportSkill(result)).toMatchObject({ status: 'overdue', fulfilment: { status: 'plannable' }, supportWorkoutIds: ['field_controlled_maintenance_01'] });
        const placement = result.placements.find(item => item.capability === 'sport_skill')!;
        expect(placement).toMatchObject({ notBeforeDate: D, consentWorkoutIds: ['field_controlled_maintenance_01'], progressionOnly: false });
    });

    it('blocks under an active mechanical guardrail and substitutes nothing', () => {
        const result = evaluate({ gates: { ...noGates(), guardrailBlocked: FIELD_IDS } });
        expect(sportSkill(result).fulfilment).toEqual({ status: 'blocked', reason: 'mechanical_guardrail' });
        expect(result.placements).toEqual([]);
    });

    it('lets unavailable win, blocks avoided, and keeps deprioritized soft', () => {
        expect(sportSkill(evaluate({ gates: { ...noGates(), unavailable: FIELD_IDS, avoided: FIELD_IDS } })).fulfilment)
            .toEqual({ status: 'blocked', reason: 'modality_unavailable' });
        const avoided = evaluate({ gates: { ...noGates(), avoided: FIELD_IDS } });
        expect(sportSkill(avoided).fulfilment).toEqual({ status: 'blocked', reason: 'modality_avoided' });
        expect(avoided.placements).toEqual([]);
        const deprioritized = evaluate({ gates: { ...noGates(), deprioritized: FIELD_IDS } });
        expect(sportSkill(deprioritized).fulfilment).toEqual({ status: 'plannable' });
        expect(deprioritized.softContext).toHaveLength(1);
    });

    it('reports environment, capacity and stage insufficiency as typed blocks', () => {
        expect(sportSkill(evaluate({ gates: { ...noGates(), environmentUnavailable: FIELD_IDS } })).fulfilment)
            .toEqual({ status: 'blocked', reason: 'environment_unavailable' });
        expect(sportSkill(evaluate({ supportCapacityDates: [] })).fulfilment).toEqual({ status: 'blocked', reason: 'no_support_capacity' });
        const coldStart = evaluate({ exposures: [], mechanicalVerdict: verdict(1, ['running_walk_run_01']) });
        expect(sportSkill(coldStart).fulfilment).toEqual({ status: 'blocked', reason: 'mechanical_stage_insufficient' });
        expect(coldStart.placements.every(item => item.progressionOnly && item.consentWorkoutIds.length === 0)).toBe(true);
        expect(coldStart.placements[0].workoutIds).toEqual(['running_walk_run_01']);
    });

    it('steers progression to the highest eligible stage without consenting a non-due identity', () => {
        const stage2 = evaluate({ exposures: [], mechanicalVerdict: verdict(2, ['running_walk_run_01', 'strength_reactive_power_01', 'field_sprint_mechanics_foundation_01']) });
        expect(stage2.capabilities.find(item => item.capability === 'linear_speed_skill')!.fulfilment).toEqual({ status: 'plannable' });
        const sport = stage2.placements.find(item => item.capability === 'sport_skill')!;
        expect(sport.progressionOnly).toBe(true);
        expect(sport.workoutIds).toEqual(['field_sprint_mechanics_foundation_01', 'strength_reactive_power_01']);
    });

    it('treats source suspensions and event-directed mode as deliberate, with no catch-up placement', () => {
        for (const source of ['adverse_recovery', 'clinical_symptoms', 'event_phase', 'mechanical_withheld'] as const) {
            const result = evaluate({ mechanicalSuspension: source, mechanicalRequirementPresent: false });
            expect(sportSkill(result).fulfilment).toEqual({ status: 'deliberately_suspended', reason: source });
            expect(result.placements).toEqual([]);
        }
        const eventMode = evaluate({ mode: 'event_directed' });
        expect(eventMode.capabilities.filter(item => item.fulfilment).every(item =>
            item.fulfilment!.reason === 'event_directed_mode')).toBe(true);
        expect(eventMode.placements).toEqual([]);
    });

    it('reports unknown when no mechanical requirement exists or history is partial', () => {
        expect(sportSkill(evaluate({ mechanicalRequirementPresent: false })).fulfilment)
            .toEqual({ status: 'unknown', reason: 'mechanical_requirement_absent' });
        expect(sportSkill(evaluate({ observedWindowDays: 7 })).fulfilment).toEqual({ status: 'unknown', reason: 'history_unavailable' });
    });

    it('owes at most one placement per capability however long a suspension lasts', () => {
        const long = evaluate({ exposures: [fieldMaint(daysAgo(27))] });
        expect(long.placements.filter(item => item.capability === 'sport_skill')).toHaveLength(1);
        expect(long.placements.length).toBeLessThanOrEqual(4);
    });
});

describe('date-aware placement resolution (#805 F12)', () => {
    const placement = {
        capability: 'sport_skill' as const, notBeforeDate: addDaysToLocalDateString(D, 3), targetDate: addDaysToLocalDateString(D, 3),
        workoutIds: ['field_controlled_maintenance_01'], consentWorkoutIds: ['field_controlled_maintenance_01'], progressionOnly: false,
    };

    it('is inactive before the not-before date and until a qualifying touch after it', () => {
        expect(activeCapabilityPlacements([placement], addDaysToLocalDateString(D, 2), [])).toEqual([]);
        expect(activeCapabilityPlacements([placement], addDaysToLocalDateString(D, 3), [])).toHaveLength(1);
        // An earlier generic touch does not fulfil the future capability placement.
        expect(activeCapabilityPlacements([placement], addDaysToLocalDateString(D, 5), [fieldMaint(addDaysToLocalDateString(D, 1))])).toHaveLength(1);
        expect(activeCapabilityPlacements([placement], addDaysToLocalDateString(D, 5), [fieldMaint(addDaysToLocalDateString(D, 3))])).toEqual([]);
        // A running touch after the not-before date never fulfils sport skill.
        expect(activeCapabilityPlacements([placement], addDaysToLocalDateString(D, 5), [{ date: addDaysToLocalDateString(D, 4), workoutId: 'running_easy_continuous_01' }])).toHaveLength(1);
    });
});
