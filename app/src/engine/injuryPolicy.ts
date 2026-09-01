import type { BodyRegion, GuardrailKey, InjuryConstraint, InjuryPolicyTrace, InjuryRegionMappingFamily, RegionTissueResponse, SessionTemplate, TissueResponseLevel } from './models.ts';

export interface InjuryRestrictions {
    restrictedModalities: SessionTemplate['modality'][];
    impliedGuardrails: GuardrailKey[];
    restrictedCategories: SessionTemplate['category'][];
}

export interface ResolvedInjuryPolicy {
    effectiveInjuries: InjuryConstraint[];
    restrictions: InjuryRestrictions;
    trace: InjuryPolicyTrace;
}

function isActiveConstraint(injury: InjuryConstraint, today: string): boolean {
    return injury.reviewBy === undefined || injury.reviewBy >= today;
}

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

/**
 * Pure resolver mapping structured InjuryConstraint[] into exact engine restrictions.
 * Expired injuries (reviewBy < today) are ignored.
 */
export function resolveInjuryRestrictions(
    injuries: InjuryConstraint[] | undefined,
    today: string
): InjuryRestrictions {
    if (!injuries || injuries.length === 0) {
        return {
            restrictedModalities: [],
            impliedGuardrails: [],
            restrictedCategories: [],
        };
    }

    const modalitiesSet = new Set<SessionTemplate['modality']>();
    const guardrailsSet = new Set<GuardrailKey>();
    const categoriesSet = new Set<SessionTemplate['category']>();

    for (const injury of injuries) {
        // Skip expired injuries
        if (!isActiveConstraint(injury, today)) {
            continue;
        }

        // Apply explicit restricted modalities if specified on constraint
        if (injury.restrictedModalities && injury.restrictedModalities.length > 0) {
            for (const mod of injury.restrictedModalities) {
                modalitiesSet.add(mod);
            }
        }

        if (injury.severity === 'monitor') {
            continue;
        }

        const region: BodyRegion | undefined = injury.region;
        const isExclude = injury.severity === 'exclude';

        if (region) {
            switch (region) {
                case 'knee':
                case 'achilles':
                case 'ankle':
                case 'calf':
                    guardrailsSet.add('avoid_high_impact');
                    if (isExclude) {
                        modalitiesSet.add('Running');
                    }
                    break;

                case 'hamstring':
                case 'quadriceps':
                case 'adductor_groin':
                case 'hip':
                    guardrailsSet.add('avoid_heavy_lower_body');
                    if (isExclude) {
                        categoriesSet.add('Lower-body Strength');
                        categoriesSet.add('Full-body Strength');
                    }
                    break;

                case 'lower_back':
                    guardrailsSet.add('avoid_heavy_spinal_loading');
                    if (isExclude) {
                        guardrailsSet.add('avoid_heavy_lower_body');
                        guardrailsSet.add('avoid_high_impact');
                    }
                    break;

                case 'shoulder':
                case 'elbow':
                case 'wrist':
                    guardrailsSet.add('avoid_overhead_pressing');
                    if (isExclude) {
                        categoriesSet.add('Upper-body Strength');
                    }
                    break;
            }
        }
    }

    return {
        restrictedModalities: Array.from(modalitiesSet),
        impliedGuardrails: Array.from(guardrailsSet),
        restrictedCategories: Array.from(categoriesSet),
    };
}

const SEVERITY_RANK: Record<InjuryConstraint['severity'], number> = { monitor: 0, limit: 1, exclude: 2 };

