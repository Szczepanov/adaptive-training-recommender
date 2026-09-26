import { describe, expect, it } from 'vitest';
import type { DimensionalFatigue, SessionHistoryEntry, SessionTemplate, UserEvent } from '../engine/models';
import { decayFatigue } from '../engine/fatigue';
import {
    evaluateRecoveryConstraints,
    intensityClassForTemplate,
    isIntensityClassAdmissible,
    TAPER_LIGHT_STRENGTH_MAX_SYSTEMIC_COST,
} from '../engine/optimizer';
import {
    RECOVERY_REENTRY_EARLY_MAX_SYSTEMIC_COST,
    RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST,
    POST_REST_REENTRY_MAX_SYSTEMIC_COST,
} from '../engine/planner';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledge';
import { costIntensityFromGarmin, SESSION_COST_ROW } from '../engine/completedTraining';
import type { NormalizedGarminActivity } from '../engine/models';
import {
    getActiveKnowledgeClaim as getActiveRegistryKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS as REGISTRY_KNOWLEDGE_CLAIM_IDS,
} from './sportsKnowledgeRegistry';
import {
    OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO,
    OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO,
    OLYMPIC_TRIATHLON_TAPER_FIRST_BLOCK_VOLUME_SHARE,
    OLYMPIC_TRIATHLON_TAPER_SWIM_TOUCH_MINUTES,
    OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE,
    OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE,
    OLYMPIC_TRIATHLON_TAPER_LATE_CYCLING_MINUTES,
    OLYMPIC_TRIATHLON_TAPER_LATE_RUNNING_MINUTES,
    OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_MAX_MINUTES,
    OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_BENEFIT,
    OLYMPIC_TRIATHLON_TAPER_LATE_RUN_BENEFIT,
    OLYMPIC_TRIATHLON_TAPER_OPENER_BENEFIT,
    OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SESSIONS,
    OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SPAN_DAYS,
    OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS,
    OLYMPIC_TRIATHLON_TAPER_PACING_BLOCKS,
    OLYMPIC_TRIATHLON_TAPER_REFERENCE_DAYS,
} from '../engine/taperPlanBudget';

function template(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'knowledge_alignment_fixture',
        title: 'Knowledge alignment fixture',
        description: 'Synthetic fixture used only to verify evidence-policy alignment.',
        category: 'Technical Skill',
        modality: 'Cycling',
        durationMin: 30,
        durationMax: 30,
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0,
        objectiveTransferable: true,
        ...overrides,
    } as SessionTemplate;
}

function history(overrides: Partial<SessionHistoryEntry>): SessionHistoryEntry {
    return {
        date: '2026-08-29',
        modality: 'Cycling',
        role: 'supporting',
        intensityClass: 'easy',
        systemicCost: 0,
        lowerBodyCost: 0,
        ...overrides,
    } as SessionHistoryEntry;
}

