import { describe, expect, it } from 'vitest';
import { buildPlanningCandidateIndex, derivePlanningCandidate, PLANNING_CANDIDATE_INDEX } from './planningCandidate';
import type { WorkoutDefinition } from '../workouts/models';
import type { SessionTemplate, WorkoutCostProfile, WorkoutStimulusProfile } from './models';
import { WORKOUTS } from '../workouts/catalog';
import { ENRICHED_TEMPLATES } from './templates';

const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0,
    sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
};
const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

function testTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'tmpl_1', category: 'Hard Endurance', modality: 'Cycling', durationMin: 30, durationMax: 60,
        title: 'Test Template', description: '', requiredEquipment: [], environment: 'outdoor', safetyTags: [],
        systemicCost: 0.6, stimulusProfile: { ...ZERO_STIMULUS, thresholdPower: 0.7 }, costProfile: { ...ZERO_COST, lowerBody: 0.7 },
        ...overrides,
    };
}

function testWorkout(overrides: Partial<WorkoutDefinition> = {}): WorkoutDefinition {
    return {
        id: 'workout_1', version: 1, status: 'active', name: 'Test Workout', description: '',
        modality: 'cycling', category: 'threshold', objectives: ['lactate_threshold'],
        duration: { minimumMin: 20, defaultMin: 40, maximumMin: 60 },
        loadProfile: { cardiovascular: 4, muscular: 2, mechanical: 2, eccentric: 1, coordination: 2, recoveryHours: 24 },
        eligibility: {},
        equipment: ['bike'],
        contraindicationTags: ['acute_knee_pain'],
        engineTemplateIds: ['tmpl_1'],
        blocks: [], variants: [], regressions: [], progressions: [], substitutions: [],
        garmin: { exportable: true }, tags: [], sourceNotes: [],
        ...overrides,
    };
}

describe('derivePlanningCandidate (Phase 5.2)', () => {
    it('derives a candidate from a workout linked to a real engine template', () => {
        const workout = testWorkout();
        const template = testTemplate();
        const candidate = derivePlanningCandidate(workout, [template]);

        expect(candidate).not.toBeNull();
        expect(candidate?.workoutId).toBe('workout_1');
        expect(candidate?.modality).toBe('Cycling');
        expect(candidate?.durationRange).toEqual({ min: 20, default: 40, max: 60 });
        expect(candidate?.stimulus).toEqual(template.stimulusProfile);
        expect(candidate?.cost).toEqual(template.costProfile);
        expect(candidate?.recoveryHours).toBe(24);
        expect(candidate?.equipment).toEqual(['bike']);
        expect(candidate?.contraindications).toEqual(['acute_knee_pain']);
    });

    it('returns null when the workout has no engineTemplateIds at all', () => {
        const workout = testWorkout({ engineTemplateIds: undefined });
        expect(derivePlanningCandidate(workout, [testTemplate()])).toBeNull();
    });

    it('returns null when engineTemplateIds points at a template that does not exist in the roster', () => {
        const workout = testWorkout({ engineTemplateIds: ['nonexistent'] });
        expect(derivePlanningCandidate(workout, [testTemplate()])).toBeNull();
    });

    it('carries minimumDaysAfterHardLowerBody through only when the workout declares it', () => {
        const withValue = derivePlanningCandidate(testWorkout({ eligibility: { minimumDaysAfterHardLowerBody: 3 } }), [testTemplate()]);
        expect(withValue?.minimumDaysAfterHardLowerBody).toBe(3);

        const without = derivePlanningCandidate(testWorkout({ eligibility: {} }), [testTemplate()]);
        expect(without?.minimumDaysAfterHardLowerBody).toBeUndefined();
        expect('minimumDaysAfterHardLowerBody' in (without ?? {})).toBe(false);
    });

    it('maps WorkoutEnvironment (trainer/field/closed_road/low_traffic_road) onto the coarser engine TrainingEnvironment', () => {
        const indoor = derivePlanningCandidate(
            testWorkout({ technicalRequirements: { environment: ['trainer'], supervision: 'none', stopConditions: [] } }),
            [testTemplate()],
        );
        expect(indoor?.environment).toEqual(['indoor']);

        const outdoor = derivePlanningCandidate(
            testWorkout({ technicalRequirements: { environment: ['field', 'closed_road'], supervision: 'none', stopConditions: [] } }),
            [testTemplate()],
        );
        expect(outdoor?.environment).toEqual(['outdoor']); // deduplicated -- both map to 'outdoor'
    });

    it('falls back to the matched template\'s own environment when the workout declares no technicalRequirements', () => {
        const candidate = derivePlanningCandidate(testWorkout(), [testTemplate({ environment: 'either' })]);
        expect(candidate?.environment).toEqual(['either']);
    });

    it('classifies sessionRole from the template category, reusing ANCHOR_HISTORY_CATEGORIES (not a second definition)', () => {
        const anchorCandidate = derivePlanningCandidate(testWorkout(), [testTemplate({ category: 'Hard Endurance' })]);
        expect(anchorCandidate?.sessionRole).toBe('anchor');

        const recoveryCandidate = derivePlanningCandidate(testWorkout(), [testTemplate({ category: 'Rest', costProfile: ZERO_COST, systemicCost: 0 })]);
        expect(recoveryCandidate?.sessionRole).toBe('recovery');

        const supportingCandidate = derivePlanningCandidate(testWorkout(), [testTemplate({ category: 'Technical Skill', costProfile: ZERO_COST, systemicCost: 0.1 })]);
        expect(supportingCandidate?.sessionRole).toBe('supporting');
    });
});

