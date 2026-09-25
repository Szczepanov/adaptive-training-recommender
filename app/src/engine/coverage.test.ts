import { describe, expect, it } from 'vitest';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import {
    buildCoverageState,
    coverageKeysForExposure,
    coverageKeysForTemplate,
    coverageNeedTierForTemplate,
    supportsUnmetPrimaryStrengthAsSymptomCompatibleFallback,
    getUnfulfilledRequiredCoverage,
    getUnfulfilledTargetCoverage,
    type CoverageHistoryEntry,
    type CoverageState,
} from './coverage';
import type { SessionTemplate, UserEvent } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { EVERGREEN_GENERAL_COVERAGE_SET, type EventPlanCoverageKey, type EventPlanPhase } from '../workouts/event-plan';
import { resolveAerobicVolumeFloor, type AerobicVolumeFloor } from './aerobicVolumeFloor';

function templateForCoverage(key: EventPlanCoverageKey, phase: EventPlanPhase): SessionTemplate {
    const template = ENRICHED_TEMPLATES.find(item => coverageKeysForTemplate(item, phase).includes(key));
    if (!template) throw new Error(`No engine template resolves to coverage ${key} in ${phase}`);
    return template;
}

function cyclingEvent(date = '2026-09-13'): UserEvent {
    return {
        id: 'coverage-event',
        title: 'Road cycling event',
        date,
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

describe('Phase 6.2c explicit weekly coverage', () => {
    it('credits a true continuous run, while keeping walk-run distinct, for evergreen aerobic volume', () => {
        expect(coverageKeysForExposure({ workoutId: 'running_easy_continuous_01', durationMin: 40 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'running_walk_run_01', durationMin: 40 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
    });

    it('keeps the Running legacy bridge reachable without weakening the aerobic-volume duration floor', () => {
        const running = ENRICHED_TEMPLATES_BY_ID.get('end_easy_02');
        const cycling = ENRICHED_TEMPLATES_BY_ID.get('end_easy_01');
        if (!running || !cycling) throw new Error('Continuous aerobic engine templates missing');

        expect(running.durationMin).toBe(30);
        expect(running.easierDose).toMatchObject({ durationMin: 30, durationMax: 30 });
        expect(coverageKeysForTemplate(running, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForTemplate(cycling, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: running.id, durationMin: 29 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: running.id, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
    });

    it('adds a first-class Walking bridge without weakening the aerobic-volume duration floor', () => {
        // Walking gap: resolveEvidenceBackedStrategy() already permits 'Walking' as an
        // aerobic substitution modality, but no SessionTemplate/workout previously existed
        // to fulfill it -- a Walking-preferring, no-bike, non-runner athlete had zero
        // reachable candidates for a required evergreen aerobic role. end_walk_01 /
        // walking_brisk_continuous_01 close that gap the same way end_easy_02 closed it for
        // Running: a genuinely purposeful continuous exposure, distinct from generic
        // recovery walking, at or above the shared 30-minute continuous-aerobic floor.
        const walking = ENRICHED_TEMPLATES_BY_ID.get('end_walk_01');
        if (!walking) throw new Error('Continuous walking engine template missing');

        expect(walking.modality).toBe('Walking');
        expect(walking.durationMin).toBeGreaterThanOrEqual(30);
        expect(coverageKeysForTemplate(walking, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: walking.id, durationMin: 29 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: walking.id, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
    });

    it('keeps symptom-compatible low-load strength outside exact primary-strength credit', () => {
        const fallback = ENRICHED_TEMPLATES_BY_ID.get('str_low_load_maint_01');
        if (!fallback) throw new Error('Symptom-compatible low-load strength template missing');
        const state: CoverageState = {
            asOfDate: '2026-09-24',
            phase: 'general',
            activeBlockId: 'block_general',
            coverageSetId: 'evergreen_general',
            descriptor: EVERGREEN_GENERAL_COVERAGE_SET,
            requirements: [{
                id: 'coverage_block_general_primary_strength_0',
                key: 'primary_strength',
                label: 'Primary full-body strength',
                requirement: 'required',
                minimumSessions: 1,
                targetSessions: 1,
                completedSessions: 0,
                projectedSessions: 0,
                priority: 'must_have',
                rollingWindowDays: 7,
                windowStart: '2026-09-17',
                windowEnd: '2026-09-30',
                credits: [],
            }],
        };

        expect(coverageKeysForTemplate(fallback, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('primary_strength');
        expect(supportsUnmetPrimaryStrengthAsSymptomCompatibleFallback(
            state,
            fallback,
            ['avoid_heavy_spinal_loading'],
        )).toBe(true);
        expect(supportsUnmetPrimaryStrengthAsSymptomCompatibleFallback(state, fallback, [])).toBe(false);

        state.requirements[0].completedSessions = 1;
        expect(supportsUnmetPrimaryStrengthAsSymptomCompatibleFallback(
            state,
            fallback,
            ['avoid_heavy_spinal_loading'],
        )).toBe(false);
    });

    it('maps exact authored workout identity, never overlapping stimulus', () => {
        expect(coverageKeysForExposure({ workoutId: 'cycling_zone2_standard_01', durationMin: 60 }, 'peak')).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'cycling_zone2_standard_01', durationMin: 20 }, 'peak')).not.toContain('aerobic_volume');
        const recoverySpin = coverageKeysForExposure({ workoutId: 'cycling_recovery_spin_01', durationMin: 60 }, 'peak');
        expect(recoverySpin).toContain('recovery_spin');
        expect(recoverySpin).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'cycling_controlled_threshold_4x8_01' }, 'peak')).toContain('sustained_quality');
        const eventSpecific = coverageKeysForExposure({ workoutId: 'cycling_event_specific_endurance_01' }, 'peak');
        expect(eventSpecific).toContain('outdoor_event_specific');
        expect(eventSpecific).toContain('short_surges');
        expect(eventSpecific).not.toContain('aerobic_volume');
        expect(eventSpecific).not.toContain('sustained_quality');
        expect(coverageKeysForExposure({ workoutId: 'unknown-workout' }, 'peak')).toEqual([]);
        expect(coverageKeysForExposure({ modality: 'Cycling', category: 'Race-Specific Endurance' }, 'peak')).toEqual([]);
    });

    it('uses the same coarse-template -> detailed-workout resolution as prescription generation', () => {
        expect(coverageKeysForTemplate(templateForCoverage('aerobic_volume', 'peak'), 'peak')).toContain('aerobic_volume');
        expect(coverageKeysForTemplate(templateForCoverage('sustained_quality', 'peak'), 'peak')).toContain('sustained_quality');
        expect(coverageKeysForTemplate(templateForCoverage('outdoor_event_specific', 'peak'), 'peak')).toContain('outdoor_event_specific');
        expect(coverageKeysForTemplate(templateForCoverage('recovery_or_rest', 'peak'), 'peak')).toContain('recovery_or_rest');
    });

    it('keeps adaptation-compatible race-specific history from substituting for aerobic or sustained roles and times hard roles to anchors', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const asOfDate = '2026-08-20';
        const raceTemplate = templateForCoverage('outdoor_event_specific', 'peak');
        const state = buildCoverageState(planState.data, asOfDate, [{
            date: addDaysToLocalDateString(asOfDate, -1),
            templateId: raceTemplate.id,
        }]);

        const byKey = new Map(state.requirements.map(item => [item.key, item]));
        expect(byKey.get('outdoor_event_specific')?.completedSessions).toBe(1);
        expect(byKey.get('aerobic_volume')?.completedSessions).toBe(0);
        expect(byKey.get('sustained_quality')?.completedSessions).toBe(0);
        expect(byKey.get('recovery_or_rest')?.completedSessions).toBe(0);

        const zone2 = templateForCoverage('aerobic_volume', 'peak');
        const threshold = templateForCoverage('sustained_quality', 'peak');
        const recovery = templateForCoverage('recovery_or_rest', 'peak');
        const technical = ENRICHED_TEMPLATES.find(item => item.modality === 'Cycling' && item.category === 'Technical Skill');
        if (!technical) throw new Error('Cycling Technical Skill template missing');

        expect(coverageNeedTierForTemplate(state, zone2)).toBe(1);
        expect(coverageNeedTierForTemplate(state, threshold)).toBe(2);
        expect(coverageNeedTierForTemplate(state, threshold, 'quality')).toBe(0);
        expect(coverageNeedTierForTemplate(state, recovery)).toBe(2);
        expect(coverageNeedTierForTemplate(state, raceTemplate)).toBeGreaterThanOrEqual(2);
        expect(coverageNeedTierForTemplate(state, technical)).toBe(3);
    });

    it('keeps recovery spins and abbreviated Zone 2 out of the aerobic-volume floor', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const asOfDate = '2026-08-20';
        const history = [
            { date: '2026-08-18', workoutId: 'cycling_recovery_spin_01', durationMin: 45 },
            { date: '2026-08-19', workoutId: 'cycling_zone2_standard_01', durationMin: 20 },
        ];
        const state = buildCoverageState(planState.data, asOfDate, history);
        const aerobicVolume = state.requirements.find(item => item.key === 'aerobic_volume');

        expect(aerobicVolume).toMatchObject({ minimumSessions: 1, targetSessions: 2, completedSessions: 0 });
        expect(getUnfulfilledRequiredCoverage(state).map(item => item.key)).toContain('aerobic_volume');
        expect(getUnfulfilledTargetCoverage(state).map(item => item.key)).toContain('aerobic_volume');

        const completed = buildCoverageState(planState.data, asOfDate, [
            ...history,
            { date: '2026-08-17', workoutId: 'cycling_zone2_standard_01', durationMin: 60 },
        ]);
        expect(completed.requirements.find(item => item.key === 'aerobic_volume')).toMatchObject({ completedSessions: 1, targetSessions: 2 });
        expect(getUnfulfilledRequiredCoverage(completed).map(item => item.key)).not.toContain('aerobic_volume');
        expect(getUnfulfilledTargetCoverage(completed).map(item => item.key)).toContain('aerobic_volume');
    });

    it('expires coverage when an exposure leaves the rolling seven-day window', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const date = '2026-08-20';
        const raceTemplate = templateForCoverage('outdoor_event_specific', 'peak');
        const exposureDate = addDaysToLocalDateString(date, -6);
        const today = buildCoverageState(planState.data, date, [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(today.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(1);
        const tomorrow = buildCoverageState(planState.data, addDaysToLocalDateString(date, 1), [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(tomorrow.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(1);
        const dayAfterTomorrow = buildCoverageState(planState.data, addDaysToLocalDateString(date, 2), [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(dayAfterTomorrow.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(0);
    });

    it('excludes readiness-modified easier doses from exact aerobic_volume coverage while preserving tier-2 fallback support', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const plan = planState.data;
        const walkTemplate = ENRICHED_TEMPLATES.find(item => item.id === 'end_walk_01')!;
        const bikeTemplate = ENRICHED_TEMPLATES.find(item => item.id === 'end_easy_01')!;

        // Even though end_walk_01's easierDose has durationMin=30 (matching walking_brisk_continuous_01's minimumMin=30),
        // a readiness-modified exposure must not earn exact aerobic_volume coverage.
        const stateAfterModifyWalk = buildCoverageState(plan, '2026-09-03', [{
            date: '2026-09-02',
            templateId: 'end_walk_01',
            durationMin: 30,
            isReadinessModifiedDose: true,
        }]);
        const aerobicVolume = stateAfterModifyWalk.requirements.find(item => item.key === 'aerobic_volume')!;
        expect(aerobicVolume.completedSessions).toBe(0);
        expect(coverageNeedTierForTemplate(stateAfterModifyWalk, { ...walkTemplate, durationMin: 30, isReadinessModifiedDose: true })).toBe(3);
        expect(coverageNeedTierForTemplate(stateAfterModifyWalk, { ...bikeTemplate, durationMin: 20, isReadinessModifiedDose: true })).toBe(3);
    });
});

describe('athlete-relative aerobic_volume floor (#757)', () => {
    const ESTABLISHED: AerobicVolumeFloor = { floorMin: 45, source: 'athlete_history', sampleCount: 8, medianMin: 60 };
    const ride = ENRICHED_TEMPLATES_BY_ID.get('end_easy_01')!;
    const walk = ENRICHED_TEMPLATES_BY_ID.get('end_walk_01')!;

    function unmetAerobicState(aerobicVolumeFloor: AerobicVolumeFloor | null): CoverageState {
        return {
            asOfDate: '2026-09-24',
            phase: 'general',
            activeBlockId: 'block_general',
            coverageSetId: 'evergreen_general',
            descriptor: EVERGREEN_GENERAL_COVERAGE_SET,
            aerobicVolumeFloor,
            requirements: [{
                id: 'coverage_block_general_aerobic_volume_0',
                key: 'aerobic_volume',
                label: 'Continuous aerobic volume',
                requirement: 'required',
                minimumSessions: 1,
                targetSessions: 2,
                completedSessions: 0,
                projectedSessions: 0,
                priority: 'must_have',
                rollingWindowDays: 7,
                windowStart: '2026-09-17',
                windowEnd: '2026-09-30',
                credits: [],
            }],
        };
    }

    it('denies a 30-min ride or walk exact credit for an established 60-min athlete, and credits 45 min', () => {
        for (const workoutId of ['cycling_zone2_standard_01', 'walking_brisk_continuous_01']) {
            expect(coverageKeysForExposure({ workoutId, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET, ESTABLISHED)).not.toContain('aerobic_volume');
            expect(coverageKeysForExposure({ workoutId, durationMin: 45 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET, ESTABLISHED)).toContain('aerobic_volume');
        }
    });

    it('keeps catalog-minimum behaviour for a new user with no history', () => {
        const newUser = resolveAerobicVolumeFloor([], '2026-09-24');
        for (const workoutId of ['cycling_zone2_standard_01', 'walking_brisk_continuous_01']) {
            expect(coverageKeysForExposure({ workoutId, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET, newUser)).toContain('aerobic_volume');
            expect(coverageKeysForExposure({ workoutId, durationMin: 29 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET, newUser)).not.toContain('aerobic_volume');
        }
    });

    it('applies the floor to completed history in the weekly ledger', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const history = [
            { date: '2026-09-01', workoutId: 'cycling_zone2_standard_01', durationMin: 35 },
            { date: '2026-09-02', workoutId: 'cycling_zone2_standard_01', durationMin: 50 },
        ];
        const aerobic = (floor: AerobicVolumeFloor | null) => buildCoverageState(planState.data, '2026-09-03', history, undefined, floor)
            .requirements.find(item => item.key === 'aerobic_volume')!;
        expect(aerobic(null).completedSessions).toBe(2);
        expect(aerobic(ESTABLISHED).completedSessions).toBe(1);
    });

    it('credits an uncapped planned ride or base run whose prescribed range reaches the floor (#768, #798)', () => {
        const catalogState = unmetAerobicState(null);
        const establishedState = unmetAerobicState(ESTABLISHED);
        const run = ENRICHED_TEMPLATES_BY_ID.get('end_easy_02')!;
        // end_easy_01 and end_easy_02 are authored 30-60 min: on an uncapped day their prescriptions reach 45.
        for (const candidate of [ride, run]) {
            expect(candidate.durationMin).toBe(30);
            expect(candidate.durationMax).toBeGreaterThanOrEqual(45);
            expect(coverageNeedTierForTemplate(establishedState, candidate)).toBe(coverageNeedTierForTemplate(catalogState, candidate));
            expect(coverageKeysForTemplate(candidate, 'general', EVERGREEN_GENERAL_COVERAGE_SET, ESTABLISHED)).toContain('aerobic_volume');
        }
        // Even if the athlete floor reaches the workout harderDose catalog maximum (70), a planned
        // standard template is clamped to its own uncapped durationMax (60) unless time-capped below 60.
        const highFloor: AerobicVolumeFloor = { floorMin: 70, source: 'athlete_history', sampleCount: 8, medianMin: 95 };
        expect(coverageKeysForTemplate(run, 'general', EVERGREEN_GENERAL_COVERAGE_SET, highFloor)).toContain('aerobic_volume');
        expect(coverageKeysForTemplate({ ...run, durationMax: 45 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET, highFloor)).not.toContain('aerobic_volume');
    });

    it('credits projected picks by prescribed range (with standard-template ceiling) but completed sessions by actual duration', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const aerobic = (entry: { durationMin: number; durationMax?: number; source?: 'projected' }) => buildCoverageState(
            planState.data, '2026-09-03', [{ date: '2026-09-02', workoutId: 'cycling_zone2_standard_01', ...entry }], undefined, ESTABLISHED,
        ).requirements.find(item => item.key === 'aerobic_volume')!;
        expect(aerobic({ durationMin: 30, durationMax: 60, source: 'projected' }).projectedSessions).toBe(1);
        expect(aerobic({ durationMin: 30, durationMax: 35, source: 'projected' }).projectedSessions).toBe(0);
        expect(aerobic({ durationMin: 30 }).completedSessions).toBe(0);
        // The catalog minimum still applies to the lower bound, exactly as before #757.
        expect(aerobic({ durationMin: 20, durationMax: 60, source: 'projected' }).projectedSessions).toBe(0);

        // At a 70-minute athlete floor, projected end_easy_02 (30-60 min) applies the standard
        // template ceiling (60) in both legacy and canonical coverage-state paths, while a
        // completed 60-minute exposure remains governed by its actual duration.
        const highFloor: AerobicVolumeFloor = { floorMin: 70, source: 'athlete_history', sampleCount: 8, medianMin: 95 };
        const evergreenPlan = {
            ...planState.data,
            coverageSetId: EVERGREEN_GENERAL_COVERAGE_SET.id,
            blocks: planState.data.blocks.map(block => ({ ...block, phase: 'general' as const })),
        };
        const runAerobic = (entry: CoverageHistoryEntry) => buildCoverageState(
            evergreenPlan, '2026-09-03', [entry], EVERGREEN_GENERAL_COVERAGE_SET, highFloor,
        ).requirements.find(item => item.key === 'aerobic_volume')!;

        expect(runAerobic({
            date: '2026-09-02',
            templateId: 'end_easy_02',
            workoutId: 'running_easy_continuous_01',
            durationMin: 30,
            durationMax: 60,
            source: 'projected',
        }).projectedSessions).toBe(1);
        expect(runAerobic({
            date: '2026-09-02',
            templateId: 'end_easy_02',
            workoutId: 'running_easy_continuous_01',
            durationMin: 30,
            durationMax: 60,
            source: 'projected',
            canonicalCoverageCredits: [{
                coverageSetId: EVERGREEN_GENERAL_COVERAGE_SET.id,
                coverageKey: 'aerobic_volume',
                creditKind: 'exact',
            }],
        }).projectedSessions).toBe(1);
        expect(runAerobic({
            date: '2026-09-02',
            templateId: 'end_easy_02',
            workoutId: 'running_easy_continuous_01',
            durationMin: 60,
            source: 'completed',
        }).completedSessions).toBe(0);
        expect(runAerobic({
            date: '2026-09-02',
            templateId: 'end_easy_02',
            workoutId: 'running_easy_continuous_01',
            durationMin: 70,
            source: 'completed',
        }).completedSessions).toBe(1);
    });

    it('gives neither a capped ride nor a walk the aerobic coverage tier when the cap keeps both below the floor', () => {
        const catalogState = unmetAerobicState(null);
        const establishedState = unmetAerobicState(ESTABLISHED);
        const cappedRide = { ...ride, durationMin: 30, durationMax: 35 };
        const cappedWalk = { ...walk, durationMin: 30, durationMax: 35 };

        // Catalog minimum: both earn the unmet-must-have tier, so the pre-#757 tie holds.
        expect(coverageNeedTierForTemplate(catalogState, cappedRide)).toBe(coverageNeedTierForTemplate(catalogState, cappedWalk));
        // Athlete floor 45: neither can claim the role, so neither wins on coverage tier and
        // the ride is not displaced by a modality flip; the shortfall is reported by the packer.
        const rideTier = coverageNeedTierForTemplate(establishedState, cappedRide);
        expect(rideTier).toBe(coverageNeedTierForTemplate(establishedState, cappedWalk));
        expect(rideTier).toBeGreaterThan(coverageNeedTierForTemplate(catalogState, cappedRide));
        expect(coverageNeedTierForTemplate(establishedState, { ...ride, durationMin: 45 })).toBe(coverageNeedTierForTemplate(catalogState, cappedRide));
    });
});
