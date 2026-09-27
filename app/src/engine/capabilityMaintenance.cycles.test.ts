import { describe, expect, it } from 'vitest';
import {
    activeCapabilityPlacements,
    capabilityProgressionTargetStage,
    evaluateCapabilityCadence,
    evaluateCapabilityMaintenance,
    type CapabilityExposureRecord,
} from './capabilityMaintenance';
import { evaluateMechanicalStageProgression, type CheckinRecord, type MechanicalExposureRecord } from './mechanicalProgression';
import type { AthleticCapabilityKey, CapabilityMaintenancePreference, DailySubjectiveCheckin } from './models';
import { athleticCapabilitiesCreditedBy } from '../workouts/athleticCapability';
import { mechanicalIdentityFor } from '../workouts/mechanicalExposure';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';

/**
 * #805 x #804 interaction over eight weeks, without simulation-harness artifacts: every day
 * the #804 verdict is resolved (with the owed capability stage as its target), the #805
 * evaluator places owed touches, and an idealized athlete performs the placed identity on
 * the first active day with an explicit normal next-morning response. It proves the cadence
 * recurs (neither the 14-day re-entry rule nor a lower-stage touch collapses the stage) and
 * that it never becomes a weekly checkbox.
 */

const START = '2026-09-01';
const WEEKS = 8;
const ALL: CapabilityMaintenancePreference = {
    enabled: true,
    capabilities: ['linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill'],
};

function normalFollowUp(date: string): CheckinRecord {
    return {
        date,
        checkin: {
            date, soreness: 2, painOrInjury: false, illnessSymptoms: false,
            tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } },
        } as DailySubjectiveCheckin,
    };
}

function runCycles(preference: CapabilityMaintenancePreference) {
    // Stage-4-ready start: two stage-3 sessions with normal follow-ups, controlled field work 20 days ago.
    const seed = [
        { date: addDaysToLocalDateString(START, -20), workoutId: 'field_controlled_maintenance_01' },
        { date: addDaysToLocalDateString(START, -9), workoutId: 'field_acceleration_braking_01' },
        { date: addDaysToLocalDateString(START, -4), workoutId: 'field_acceleration_braking_01' },
    ];
    const performed: CapabilityExposureRecord[] = [...seed];
    const stages: number[] = [];
    for (let day = 0; day < WEEKS * 7; day++) {
        const date = addDaysToLocalDateString(START, day);
        const exposureHistory: MechanicalExposureRecord[] = performed.map(item => ({
            date: item.date, workoutId: item.workoutId!, stage: mechanicalIdentityFor(item.workoutId)!.stage,
        }));
        const checkinHistory = performed.map(item => normalFollowUp(addDaysToLocalDateString(item.date, 1)))
            .filter(record => record.date <= date);
        const cadenceInput = { asOfDate: date, planningHorizonDays: 7, preference, exposures: performed, observedWindowDays: 28 };
        const verdict = evaluateMechanicalStageProgression({
            asOfDate: date, exposureHistory, checkinHistory,
            targetStage: capabilityProgressionTargetStage(evaluateCapabilityCadence(cadenceInput)),
        });
        stages.push(verdict.stage);
        const result = evaluateCapabilityMaintenance({
            ...cadenceInput,
            mode: 'evergreen', mechanicalSuspension: null, mechanicalRequirementPresent: true, mechanicalVerdict: verdict,
            gates: { guardrailBlocked: new Set(), unavailable: new Set(), avoided: new Set(), environmentUnavailable: new Set(), deprioritized: new Set() },
            supportCapacityDates: Array.from({ length: 7 }, (_, offset) => addDaysToLocalDateString(date, offset)),
        });
        const active = activeCapabilityPlacements(result.placements, date, []);
        if (active.length === 0) continue;
        // One session: the identity shared by most owed placements, highest stage on ties.
        const ids = [...new Set(active.flatMap(placement => placement.workoutIds))];
        const score = (id: string) => active.filter(placement => placement.workoutIds.includes(id)).length * 10
            + (mechanicalIdentityFor(id)?.stage ?? 0);
        const chosen = ids.sort((left, right) => score(right) - score(left))[0];
        performed.push({ date, workoutId: chosen });
    }
    return { performed: performed.slice(seed.length), seed, stages };
}

describe('capability maintenance x #804 progression over eight weeks (#805)', () => {
    it('recurs every enabled capability within the 14-day gap and holds Stage 4', () => {
        const { performed, seed, stages } = runCycles(ALL);
        const all = [...seed, ...performed];
        for (const capability of ALL.capabilities) {
            const touches = all.filter(item => athleticCapabilitiesCreditedBy({ workoutId: item.workoutId })
                .includes(capability as AthleticCapabilityKey)).map(item => item.date);
            const inRun = touches.filter(date => date >= START);
            expect(inRun.length, capability).toBeGreaterThanOrEqual(3);
            for (let index = 1; index < touches.length; index++) {
                if (touches[index - 1] < START) continue;
                // Never more than 14 days apart once the run starts, and never closer than the
                // interval would require (no weekly checkbox).
                expect(getDayDiff(touches[index], touches[index - 1]), `${capability} ${touches[index]}`).toBeLessThanOrEqual(14);
            }
        }
        // After the first controlled field session the athlete is never demoted below Stage 3.
        const firstField = performed.findIndex(item => item.workoutId === 'field_controlled_maintenance_01');
        expect(firstField).toBeGreaterThanOrEqual(0);
        expect(Math.min(...stages.slice(getDayDiff(performed[firstField].date, START)))).toBeGreaterThanOrEqual(3);
    });

    it('is low-frequency: about two capability sessions per fortnight, never on consecutive days', () => {
        const { performed } = runCycles(ALL);
        expect(performed.length).toBeLessThanOrEqual(WEEKS * 2);
        for (let index = 1; index < performed.length; index++) {
            expect(getDayDiff(performed[index].date, performed[index - 1].date)).toBeGreaterThanOrEqual(2);
        }
    });

    it('with only sport skill enabled, controlled field work recurs roughly fortnightly and nothing else is consented', () => {
        const { performed } = runCycles({ enabled: true, capabilities: ['sport_skill'] });
        const field = performed.filter(item => item.workoutId === 'field_controlled_maintenance_01');
        expect(field.length).toBeGreaterThanOrEqual(3);
        for (let index = 1; index < field.length; index++) {
            const gap = getDayDiff(field[index].date, field[index - 1].date);
            expect(gap).toBeGreaterThanOrEqual(13);
            expect(gap).toBeLessThanOrEqual(14);
        }
    });
});
