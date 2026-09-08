import { describe, expect, it } from 'vitest';
import {
    CANONICAL_RECOVERY_WORKOUT_IDS,
    isQualifyingRecoveryIdentity,
    resolveRecoveryAuthority,
} from '../engine/recoveryPlacement';
import {
    EVERGREEN_RECOVERY_WORKOUT_IDS,
    EVERGREEN_SESSION_COVERAGE,
    SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
} from './event-plan';
import { workoutForTemplate } from './prescription';

describe('recovery identity alignment (ADR-0038 RP0 / RP1)', () => {
    it('keeps product-policy recovery identity owned by the Evergreen descriptor', () => {
        const productAuthority = resolveRecoveryAuthority(null);
        const evergreenRecovery = EVERGREEN_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');

        expect(productAuthority.authority).toBe('product_policy');
        expect(evergreenRecovery).toBeDefined();
        expect(evergreenRecovery?.workoutIds).toEqual([...EVERGREEN_RECOVERY_WORKOUT_IDS]);
        expect([...CANONICAL_RECOVERY_WORKOUT_IDS]).toEqual([...EVERGREEN_RECOVERY_WORKOUT_IDS]);

        for (const workoutId of EVERGREEN_RECOVERY_WORKOUT_IDS) {
            expect(isQualifyingRecoveryIdentity(workoutId, productAuthority)).toBe(true);
        }
    });

    it('documents the frozen September descriptor breathwork exception exactly', () => {
        const eventRecovery = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        const evergreenRecovery = EVERGREEN_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        expect(eventRecovery).toBeDefined();
        expect(evergreenRecovery).toBeDefined();

        const eventOnly = eventRecovery?.workoutIds.filter(id => !evergreenRecovery?.workoutIds.includes(id)) ?? [];
        const evergreenOnly = evergreenRecovery?.workoutIds.filter(id => !eventRecovery?.workoutIds.includes(id)) ?? [];

        expect(eventOnly).toEqual([]);
        expect(evergreenOnly).toEqual(['recovery_breathwork_01']);
    });

    it('recognizes authored recovery identities under September cycling event coverage', () => {
        const eventCoverage = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.find(item => item.key === 'recovery_or_rest');
        expect(eventCoverage).toBeDefined();

        const authoredAuthority = {
            authority: 'authored_coverage' as const,
            coverageSetId: 'september_cycling_event' as const,
            phase: 'build' as const,
            descriptor: {
                id: 'september_cycling_event' as const,
                coverage: SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
                requiredKeys: ['recovery_or_rest' as const],
                phases: ['build' as const],
            },
        };

        expect(isQualifyingRecoveryIdentity('recovery_mobility_tissue_01', authoredAuthority)).toBe(true);
        expect(isQualifyingRecoveryIdentity('cycling_recovery_spin_01', authoredAuthority)).toBe(true);
        expect(isQualifyingRecoveryIdentity('rest_complete_01', authoredAuthority)).toBe(true);

        // Breathwork belongs to baseline product policy but is intentionally absent from
        // the ADR-0016-frozen September cycling descriptor.
        expect(isQualifyingRecoveryIdentity('recovery_breathwork_01', authoredAuthority)).toBe(false);
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

    it('rejects unmapped templates or generic non-recovery categories', () => {
        expect(isQualifyingRecoveryIdentity('end_easy_01')).toBe(false);
        expect(isQualifyingRecoveryIdentity('str_full_01')).toBe(false);
        expect(isQualifyingRecoveryIdentity('unmapped_mobility_template')).toBe(false);
        expect(isQualifyingRecoveryIdentity({ id: 'unknown_session' })).toBe(false);
    });
});
