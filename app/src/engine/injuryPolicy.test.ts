import { describe, expect, it } from 'vitest';
import { migrateLegacyInjuries, resolveInjuryRestrictions } from './injuryPolicy';
import type { InjuryConstraint } from './models';

describe('injuryPolicy', () => {
    describe('resolveInjuryRestrictions', () => {
        it('returns empty restrictions when no injuries are provided', () => {
            const result = resolveInjuryRestrictions([], '2026-08-08');
            expect(result.restrictedModalities).toEqual([]);
            expect(result.impliedGuardrails).toEqual([]);
            expect(result.restrictedCategories).toEqual([]);
        });

        it('ignores expired injuries', () => {
            const injuries: InjuryConstraint[] = [
                {
                    region: 'knee',
                    severity: 'exclude',
                    reviewBy: '2026-08-01', // Expired relative to 2026-08-08
                },
            ];
            const result = resolveInjuryRestrictions(injuries, '2026-08-08');
            expect(result.restrictedModalities).toEqual([]);
            expect(result.impliedGuardrails).toEqual([]);
            expect(result.restrictedCategories).toEqual([]);
        });

        it('applies active injury review dates correctly', () => {
            const injuries: InjuryConstraint[] = [
                {
                    region: 'knee',
                    severity: 'exclude',
                    reviewBy: '2026-08-10', // Active
                },
            ];
            const result = resolveInjuryRestrictions(injuries, '2026-08-08');
            expect(result.restrictedModalities).toEqual(['Running']);
            expect(result.impliedGuardrails).toEqual(['avoid_high_impact']);
        });

        it('correctly maps knee, achilles, ankle, calf restrictions', () => {
            const limitKnee = resolveInjuryRestrictions(
                [{ region: 'knee', severity: 'limit' }],
                '2026-08-08'
            );
            expect(limitKnee.impliedGuardrails).toEqual(['avoid_high_impact']);
            expect(limitKnee.restrictedModalities).toEqual([]);

            const excludeAchilles = resolveInjuryRestrictions(
                [{ region: 'achilles', severity: 'exclude' }],
                '2026-08-08'
            );
            expect(excludeAchilles.impliedGuardrails).toEqual(['avoid_high_impact']);
            expect(excludeAchilles.restrictedModalities).toEqual(['Running']);
        });

        it('correctly maps lower-body muscle regions (hamstring, quad, hip, groin)', () => {
            const limitHamstring = resolveInjuryRestrictions(
                [{ region: 'hamstring', severity: 'limit' }],
                '2026-08-08'
            );
            expect(limitHamstring.impliedGuardrails).toEqual(['avoid_heavy_lower_body']);
            expect(limitHamstring.restrictedCategories).toEqual([]);

            const excludeQuad = resolveInjuryRestrictions(
                [{ region: 'quadriceps', severity: 'exclude' }],
                '2026-08-08'
            );
            expect(excludeQuad.impliedGuardrails).toEqual(['avoid_heavy_lower_body']);
            expect(excludeQuad.restrictedCategories.sort()).toEqual(
                ['Lower-body Strength', 'Full-body Strength'].sort()
            );
        });

        it('correctly maps lower_back restrictions', () => {
            const limitBack = resolveInjuryRestrictions(
                [{ region: 'lower_back', severity: 'limit' }],
                '2026-08-08'
            );
            expect(limitBack.impliedGuardrails).toEqual(['avoid_heavy_spinal_loading']);

            const excludeBack = resolveInjuryRestrictions(
                [{ region: 'lower_back', severity: 'exclude' }],
                '2026-08-08'
            );
            expect(excludeBack.impliedGuardrails.sort()).toEqual(
                ['avoid_heavy_spinal_loading', 'avoid_heavy_lower_body'].sort()
            );
        });

        it('correctly maps upper-body regions (shoulder, elbow, wrist)', () => {
            const limitShoulder = resolveInjuryRestrictions(
                [{ region: 'shoulder', severity: 'limit' }],
                '2026-08-08'
            );
            expect(limitShoulder.impliedGuardrails).toEqual(['avoid_overhead_pressing']);

            const excludeElbow = resolveInjuryRestrictions(
                [{ region: 'elbow', severity: 'exclude' }],
                '2026-08-08'
            );
            expect(excludeElbow.impliedGuardrails).toEqual(['avoid_overhead_pressing']);
            expect(excludeElbow.restrictedCategories).toEqual(['Upper-body Strength']);
        });

        it('produces no structural restrictions for monitor severity', () => {
            const monitorAnkle = resolveInjuryRestrictions(
                [{ region: 'ankle', severity: 'monitor' }],
                '2026-08-08'
            );
            expect(monitorAnkle.restrictedModalities).toEqual([]);
            expect(monitorAnkle.impliedGuardrails).toEqual([]);
            expect(monitorAnkle.restrictedCategories).toEqual([]);
        });
    });

    describe('migrateLegacyInjuries', () => {
        it('migrates leg and run legacy tokens to produce running restrictions', () => {
            const legMigrated = migrateLegacyInjuries(['leg']);
            expect(legMigrated).toHaveLength(1);
            expect(legMigrated[0].region).toBe('hamstring');
            expect(legMigrated[0].restrictedModalities).toEqual(['Running']);

            const legResolved = resolveInjuryRestrictions(legMigrated, '2026-08-08');
            expect(legResolved.restrictedModalities).toContain('Running');

            const runMigrated = migrateLegacyInjuries(['run']);
            expect(runMigrated).toHaveLength(1);
            expect(runMigrated[0].region).toBeUndefined();
            expect(runMigrated[0].restrictedModalities).toEqual(['Running']);

            const runResolved = resolveInjuryRestrictions(runMigrated, '2026-08-08');
            expect(runResolved.restrictedModalities).toContain('Running');
        });

        it('migrates knee, achilles, ankle legacy tokens', () => {
            const migrated = migrateLegacyInjuries(['Right Knee pain', 'Achilles strain', 'Sprained ankle']);
            expect(migrated).toHaveLength(3);
            expect(migrated[0].region).toBe('knee');
            expect(migrated[1].region).toBe('achilles');
            expect(migrated[2].region).toBe('ankle');

            const resolved = resolveInjuryRestrictions(migrated, '2026-08-08');
            expect(resolved.impliedGuardrails).toContain('avoid_high_impact');
        });
    });
});