/** Tightens only -- never returns a less-severe value than either input. */
function moreSevere(a: InjuryConstraint['severity'], b: InjuryConstraint['severity']): InjuryConstraint['severity'] {
    return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Evaluates today's tissue-response observations with 24-hour response latency:
 * 1. Severe at any point (morning, during, post, or next morning) -> 'exclude'.
 * 2. Persistent post-session or next-morning irritability (or waking morningState) at moderate -> 'limit'.
 * 3. Transient during-session loading discomfort (painDuringTraining === 'moderate') that
 *    settles post-session and next morning (normal/mild) -> 'monitor' (tolerable load response,
 *    Escriche-Escuder 2020).
 * 4. Mild at any point -> 'monitor'.
 * 5. Normal or absent -> null.
 */
export function deriveTissueSeverity(response: RegionTissueResponse): InjuryConstraint['severity'] | null {
    const { morningState, painDuringTraining, afterTrainingState, nextMorningReaction } = response;
    const levels = [morningState, painDuringTraining, afterTrainingState, nextMorningReaction]
        .filter((level): level is TissueResponseLevel => level !== undefined);
    if (levels.length === 0) return null;

    // Any severe signal is an acute red-flag/exclusion boundary
    if (levels.some((level) => level === 'severe')) {
        return 'exclude';
    }

    // Persistent or delayed moderate irritability: waking morningState, post-exercise, or next morning
    if (morningState === 'moderate' || afterTrainingState === 'moderate' || nextMorningReaction === 'moderate') {
        return 'limit';
    }

    // Transient during-session moderate discomfort that settled (post-training and next morning are normal/mild)
    if (painDuringTraining === 'moderate') {
        return 'monitor';
    }

    // Mild signal at any point
    if (levels.some((level) => level === 'mild')) {
        return 'monitor';
    }

    return null;
}

/**
 * Merges today's observed per-region tissue response into the athlete's standing
 * InjuryConstraint[]. Per docs/plans/phase-5-sequence-planning.md 5.4, this is
 * PRESERVE-OR-TIGHTEN ONLY:
 *
 *   InjuryConstraint (hard) -> observed tissue response (may tighten) -> ...
 *
 * An active exclude/limit constraint is never weakened or cleared by a good day's tissue
 * response (a green knee reading does not unlock running while an exclude knee
 * constraint stands -- only editing the constraint does that). The result is a read-time
 * value for a single day's decision; the caller must never persist it back as
 * TrainingSettings.injuries.
 */
export function resolveEffectiveInjuryConstraints(
    baseInjuries: InjuryConstraint[] | undefined,
    tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    today: string
): InjuryConstraint[] {
    const base = baseInjuries ?? [];
    if (!tissueResponses || Object.keys(tissueResponses).length === 0) return base;

    const regionless = base.filter(injury => !injury.region);
    // Every same-region base constraint is kept -- a region can legitimately carry more
    // than one (e.g. a general limit plus a modality-specific exclude), each with its own
    // restrictedModalities. Incorrectly collapsing to a single "worst" constraint would silently drop
    // the others' restrictedModalities.
    const byRegion = new Map<BodyRegion, InjuryConstraint[]>();
    for (const injury of base) {
        if (!injury.region) continue;
        const existing = byRegion.get(injury.region);
        if (existing) existing.push(injury);
        else byRegion.set(injury.region, [injury]);
    }

    const allRegions = new Set<BodyRegion>([...byRegion.keys(), ...(Object.keys(tissueResponses) as BodyRegion[])]);
    const merged: InjuryConstraint[] = [...regionless];

    for (const region of allRegions) {
        const injuriesForRegion = byRegion.get(region) ?? [];
        const response = tissueResponses[region];
        const derived = response ? deriveTissueSeverity(response) : null;

        let anyActive = false;
        for (const injury of injuriesForRegion) {
            const isActive = !(injury.reviewBy !== undefined && injury.reviewBy < today);
            if (isActive) anyActive = true;
            if (isActive && derived) {
                // Tighten this constraint's severity -- restrictedModalities and every
                // other field pass through unchanged.
                merged.push({ ...injury, severity: moreSevere(injury.severity, derived) });
            } else {
                // Pass the base constraint through unchanged -- resolveInjuryRestrictions is
                // what actually drops an expired one; this function never resurrects it.
                merged.push(injury);
            }
        }
        if (derived && !anyActive) {
            // Either a brand-new region with no standing constraint, or every standing
            // constraint for it has lapsed and today's tissue response found a fresh
            // problem -- either way this is today-only, so it gets its own bounded
            // reviewBy rather than silently persisting if this result were ever mistakenly
            // saved.
            merged.push({ region, severity: derived, reviewBy: today, note: "Derived from today's tissue check-in" });
        }
    }

    return merged;
}

/** True only when today's tissue input creates a new effective constraint or tightens an
 * active one. A normal response and a response no worse than every active constraint are
 * intentionally absent from lineage because they do not change the composed policy state. */
function tissueSeverityMateriallyApplied(
    baseInjuries: InjuryConstraint[] | undefined,
    tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    today: string,
): boolean {
    if (!tissueResponses) return false;
    const base = baseInjuries ?? [];
    return Object.values(tissueResponses).some(response => {
        if (!response) return false;
        const derived = deriveTissueSeverity(response);
        if (!derived) return false;
        const activeForRegion = base.filter(injury => injury.region === response.region && isActiveConstraint(injury, today));
        return activeForRegion.length === 0 || activeForRegion.some(injury => SEVERITY_RANK[injury.severity] < SEVERITY_RANK[derived]);
    });
}

/**
 * Resolves the existing injury policy with compact lineage facts. The restrictions and
 * effective constraints are exactly those returned by the pre-existing public resolvers;
 * trace facts are observational and must never influence the policy calculation.
 */
export function resolveInjuryPolicy(
    baseInjuries: InjuryConstraint[] | undefined,
    tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    today: string,
): ResolvedInjuryPolicy {
    const effectiveInjuries = resolveEffectiveInjuryConstraints(baseInjuries, tissueResponses, today);
    const restrictions = resolveInjuryRestrictions(effectiveInjuries, today);
    const regionMappingFamilies = [...new Set(
        effectiveInjuries
            .filter(injury => Boolean(injury.region) && injury.severity !== 'monitor' && isActiveConstraint(injury, today))
            .map(injury => injuryRegionMappingFamily(injury.region!)),
    )].sort() as InjuryRegionMappingFamily[];
    return {
        effectiveInjuries,
        restrictions,
        trace: {
            tissueSeverityApplied: tissueSeverityMateriallyApplied(baseInjuries, tissueResponses, today),
            regionMappingFamilies,
            clinicalEnvelopeSources: [],
        },
    };
}

/**
 * One-way legacy injury string array migration to structured InjuryConstraint[].
 */
export function migrateLegacyInjuries(injuries: string[]): InjuryConstraint[] {
    const migrated: InjuryConstraint[] = [];

    for (const raw of injuries) {
        const lower = raw.trim().toLowerCase();
        if (!lower) continue;

        if (lower.includes('knee')) {
            migrated.push({ region: 'knee', severity: 'limit', note: raw });
        } else if (lower.includes('achilles')) {
            migrated.push({ region: 'achilles', severity: 'limit', note: raw });
        } else if (lower.includes('ankle')) {
            migrated.push({ region: 'ankle', severity: 'limit', note: raw });
        } else if (lower.includes('leg')) {
            migrated.push({
                region: 'hamstring',
                severity: 'limit',
                restrictedModalities: ['Running'],
                note: raw,
            });
        } else if (lower.includes('run')) {
            migrated.push({
                severity: 'limit',
                restrictedModalities: ['Running'],
                note: raw,
            });
        } else {
            // General string fallback
            migrated.push({
                severity: 'limit',
                note: raw,
            });
        }
    }

    return migrated;
}
