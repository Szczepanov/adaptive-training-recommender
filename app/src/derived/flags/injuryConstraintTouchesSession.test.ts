import { describe, expect, it } from 'vitest';
import { injuryRegionMappingFamily as engineInjuryRegionMappingFamily, resolveInjuryRestrictions } from '../../engine/injuryPolicy';
import { BODY_REGIONS, type InjuryConstraint } from '../../ledger/models';
import type { SessionDefinition, SessionStep } from '../../sessions/models';
import { MOVEMENT_COMPOSITION_PATTERNS } from '../../sessions/movementCompositionContract';
import {
    evaluateInjuryConstraintTouchesSession,
    INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION,
    INJURY_SESSION_TOUCH_TABLE,
    injuryRegionMappingFamily,
    isActiveInjuryConstraint,
} from './injuryConstraintTouchesSession';

const DATE = '2026-10-28';

function step(id: string, overrides: Partial<SessionStep> = {}): SessionStep {
    return { id, kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: id }, ...overrides };
}

function session(steps: SessionStep[], overrides: Partial<SessionDefinition> = {}): SessionDefinition {
    return {
        schemaVersion: 1, id: 'def-1', revision: 1, title: 'Session', intent: 'training',
        modalities: ['strength'], dominantModality: 'strength',
        blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps }],
        ...overrides,
    };
}

const squatSession = session([step('front_squat', { compositionPatterns: ['knee_dominant_bilateral'] })]);
const benchSession = session([step('bench_press', { compositionPatterns: ['upper_push'] })]);
const runSession = session([], { modalities: ['running'], dominantModality: 'running' });

const kneeLimit: InjuryConstraint = { region: 'knee', severity: 'limit' };

function evaluate(constraints: readonly InjuryConstraint[] | null | undefined, definition: SessionDefinition | null | undefined) {
    return evaluateInjuryConstraintTouchesSession(constraints, DATE, definition);
}

describe('isActiveInjuryConstraint: duplicate of the engine reviewBy rule', () => {
    const reviewByCases: (string | undefined)[] = [undefined, '2026-10-27', DATE, '2026-10-29', '2025-12-31', '2027-01-01'];

    it.each(reviewByCases)('matches engine resolveInjuryRestrictions for reviewBy %s', reviewBy => {
        const constraint: InjuryConstraint = { region: 'knee', severity: 'limit', ...(reviewBy ? { reviewBy } : {}) };
        const engineActive = resolveInjuryRestrictions([constraint], DATE).impliedGuardrails.length > 0;
        expect(isActiveInjuryConstraint(constraint, DATE)).toBe(engineActive);
    });

    it('treats reviewBy on the evaluated date as still active and the day before as expired', () => {
        expect(isActiveInjuryConstraint({ severity: 'limit', reviewBy: DATE }, DATE)).toBe(true);
        expect(isActiveInjuryConstraint({ severity: 'limit', reviewBy: '2026-10-27' }, DATE)).toBe(false);
        expect(isActiveInjuryConstraint({ severity: 'limit' }, DATE)).toBe(true);
    });
});

describe('injuryRegionMappingFamily: duplicate of the engine region mapping', () => {
    it.each([...BODY_REGIONS])('maps %s exactly as engine/injuryPolicy.ts does', region => {
        expect(injuryRegionMappingFamily(region)).toBe(engineInjuryRegionMappingFamily(region));
    });
});

describe('INJURY_SESSION_TOUCH_TABLE', () => {
    it('names only real movement-composition patterns and has a cell for every family and counted severity', () => {
        for (const family of ['lower_limb_impact', 'lower_limb_strength', 'lumbar_loading', 'upper_limb_loading'] as const) {
            for (const severity of ['limit', 'exclude'] as const) {
                const cell = INJURY_SESSION_TOUCH_TABLE[family][severity];
                expect(cell.patterns.length).toBeGreaterThan(0);
                cell.patterns.forEach(pattern => expect(MOVEMENT_COMPOSITION_PATTERNS.has(pattern)).toBe(true));
            }
        }
    });
});

