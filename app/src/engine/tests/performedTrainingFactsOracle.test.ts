import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    deriveExactCoverageCredits,
    deriveFactsFromOccurrence,
    type CoverageCreditFact,
    type FactConfidence,
    type HydratedOccurrenceContext,
    type PerformedExposureFact,
} from '../../derived/training/performedTrainingFacts';
import { ENGINE_PERFORMED_TRAINING_CATALOG } from '../performedTrainingCatalog';
import {
    GARMIN_CYCLING_ACTIVITY_TYPES,
    classifyGarminTier,
    isGarminCyclingActivityType,
} from '../../derived/training/providerEvidence';
import type {
    ActivityOverride,
    ActivityStimulusDomain,
    EvidenceTier,
    Modality,
    NormalizedGarminActivity,
    SessionCategory,
} from '../models';
import {
    TEMPLATE_STIMULUS_FAMILY,
    classifyWorkoutStimulusFamily,
} from '../stimulusRecency';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from '../templates';
import {
    getTemplateIdsForWorkoutId,
    getUniqueTemplateIdForWorkoutId,
} from '../workoutTemplateIndex';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models';
import { getLocalDateString } from '../../utils/localDate';
import { WORKOUTS_BY_ID } from '../../workouts/catalog';
import {
    EVERGREEN_GENERAL_COVERAGE_SET,
    SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
    type CoverageSetDescriptor,
} from '../../workouts/event-plan';
import type { WorkoutVariant } from '../../workouts/models';

/**
 * Frozen pre-#1183 implementation of `deriveFactsFromOccurrence` and its helpers,
 * copied verbatim from `performedTrainingFacts.ts` before catalog
 * port injection. Used to prove parity with `deriveFactsFromOccurrence` called
 * with `ENGINE_PERFORMED_TRAINING_CATALOG`.
 */
function oracleNormalizeModality(raw: string | undefined): Modality | 'Unknown' {
    if (!raw) return 'Unknown';
    const lower = raw.toLowerCase();
    if (lower.includes('strength') || lower.includes('weight') || lower.includes('lift')) return 'Strength';
    if (isGarminCyclingActivityType(lower) || lower.includes('cycl') || lower.includes('bike') || lower.includes('biking')) return 'Cycling';
    if (lower.includes('run')) return 'Running';
    if (lower.includes('swim')) return 'Swimming';
    if (lower.includes('walk')) return 'Walking';
    if (lower.includes('mobility') || lower.includes('yoga')) return 'Mobility';
    if (lower.includes('soccer') || lower.includes('football') || lower.includes('field')) return 'Field';
    if (lower.includes('cross') || lower.includes('row') || lower.includes('ellipt')) return 'Cross Training';
    if (lower === 'rest' || lower === 'none') return 'None';
    return 'Unknown';
}

function oracleNormalizeCategory(category?: string): SessionCategory | undefined {
    if (!category) return undefined;
    const cat = category as SessionCategory;
    const validCategories: SessionCategory[] = [
        'Hard Endurance', 'Moderate Endurance', 'Easy Endurance', 'Race-Specific Endurance',
        'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength',
        'Power Maintenance', 'Field Maintenance', 'Technical Skill', 'Mobility/Recovery', 'Rest',
    ];
    return validCategories.includes(cat) ? cat : undefined;
}

function oracleTemplateIdForWorkoutId(workoutId: string): string | undefined {
    return getUniqueTemplateIdForWorkoutId(workoutId);
}

function oracleCategoryForWorkoutId(workoutId: string): SessionCategory | undefined {
    const templateIds = getTemplateIdsForWorkoutId(workoutId);
    if (templateIds.length === 0) return undefined;
    const categories = new Set(templateIds.map(templateId => ENRICHED_TEMPLATES_BY_ID.get(templateId)?.category));
    return categories.size === 1 ? ENRICHED_TEMPLATES_BY_ID.get(templateIds[0])?.category : undefined;
}

function oracleIsValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month - 1
        && candidate.getUTCDate() === day;
}

