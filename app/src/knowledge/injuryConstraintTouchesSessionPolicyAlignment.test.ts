import { describe, expect, it } from 'vitest';
import {
    evaluateInjuryConstraintTouchesSession,
    INJURY_SESSION_TOUCH_TABLE,
    injuryRegionMappingFamily,
    type InjuryRegionMappingFamily,
} from '../derived/flags/injuryConstraintTouchesSession';
import { injuryRegionMappingFamily as engineInjuryRegionMappingFamily, resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { TEMPLATES } from '../engine/templates';
import { EXERCISES_BY_ID } from '../workouts/exercises';
import { workoutForTemplate } from '../workouts/prescription';
import { BODY_REGIONS, type BodyRegion } from '../ledger/models';
import type { SessionDefinition } from '../sessions/models';
import { INJURY_PAIN_POLICY_DESCRIPTOR } from './injuryPainKnowledge';

// I4 / ADR-0033 alignment for policy.injury.constraint_touches_session_flag_v1 (#1164).
const TODAY = '2026-10-28';
const descriptor = INJURY_PAIN_POLICY_DESCRIPTOR.constraintTouchesSessionFlag;

function regionsOf(family: InjuryRegionMappingFamily): BodyRegion[] {
    return BODY_REGIONS.filter(region => engineInjuryRegionMappingFamily(region) === family);
}

describe('injury constraint touches session policy alignment', () => {
    it.each([...BODY_REGIONS])('maps %s to the same region family as the engine', region => {
        expect(injuryRegionMappingFamily(region)).toBe(engineInjuryRegionMappingFamily(region));
    });

    it('pins the family x severity touch table to the descriptor', () => {
        expect(INJURY_SESSION_TOUCH_TABLE).toEqual(descriptor.familySeverityTouch);
        for (const cells of Object.values(INJURY_SESSION_TOUCH_TABLE)) {
            expect(Object.keys(cells)).toEqual([...descriptor.countedSeverities]);
        }
    });

    it('covers every region family the engine can produce', () => {
        const engineFamilies = [...new Set(BODY_REGIONS.map(engineInjuryRegionMappingFamily))].sort();
        expect(Object.keys(INJURY_SESSION_TOUCH_TABLE).sort()).toEqual(engineFamilies);
    });

    // Modality cells mirror the engine: the resolver's own restricted modalities plus the
    // non-Strength template modalities its implied guardrails block. Strength is judged by
    // pattern instead, so a pure upper-body session is not touched by a hamstring constraint.
    it.each(Object.keys(INJURY_SESSION_TOUCH_TABLE) as InjuryRegionMappingFamily[])(
        'pins the %s modality cells against the engine restrictions',
        family => {
            for (const severity of descriptor.countedSeverities) {
                for (const region of regionsOf(family)) {
                    const restrictions = resolveInjuryRestrictions([{ region, severity }], TODAY);
                    const blockedTemplateModalities = TEMPLATES
                        .filter(template => template.modality !== 'Strength')
                        .filter(template => template.safetyTags.some(tag => restrictions.impliedGuardrails.includes(tag)))
                        .map(template => template.modality);
                    const engineModalities = [...new Set([...restrictions.restrictedModalities, ...blockedTemplateModalities])].sort();
                    expect([...INJURY_SESSION_TOUCH_TABLE[family][severity].modalities].sort()).toEqual(engineModalities);
                }
            }
        },
    );

    // Pattern precedent. Templates carry guardrails per whole session, not per pattern, so a
    // cell cannot equal "every pattern in a blocked template" (for the overhead-pressing
    // guardrail that union is all six patterns). What can be pinned is the subset: every
    // pattern a precedent-backed cell names occurs in a Strength template the engine blocks
    // for that family and severity. lower_limb_impact has no such template, which is why its
    // pattern cells are labelled "proposed, no engine precedent".
    function blockedStrengthTemplatePatterns(region: BodyRegion, severity: 'limit' | 'exclude'): Set<string> {
        const restrictions = resolveInjuryRestrictions([{ region, severity }], TODAY);
        const blocked = TEMPLATES.filter(template => template.modality === 'Strength'
            && (template.safetyTags.some(tag => restrictions.impliedGuardrails.includes(tag))
                || restrictions.restrictedCategories.includes(template.category)));
        return new Set(blocked.flatMap(template => (workoutForTemplate(template.id)?.blocks ?? [])
            .flatMap(block => block.steps)
            .flatMap(step => EXERCISES_BY_ID.get(step.exerciseId)?.compositionPatterns ?? [])));
    }

    it.each(['lower_limb_strength', 'lumbar_loading', 'upper_limb_loading'] as const)(
        'pins every %s pattern cell to a Strength template the engine blocks',
        family => {
            for (const severity of descriptor.countedSeverities) {
                for (const region of regionsOf(family)) {
                    const enginePatterns = blockedStrengthTemplatePatterns(region, severity);
                    for (const pattern of INJURY_SESSION_TOUCH_TABLE[family][severity].patterns) {
                        expect(enginePatterns.has(pattern), `${family}/${severity}/${region}: ${pattern}`).toBe(true);
                    }
                }
            }
        },
    );

    it('pins the upper-limb cells to the overhead-pressing template precedent (bar-on-back and grip loading)', () => {
        for (const severity of descriptor.countedSeverities) {
            expect([...INJURY_SESSION_TOUCH_TABLE.upper_limb_loading[severity].patterns].sort())
                .toEqual(['hip_dominant_hinge', 'knee_dominant_bilateral', 'upper_pull', 'upper_push']);
        }
        const strLower = TEMPLATES.find(template => template.id === 'str_lower_01');
        expect(strLower?.safetyTags).toContain('avoid_overhead_pressing');
        expect(blockedStrengthTemplatePatterns('shoulder', 'limit')).toEqual(new Set([
            'hip_dominant_hinge', 'knee_dominant_bilateral', 'trunk_tissue_capacity', 'unilateral_lower_body', 'upper_pull', 'upper_push',
        ]));
    });

    it('records that the engine blocks no Strength template for lower_limb_impact (pattern cells are proposed)', () => {
        for (const severity of descriptor.countedSeverities) {
            for (const region of regionsOf('lower_limb_impact')) {
                expect(blockedStrengthTemplatePatterns(region, severity).size).toBe(0);
            }
        }
    });

    it('pins the counted severities, monitor exclusion and missing-evidence rule', () => {
        expect(descriptor.countedSeverities).toEqual(['limit', 'exclude']);
        expect(descriptor.monitorCounts).toBe(false);
        expect(descriptor.missingPatternEvidence).toBe('active_null_when_a_reachable_pattern_lacks_evidence');
        expect(descriptor.degradedCompositionIsEvidence).toBe(false);
        expect(descriptor.relaxedRequirementsCount).toBe(false);

        const squat: SessionDefinition = {
            schemaVersion: 1, id: 'd', revision: 1, title: 'Squat', intent: 'training', modalities: ['strength'],
            blocks: [{ id: 'b', role: 'main', executionMode: 'sequential', steps: [{ id: 's', kind: 'exercise', compositionPatterns: ['knee_dominant_bilateral'] }] }],
        };
        expect(evaluateInjuryConstraintTouchesSession([{ region: 'knee', severity: 'monitor' }], TODAY, squat).active).toBe(false);
        expect(evaluateInjuryConstraintTouchesSession([{ region: 'knee', severity: 'limit' }], TODAY, squat).active).toBe(true);
        const untagged: SessionDefinition = { ...squat, blocks: [{ ...squat.blocks[0], steps: [{ id: 's', kind: 'exercise' }] }] };
        expect(evaluateInjuryConstraintTouchesSession([{ region: 'knee', severity: 'limit' }], TODAY, untagged).active).toBeNull();
    });
});