describe('evaluateInjuryConstraintTouchesSession: identity', () => {
    it('reports the D-FLAGS id, definition version and a threshold that names the rule', () => {
        const result = evaluate([kneeLimit], squatSession);
        expect(result.id).toBe('injury_constraint_touches_session');
        expect(result.definitionVersion).toBe(INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION);
        expect(INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION).toBe('injury_constraint_touches_session-v1');
        expect(result.threshold).toContain('monitor');
        expect(result.threshold).toContain('lower_limb_impact/limit');
    });
});

describe('evaluateInjuryConstraintTouchesSession: missing inputs are not a negative', () => {
    it('returns active null / missing when the constraints record is absent', () => {
        for (const constraints of [null, undefined]) {
            const result = evaluate(constraints, squatSession);
            expect(result).toMatchObject({ active: null, state: 'missing', reasonCode: 'no_constraints_record' });
        }
    });

    it('returns active null / missing when there is no session', () => {
        for (const definition of [null, undefined]) {
            const result = evaluate([kneeLimit], definition);
            expect(result).toMatchObject({ active: null, state: 'missing', reasonCode: 'no_session' });
        }
    });
});

describe('evaluateInjuryConstraintTouchesSession: which constraints count', () => {
    it('counts an active limit or exclude constraint', () => {
        expect(evaluate([kneeLimit], squatSession)).toMatchObject({ active: true, state: 'measured', reasonCode: 'pattern_touch' });
        expect(evaluate([{ region: 'knee', severity: 'exclude' }], squatSession)).toMatchObject({ active: true, state: 'measured' });
    });

    it('ignores an expired constraint', () => {
        const result = evaluate([{ ...kneeLimit, reviewBy: '2026-10-27' }], squatSession);
        expect(result).toMatchObject({ active: false, state: 'measured', reasonCode: 'no_active_constraints' });
    });

    it('still counts a constraint whose reviewBy is the evaluated date', () => {
        expect(evaluate([{ ...kneeLimit, reviewBy: DATE }], squatSession).active).toBe(true);
    });

    it('never counts monitor, even with explicit restricted modalities (owner decision Q5)', () => {
        const monitor: InjuryConstraint = { region: 'knee', severity: 'monitor', restrictedModalities: ['Running'] };
        expect(evaluate([monitor], squatSession)).toMatchObject({ active: false, reasonCode: 'no_active_constraints' });
        expect(evaluate([monitor], runSession)).toMatchObject({ active: false, reasonCode: 'no_active_constraints' });
        // Deliberate divergence: the frozen engine passes a monitor constraint's explicit
        // modalities through as a restriction; the flag does not count monitor at all.
        expect(resolveInjuryRestrictions([monitor], DATE).restrictedModalities).toEqual(['Running']);
    });

    it('reports the counted constraint families as an input', () => {
        const result = evaluate([kneeLimit, { region: 'shoulder', severity: 'monitor' }], squatSession);
        expect(result.inputs.find(input => input.name === 'active_constraint_families')?.value).toMatchObject({
            value: ['lower_limb_impact'], state: 'measured', observedOn: DATE,
        });
    });
});

