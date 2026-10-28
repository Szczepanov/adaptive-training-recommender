import { describe, expect, it } from 'vitest';
import {
    evaluateInjuryConstraintTouchesSession,
    INJURY_SESSION_TOUCH_TABLE,
    injuryRegionMappingFamily,
    type InjuryRegionMappingFamily,
} from '../derived/flags/injuryConstraintTouchesSession';
import { injuryRegionMappingFamily as engineInjuryRegionMappingFamily, resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { TEMPLATES } from '../engine/templates';
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

    it('pins the counted severities, monitor exclusion and missing-evidence rule', () => {
        expect(descriptor.countedSeverities).toEqual(['limit', 'exclude']);
        expect(descriptor.monitorCounts).toBe(false);
        expect(descriptor.missingPatternEvidence).toBe('active_null');

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