describe('load + intensity + recovery product-claim alignment', () => {
    it('issue #800: aligns the Olympic-triathlon plan budget with its registered policy and taper evidence', () => {
        const policy = getActiveRegistryKnowledgeClaim(REGISTRY_KNOWLEDGE_CLAIM_IDS.olympicTriathlonPlanBudgetPolicy);
        const science = getActiveRegistryKnowledgeClaim(REGISTRY_KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper);
        expect(policy.claimType).toBe('heuristic');
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO}`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO}`);
        expect(policy.statement).toContain('ceiling');
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_REFERENCE_DAYS}-day`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SESSIONS} measured`);
        expect(policy.statement).toContain(`at least ${OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SPAN_DAYS} days`);
        expect(policy.statement).toContain(`Each ${OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS}-day block`);
        expect(OLYMPIC_TRIATHLON_TAPER_PACING_BLOCKS).toBe(2);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_FIRST_BLOCK_VOLUME_SHARE}`);
        expect(policy.statement).toContain('Pending, dated fixed training with exact or external-authored identity');
        expect(policy.statement).toContain('at least one opportunity for each race discipline');
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_SWIM_TOUCH_MINUTES} swim minutes`);
        expect(policy.statement).toContain(`D-${OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE} through D-${OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE}`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_LATE_CYCLING_MINUTES} cycling minutes`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_LATE_RUNNING_MINUTES} running minutes`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_MAX_MINUTES} minutes`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_BENEFIT} for a race-week swim`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_LATE_RUN_BENEFIT} for a late run`);
        expect(policy.statement).toContain(`${OLYMPIC_TRIATHLON_TAPER_OPENER_BENEFIT} for a brief cycling opener`);
        expect(policy.statement).toContain('D-1');
        expect(science.statement).toContain('41-60%');
        expect(OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO).toBeCloseTo(1 - 0.41);
    });
    it('pins the registered intensity-band claim to the current public classifier boundary', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands);

        expect(intensityClassForTemplate(template({ systemicCost: 0.29 }))).toBe('easy');
        expect(intensityClassForTemplate(template({ systemicCost: 0.30 }))).toBe('moderate');
        expect(intensityClassForTemplate(template({ systemicCost: 0.59 }))).toBe('moderate');
        expect(intensityClassForTemplate(template({ systemicCost: 0.60 }))).toBe('hard');
        expect(isIntensityClassAdmissible('hard', 0.79)).toBe(false);
        expect(isIntensityClassAdmissible('hard', 0.80)).toBe(true);
    });

    it('pins the rolling hard-density claim to three prior >=0.5 sessions in six days', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap);
        const targetDate = '2026-08-30';
        const prior = [
            history({ date: '2026-08-29', systemicCost: 0.5 }),
            history({ date: '2026-08-27', systemicCost: 0.5 }),
            history({ date: '2026-08-25', systemicCost: 0.5 }),
        ];

        expect(evaluateRecoveryConstraints(template({ systemicCost: 0.49 }), targetDate, prior, {}))
            .not.toContain('ROLLING_HARD_CAP_EXCEEDED');
        expect(evaluateRecoveryConstraints(template({ systemicCost: 0.50 }), targetDate, prior, {}))
            .toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('pins previous-day anchor and default hard-lower-body spacing claims', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.anchorSpacing);
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing);
        const targetDate = '2026-08-30';

        const anchorCandidate = template({ category: 'Hard Endurance', systemicCost: 0.6 });
        expect(evaluateRecoveryConstraints(anchorCandidate, targetDate, [history({ role: 'anchor' })], {}))
            .toContain('QUALITY_SPACING_VIOLATION');

        const lowerBodyCandidate = template({
            category: 'Lower-body Strength',
            modality: 'Strength',
            systemicCost: 0.5,
            costProfile: { systemic: 0.5, cardiovascular: 0.1, lowerBody: 0.6, upperBody: 0, impactTissue: 0.2, neuromuscular: 0.5 },
        });
        expect(evaluateRecoveryConstraints(lowerBodyCandidate, targetDate, [history({ lowerBodyCost: 0.6 })], {}))
            .toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        expect(evaluateRecoveryConstraints(lowerBodyCandidate, targetDate, [history({ date: '2026-08-28', lowerBodyCost: 0.6 })], {}))
            .not.toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    it('pins the conservative strength/key-cycling adjacency claim without calling it scientific necessity', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency);
        expect(claim.limitations.join(' ')).toContain('same-day strength and endurance training is harmful');

        const keyCyclingCandidate = template({ category: 'Hard Endurance', modality: 'Cycling', systemicCost: 0.6 });
        const priorHeavyStrength = history({
            category: 'Lower-body Strength',
            modality: 'Strength',
            lowerBodyCost: 0.6,
        });
        expect(evaluateRecoveryConstraints(keyCyclingCandidate, '2026-08-30', [priorHeavyStrength], {}))
            .toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('pins the registered fatigue half-lives to the current decay model', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives);
        const full: DimensionalFatigue = {
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 1,
            upperBody: 1,
            impactTissue: 1,
            neuromuscular: 1,
        };

        const after24 = decayFatigue(full, 24);
        const after36 = decayFatigue(full, 36);
        const after48 = decayFatigue(full, 48);
        expect(after24.cardiovascular).toBeCloseTo(0.5, 8);
        expect(after36.systemic).toBeCloseTo(0.5, 8);
        expect(after36.upperBody).toBeCloseTo(0.5, 8);
        expect(after36.neuromuscular).toBeCloseTo(0.5, 8);
        expect(after48.lowerBody).toBeCloseTo(0.5, 8);
        expect(after48.impactTissue).toBeCloseTo(0.5, 8);
    });

    it('issue #679: pins the monotonic severe-recovery re-entry ladder to its registered claim', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.severeAdverseRecoveryReentry);
        expect(claim.statement).toContain('days 1-2');
        expect(claim.statement).toContain(`${RECOVERY_REENTRY_EARLY_MAX_SYSTEMIC_COST}`);
        expect(claim.statement).toContain(`${RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST}`);
        expect(claim.statement).toContain('two projected rest days');
        expect(claim.statement).toContain('fresh subjective check-in');
        expect(claim.statement).toContain('recovery-only dates use recover-tier');
        expect(claim.statement).toContain('graduated re-entry dates use modify-tier');
        expect(RECOVERY_REENTRY_EARLY_MAX_SYSTEMIC_COST).toBeLessThan(RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST);
        expect(RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST).toBeLessThanOrEqual(0.5);
        expect(POST_REST_REENTRY_MAX_SYSTEMIC_COST).toBe(0.75);
    });

    it('issue #679: pins the taper-window nonessential-strength and moderate-density guard for triathlon A-events', () => {
        const claim = getActiveRegistryKnowledgeClaim(REGISTRY_KNOWLEDGE_CLAIM_IDS.preEventRestrictionsPolicy);
        expect(claim.applicability.sports).toContain('triathlon');

        const triathlonAEvent: UserEvent = {
            id: 'evt-tri-a',
            title: 'Olympic Triathlon',
            category: 'triathlon',
            date: '2026-09-14',
            priority: 'A',
            lifecycle: 'scheduled',
            demandProfile: { aerobicEndurance: 0.75, thresholdPower: 0.8, vo2MaxPower: 0.45, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.65, neuromuscular: 0.15 },
        };
        const targetDate = '2026-09-04'; // 10 days out: inside the legacy 14-day A taper window

        // A second strength touch in the taper window is excluded even though it is light.
        const lightStrength = template({ category: 'Upper-body Strength', modality: 'Strength', systemicCost: TAPER_LIGHT_STRENGTH_MAX_SYSTEMIC_COST });
        const priorLightStrength = history({ date: '2026-09-01', category: 'Upper-body Strength', modality: 'Strength', systemicCost: TAPER_LIGHT_STRENGTH_MAX_SYSTEMIC_COST });
        expect(evaluateRecoveryConstraints(lightStrength, targetDate, [priorLightStrength], { focusEvent: triathlonAEvent }))
            .toContain('TAPER_NONESSENTIAL_STRENGTH_RESTRICTION');

        // A first strength touch above the light ceiling is excluded outright.
        const heavyStrength = template({ category: 'Lower-body Strength', modality: 'Strength', systemicCost: TAPER_LIGHT_STRENGTH_MAX_SYSTEMIC_COST + 0.1 });
        expect(evaluateRecoveryConstraints(heavyStrength, targetDate, [], { focusEvent: triathlonAEvent }))
            .toContain('TAPER_NONESSENTIAL_STRENGTH_RESTRICTION');

        // A single light touch, with no prior one in-window, is allowed.
        expect(evaluateRecoveryConstraints(lightStrength, targetDate, [], { focusEvent: triathlonAEvent }))
            .not.toContain('TAPER_NONESSENTIAL_STRENGTH_RESTRICTION');

        // Moderate Endurance stacked within 3 days of a prior one is excluded.
        const moderateEndurance = template({ category: 'Moderate Endurance', modality: 'Running', systemicCost: 0.6 });
        const priorModerate = history({ date: '2026-09-02', category: 'Moderate Endurance', modality: 'Swimming', systemicCost: 0.6 });
        expect(evaluateRecoveryConstraints(moderateEndurance, targetDate, [priorModerate], { focusEvent: triathlonAEvent }))
            .toContain('TAPER_MODERATE_DENSITY_RESTRICTION');

        // The same candidate is admissible once spaced out (>3 days).
        const distantPriorModerate = history({ date: '2026-08-30', category: 'Moderate Endurance', modality: 'Swimming', systemicCost: 0.6 });
        expect(evaluateRecoveryConstraints(moderateEndurance, targetDate, [distantPriorModerate], { focusEvent: triathlonAEvent }))
            .not.toContain('TAPER_MODERATE_DENSITY_RESTRICTION');

        // D-3 excludes generic tempo/hard endurance while leaving a light race-specific
        // sharpening touch eligible. This addresses the build-like generic tempo symptom
        // without converting taper into a blanket intensity ban.
        const d3Date = '2026-09-11';
        const d3Moderate = template({ category: 'Moderate Endurance', modality: 'Running', systemicCost: 0.4 });
        const d3Hard = template({ category: 'Hard Endurance', modality: 'Cycling', systemicCost: 0.6 });
        const d3RaceSpecific = template({ category: 'Race-Specific Endurance', modality: 'Cycling', systemicCost: 0.4 });
        expect(evaluateRecoveryConstraints(d3Moderate, d3Date, [], { focusEvent: triathlonAEvent }))
            .toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(d3Hard, d3Date, [], { focusEvent: triathlonAEvent }))
            .toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(d3RaceSpecific, d3Date, [], { focusEvent: triathlonAEvent }))
            .not.toContain('PRE_EVENT_TAPER_RESTRICTION');

        const cWithoutAuthoredTaper: UserEvent = { ...triathlonAEvent, priority: 'C' };
        const cAuthoredTaper: UserEvent = { ...cWithoutAuthoredTaper, taper: { startDate: '2026-09-07' } };

        // Issue #737: unauthored C events preserve normal D-3 quality/strength allocation;
        // an explicit taper opts back into the A/B D-3 gates.
        expect(evaluateRecoveryConstraints(d3Moderate, d3Date, [], { focusEvent: cWithoutAuthoredTaper }))
            .not.toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(d3Hard, d3Date, [], { focusEvent: cWithoutAuthoredTaper }))
            .not.toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(heavyStrength, d3Date, [], { focusEvent: cWithoutAuthoredTaper }))
            .not.toContain('PRE_EVENT_STRENGTH_RESTRICTION');
        expect(evaluateRecoveryConstraints(d3Hard, d3Date, [], { focusEvent: cAuthoredTaper }))
            .toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(heavyStrength, d3Date, [], { focusEvent: cAuthoredTaper }))
            .toContain('PRE_EVENT_STRENGTH_RESTRICTION');

        // The exception ends exactly at the final-48-hour boundary.
        const d2Date = '2026-09-12';
        expect(evaluateRecoveryConstraints(d3Hard, d2Date, [], { focusEvent: cWithoutAuthoredTaper }))
            .toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(heavyStrength, d2Date, [], { focusEvent: cWithoutAuthoredTaper }))
            .toContain('PRE_EVENT_STRENGTH_RESTRICTION');

        const exhaustive = template({ category: 'Hard Endurance', modality: 'Running', systemicCost: 0.8, title: 'VO2 intervals' });
        expect(evaluateRecoveryConstraints(exhaustive, '2026-09-09', [], { focusEvent: cWithoutAuthoredTaper }))
            .not.toContain('PRE_EVENT_TAPER_RESTRICTION');
        expect(evaluateRecoveryConstraints(exhaustive, '2026-09-09', [], { focusEvent: cAuthoredTaper }))
            .toContain('PRE_EVENT_TAPER_RESTRICTION');

        // Outside the taper window, none of this applies.
        expect(evaluateRecoveryConstraints(heavyStrength, '2026-07-01', [], { focusEvent: triathlonAEvent }))
            .not.toContain('TAPER_NONESSENTIAL_STRENGTH_RESTRICTION');

        // A strength_meet's own taper is a deload of strength work itself, not something to
        // treat as nonessential -- the guard must not fight the event it exists to protect.
        const strengthMeetAEvent: UserEvent = { ...triathlonAEvent, id: 'evt-meet-a', category: 'strength_meet' };
        expect(evaluateRecoveryConstraints(heavyStrength, targetDate, [priorLightStrength], { focusEvent: strengthMeetAEvent }))
            .not.toContain('TAPER_NONESSENTIAL_STRENGTH_RESTRICTION');
    });

    it('pins the Garmin session-cost to cost-row mapping and stimulus floor to its claim (#809)', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.garminStimulusCostClassification);
        expect(SESSION_COST_ROW).toEqual({ low: 'easy', moderate: 'moderate', high: 'hard', very_high: 'hard' });
        for (const [cost, row] of Object.entries(SESSION_COST_ROW)) {
            expect(claim.statement).toContain(`${cost} ${row}`);
        }
        expect(claim.statement).toContain('never lower it below the stimulus row');
        const activity = (sessionCost: NormalizedGarminActivity['sessionCost']): NormalizedGarminActivity => ({
            activityId: 'a', date: '2026-09-20', type: 'cycling', durationMin: 60, trainingEffectAerobic: 2,
            trainingEffectAnaerobic: 0, averageHr: null, activityTrainingLoad: null, intensityTag: 'hard', sessionCost,
        });
        expect(costIntensityFromGarmin(activity('low'), 'hard')).toBe('hard');
        expect(costIntensityFromGarmin(activity('high'), 'easy')).toBe('hard');
        expect(costIntensityFromGarmin(activity('moderate'), 'easy')).toBe('moderate');
        expect(costIntensityFromGarmin(activity('unknown'), 'moderate')).toBe('moderate');
    });
});
