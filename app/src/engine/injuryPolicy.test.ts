import { describe, expect, it } from 'vitest';
import { deriveTissueSeverity, migrateLegacyInjuries, resolveEffectiveInjuryConstraints, resolveInjuryPolicy, resolveInjuryRestrictions } from './injuryPolicy';
import type { InjuryConstraint, RegionTissueResponse } from './models';

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

    describe('deriveTissueSeverity', () => {
        it('returns null when every observed signal is normal or absent', () => {
            expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal' })).toBeNull();
        });

        it('takes the worst of the four observation points, not just morningState', () => {
            const response: RegionTissueResponse = {
                region: 'knee', morningState: 'normal', painDuringTraining: 'severe', afterTrainingState: 'mild',
            };
            expect(deriveTissueSeverity(response)).toBe('exclude');
        });

        it('maps mild -> monitor and moderate -> limit', () => {
            expect(deriveTissueSeverity({ region: 'calf', morningState: 'mild' })).toBe('monitor');
            expect(deriveTissueSeverity({ region: 'calf', morningState: 'moderate' })).toBe('limit');
        });
    });

    // Phase 5.4's required precedence tests: InjuryConstraint (hard) -> observed tissue
    // response (may tighten) -> wearable-derived readiness (may tighten). All three
    // pairwise conflicts must hold.
    describe('resolveEffectiveInjuryConstraints (precedence)', () => {
        it('[InjuryConstraint vs tissue response] a normal tissue reading never clears or weakens an active exclude constraint', () => {
            const baseInjuries: InjuryConstraint[] = [{ region: 'knee', severity: 'exclude', reviewBy: '2026-09-01' }];
            const tissueResponses = { knee: { region: 'knee' as const, morningState: 'normal' as const } };

            const effective = resolveEffectiveInjuryConstraints(baseInjuries, tissueResponses, '2026-08-08');
            const knee = effective.find(i => i.region === 'knee');
            expect(knee?.severity).toBe('exclude');

            // And the actual gate still restricts Running, same as with no tissue response at all.
            const restrictions = resolveInjuryRestrictions(effective, '2026-08-08');
            expect(restrictions.restrictedModalities).toContain('Running');
        });

        it('[InjuryConstraint vs tissue response] a severe tissue reading tightens a monitor-only constraint on the same region', () => {
            const baseInjuries: InjuryConstraint[] = [{ region: 'shoulder', severity: 'monitor' }];
            const tissueResponses = { shoulder: { region: 'shoulder' as const, morningState: 'normal' as const, painDuringTraining: 'severe' as const } };

            const effective = resolveEffectiveInjuryConstraints(baseInjuries, tissueResponses, '2026-08-08');
            const shoulder = effective.find(i => i.region === 'shoulder');
            expect(shoulder?.severity).toBe('exclude');

            const restrictions = resolveInjuryRestrictions(effective, '2026-08-08');
            expect(restrictions.restrictedCategories).toContain('Upper-body Strength');
        });

        it('[tissue response vs wearable readiness] a severe tissue reading restricts even when nothing about wearable readiness is consulted', () => {
            // resolveEffectiveInjuryConstraints takes no readiness input at all -- this is
            // a structural guarantee, not just a test outcome: wearable-derived readiness
            // has no parameter through which it could weaken what tissue response set.
            const tissueResponses = { hamstring: { region: 'hamstring' as const, morningState: 'severe' as const } };
            const effective = resolveEffectiveInjuryConstraints(undefined, tissueResponses, '2026-08-08');
            const restrictions = resolveInjuryRestrictions(effective, '2026-08-08');
            expect(restrictions.impliedGuardrails).toContain('avoid_heavy_lower_body');
            expect(restrictions.restrictedCategories.sort()).toEqual(['Lower-body Strength', 'Full-body Strength'].sort());
        });

        it('[InjuryConstraint vs wearable readiness] a persisted exclude constraint restricts independent of any readiness/tissue input at all', () => {
            const baseInjuries: InjuryConstraint[] = [{ region: 'ankle', severity: 'exclude', reviewBy: '2026-09-01' }];
            const effective = resolveEffectiveInjuryConstraints(baseInjuries, undefined, '2026-08-08');
            const restrictions = resolveInjuryRestrictions(effective, '2026-08-08');
            expect(restrictions.restrictedModalities).toContain('Running');
        });

        it('leaves regionless constraints untouched', () => {
            const baseInjuries: InjuryConstraint[] = [{ severity: 'limit', restrictedModalities: ['Running'], note: 'general caution' }];
            const effective = resolveEffectiveInjuryConstraints(baseInjuries, { knee: { region: 'knee', morningState: 'severe' } }, '2026-08-08');
            expect(effective).toContainEqual(baseInjuries[0]);
        });

        it('adds a today-only constraint for a region with no standing InjuryConstraint at all', () => {
            const effective = resolveEffectiveInjuryConstraints([], { elbow: { region: 'elbow', morningState: 'moderate' } }, '2026-08-08');
            const elbow = effective.find(i => i.region === 'elbow');
            expect(elbow?.severity).toBe('limit');
            expect(elbow?.reviewBy).toBe('2026-08-08');
        });

        it('does not resurrect an expired standing constraint, but still surfaces a fresh tissue-derived one for the same region', () => {
            const baseInjuries: InjuryConstraint[] = [{ region: 'knee', severity: 'exclude', reviewBy: '2026-08-01' }];
            const effective = resolveEffectiveInjuryConstraints(baseInjuries, { knee: { region: 'knee', morningState: 'moderate' } }, '2026-08-08');

            // The expired exclude constraint is passed through as-is (still expired) --
            expect(effective.some(i => i.region === 'knee' && i.severity === 'exclude' && i.reviewBy === '2026-08-01')).toBe(true);
            // -- and a fresh, active, today-only 'limit' entry is added alongside it.
            expect(effective.some(i => i.region === 'knee' && i.severity === 'limit' && i.reviewBy === '2026-08-08')).toBe(true);

            const restrictions = resolveInjuryRestrictions(effective, '2026-08-08');
            expect(restrictions.restrictedModalities).toEqual([]); // limit alone doesn't restrict Running
            expect(restrictions.impliedGuardrails).toContain('avoid_high_impact');
        });

        it('is a no-op when no tissue responses are supplied', () => {
            const baseInjuries: InjuryConstraint[] = [{ region: 'hip', severity: 'limit' }];
            expect(resolveEffectiveInjuryConstraints(baseInjuries, undefined, '2026-08-08')).toEqual(baseInjuries);
            expect(resolveEffectiveInjuryConstraints(baseInjuries, {}, '2026-08-08')).toEqual(baseInjuries);
        });

        it('keeps every same-region base constraint, not just the highest-severity one, and tightens each independently', () => {
            // Two standing knee constraints: a general monitor plus an explicit
            // modality-specific limit. A collapse-to-one-per-region regression would silently
            // drop one of these, along with its restrictedModalities.
            const baseInjuries: InjuryConstraint[] = [
                { region: 'knee', severity: 'monitor', note: 'general knee caution' },
                { region: 'knee', severity: 'limit', restrictedModalities: ['Running'], note: 'no running on knee' },
            ];
            const tissueResponses = { knee: { region: 'knee' as const, morningState: 'moderate' as const } };

            const effective = resolveEffectiveInjuryConstraints(baseInjuries, tissueResponses, '2026-08-08');
            const kneeConstraints = effective.filter(i => i.region === 'knee');

            // Both base constraints survive, each tightened by the moderate tissue reading
            // (monitor -> limit; limit stays limit since 'limit' already outranks the
            // derived 'limit') and neither constraint's restrictedModalities is lost.
            expect(kneeConstraints).toHaveLength(2);
            expect(kneeConstraints.find(i => i.note === 'general knee caution')?.severity).toBe('limit');
            const explicitLimit = kneeConstraints.find(i => i.note === 'no running on knee');
            expect(explicitLimit?.severity).toBe('limit');
            expect(explicitLimit?.restrictedModalities).toEqual(['Running']);
        });
    });

    describe('resolveInjuryPolicy lineage trace', () => {
        it('records a tissue-derived region mapping only when today’s response creates or tightens state', () => {
            const resolved = resolveInjuryPolicy(
                [{ region: 'knee', severity: 'monitor' }],
                { knee: { region: 'knee', morningState: 'severe' } },
                '2026-08-08',
            );
            expect(resolved.trace).toEqual({
                tissueSeverityApplied: true,
                regionMappingFamilies: ['lower_limb_impact'],
                clinicalEnvelopeSources: [],
            });
            expect(resolved.restrictions).toEqual(resolveInjuryRestrictions(resolved.effectiveInjuries, '2026-08-08'));
        });

        it('does not claim tissue severity materiality when a standing constraint is already stricter', () => {
            const resolved = resolveInjuryPolicy(
                [{ region: 'shoulder', severity: 'exclude' }],
                { shoulder: { region: 'shoulder', morningState: 'moderate' } },
                '2026-08-08',
            );
            expect(resolved.trace).toEqual({
                tissueSeverityApplied: false,
                regionMappingFamilies: ['upper_limb_loading'],
                clinicalEnvelopeSources: [],
            });
        });

        it('does not attach a region family to monitor-only or expired constraints', () => {
            const monitor = resolveInjuryPolicy([{ region: 'ankle', severity: 'monitor' }], undefined, '2026-08-08');
            const expired = resolveInjuryPolicy([{ region: 'ankle', severity: 'exclude', reviewBy: '2026-08-01' }], undefined, '2026-08-08');
            expect(monitor.trace.regionMappingFamilies).toEqual([]);
            expect(expired.trace.regionMappingFamilies).toEqual([]);
        });
    });
});
