import type { LedgerFlag } from '../../ledger/export/schema.ts';
import type { BodyRegion, InjuryConstraint, Modality } from '../../ledger/models.ts';
import type { SessionDefinition, SessionStep } from '../../sessions/models.ts';
import type { MovementCompositionPattern } from '../../sessions/movementCompositionContract.ts';
import type { FlagEvaluation } from './flagEvaluation.ts';

/*
 * D-FLAGS "active injury constraint touches the session's patterns" (ADR-0052, ADR-0013),
 * #1144 PR1-6.
 *
 * New code: the frozen engine has no such flag, and `engine/injuryPolicy.ts` is unchanged.
 * Two engine rules are duplicated here rather than imported, because nothing under derived/
 * may reach engine/ (Phase 3 deletes it): the `reviewBy` expiry rule and
 * `injuryRegionMappingFamily`. `injuryConstraintTouchesSession.test.ts` proves both copies
 * equal the engine's. The family x severity -> pattern table is new product policy, owned by
 * `policy.injury.constraint_touches_session_flag_v1` and pinned by
 * `knowledge/injuryConstraintTouchesSessionPolicyAlignment.test.ts`.
 *
 * Advisory only: the flag never blocks or re-doses a session (D-FLAGS). Pure: reads only the
 * already-fetched constraints and session definition.
 */

export const INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION = 'injury_constraint_touches_session-v1';

/** Duplicate of `engine/models.ts` `InjuryRegionMappingFamily`; derived/ may not import engine/. */
export type InjuryRegionMappingFamily = 'lower_limb_impact' | 'lower_limb_strength' | 'lumbar_loading' | 'upper_limb_loading';

/** Severities the flag counts. `monitor` is observational and never counts (owner decision Q5). */
export type CountedInjurySeverity = Exclude<InjuryConstraint['severity'], 'monitor'>;

export interface InjurySessionTouchCell {
    /** Movement-composition patterns this family/severity touches, at any dose. */
    patterns: readonly MovementCompositionPattern[];
    /** Session modalities this family/severity touches, beyond a constraint's explicit list. */
    modalities: readonly Modality[];
}

/**
 * Exact copy of the private `isActiveConstraint` in `engine/injuryPolicy.ts`: a constraint is
 * active unless its `reviewBy` date is before the evaluated date. Severity is not considered.
 */
export function isActiveInjuryConstraint(injury: InjuryConstraint, today: string): boolean {
    return injury.reviewBy === undefined || injury.reviewBy >= today;
}

/** Exact copy of `engine/injuryPolicy.ts` `injuryRegionMappingFamily`. */
export function injuryRegionMappingFamily(region: BodyRegion): InjuryRegionMappingFamily {
    switch (region) {
        case 'knee':
        case 'achilles':
        case 'ankle':
        case 'calf':
            return 'lower_limb_impact';
        case 'hamstring':
        case 'quadriceps':
        case 'adductor_groin':
        case 'hip':
            return 'lower_limb_strength';
        case 'lower_back':
            return 'lumbar_loading';
        case 'shoulder':
        case 'elbow':
        case 'wrist':
            return 'upper_limb_loading';
    }
}

const LOWER_BODY_PATTERNS: readonly MovementCompositionPattern[] = ['knee_dominant_bilateral', 'hip_dominant_hinge', 'unilateral_lower_body'];
/** Every Running and Field template carries `avoid_high_impact` and `avoid_heavy_lower_body`. */
const IMPACT_MODALITIES: readonly Modality[] = ['Running', 'Field'];

/**
 * Family x counted severity -> what the constraint touches. Proposed for owner approval
 * (#1164); the PR description gives each cell's engine precedent. Patterns are dose-blind:
 * a session's composition evidence carries no load, so a pattern the engine restricts only
 * when heavy still touches.
 */
export const INJURY_SESSION_TOUCH_TABLE: Readonly<Record<InjuryRegionMappingFamily, Readonly<Record<CountedInjurySeverity, InjurySessionTouchCell>>>> = {
    lower_limb_impact: {
        limit: { patterns: ['knee_dominant_bilateral', 'unilateral_lower_body'], modalities: IMPACT_MODALITIES },
        exclude: { patterns: ['knee_dominant_bilateral', 'unilateral_lower_body'], modalities: IMPACT_MODALITIES },
    },
    lower_limb_strength: {
        limit: { patterns: LOWER_BODY_PATTERNS, modalities: IMPACT_MODALITIES },
        exclude: { patterns: LOWER_BODY_PATTERNS, modalities: IMPACT_MODALITIES },
    },
    lumbar_loading: {
        limit: { patterns: [...LOWER_BODY_PATTERNS, 'trunk_tissue_capacity'], modalities: [] },
        exclude: { patterns: [...LOWER_BODY_PATTERNS, 'trunk_tissue_capacity'], modalities: IMPACT_MODALITIES },
    },
    // The overhead-pressing guardrail also blocks str_lower_01 (squats, deadlifts) and the
    // full-body templates: bar-on-back and grip loading. Authored-session profiling is narrower
    // (vertical_push only); the cell follows the broader template behaviour.
    upper_limb_loading: {
        limit: { patterns: ['upper_push', 'upper_pull', 'knee_dominant_bilateral', 'hip_dominant_hinge'], modalities: [] },
        exclude: { patterns: ['upper_push', 'upper_pull', 'knee_dominant_bilateral', 'hip_dominant_hinge'], modalities: [] },
    },
};

