import { SHADOW_VERDICTS, type ShadowVerdict } from './models';

/**
 * Phase 9.0.4: classifies a day's engine verdict against the athlete's own (external)
 * verdict, both in `ShadowVerdict` vocabulary. Pure and deterministic on purpose -- the
 * 9.0.8 readout must not depend on how a reviewer eyeballed the export table.
 */
export type AgreementClass =
    | 'agree'
    | 'engine_more_conservative'
    | 'engine_less_conservative'
    | 'incomparable';

/**
 * Resolve the exact action the engine communicated in the shared shadow vocabulary.
 * Imported-session adjudication wins when present: an event can be `advisory` while the
 * surrounding ranked recommendation is `train`, and a feasibility exclusion can be
 * `skip` while the fallback recommendation itself is train/recover. Falling back to mode
 * is correct only when no imported-session verdict exists.
 */
export function resolveEngineShadowVerdict(
    mode: 'train' | 'modify' | 'recover',
    externalDecision?: ShadowVerdict | null,
): ShadowVerdict {
    if (externalDecision) return externalDecision;
    if (mode === 'train') return 'proceed';
    if (mode === 'modify') return 'scale';
    return 'defer';
}

/**
 * Conservatism ladder: `proceed` > `scale` > `defer` ≈ `skip`. `defer` and `skip` are
 * equally conservative *about today* -- they differ in what happens to the session
 * afterward, which is a placement question, not a load question, so they classify as
 * `agree` against each other. Lower rank = more conservative.
 */
const CONSERVATISM_RANK: Partial<Record<ShadowVerdict, number>> = {
    proceed: 3,
    scale: 2,
    defer: 1,
    skip: 1,
};

/**
 * `advisory` sits outside the ladder entirely (D-EVENT makes it a non-instruction), so any
 * pair involving it is `incomparable` rather than being forced onto a scale it was never on.
 */
export function classifyAgreement(engine: ShadowVerdict, external: ShadowVerdict): AgreementClass {
    const engineRank = CONSERVATISM_RANK[engine];
    const externalRank = CONSERVATISM_RANK[external];
    if (engineRank === undefined || externalRank === undefined) return 'incomparable';
    if (engineRank === externalRank) return 'agree';
    return engineRank < externalRank ? 'engine_more_conservative' : 'engine_less_conservative';
}

/** Every ordered pair of the five `ShadowVerdict` values, for exhaustive test coverage. */
export function allShadowVerdictPairs(): Array<[ShadowVerdict, ShadowVerdict]> {
    const pairs: Array<[ShadowVerdict, ShadowVerdict]> = [];
    for (const engine of SHADOW_VERDICTS) {
        for (const external of SHADOW_VERDICTS) {
            pairs.push([engine, external]);
        }
    }
    return pairs;
}