describe('buildPlanningCandidateIndex (Phase 5.2)', () => {
    it('excludes non-active (draft/deprecated) workouts', () => {
        const draft = testWorkout({ id: 'draft_1', status: 'draft' });
        const index = buildPlanningCandidateIndex([draft], [testTemplate()]);
        expect(index.size).toBe(0);
    });

    it('keeps the higher engineTemplatePriority workout when two workouts implement the same template', () => {
        const low = testWorkout({ id: 'low_priority', engineTemplatePriority: 1 });
        const high = testWorkout({ id: 'high_priority', engineTemplatePriority: 5 });
        const index = buildPlanningCandidateIndex([low, high], [testTemplate()]);
        expect(index.get('tmpl_1')?.workoutId).toBe('high_priority');

        // Order independence -- same result regardless of catalog array order.
        const indexReversed = buildPlanningCandidateIndex([high, low], [testTemplate()]);
        expect(indexReversed.get('tmpl_1')?.workoutId).toBe('high_priority');
    });

    it('the real, module-level PLANNING_CANDIDATE_INDEX is built from the actual catalog and template roster', () => {
        expect(PLANNING_CANDIDATE_INDEX.size).toBeGreaterThan(0);
        // Cross-check against a fresh build from the same live data -- guards against the
        // module-level singleton silently drifting from WORKOUTS/ENRICHED_TEMPLATES.
        const rebuilt = buildPlanningCandidateIndex(WORKOUTS, ENRICHED_TEMPLATES);
        expect(PLANNING_CANDIDATE_INDEX.size).toBe(rebuilt.size);
    });

    it('every real active workout with a resolvable engineTemplateIds entry produces a non-null candidate', () => {
        const templateIds = new Set(ENRICHED_TEMPLATES.map(t => t.id));
        const linkedActiveWorkouts = WORKOUTS.filter(w => w.status === 'active' && w.engineTemplateIds?.some(id => templateIds.has(id)));
        for (const workout of linkedActiveWorkouts) {
            expect(derivePlanningCandidate(workout, ENRICHED_TEMPLATES)).not.toBeNull();
        }
    });
});
