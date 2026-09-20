import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './templates';
import { injuryRegionMappingFamily } from './injuryPolicy';
import type { GuardrailKey } from './models';
import { BODY_REGIONS, type BodyRegion } from './models';
import { EXERCISES } from '../workouts/exercises';
import { workoutForTemplate } from '../workouts/prescription';
import type { InjuryRegionMappingFamily } from './models';

/**
 * Issue #680 root cause: SessionTemplate.safetyTags is the only guardrail-consuming
 * metadata layer with a live consumer (eligibility.ts). WorkoutDefinition and
 * ExerciseDefinition each carry their own, independently-maintained contraindicationTags,
 * which have no runtime consumer (see sessionChoiceEligibility.ts's docstring) and can
 * silently drift out of sync with a template's safetyTags -- exactly what happened to
 * str_upper_pull_01 and str_full_02. This is not a new safety-filtering mechanism; it is a
 * consistency check that a strength template's safetyTags stays a conservative superset of
 * what its own resolved, user-facing workout (via workoutForTemplate -- the same resolver
 * the app uses to render the detailed session) actually contains.
 */

const EXERCISES_BY_ID = new Map(EXERCISES.map(e => [e.id, e]));

// Scoped to the two families implicated by issue #680 (upper-limb/shoulder and lumbar/back).
// lower_limb_impact and lower_limb_strength are deliberately excluded: their guardrail names
// ("avoid_high_impact", "avoid_heavy_lower_body") imply impact/load level that a bare
// contraindicationTag doesn't distinguish (e.g. a bodyweight hip hinge carries
// acute_hamstring_pain but isn't "heavy" loading), which would make this check noisy for a
// pre-existing, more diffuse mismatch unrelated to #680's shoulder/back flare report. That
// gap is real but out of scope here -- see the flagged follow-up.
const FAMILY_TO_GUARDRAIL: Partial<Record<InjuryRegionMappingFamily, GuardrailKey>> = {
    lumbar_loading: 'avoid_heavy_spinal_loading',
    upper_limb_loading: 'avoid_overhead_pressing',
};

// contraindicationTags follow an `acute_<token>_pain` convention; a handful of tokens don't
// spell their BodyRegion exactly (e.g. 'adductor' vs. 'adductor_groin'). Tags outside this
// convention (e.g. 'knee_swelling', 'worsening_achilles_pain') describe a specific clinical
// condition consumed elsewhere (WorkoutDefinition.eligibility.forbiddenPainFlags), not a
// BodyRegion, and are intentionally not part of this guardrail-alignment check.
const ACUTE_PAIN_TAG = /^acute_(.+)_pain$/;
const TAG_TOKEN_TO_REGION: Record<string, BodyRegion> = { adductor: 'adductor_groin' };

function regionForContraindicationTag(tag: string): BodyRegion | null {
    const match = ACUTE_PAIN_TAG.exec(tag);
    if (!match) return null;
    const token = match[1];
    const region = (TAG_TOKEN_TO_REGION[token] ?? token) as BodyRegion;
    return (BODY_REGIONS as readonly string[]).includes(region) ? region : null;
}

function expectedGuardrailsForTemplate(templateId: string): Set<GuardrailKey> {
    const workout = workoutForTemplate(templateId);
    const guardrails = new Set<GuardrailKey>();
    if (!workout) return guardrails;

    for (const block of workout.blocks) {
        for (const step of block.steps) {
            const exercise = EXERCISES_BY_ID.get(step.exerciseId);
            for (const tag of exercise?.contraindicationTags ?? []) {
                const region = regionForContraindicationTag(tag);
                if (!region) continue;
                const guardrail = FAMILY_TO_GUARDRAIL[injuryRegionMappingFamily(region)];
                if (guardrail) guardrails.add(guardrail);
            }
        }
    }
    return guardrails;
}

describe('strength template safetyTags stay aligned with their resolved workout (issue #680)', () => {
    const strengthTemplates = TEMPLATES.filter(t => t.modality === 'Strength');

    it.each(strengthTemplates.map(t => t.id))('%s carries every guardrail implied by its resolved workout\'s exercises', (templateId) => {
        const template = TEMPLATES.find(t => t.id === templateId)!;
        const expected = expectedGuardrailsForTemplate(templateId);
        const actual = new Set(template.safetyTags);

        const missing = [...expected].filter(g => !actual.has(g));
        expect(missing, `${templateId} is missing guardrail(s) implied by its resolved workout: ${missing.join(', ')}`).toEqual([]);
    });

    it('confirms the resolved-workout signal is non-trivial for at least one template', () => {
        // Guards against the check above silently passing because workoutForTemplate()
        // returned no exercises for every strength template (e.g. a broken import).
        const anyGuardrailsFound = strengthTemplates.some(t => expectedGuardrailsForTemplate(t.id).size > 0);
        expect(anyGuardrailsFound).toBe(true);
    });
});