describe('evaluateInjuryConstraintTouchesSession: region/pattern touch', () => {
    it.each([
        ['knee', 'knee_dominant_bilateral'],
        ['hamstring', 'hip_dominant_hinge'],
        ['lower_back', 'hip_dominant_hinge'],
        ['lower_back', 'trunk_tissue_capacity'],
        ['shoulder', 'upper_push'],
        ['wrist', 'upper_pull'],
    ] as const)('%s limit touches a %s step', (region, pattern) => {
        const result = evaluate([{ region, severity: 'limit' }], session([step('x', { compositionPatterns: [pattern] })]));
        expect(result).toMatchObject({ active: true, state: 'measured', reasonCode: 'pattern_touch' });
        expect(result.inputs.find(input => input.name === 'touched_patterns')?.value.value).toEqual([pattern]);
    });

    it('does not touch a session whose complete pattern evidence lies outside the cell', () => {
        expect(evaluate([kneeLimit], benchSession)).toMatchObject({ active: false, state: 'measured', reasonCode: 'no_touch' });
        expect(evaluate([{ region: 'shoulder', severity: 'exclude' }], squatSession)).toMatchObject({ active: false, reasonCode: 'no_touch' });
    });

    it('reads patterns from degraded composition, alternatives and session requirements', () => {
        const degraded = session([step('a', { compositionPatterns: ['upper_pull'], degradedComposition: { pattern: 'upper_push', reason: 'swap' } })]);
        expect(evaluate([{ region: 'shoulder', severity: 'limit' }], degraded).inputs
            .find(input => input.name === 'touched_patterns')?.value.value).toEqual(['upper_pull', 'upper_push']);

        const alternative = session([step('a', {
            compositionPatterns: ['upper_push'],
            alternatives: [{ id: 'alt', title: 'Lunge', exerciseRef: { kind: 'catalog', exerciseId: 'walking_lunge' }, compositionPatterns: ['unilateral_lower_body'] }],
        })]);
        expect(evaluate([kneeLimit], alternative).active).toBe(true);

        const required = session([step('a')], {
            movementComposition: [{ id: 'r1', pattern: 'knee_dominant_bilateral', stepIds: ['a'], status: 'required' }],
        });
        expect(evaluate([kneeLimit], required).active).toBe(true);
    });

    it('ignores rest and transition steps', () => {
        const withRest = session([step('bench_press', { compositionPatterns: ['upper_push'] }), { id: 'rest', kind: 'rest' }, { id: 't', kind: 'transition' }]);
        expect(evaluate([kneeLimit], withRest)).toMatchObject({ active: false, state: 'measured' });
    });

    it('does not let a regionless constraint touch patterns', () => {
        const regionless: InjuryConstraint = { severity: 'exclude', restrictedModalities: ['Cycling'] };
        expect(evaluate([regionless], squatSession)).toMatchObject({ active: false, state: 'measured', reasonCode: 'no_touch' });
    });
});

describe('evaluateInjuryConstraintTouchesSession: modality touch', () => {
    it('touches through explicit restrictedModalities, case-insensitively', () => {
        const constraint: InjuryConstraint = { severity: 'limit', restrictedModalities: ['Cross Training'] };
        const result = evaluate([constraint], session([], { modalities: ['cross_training'], dominantModality: undefined }));
        expect(result).toMatchObject({ active: true, state: 'measured', reasonCode: 'modality_touch' });
        expect(result.inputs.find(input => input.name === 'touched_modalities')?.value.value).toEqual(['Cross Training']);
    });

    it('reads dominantModality when modalities is absent', () => {
        const constraint: InjuryConstraint = { severity: 'limit', restrictedModalities: ['Cycling'] };
        expect(evaluate([constraint], session([], { modalities: undefined, dominantModality: 'Cycling' })).active).toBe(true);
    });

    it('touches Running for an excluded lower-limb-impact region (engine exclude restriction)', () => {
        const result = evaluate([{ region: 'achilles', severity: 'exclude' }], runSession);
        expect(result).toMatchObject({ active: true, reasonCode: 'modality_touch' });
        expect(resolveInjuryRestrictions([{ region: 'achilles', severity: 'exclude' }], DATE).restrictedModalities).toContain('Running');
    });

    it('touches the impact modalities for a limit lower-limb-impact region and an excluded lower back', () => {
        expect(evaluate([{ region: 'ankle', severity: 'limit' }], runSession).active).toBe(true);
        expect(evaluate([{ region: 'lower_back', severity: 'exclude' }], session([], { modalities: ['field'], dominantModality: 'field' })).active).toBe(true);
    });

    it('does not touch a running session for a limit lower back or an upper-limb region', () => {
        expect(evaluate([{ region: 'lower_back', severity: 'limit' }], runSession)).toMatchObject({ active: false, reasonCode: 'no_touch' });
        expect(evaluate([{ region: 'elbow', severity: 'exclude' }], runSession)).toMatchObject({ active: false, reasonCode: 'no_touch' });
    });

    it('reports both channels when a pattern and a modality touch', () => {
        const constraint: InjuryConstraint = { region: 'knee', severity: 'limit', restrictedModalities: ['Strength'] };
        expect(evaluate([constraint], squatSession).reasonCode).toBe('pattern_and_modality_touch');
    });

    it('cannot rule out a modality touch when the session records no modality', () => {
        const constraint: InjuryConstraint = { severity: 'limit', restrictedModalities: ['Running'] };
        const result = evaluate([constraint], session([], { modalities: undefined, dominantModality: undefined }));
        expect(result).toMatchObject({ active: null, state: 'not_recorded', reasonCode: 'session_modality_not_recorded' });
    });
});

