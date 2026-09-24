import { describe, expect, it } from 'vitest';
import { buildOptimizationContext, calculateStimulusBenefit, evaluateRecoveryConstraints, rankCandidates, rankCandidatesByUtility, resolveCapTruncatedPrescription, resolveTimeCapDoseAdjustment, type RecentHistoryEntry } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveHealthPlanningPolicy } from './healthPlanningPolicy';
import type { FatigueState, SessionHistoryEntry, SessionTemplate, UserContext, UserPreferences, WeeklyObjective } from './models';
import type { ResolvedAvailability } from './schedule';
import type { CoverageState } from './coverage';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-01',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const DEFAULT_AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-01',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: 'user_default',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

const ZERO_CANONICAL_STIMULUS = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    sprintPower: 0,
    fatigueResistance: 0,
    maxStrength: 0,
    hypertrophy: 0,
};

describe('resolveTimeCapDoseAdjustment — Easy Endurance cap truncation (#744)', () => {
    const template = (id: string) => ENRICHED_TEMPLATES.find(item => item.id === id)!;

    it('shortens a train-tier Zone 2 prescription within its authored range', () => {
        const result = resolveTimeCapDoseAdjustment(template('end_easy_01'), 35, false);
        expect(result?.activeDose).toMatchObject({ durationMin: 30, durationMax: 35 });
        expect(result?.activeDose.doseRatio).toBeCloseTo(32.5 / 45);
        expect(result?.adjustment).toMatchObject({ direction: 'easier', tier: 1, originalTemplateId: 'end_easy_01' });
        expect(result?.adjustment.rationale).toContain('time cap');
        expect(result?.adjustment.rationale).toContain('shortened within its authored range');
    });

    it('keeps the authored readiness dose on modify-tier days', () => {
        expect(resolveTimeCapDoseAdjustment(template('end_easy_01'), 35, true)?.activeDose)
            .toEqual(template('end_easy_01').easierDose);
    });

    it('falls back to the authored easier dose below the prescription minimum', () => {
        const authored = template('end_easy_01');
        const capSafeTemplate = {
            ...authored,
            easierDose: { ...authored.easierDose!, durationMax: 25, doseRatio: 0.5 },
        };
        expect(resolveTimeCapDoseAdjustment(capSafeTemplate, 25, false)?.activeDose)
            .toEqual(capSafeTemplate.easierDose);
    });

    it.each([
        ['end_walk_01', 35], ['end_mod_02', 45], ['str_full_02', 35],
    ] as const)(
        'preserves the existing easier dose for %s', (id, cap) => {
            expect(resolveCapTruncatedPrescription(template(id), cap)).toBeNull();
            expect(resolveTimeCapDoseAdjustment(template(id), cap, false)?.activeDose)
                .toEqual(template(id).easierDose);
        },
    );

    it('does not truncate an out-of-scope moderate ride at a 35-minute cap', () => {
        expect(resolveCapTruncatedPrescription(template('end_mod_02'), 35)).toBeNull();
        expect(resolveTimeCapDoseAdjustment(template('end_mod_02'), 35, false)).toBeNull();
    });

    it('keeps every eligible Easy Endurance truncated ratio at least as high as its easier dose', () => {
        let checked = 0;
        for (const item of ENRICHED_TEMPLATES.filter(candidate => candidate.category === 'Easy Endurance')) {
            for (let cap = item.durationMin; cap < item.durationMax; cap++) {
                const dose = resolveCapTruncatedPrescription(item, cap);
                if (!item.easierDose || item.easierDose.durationMin >= item.durationMin) {
                    expect(dose).toBeNull();
                    continue;
                }
                expect(dose).not.toBeNull();
                checked += 1;
                expect(dose!.durationMin).toBe(item.durationMin);
                expect(dose!.durationMax).toBeLessThanOrEqual(cap);
                expect(dose!.doseRatio).toBeGreaterThanOrEqual(item.easierDose.doseRatio);
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('gives a capped cycling and walking session the same unmet aerobic coverage tier', () => {
        const coverageState: CoverageState = {
            asOfDate: '2026-03-05', phase: 'general', activeBlockId: 'block_general',
            coverageSetId: 'evergreen_general', descriptor: EVERGREEN_GENERAL_COVERAGE_SET,
            requirements: [{
                id: 'coverage_aerobic', key: 'aerobic_volume', label: 'Aerobic volume',
                requirement: 'required', minimumSessions: 1, targetSessions: 2,
                completedSessions: 0, projectedSessions: 0, priority: 'must_have',
                rollingWindowDays: 7, windowStart: '2026-02-26', windowEnd: '2026-03-11', credits: [],
            }],
        };
        const result = rankCandidates(
            [template('end_easy_01'), template('end_walk_01')], [], DEFAULT_FATIGUE,
            { ...DEFAULT_AVAILABILITY, date: '2026-03-05', maxTimeMinutes: 35 }, [],
            { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling', 'Strength'] },
            { date: '2026-03-05', coverageState },
        );
        expect(result.accepted.find(item => item.template.id === 'end_easy_01')?.coverageNeedTier).toBe(1);
        expect(result.accepted.find(item => item.template.id === 'end_walk_01')?.coverageNeedTier).toBe(1);
    });
});

describe('optimizer — preferred modality and safe strength fallback (#736)', () => {
    const candidate = (id: string) => ENRICHED_TEMPLATES.find(template => template.id === id)!;

    it('excludes Field Maintenance and Sprint Mechanics without explicit field preference', () => {
        const field = candidate('field_maint_01');
        const sprint = candidate('field_technical_01');
        const unrequested = rankCandidates([field, sprint], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], {
            ...DEFAULT_PREFERENCES, preferredModalities: ['Strength'],
        }, { date: '2026-03-05' });
        expect(unrequested.rejected.map(item => item.template.id)).toEqual(expect.arrayContaining([field.id, sprint.id]));
        expect(unrequested.rejected.every(item => item.excludedReasons.includes('EXPLICIT_MODALITY_PREFERENCE_REQUIRED'))).toBe(true);
        const requested = rankCandidates([field, sprint], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], {
            ...DEFAULT_PREFERENCES, preferredModalities: ['Field'],
        }, { date: '2026-03-05' });
        expect(requested.accepted.map(item => item.template.id)).toContain(field.id);
        expect(requested.accepted.map(item => item.template.id)).toContain(sprint.id);

        const unmarkedFutureFieldTemplate = { ...field, id: 'future-field-template', requiresExplicitModalityPreference: undefined };
        const unmarked = rankCandidates([unmarkedFutureFieldTemplate], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], {
            ...DEFAULT_PREFERENCES, preferredModalities: ['Strength'],
        }, { date: '2026-03-05' });
        expect(unmarked.accepted.map(item => item.template.id)).toContain(unmarkedFutureFieldTemplate.id);
    });

    it('prefers an eligible cycling spin over unpreferred walking and running in a short window', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling', 'Strength'] };
        const result = rankCandidates(
            [candidate('end_walk_01'), candidate('end_easy_02'), candidate('end_easy_01')],
            [], DEFAULT_FATIGUE, { ...DEFAULT_AVAILABILITY, maxTimeMinutes: 35 }, [], preferences,
            { date: '2026-03-05' },
        );
        expect(result.accepted[0].template.id).toBe('end_easy_01');
        const walking = result.accepted.find(item => item.template.id === 'end_walk_01')!;
        expect(walking.benefitScore).toBeLessThan(result.accepted[0].benefitScore);
        expect(walking.rationale).toContain(`Benefit score: ${walking.benefitScore.toFixed(2)}`);
    });

    it('demotes unpreferred running for a health athlete while allowing it as a last feasible training fallback', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const running = candidate('end_easy_02');
        const walking = candidate('end_walk_01');
        const both = rankCandidates([running, walking], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences, { date: '2026-03-05' });
        expect(both.accepted[0].template.id).toBe(walking.id);
        const fallback = rankCandidates([running], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences, { date: '2026-03-05' });
        expect(fallback.accepted[0].template.id).toBe(running.id);
    });

    it('honors an explicit current-decision modality within equal coverage and recovery tiers', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling', 'Strength'] };
        const strength = candidate('str_low_load_maint_01');
        const templates = [strength, { ...strength, id: 'equal-benefit-bike', modality: 'Cycling' as const }];
        const select = (preferredModalityToday: string) => rankCandidates(
            templates, [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', preferredModalityToday },
        ).accepted[0].template.modality;
        expect(select('Cycling')).toBe('Cycling');
        expect(select('Strength')).toBe('Strength');
    });

    it('keeps an unresolved strength objective ahead of chronic and current-day modality preference', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling'] };
        const strength = candidate('str_full_03');
        const cycling = candidate('end_easy_01');
        const strengthObjective: WeeklyObjective = {
            id: 'strength-maintenance', key: 'strength_maintenance', title: 'Strength maintenance',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { maxStrength: 0.7, hypertrophy: 0.5 },
        };
        const options = { date: '2026-03-05', preferredModalityToday: 'Cycling' };
        const ranked = rankCandidates([strength, cycling], [strengthObjective], DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY, [], preferences, options);
        const withoutPreferredAlternative = rankCandidates([strength], [strengthObjective], DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY, [], preferences, options);

        expect(ranked.accepted[0].template.id).toBe(strength.id);
        expect(ranked.accepted.find(item => item.template.id === strength.id)?.benefitScore)
            .toBeCloseTo(withoutPreferredAlternative.accepted[0].benefitScore);
    });

    it('ranks spinal-safe strength as degraded support while leaving primary strength open', () => {
        const fallback = candidate('str_low_load_maint_01');
        const cycling = candidate('end_easy_01');
        const coverageState: CoverageState = {
            asOfDate: '2026-03-05',
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
                windowStart: '2026-02-26',
                windowEnd: '2026-03-11',
                credits: [],
            }],
        };
        const strengthObjective: WeeklyObjective = {
            id: 'strength-reentry',
            key: 'strength_development',
            title: 'Strength development',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { maxStrength: 0.6, hypertrophy: 0.4 },
        };
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling', 'Strength'] };
        const guarded = rankCandidates(
            [cycling, fallback],
            [strengthObjective],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            preferences,
            { date: '2026-03-05', coverageState, guardrails: ['avoid_heavy_spinal_loading'] },
        );
        const fallbackRank = guarded.accepted.find(item => item.template.id === fallback.id);
        expect(fallbackRank?.coverageNeedTier).toBe(2);
        expect(fallbackRank?.rationale).toContain('exact primary-strength role remains open');
        expect(guarded.accepted[0].template.id).toBe(fallback.id);

        const unguarded = rankCandidates(
            [cycling, fallback],
            [strengthObjective],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            preferences,
            { date: '2026-03-05', coverageState, guardrails: [] },
        );
        expect(unguarded.accepted.find(item => item.template.id === fallback.id)?.coverageNeedTier).toBe(3);
    });

    it('excludes adjacent-day strength across upper, full-body, and low-load maintenance templates', () => {
        const templates = [candidate('str_upper_01'), candidate('str_full_03'), candidate('str_low_load_maint_01')];
        for (const category of ['Upper-body Strength', 'Full-body Strength']) {
            const result = rankCandidates(
                templates, [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-09', recentHistory: [{ date: '2026-03-08', modality: 'Strength', category: category as SessionTemplate['category'], systemicCost: 0.3, lowerBodyCost: 0.2 }] },
            );
            expect(result.rejected).toHaveLength(templates.length);
            expect(result.rejected.every(item => item.excludedReasons.includes('CONSECUTIVE_STRENGTH_DAYS'))).toBe(true);
        }
    });
});