const CONSTRAINTS_SOURCE = 'training_settings.injuries';
const SESSION_SOURCE = 'session_definition';

function describeTable(): string {
    return Object.entries(INJURY_SESSION_TOUCH_TABLE)
        .flatMap(([family, cells]) => Object.entries(cells).map(([severity, cell]) =>
            `${family}/${severity}: patterns ${cell.patterns.join('+')}; modalities ${cell.modalities.join('+') || 'none'}`))
        .join('. ');
}

const THRESHOLD = 'Active when an active (reviewBy absent or on/after the date) limit or exclude injury constraint '
    + 'touches the session: its region family x severity pattern set meets a pattern of an exercise step, alternative '
    + 'or composition requirement, or its explicit restrictedModalities or family modalities meet the session modalities '
    + `or dominant modality. monitor never counts. ${describeTable()}. Pattern evidence is a step or alternative's own `
    + 'non-empty compositionPatterns; a degradedComposition names a pattern that is not delivered and leaves that evidence '
    + 'incomplete, relaxed composition requirements are ignored, and a required one may add a touch but is not evidence. '
    + 'Not active requires complete pattern evidence only when the counted constraints reach at least one pattern, and a '
    + 'recorded session modality when one restricts a modality; otherwise active is null (ADR-0013, ADR-0052 D-FLAGS)';

interface SessionPatternEvidence {
    patterns: ReadonlySet<MovementCompositionPattern>;
    complete: boolean;
}

/** Own evidence of a step or alternative: only a non-empty `compositionPatterns` without a
 * declared degradation. A `degradedComposition.pattern` is the component it does NOT deliver. */
function ownEvidence(item: Pick<SessionStep, 'compositionPatterns' | 'degradedComposition'>): { patterns: MovementCompositionPattern[]; complete: boolean } {
    const patterns = item.compositionPatterns ?? [];
    return { patterns, complete: patterns.length > 0 && item.degradedComposition === undefined };
}

/** Structured composition evidence only, never inferred from titles. Empty or absent is unknown. */
function sessionPatternEvidence(session: SessionDefinition): SessionPatternEvidence {
    // Only `required` requirements: `relaxed` means no listed step carries structured evidence.
    // A required one adds a touch candidate for its steps but never completes their evidence.
    const required = new Map<string, MovementCompositionPattern[]>();
    for (const requirement of session.movementComposition ?? []) {
        if (requirement.status !== 'required') continue;
        for (const stepId of requirement.stepIds) required.set(stepId, [...(required.get(stepId) ?? []), requirement.pattern]);
    }
    const patterns = new Set<MovementCompositionPattern>();
    let complete = true;
    const exerciseSteps = session.blocks.flatMap(block => block.steps).filter(step => step.kind === 'exercise');
    for (const step of exerciseSteps) {
        for (const item of [step, ...(step.alternatives ?? [])]) {
            const evidence = ownEvidence(item);
            if (!evidence.complete) complete = false;
            evidence.patterns.forEach(pattern => patterns.add(pattern));
        }
        (required.get(step.id) ?? []).forEach(pattern => patterns.add(pattern));
    }
    return { patterns, complete };
}