describe('evaluateInjuryConstraintTouchesSession: missing pattern evidence', () => {
    const untagged = session([step('bench_press', { compositionPatterns: ['upper_push'] }), step('mystery')]);

    it('returns active null, never false, when an exercise step carries no pattern evidence', () => {
        const result = evaluate([kneeLimit], untagged);
        expect(result).toMatchObject({ active: null, state: 'not_recorded', reasonCode: 'pattern_evidence_incomplete' });
        expect(result.inputs.find(input => input.name === 'session_pattern_evidence_complete')?.value.value).toBe(false);
    });

    it('treats an empty pattern list and an untagged alternative as missing evidence', () => {
        expect(evaluate([kneeLimit], session([step('a', { compositionPatterns: [] })])).active).toBeNull();
        const untaggedAlternative = session([step('a', {
            compositionPatterns: ['upper_push'],
            alternatives: [{ id: 'alt', title: 'Free text', exerciseRef: { kind: 'unresolved_free_text', name: 'thing' } }],
        })]);
        expect(evaluate([kneeLimit], untaggedAlternative).active).toBeNull();
    });

    it('still reports a positive touch found in the evidence that is present', () => {
        const partly = session([step('front_squat', { compositionPatterns: ['knee_dominant_bilateral'] }), step('mystery')]);
        expect(evaluate([kneeLimit], partly)).toMatchObject({ active: true, state: 'measured', reasonCode: 'pattern_touch' });
    });

    it('a modality touch is still positive with incomplete pattern evidence', () => {
        const run = session([step('easy_run')], { modalities: ['running'], dominantModality: 'running' });
        expect(evaluate([{ region: 'knee', severity: 'exclude' }], run)).toMatchObject({ active: true, reasonCode: 'modality_touch' });
    });

    it('returns active null for an active constraint with neither a region nor a modality to judge it by', () => {
        const legacy: InjuryConstraint = { severity: 'limit', note: 'general' };
        expect(evaluate([legacy], squatSession)).toMatchObject({ active: null, state: 'not_recorded', reasonCode: 'unmapped_active_constraint' });
    });
});

describe('evaluateInjuryConstraintTouchesSession: no active constraints', () => {
    it('is a measured negative when the session pattern evidence is complete', () => {
        for (const constraints of [[], [{ ...kneeLimit, reviewBy: '2026-01-01' }], [{ region: 'knee', severity: 'monitor' }]] as InjuryConstraint[][]) {
            expect(evaluate(constraints, squatSession)).toMatchObject({ active: false, state: 'measured', reasonCode: 'no_active_constraints' });
        }
    });

    it('is a measured negative for a session with no exercise steps', () => {
        expect(evaluate([], runSession)).toMatchObject({ active: false, state: 'measured', reasonCode: 'no_active_constraints' });
    });

    it('is not a measured negative when the session pattern evidence is incomplete', () => {
        expect(evaluate([], session([step('mystery')]))).toMatchObject({ active: null, state: 'not_recorded', reasonCode: 'pattern_evidence_incomplete' });
    });
});