function oracleRequirePerformedLocalDate(
    occurrence: PerformedTrainingOccurrence,
    startedAt: string | undefined,
    hydrated: HydratedOccurrenceContext,
): string {
    let localDate: string | undefined;

    if (occurrence.localDate !== undefined) {
        localDate = occurrence.localDate;
    } else if (startedAt) {
        const startedInstant = new Date(startedAt);
        if (Number.isNaN(startedInstant.getTime())) {
            throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has invalid start time: ${startedAt}.`);
        }
        localDate = getLocalDateString(startedInstant);
    } else if (hydrated.provider?.garminActivity?.date !== undefined) {
        localDate = hydrated.provider.garminActivity.date;
    }

    if (!localDate) {
        throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has no performed local date or start time.`);
    }
    if (!oracleIsValidCalendarDate(localDate)) {
        throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has invalid performed local date: ${localDate}.`);
    }
    return localDate;
}

function oracleDeriveFactsFromOccurrence(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    descriptor: CoverageSetDescriptor = EVERGREEN_GENERAL_COVERAGE_SET,
): { exposure: PerformedExposureFact; coverageCredits: CoverageCreditFact[] } {
    const sourceKinds: Array<'structured_execution' | 'provider_activity' | 'legacy_strength'> = [];
    if (hydrated.structured) {
        sourceKinds.push(hydrated.structured.isLegacyStrength ? 'legacy_strength' : 'structured_execution');
    }
    if (hydrated.provider) {
        sourceKinds.push('provider_activity');
    }

    const occurrenceModality = occurrence.modality ? oracleNormalizeModality(occurrence.modality) : undefined;
    const providerModality = hydrated.provider?.modality;
    const providerOverride = hydrated.structured ? undefined : hydrated.provider?.override;
    const modality: Modality | 'Unknown' =
        hydrated.structured?.modality
        ?? providerOverride?.overriddenModality
        ?? (occurrenceModality && occurrenceModality !== 'Unknown' ? occurrenceModality : undefined)
        ?? (providerModality && providerModality !== 'Unknown' ? providerModality : undefined)
        ?? occurrenceModality
        ?? providerModality
        ?? 'Unknown';

    const workoutId = hydrated.structured?.workoutId;
    const explicitTemplate = hydrated.structured?.templateId
        ? ENRICHED_TEMPLATES_BY_ID.get(hydrated.structured?.templateId)
        : undefined;
    const templateId = hydrated.structured?.templateId ?? (workoutId ? oracleTemplateIdForWorkoutId(workoutId) : undefined);
    const category = oracleNormalizeCategory(
        hydrated.structured?.category
        ?? explicitTemplate?.category
        ?? (workoutId ? oracleCategoryForWorkoutId(workoutId) : undefined),
    );

    const startedAt = hydrated.structured?.startedAt ?? occurrence.startedAt ?? hydrated.provider?.startedAt;
    const endedAt = hydrated.structured?.endedAt ?? occurrence.endedAt ?? hydrated.provider?.endedAt;

    const durationMin =
        hydrated.structured?.durationMin
        ?? hydrated.provider?.durationMin
        ?? (startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000)) : undefined);

    let confidence: FactConfidence = 'unknown';
    let evidenceTier: EvidenceTier = 'genericModalityFallback';

    if (hydrated.structured) {
        if (workoutId && workoutId !== 'legacy_strength') {
            confidence = 'exact';
            evidenceTier = 'completedStructuredWorkout';
        } else if (hydrated.structured.isLegacyStrength) {
            confidence = 'high';
            evidenceTier = 'athleteClassification';
        } else {
            confidence = 'high';
            evidenceTier = 'completedStructuredWorkout';
        }
    } else if (providerOverride) {
        confidence = 'high';
        evidenceTier = 'athleteClassification';
    } else if (hydrated.provider?.garminActivity) {
        confidence = 'inferred';
        evidenceTier = classifyGarminTier({
            trainingEffectAerobic: hydrated.provider.garminActivity.trainingEffectAerobic,
            trainingEffectAnaerobic: hydrated.provider.garminActivity.trainingEffectAnaerobic,
            intensityTag: hydrated.provider.garminActivity.intensityTag ?? '',
            activityTrainingLoad: hydrated.provider.garminActivity.activityTrainingLoad,
            modalityKnown: modality !== 'Unknown',
        });
    }

    let structuredDomain: ActivityStimulusDomain | undefined;
    if (hydrated.structured) {
        const family = (workoutId ? classifyWorkoutStimulusFamily(workoutId) : undefined)
            ?? (templateId ? TEMPLATE_STIMULUS_FAMILY[templateId] : undefined);
        if (family && family !== 'recovery') {
            structuredDomain = family;
        } else if (family === 'recovery') {
            structuredDomain = 'recovery';
        }
    }

    const localDate = oracleRequirePerformedLocalDate(occurrence, startedAt, hydrated);
    const hasOverride = hydrated.provider?.override !== undefined;
    const providerSemantics = (hydrated.structured || hasOverride || hydrated.provider?.overridesUnavailable)
        ? undefined
        : hydrated.provider?.garminActivity;
    const resolvedStimulusDomain = structuredDomain ?? providerSemantics?.stimulusDomain;

    const exposure: PerformedExposureFact = {
        performedOccurrenceId: occurrence.performedOccurrenceId,
        localDate,
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
        ...(durationMin !== undefined ? { durationMin } : {}),
        modality,
        ...(category ? { category } : {}),
        confidence,
        sourceKinds,
        evidenceTier,
        ...(resolvedStimulusDomain !== undefined ? { stimulusDomain: resolvedStimulusDomain } : {}),
        ...(providerSemantics?.sessionCost !== undefined ? { sessionCost: providerSemantics.sessionCost } : {}),
        ...(providerSemantics?.intensityEvidence !== undefined ? { intensityEvidence: providerSemantics.intensityEvidence } : {}),
        ...(providerSemantics?.intensityClassificationVersion !== undefined
            ? { intensityClassificationVersion: providerSemantics.intensityClassificationVersion }
            : {}),
        ...(workoutId ? { workoutId } : {}),
        ...(templateId ? { templateId } : {}),
        ...(hydrated.structured?.workoutVariantId ? { workoutVariantId: hydrated.structured.workoutVariantId } : {}),
        ...(hydrated.structured?.isReadinessModifiedDose ? { isReadinessModifiedDose: true } : {}),
    };

    const coverageCredits: CoverageCreditFact[] = [];
    if (workoutId && workoutId !== 'legacy_strength') {
        coverageCredits.push(...deriveExactCoverageCredits(exposure, descriptor));
    } else if (modality === 'Strength') {
        // Generic strength occurred without proven exact catalog role (D1, D5).
        coverageCredits.push({
            performedOccurrenceId: occurrence.performedOccurrenceId,
            coverageSetId: descriptor.id,
            coverageKey: 'primary_strength',
            creditKind: 'none',
            confidence: 0,
            reasonCode: 'generic_modality_only',
            sourceKinds,
        });
    }

    return { exposure, coverageCredits };
}

function makeBaseOccurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-oracle-1',
        userId: 'user-oracle',
        status: 'active',
        localDate: '2026-09-10',
        startedAt: '2026-09-10T09:00:00Z',
        endedAt: '2026-09-10T10:00:00Z',
        modality: 'Strength',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-oracle-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-10T10:05:00Z',
        updatedAt: '2026-09-10T10:05:00Z',
        ...overrides,
    };
}

function assertOracleParity(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    descriptor?: CoverageSetDescriptor,
): void {
    const actual =
        descriptor === undefined
            ? deriveFactsFromOccurrence(occurrence, hydrated, ENGINE_PERFORMED_TRAINING_CATALOG)
            : deriveFactsFromOccurrence(occurrence, hydrated, ENGINE_PERFORMED_TRAINING_CATALOG, descriptor);
    const expected =
        descriptor === undefined
            ? oracleDeriveFactsFromOccurrence(occurrence, hydrated)
            : oracleDeriveFactsFromOccurrence(occurrence, hydrated, descriptor);
    expect(actual).toEqual(expected);
}

describe('performedTrainingFacts frozen-oracle parity (#1183)', () => {
    it('matches oracle across every WORKOUTS_BY_ID id, legacy_strength, and unknown id (with and without explicit templateId)', () => {
        const workoutIds: Array<string | undefined> = [
            ...WORKOUTS_BY_ID.keys(),
            'legacy_strength',
            'unknown_workout_id_99',
            undefined,
        ];
        const sampleTemplates: Array<string | undefined> = [
            undefined,
            ...ENRICHED_TEMPLATES.map(t => t.id),
            'unknown_template_99',
        ];

        for (const workoutId of workoutIds) {
            for (const templateId of [undefined, 'str_full_01', 'end_mod_02']) {
                const occ = makeBaseOccurrence({
                    performedOccurrenceId: `occ-${workoutId ?? 'none'}-${templateId ?? 'none'}`,
                });
                const hydrated: HydratedOccurrenceContext = {
                    structured: {
                        executionId: 'exec-1',
                        workoutId,
                        templateId,
                        modality: 'Strength',
                        durationMin: 45,
                        workoutVariantId: 'full',
                    },
                };
                assertOracleParity(occ, hydrated);
            }
        }

        for (const templateId of sampleTemplates) {
            for (const workoutId of [undefined, 'strength_full_body_maintenance_01', 'unknown_workout_id_99']) {
                const occ = makeBaseOccurrence({
                    performedOccurrenceId: `occ-tpl-${templateId ?? 'none'}-${workoutId ?? 'none'}`,
                });
                const hydrated: HydratedOccurrenceContext = {
                    structured: {
                        executionId: 'exec-1',
                        workoutId,
                        templateId,
                        modality: 'Cycling',
                        durationMin: 50,
                        workoutVariantId: 'full',
                    },
                };
                assertOracleParity(occ, hydrated);
            }
        }
    });

    it('matches oracle across isLegacyStrength, workoutVariantId, and isReadinessModifiedDose combinations', () => {
        const variants: Array<WorkoutVariant['id'] | undefined> = [
            'full',
            'reduced',
            'return_to_training',
            undefined,
        ];
        const workoutIds = [
            'strength_full_body_maintenance_01',
            'strength_compact_power_01',
            'running_walk_run_01',
            'running_easy_continuous_01',
            'legacy_strength',
            undefined,
        ];

        for (const workoutId of workoutIds) {
            for (const isLegacyStrength of [false, true, undefined]) {
                for (const workoutVariantId of variants) {
                    for (const isReadinessModifiedDose of [false, true, undefined]) {
                        const occ = makeBaseOccurrence({
                            sourceRefs: [
                                { kind: 'structured_execution', executionId: 'exec-1' },
                                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                            ],
                        });
                        const hydrated: HydratedOccurrenceContext = {
                            structured: {
                                executionId: 'exec-1',
                                workoutId,
                                isLegacyStrength,
                                workoutVariantId,
                                isReadinessModifiedDose,
                                modality: 'Strength',
                                durationMin: 40,
                            },
                            provider: {
                                activityId: 'act-1',
                                provider: 'garmin',
                                modality: 'Strength',
                                durationMin: 55,
                            },
                        };
                        assertOracleParity(occ, hydrated, EVERGREEN_GENERAL_COVERAGE_SET);
                    }
                }
            }
        }
    });

    it('matches oracle across provider-only rows varying Training Effect, training load, and intensity tag', () => {
        const teValues: Array<number | null> = [null, 0, 1.5, 3.2];
        const loadValues: Array<number | null> = [null, 0, 42];
        const intensityTags: Array<NormalizedGarminActivity['intensityTag']> = [
            '',
            'recovery',
            'easy',
            'moderate',
            'hard',
        ];
        const stimulusDomains: Array<NormalizedGarminActivity['stimulusDomain']> = [
            undefined,
            'endurance',
            'tempo',
            'threshold',
            'strength',
        ];

        for (const te of teValues) {
            for (const load of loadValues) {
                for (const tag of intensityTags) {
                    for (const stimulusDomain of stimulusDomains) {
                        const occ = makeBaseOccurrence({
                            modality: 'Cycling',
                            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-prov' }],
                        });
                        const garminActivity: NormalizedGarminActivity = {
                            activityId: 'act-prov',
                            date: '2026-09-10',
                            type: 'cycling',
                            durationMin: 60,
                            averageHr: 135,
                            trainingEffectAerobic: te,
                            trainingEffectAnaerobic: 0,
                            activityTrainingLoad: load,
                            intensityTag: tag,
                            ...(stimulusDomain ? { stimulusDomain, intensityClassificationVersion: 2 as const } : {}),
                        };
                        const hydrated: HydratedOccurrenceContext = {
                            provider: {
                                activityId: 'act-prov',
                                provider: 'garmin',
                                modality: 'Cycling',
                                durationMin: 60,
                                garminActivity,
                            },
                        };
                        assertOracleParity(occ, hydrated);
                    }
                }
            }
        }
    });

    it('matches oracle across every Garmin cycling type plus near-misses (case, whitespace, bike, cycl)', () => {
        const modalityStrings: Array<string | undefined> = [
            ...GARMIN_CYCLING_ACTIVITY_TYPES,
            'CYCLING',
            'Road_Biking',
            ' cycling ',
            'bike',
            'ebike',
            'cycl',
            'unicycle',
            'strength_training',
            'weight_training',
            'running',
            'trail_running',
            'swimming',
            'yoga',
            'mobility',
            'rest',
            'unknown_sport',
            '',
            undefined,
        ];
        const provModalities: Array<Modality | 'Unknown' | undefined> = [
            'Cycling',
            'Strength',
            'Running',
            'Unknown',
            undefined,
        ];

        for (const occModality of modalityStrings) {
            for (const provModality of provModalities) {
                const occ = makeBaseOccurrence({
                    modality: occModality ?? '',
                    sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-mod' }],
                });
                const hydrated: HydratedOccurrenceContext = {
                    provider: {
                        activityId: 'act-mod',
                        provider: 'garmin',
                        modality: provModality,
                        durationMin: 45,
                    },
                };
                assertOracleParity(occ, hydrated);
            }
        }
    });

    it('matches oracle across override present, absent, and overridesUnavailable', () => {
        const sampleOverride: ActivityOverride = {
            activityId: 'act-ovr',
            userId: 'user-oracle',
            date: '2026-09-10',
            originalType: 'cycling',
            originalIntensityTag: 'tempo',
            overriddenModality: 'Running',
            overriddenIntensity: 'easy',
            notes: 'Reclassified',
            createdAt: '2026-09-10T12:00:00Z',
            updatedAt: '2026-09-10T12:00:00Z',
        };

        for (const hasStructured of [false, true]) {
            for (const override of [undefined, sampleOverride]) {
                for (const overridesUnavailable of [undefined, false, true]) {
                    const occ = makeBaseOccurrence({
                        modality: 'Cycling',
                        sourceRefs: [
                            ...(hasStructured
                                ? [{ kind: 'structured_execution' as const, executionId: 'exec-ovr' }]
                                : []),
                            { kind: 'provider_activity' as const, provider: 'garmin', activityId: 'act-ovr' },
                        ],
                    });
                    const hydrated: HydratedOccurrenceContext = {
                        ...(hasStructured
                            ? {
                                structured: {
                                    executionId: 'exec-ovr',
                                    workoutId: 'cycling_tempo_surges_01',
                                    modality: 'Cycling',
                                    durationMin: 50,
                                },
                            }
                            : {}),
                        provider: {
                            activityId: 'act-ovr',
                            provider: 'garmin',
                            modality: 'Cycling',
                            durationMin: 60,
                            garminActivity: {
                                activityId: 'act-ovr',
                                date: '2026-09-10',
                                type: 'cycling',
                                durationMin: 60,
                                averageHr: 142,
                                trainingEffectAerobic: 3.1,
                                trainingEffectAnaerobic: 0.4,
                                activityTrainingLoad: 78,
                                intensityTag: 'moderate',
                                stimulusDomain: 'tempo',
                                sessionCost: 'moderate',
                                intensityEvidence: 'primary_benefit',
                                intensityClassificationVersion: 2,
                            },
                            override,
                            overridesUnavailable,
                        },
                    };
                    assertOracleParity(occ, hydrated);
                }
            }
        }
    });

    it('matches oracle across power_exposure, mechanical_exposure, evergreen, and september descriptors', () => {
        const descriptors: CoverageSetDescriptor[] = [
            EVERGREEN_GENERAL_COVERAGE_SET,
            SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
        ];
        const variants: Array<WorkoutVariant['id'] | undefined> = ['full', 'reduced', 'return_to_training', undefined];

        for (const descriptor of descriptors) {
            for (const workoutId of WORKOUTS_BY_ID.keys()) {
                for (const workoutVariantId of variants) {
                    for (const isReadinessModifiedDose of [false, true]) {
                        const occ = makeBaseOccurrence({
                            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-desc' }],
                        });
                        const hydrated: HydratedOccurrenceContext = {
                            structured: {
                                executionId: 'exec-desc',
                                workoutId,
                                workoutVariantId,
                                isReadinessModifiedDose,
                                modality: 'Strength',
                                durationMin: 45,
                            },
                        };
                        assertOracleParity(occ, hydrated, descriptor);
                    }
                }
            }
        }
    });

    it('throws identical errors for invalid/missing dates and malformed startedAt', () => {
        const invalidCases: Array<{ occ: PerformedTrainingOccurrence; hydrated: HydratedOccurrenceContext }> = [
            {
                occ: makeBaseOccurrence({ localDate: '2026-02-30', startedAt: '2026-09-10T09:00:00Z' }),
                hydrated: {},
            },
            {
                occ: makeBaseOccurrence({ localDate: 'not-a-date', startedAt: undefined }),
                hydrated: {},
            },
            {
                occ: makeBaseOccurrence({ localDate: undefined, startedAt: 'not-a-timestamp' }),
                hydrated: {},
            },
            {
                occ: makeBaseOccurrence({ localDate: undefined, startedAt: undefined }),
                hydrated: {
                    provider: {
                        activityId: 'act-bad',
                        provider: 'garmin',
                        startedAt: 'also-invalid',
                    },
                },
            },
            {
                occ: makeBaseOccurrence({ localDate: undefined, startedAt: undefined }),
                hydrated: {},
            },
        ];

        for (const { occ, hydrated } of invalidCases) {
            let actualErr: unknown;
            let oracleErr: unknown;
            try {
                deriveFactsFromOccurrence(occ, hydrated, ENGINE_PERFORMED_TRAINING_CATALOG);
            } catch (err) {
                actualErr = err;
            }
            try {
                oracleDeriveFactsFromOccurrence(occ, hydrated);
            } catch (err) {
                oracleErr = err;
            }
            expect(actualErr).toBeInstanceOf(Error);
            expect(oracleErr).toBeInstanceOf(Error);
            expect((actualErr as Error).message).toBe((oracleErr as Error).message);
        }
    });

    it('performedTrainingFacts.ts has no direct or transitive imports into app/src/engine/', () => {
        const thisDir = dirname(fileURLToPath(import.meta.url));
        const srcRoot = resolve(thisDir, '../..');
        const engineDir = resolve(srcRoot, 'engine');
        const entryFile = resolve(srcRoot, 'derived/training/performedTrainingFacts.ts');

        const resolveSpec = (fromFile: string, spec: string): string => {
            const base = resolve(dirname(fromFile), spec);
            for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
                try {
                    readFileSync(candidate);
                    return candidate;
                } catch {
                    // try next
                }
            }
            throw new Error(`Unresolved import ${spec} from ${fromFile}`);
        };

        const visited = new Set<string>();
        const queue: string[] = [entryFile];
        const engineImports: Array<{ from: string; to: string }> = [];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const content = readFileSync(current, 'utf8');
            const specs = [
                ...content.matchAll(/(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g),
            ].map(match => match[1]);

            for (const spec of specs) {
                if (!spec.startsWith('.')) continue;
                const target = resolveSpec(current, spec);
                if (target.startsWith(engineDir)) {
                    engineImports.push({ from: current, to: target });
                }
                if (!visited.has(target)) {
                    queue.push(target);
                }
            }
        }

        expect(engineImports).toEqual([]);
    });
});