function normalizeModality(modality: string): string {
    return modality.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function sessionModalities(session: SessionDefinition): ReadonlySet<string> {
    return new Set([...(session.modalities ?? []), ...(session.dominantModality ? [session.dominantModality] : [])]
        .filter(modality => modality.trim().length > 0)
        .map(normalizeModality));
}

interface ConstraintReach {
    family: InjuryRegionMappingFamily | null;
    patterns: readonly MovementCompositionPattern[];
    modalities: readonly Modality[];
}

function reachOf(constraint: InjuryConstraint & { severity: CountedInjurySeverity }): ConstraintReach {
    const family = constraint.region ? injuryRegionMappingFamily(constraint.region) : null;
    const cell = family ? INJURY_SESSION_TOUCH_TABLE[family][constraint.severity] : null;
    return {
        family,
        patterns: cell?.patterns ?? [],
        modalities: [...new Set([...(constraint.restrictedModalities ?? []), ...(cell?.modalities ?? [])])],
    };
}

function isCounted(constraint: InjuryConstraint, date: string): constraint is InjuryConstraint & { severity: CountedInjurySeverity } {
    return constraint.severity !== 'monitor' && isActiveInjuryConstraint(constraint, date);
}

function missing(reasonCode: string, constraintsInput: LedgerFlag['inputs'][number]['value']): FlagEvaluation {
    return {
        id: 'injury_constraint_touches_session',
        active: null,
        state: 'missing',
        reasonCode,
        definitionVersion: INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION,
        inputs: [
            { name: 'active_constraint_families', value: constraintsInput },
            { name: 'session_pattern_evidence_complete', value: { value: null, source: SESSION_SOURCE, state: 'missing' } },
        ],
        threshold: THRESHOLD,
    };
}

function countedFamilies(constraints: readonly InjuryConstraint[], date: string): InjuryRegionMappingFamily[] {
    return sorted(constraints.filter(constraint => isCounted(constraint, date)).flatMap(constraint =>
        constraint.region ? [injuryRegionMappingFamily(constraint.region)] : []));
}

function sorted<T extends string>(values: Iterable<T>): T[] {
    return [...new Set(values)].sort();
}

/**
 * Pure. Evaluates `injury_constraint_touches_session` for one date and one session.
 *
 * - No constraints record or no session: `active: null`, state `missing`.
 * - Any counted constraint touches a pattern or modality the session records: `active: true`,
 *   even when other evidence is incomplete, because positive evidence is measured.
 * - Otherwise `active: false` only when (a) every exercise step and alternative carries its own
 *   pattern evidence, whenever the counted constraints reach at least one pattern; (b) the
 *   session records a modality whenever a counted constraint restricts one; and (c) every
 *   counted constraint has a region or a modality to judge it by. Anything less is
 *   `active: null`, state `not_recorded`: missing evidence is never read as a negative. With no
 *   reachable pattern (no counted constraints, or modality-only ones) pattern completeness
 *   cannot change the answer, so it is not required; the evidence input still records it.
 */
export function evaluateInjuryConstraintTouchesSession(
    constraints: readonly InjuryConstraint[] | null | undefined,
    date: string,
    session: SessionDefinition | null | undefined,
): FlagEvaluation {
    if (constraints === null || constraints === undefined) {
        return missing('no_constraints_record', { value: null, source: CONSTRAINTS_SOURCE, state: 'missing' });
    }
    if (session === null || session === undefined) {
        return missing('no_session', { value: countedFamilies(constraints, date), source: CONSTRAINTS_SOURCE, state: 'measured', observedOn: date });
    }

    const reaches = constraints.filter(constraint => isCounted(constraint, date)).map(reachOf);
    const evidence = sessionPatternEvidence(session);
    const modalities = sessionModalities(session);
    const touchedPatterns = sorted(reaches.flatMap(reach => reach.patterns).filter(pattern => evidence.patterns.has(pattern)));
    const touchedModalities = sorted(reaches.flatMap(reach => reach.modalities).filter(modality => modalities.has(normalizeModality(modality))));
    const modalityNeeded = reaches.some(reach => reach.modalities.length > 0);
    // Pattern completeness matters only when some counted constraint can reach a pattern.
    const patternNeeded = reaches.some(reach => reach.patterns.length > 0);
    const unmapped = reaches.some(reach => reach.family === null && reach.modalities.length === 0);

    const observedOn = { observedOn: date };
    const inputs: LedgerFlag['inputs'] = [
        { name: 'active_constraint_families', value: { value: countedFamilies(constraints, date), source: CONSTRAINTS_SOURCE, state: 'measured', ...observedOn } },
        { name: 'touched_patterns', value: { value: touchedPatterns, source: SESSION_SOURCE, state: 'measured', ...observedOn } },
        {
            name: 'touched_modalities',
            value: modalities.size > 0 || !modalityNeeded
                ? { value: touchedModalities, source: SESSION_SOURCE, state: 'measured', ...observedOn }
                : { value: null, source: SESSION_SOURCE, state: 'not_recorded', ...observedOn },
        },
        { name: 'session_pattern_evidence_complete', value: { value: evidence.complete, source: SESSION_SOURCE, state: 'measured', ...observedOn } },
    ];
    const base = {
        id: 'injury_constraint_touches_session' as const,
        definitionVersion: INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION,
        inputs,
        threshold: THRESHOLD,
    };

    if (touchedPatterns.length > 0 || touchedModalities.length > 0) {
        const reasonCode = touchedPatterns.length > 0 && touchedModalities.length > 0
            ? 'pattern_and_modality_touch'
            : touchedPatterns.length > 0 ? 'pattern_touch' : 'modality_touch';
        return { ...base, active: true, state: 'measured', reasonCode };
    }
    const unjudged = patternNeeded && !evidence.complete
        ? 'pattern_evidence_incomplete'
        : modalityNeeded && modalities.size === 0
            ? 'session_modality_not_recorded'
            : unmapped ? 'unmapped_active_constraint' : null;
    if (unjudged !== null) return { ...base, active: null, state: 'not_recorded', reasonCode: unjudged };
    return { ...base, active: false, state: 'measured', reasonCode: reaches.length === 0 ? 'no_active_constraints' : 'no_touch' };
}