describe('optimizer — dated, role-aware recovery constraints (F3 / 3.1)', () => {
    it('ranks feasible low-impact health aerobic work ahead of running without explicit running support', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const policy = resolveHealthPlanningPolicy(['health'], preferences, false);
        const walking = ENRICHED_TEMPLATES.find(t => t.id === 'end_walk_01')!;
        const running = ENRICHED_TEMPLATES.find(t => t.id === 'end_easy_02')!;

        const result = rankCandidates(
            [running, walking], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', recentHistory: [], healthPlanningPolicy: policy },
        );

        expect(result.accepted[0].template.id).toBe('end_walk_01');
    });

    it('hard-gates moderate and hard endurance after adverse recovery in same-day ranking', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const policy = resolveHealthPlanningPolicy(['health'], preferences, true);
        const moderate = ENRICHED_TEMPLATES.find(t => t.id === 'end_mod_01')!;
        const hard = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_01')!;

        const result = rankCandidates(
            [moderate, hard], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', recentHistory: [], healthPlanningPolicy: policy },
        );

        expect(result.accepted).toHaveLength(0);
        expect(result.rejected.flatMap(candidate => candidate.excludedReasons)).toEqual(expect.arrayContaining([
            'HEALTH_QUALITY_ENDURANCE_WITHHELD_AFTER_ADVERSE_RECOVERY',
        ]));
    });

    it('hard-gates hard endurance without explicit running support while keeping preferred moderate work eligible', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const policy = resolveHealthPlanningPolicy(['health'], preferences, false);
        const moderateCycling = ENRICHED_TEMPLATES.find(t => t.id === 'end_mod_01')!;
        const hardRunning = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_01')!;
        const hardCycling = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;

        const result = rankCandidates(
            [moderateCycling, hardRunning, hardCycling], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', recentHistory: [], healthPlanningPolicy: policy },
        );

        expect(result.accepted.map(candidate => candidate.template.id)).toContain('end_mod_01');
        expect(result.rejected.find(candidate => candidate.template.id === 'end_hard_01')?.excludedReasons).toContain(
            'HEALTH_HARD_ENDURANCE_WITHHELD_AS_GENERIC_FILLER',
        );
        expect(result.rejected.find(candidate => candidate.template.id === hardCycling.id)?.excludedReasons).toContain(
            'HEALTH_HARD_ENDURANCE_WITHHELD_AS_GENERIC_FILLER',
        );
    });

    it('preserves hard endurance when health is paired with an explicit performance priority', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const policy = resolveHealthPlanningPolicy(['health', 'endurance'], preferences, false);
        const hardCycling = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;

        const result = rankCandidates(
            [hardCycling], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', recentHistory: [], healthPlanningPolicy: policy },
        );

        expect(result.accepted.map(candidate => candidate.template.id)).toContain(hardCycling.id);
        expect(result.rejected).toHaveLength(0);
    });

    it('does not gate hard endurance when running is explicitly supported', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Running'] };
        const policy = resolveHealthPlanningPolicy(['health'], preferences, false);
        const hardRunning = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_01')!;

        const result = rankCandidates(
            [hardRunning], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            { date: '2026-03-05', recentHistory: [], healthPlanningPolicy: policy },
        );

        expect(result.accepted.map(candidate => candidate.template.id)).toContain('end_hard_01');
    });

    it('enforces the rolling quality cap when qualifying moderate history is present', () => {
        const preferences = { ...DEFAULT_PREFERENCES, preferredModalities: ['Strength', 'Walking', 'Cycling'] };
        const policy = resolveHealthPlanningPolicy(['health'], preferences, false);
        const moderate = ENRICHED_TEMPLATES.find(t => t.id === 'end_mod_01')!;
        const result = rankCandidates(
            [moderate], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], preferences,
            {
                date: '2026-03-05',
                recentHistory: [{ date: '2026-03-01', category: 'Moderate Endurance', type: 'Tempo Run' }],
                healthPlanningPolicy: policy,
            },
        );

        expect(result.rejected[0].excludedReasons).toContain('HEALTH_QUALITY_ENDURANCE_DENSITY_LIMIT');
    });

    it('treats swim, bike, and run symmetrically as triathlon event modalities', () => {
        const base: SessionTemplate = {
            id: 'tri_modality_base',
            category: 'Easy Endurance',
            modality: 'Cycling',
            durationMin: 30,
            durationMax: 30,
            title: 'Triathlon modality exposure',
            description: 'Synthetic equal-dose modality fixture.',
            requiredEquipment: [],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0.3,
            objectiveTransferable: true,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.6 },
            costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
        };
        const candidates: SessionTemplate[] = [
            { ...base, id: 'tri_swim', modality: 'Swimming' },
            { ...base, id: 'tri_bike', modality: 'Cycling' },
            { ...base, id: 'tri_run', modality: 'Running' },
        ];
        const focusEvent = {
            id: 'tri-a',
            title: 'Olympic Triathlon',
            date: '2026-03-20',
            priority: 'A' as const,
            category: 'triathlon' as const,
            lifecycle: 'scheduled' as const,
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.7, vo2MaxPower: 0.4, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.7, neuromuscular: 0.2 },
        };

        const result = rankCandidates(
            candidates, [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', focusEvent, recentHistory: [] },
        );

        const benefitById = new Map(result.accepted.map(candidate => [candidate.template.id, candidate.benefitScore]));
        expect(benefitById.get('tri_swim')).toBeCloseTo(benefitById.get('tri_bike')!, 8);
        expect(benefitById.get('tri_swim')).toBeCloseTo(benefitById.get('tri_run')!, 8);
        for (const candidate of result.accepted) {
            expect(candidate.rationale).toContain('Event-modality coverage:');
        }
    });

    it('allows three cycling sessions across 7 days with >= 48h spacing without repetition penalty', () => {
        const thresholdRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5, type: 'Cycling' },
            { date: '2026-03-02', modality: 'Rest', category: 'Rest', role: 'recovery', systemicCost: 0, lowerBodyCost: 0, type: 'Rest' },
            { date: '2026-03-03', modality: 'Cycling', category: 'Moderate Endurance', role: 'supporting', systemicCost: 0.5, lowerBodyCost: 0.3, type: 'Cycling' },
        ];

        const result = rankCandidates(
            [thresholdRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).toEqual([]);
        expect(result.accepted[0].utilityScore).toBeGreaterThan(0);
    });

    it('rejects a hard candidate when planned intensity is below the 0.8 admissibility boundary', () => {
        const hardRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const result = rankCandidates(
            [hardRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', plannedDose: { volume: 1, intensity: 0.79 } }
        );

        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('INTENSITY_SCALE_INADMISSIBLE');
    });

    it('rejects two hard lower-body sessions on consecutive days with HARD_LOWER_BODY_SPACING_VIOLATION', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-04', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' }
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    // Phase 5.2: a detailed workout's own minimumDaysAfterHardLowerBody can require a
    // longer (or shorter) gap than the flat default -- resolveMinimumDaysAfterHardLowerBody
    // is the injection point (planningCandidate.ts is the real, catalog-backed resolver;
    // these tests exercise the mechanism directly with a synthetic one).
    describe('per-workout hard-lower-body spacing override (Phase 5.2)', () => {
        // No fallback to "any Strength template" -- a fallback that isn't heavy lower-body
        // would silently defeat evaluateRecoveryConstraints' hard-lower-body spacing rule
        // these tests exist to exercise, so a missing fixture template must fail loudly.
        const heavySquat = () => {
            const template = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength');
            if (!template) throw new Error('No Lower-body Strength template in ENRICHED_TEMPLATES');
            return template;
        };
        const oneDayPriorHistory: SessionHistoryEntry[] = [
            { date: '2026-03-04', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8 },
        ];

        it('a stricter (3-day) workout-level requirement rejects at a day-2 gap that the flat 2-day default accepts', () => {
            const template = heavySquat();
            const twoDaysPriorHistory: RecentHistoryEntry[] = [
                { date: '2026-03-03', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' },
            ];
            // Default (no resolver): day-2 gap already clears the flat 2-day rule.
            const defaultResult = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: twoDaysPriorHistory },
            );
            expect(defaultResult.accepted).toHaveLength(1);

            // A workout that declares it needs 3 full days still rejects at day 2.
            const strictResult = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: twoDaysPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => 3 },
            );
            expect(strictResult.rejected).toHaveLength(1);
            expect(strictResult.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        });

        it('keeps a 1-day workout override for shared recovery constraints while automatic catalog spacing still rejects adjacent strength', () => {
            const template = heavySquat();
            const options = { date: '2026-03-05', recentHistory: oneDayPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => 1 };
            const sharedReasons = evaluateRecoveryConstraints(template, '2026-03-05', oneDayPriorHistory, options);
            expect(sharedReasons).not.toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
            expect(sharedReasons).not.toContain('RECENT_STRENGTH_SPACING_VIOLATION');
            const result = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                options,
            );
            expect(result.rejected[0].excludedReasons).toContain('CONSECUTIVE_STRENGTH_DAYS');
        });

        it('a resolver that returns undefined for this template falls back to the flat 2-day default, unchanged', () => {
            const template = heavySquat();
            const result = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: oneDayPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => undefined },
            );
            expect(result.rejected).toHaveLength(1);
            expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        });
    });

    it('rejects a hard session with ROLLING_HARD_CAP_EXCEEDED once 3 hard sessions already sit in the rolling 7-day window', () => {
        const moderateRide = ENRICHED_TEMPLATES.find(t => t.category === 'Moderate Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
            { date: '2026-03-07', modality: 'Strength', category: 'Upper-body Strength', systemicCost: 0.55, lowerBodyCost: 0 },
            { date: '2026-03-05', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
        ];

        const result = rankCandidates(
            [moderateRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('does not count a hard session exactly 7 days back toward the rolling cap (outside the dayDiff <= 6 window)', () => {
        const moderateRide = ENRICHED_TEMPLATES.find(t => t.category === 'Moderate Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
            { date: '2026-03-07', modality: 'Strength', category: 'Upper-body Strength', systemicCost: 0.55, lowerBodyCost: 0 },
            { date: '2026-03-03', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
        ];

        const result = rankCandidates(
            [moderateRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).not.toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('rejects heavy lower-body strength with ANCHOR_PROTECTION_VIOLATION when a key Cycling session sits within 1 day', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5 },
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('does not raise ANCHOR_PROTECTION_VIOLATION when the key Cycling session sits 2 days away (outside the 0-1 day window)', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-08', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5 },
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).not.toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('keeps every accepted candidate exactly once after near-equivalent variety rotation (no drop or duplicate)', () => {
        const sharedProfile = {
            requiredEquipment: [] as SessionTemplate['requiredEquipment'],
            environment: 'either' as const,
            safetyTags: [] as SessionTemplate['safetyTags'],
            systemicCost: 0.4,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.6 },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        };
        const templateA: SessionTemplate = {
            id: 'rotation_a', category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Rotation Test A', description: '', ...sharedProfile,
        };
        const templateB: SessionTemplate = {
            id: 'rotation_b', category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Rotation Test B', description: '', ...sharedProfile,
        };
        const templateC: SessionTemplate = {
            id: 'rotation_c', category: 'Easy Endurance', modality: 'Cycling',
            durationMin: 30, durationMax: 45, title: 'Rotation Test C', description: '', ...sharedProfile,
        };

        const result = rankCandidates(
            [templateA, templateC, templateB], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05' }
        );

        expect(result.accepted).toHaveLength(3);
        expect(result.accepted.map(c => c.template.id).sort()).toEqual(['rotation_a', 'rotation_b', 'rotation_c']);
    });
});

describe('optimizer — lexicographic ordering (3.2)', () => {
    it('uses the stronger of max-strength and hypertrophy evidence for strength-maintenance benefit', () => {
        const strengthObjective: WeeklyObjective = {
            id: 'obj_strength_axes', key: 'strength_maintenance', title: 'Strength maintenance',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { maxStrength: 0.2, hypertrophy: 0.9 },
        };
        const candidate: SessionTemplate = {
            id: 'strength_axes', category: 'Upper-body Strength', modality: 'Strength',
            durationMin: 30, durationMax: 40, title: 'Strength Axes', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.3,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, maxStrength: 0.2, hypertrophy: 0.9 },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0.2, impactTissue: 0, neuromuscular: 0.2 },
        };

        expect(calculateStimulusBenefit(candidate, [strengthObjective])).toBeCloseTo(0.9 * 0.9 * 1.6 + 0.5);
    });

    it('scores the vo2MaxPower axis so a vo2_max objective can prioritize its matching templates', () => {
        const vo2Objective: WeeklyObjective = {
            id: 'obj_vo2_max', key: 'vo2_max', title: 'VO2 max development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { vo2MaxPower: 0.9, aerobicEndurance: 0.5 },
        };
        const candidate: SessionTemplate = {
            id: 'vo2_intervals', category: 'Hard Endurance', modality: 'Running',
            durationMin: 40, durationMax: 55, title: 'VO2 Intervals', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.6,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, vo2MaxPower: 0.9 },
            costProfile: { systemic: 0.5, cardiovascular: 0.6, lowerBody: 0.4, upperBody: 0, impactTissue: 0.4, neuromuscular: 0.2 },
        };
        const nonMatching: SessionTemplate = {
            ...candidate, id: 'easy_no_vo2', category: 'Easy Endurance',
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.5 },
        };

        expect(calculateStimulusBenefit(candidate, [vo2Objective])).toBeCloseTo(0.9 * 0.9 * 1.5 + 0.5);
        // A candidate carrying no vo2MaxPower stimulus still earns credit for the objective's
        // secondary aerobicEndurance target, but none of the vo2MaxPower contribution.
        expect(calculateStimulusBenefit(nonMatching, [vo2Objective])).toBeCloseTo(0.5 * 0.5 * 1.2 + 0.5);
    });

    it('enforces qualification.minimumStimulus so a candidate that cannot resolve an objective earns no benefit from it', () => {
        const gatedObjective: WeeklyObjective = {
            id: 'obj_gated_threshold', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { thresholdPower: 0.9 },
            qualification: { minimumStimulus: { thresholdPower: 0.6 } },
        };
        const belowMinimum: SessionTemplate = {
            id: 'weak_threshold', category: 'Moderate Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Weak Threshold', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.4,
            // thresholdPower is present but below the objective's minimumStimulus floor.
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, thresholdPower: 0.3 },
            costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.3, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.1 },
        };
        const meetsMinimum: SessionTemplate = {
            ...belowMinimum, id: 'strong_threshold',
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, thresholdPower: 0.7 },
        };

        // Below the qualification floor: the objective contributes nothing, only the baseline.
        expect(calculateStimulusBenefit(belowMinimum, [gatedObjective])).toBeCloseTo(0.5);
        // At/above the floor: the objective's threshold-power axis scores normally.
        expect(calculateStimulusBenefit(meetsMinimum, [gatedObjective])).toBeCloseTo(0.9 * 0.7 * 1.5 + 0.5);
    });

    it('ensures preference multiplier cannot promote a zero-objective candidate over an objective-satisfying candidate', () => {
        const thresholdObj: WeeklyObjective = {
            id: 'obj_1', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0, targetStimulus: { thresholdPower: 0.8 },
        };

        const thresholdCandidate = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const dislikedObjCandidate = { ...thresholdCandidate, id: 'obj_candidate_disliked', modality: 'Running' as const };
        const preferredNoObjCandidate = {
            ...ENRICHED_TEMPLATES.find(t => t.category === 'Mobility/Recovery')!,
            id: 'no_obj_candidate_preferred', modality: 'Mobility' as const,
        };

        const prefs: UserPreferences = {
            ...DEFAULT_PREFERENCES, avoidedModalities: ['Running'], preferredModalities: ['Mobility'],
        };

        const result = rankCandidatesByUtility(
            [dislikedObjCandidate, preferredNoObjCandidate], [thresholdObj], DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY, [], prefs, { date: '2026-03-05' }
        );

        expect(result[0].template.id).toBe('obj_candidate_disliked');
    });

    it('populates excludedReasons for every filtered candidate', () => {
        const shortTimeAvailability: ResolvedAvailability = { ...DEFAULT_AVAILABILITY, maxTimeMinutes: 15 };
        const longWorkout = ENRICHED_TEMPLATES.find(t => t.durationMin > 30)!;
        const result = rankCandidates(
            [longWorkout], [], DEFAULT_FATIGUE, shortTimeAvailability, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );
        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('TIME_BUDGET_EXCEEDED');
    });

    it('produces an input-order-independent ranking across a benefit chain a naive pairwise tie-band handles non-transitively', () => {
        const aeroObj: WeeklyObjective = {
            id: 'obj_chain', key: 'zone2_aerobic', title: 'Aerobic Base',
            targetExposures: 1, completedExposures: 0, targetStimulus: { aerobicEndurance: 1 },
        };
        const makeCandidate = (id: string, aerobicEndurance: number): SessionTemplate => ({
            id, category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: id, description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.3,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        });
        const a = makeCandidate('chain_a', 1.00 / 1.2);
        const b = makeCandidate('chain_b', 0.96 / 1.2);
        const c = makeCandidate('chain_c', 0.92 / 1.2);

        const inOrder = rankCandidates(
            [a, b, c], [aeroObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );
        const shuffled = rankCandidates(
            [c, a, b], [aeroObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );

        expect(inOrder.accepted).toHaveLength(3);
        expect(inOrder.accepted.map(r => r.template.id)).toEqual(shuffled.accepted.map(r => r.template.id));
    });

    it('keeps two candidates within BENEFIT_TIE_BAND of each other in the same tier even when they straddle a naive rounding boundary', () => {
        const lowObj: WeeklyObjective = {
            id: 'obj_low', key: 'zone2_aerobic', title: 'Aerobic Base',
            targetExposures: 1, completedExposures: 0, targetStimulus: { aerobicEndurance: 1 },
        };
        const makeCandidate = (id: string, aerobicEndurance: number, avoided: boolean): SessionTemplate => ({
            id, category: 'Mobility/Recovery', modality: avoided ? 'Cross Training' : 'Mobility',
            durationMin: 20, durationMax: 30, title: id, description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.1,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        });
        const low = makeCandidate('boundary_low', 0.02 / 1.2, false);
        const high = makeCandidate('boundary_high', 0.0592 / 1.2, true);

        const result = rankCandidates(
            [low, high], [lowObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], {
                ...DEFAULT_PREFERENCES, avoidedModalities: ['Cross Training'],
            }, { date: '2026-03-05' }
        );

        expect(result.accepted[0].template.id).toBe('boundary_low');
    });
});

describe('optimizer — one optimizer invocation context (F4 / 3.3)', () => {
    it('uses projected prior-day strength history for the week-ahead spacing gate', () => {
        const intent = {
            unresolvedObjectives: [], fatigue: DEFAULT_FATIGUE, periodization: { focusEvent: null },
            history: [{ date: '2026-03-08', modality: 'Strength', category: 'Upper-body Strength' as const, systemicCost: 0.3, lowerBodyCost: 0.1, source: 'projected' as const }],
        };
        const context = { constraints: { restrictedModalities: [] }, preferences: DEFAULT_PREFERENCES } as unknown as UserContext;
        const optimization = buildOptimizationContext(intent, context, DEFAULT_PREFERENCES, '2026-03-09', {
            resolvedAvailability: DEFAULT_AVAILABILITY,
        });
        expect(optimization.options.recentPerformedExposures).toBeUndefined();
        const ranked = rankCandidates(
            [ENRICHED_TEMPLATES.find(template => template.id === 'str_full_03')!],
            optimization.unresolvedObjectives, optimization.fatigueState, optimization.availability,
            optimization.injuryConstraints, optimization.preferences, optimization.options,
        );
        expect(ranked.rejected[0].excludedReasons).toContain('CONSECUTIVE_STRENGTH_DAYS');
    });

    it('buildOptimizationContext produces equivalent context from intent and context inputs', () => {
        const intent = {
            unresolvedObjectives: [], fatigue: DEFAULT_FATIGUE, periodization: { focusEvent: null },
            history: [{ date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance' as const, systemicCost: 0.8, lowerBodyCost: 0.5 }],
        };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: ['Running'] }, preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optContext = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');

        expect(optContext.injuryConstraints).toEqual(['Running']);
        expect(optContext.preferences.userId).toBe('user_1');
        expect(optContext.options.date).toBe('2026-03-05');
        expect(optContext.options.recentHistory).toHaveLength(1);
    });

    it('returns identical ranking when given identical OptimizationContext', () => {
        const template = ENRICHED_TEMPLATES.find(t => (t.requiredEquipment ?? []).length === 0 && t.modality !== 'Field')!;
        const intent = { unresolvedObjectives: [], fatigue: DEFAULT_FATIGUE, periodization: { focusEvent: null }, history: [] };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: [] }, preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optCtx1 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');
        const optCtx2 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');
        const res1 = rankCandidates([template], optCtx1.unresolvedObjectives, optCtx1.fatigueState, optCtx1.availability, optCtx1.injuryConstraints, optCtx1.preferences, optCtx1.options);
        const res2 = rankCandidates([template], optCtx2.unresolvedObjectives, optCtx2.fatigueState, optCtx2.availability, optCtx2.injuryConstraints, optCtx2.preferences, optCtx2.options);

        expect(res1.accepted[0].utilityScore).toEqual(res2.accepted[0].utilityScore);
    });
});

describe('optimizer — post-event recovery window constraints', () => {
    const fullBodyStrength = ENRICHED_TEMPLATES.find(t => t.category === 'Full-body Strength')!;
    const easySpin = ENRICHED_TEMPLATES.find(t => t.category === 'Easy Endurance')!;
    const focusEventA = {
        id: 'crit-a',
        title: 'Championship Criterium',
        date: '2026-08-10',
        priority: 'A' as const,
        category: 'cycling_event' as const,
        lifecycle: 'scheduled' as const,
        demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.7, vo2MaxPower: 0.4, repeatedSurges: 0.5, sprintPower: 0.2, fatigueResistance: 0.8, neuromuscular: 0.3 },
    };

    it('restricts heavy strength and hard sessions for 1-3 days after an A-priority event', () => {
        // 2 days post-event (targetDate = 2026-08-12)
        const reasonsStrength = evaluateRecoveryConstraints(fullBodyStrength, '2026-08-12', [], {
            focusEvent: focusEventA,
        });
        expect(reasonsStrength).toContain('POST_EVENT_RECOVERY_WINDOW');

        const reasonsEasy = evaluateRecoveryConstraints(easySpin, '2026-08-12', [], {
            focusEvent: focusEventA,
        });
        expect(reasonsEasy).not.toContain('POST_EVENT_RECOVERY_WINDOW');
    });

    it('lifts post-event restriction after 3 days have passed', () => {
        // 4 days post-event (targetDate = 2026-08-14)
        const reasonsStrength = evaluateRecoveryConstraints(fullBodyStrength, '2026-08-14', [], {
            focusEvent: focusEventA,
        });
        expect(reasonsStrength).not.toContain('POST_EVENT_RECOVERY_WINDOW');
    });
});
