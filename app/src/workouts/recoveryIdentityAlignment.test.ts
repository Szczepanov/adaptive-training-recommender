import { describe, expect, it } from 'vitest';
import { EVERGREEN_SESSION_COVERAGE, SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from './event-plan';
import { workoutForTemplate } from './prescription';

describe('recovery identity alignment (ADR-0038 RP1)', () => {
    const CANONICAL_RECOVERY_WORKOUT_IDS = [
        'recovery_mobility_tissue_01',
        'recovery_breathwork_01',
        'cycling_recovery_spin_01',
        'rest_complete_01',
    ] as const;

    it('recognizes all four canonical recovery identities in Evergreen baseline', () => {
        const evergreenRecovery = EVERGREEN_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        expect(evergreenRecovery).toBeDefined();
        expect(evergreenRecovery?.workoutIds).toEqual(expect.arrayContaining([...CANONICAL_RECOVERY_WORKOUT_IDS]));
        expect(evergreenRecovery?.workoutIds).toHaveLength(CANONICAL_RECOVERY_WORKOUT_IDS.length);
    });

    it('recognizes September cycling event recovery identities with explicit exception set', () => {
        const eventRecovery = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        expect(eventRecovery).toBeDefined();

        const evergreenRecovery = EVERGREEN_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        expect(evergreenRecovery).toBeDefined();

        // The only difference between evergreen recovery and event recovery is the asserted exception set:
        // breathwork is part of general evergreen recovery but omitted from the frozen cycling event descriptor.
        const missingFromEvent = evergreenRecovery!.workoutIds.filter(id => !eventRecovery!.workoutIds.includes(id));
        expect(missingFromEvent).toEqual(['recovery_breathwork_01']);

        const missingFromEvergreen = eventRecovery!.workoutIds.filter(id => !evergreenRecovery!.workoutIds.includes(id));
        expect(missingFromEvergreen).toEqual([]);
    });

    it('preserves cycling_recovery_spin_01 as recovery-only and never grants aerobic_volume credit', () => {
        const evergreenAerobic = EVERGREEN_SESSION_COVERAGE.find(item => item.key === 'aerobic_volume');
        expect(evergreenAerobic?.workoutIds).not.toContain('cycling_recovery_spin_01');

        const eventAerobic = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.find(item => item.key === 'aerobic_volume');
        expect(eventAerobic?.workoutIds).not.toContain('cycling_recovery_spin_01');
    });

    it('resolves canonical recovery workouts from engine templates', () => {
        expect(workoutForTemplate('rest_01')?.id).toBe('rest_complete_01');
        expect(workoutForTemplate('mob_01')?.id).toBe('recovery_mobility_tissue_01');
        expect(workoutForTemplate('mob_02')?.id).toBe('recovery_breathwork_01');
    });
});
