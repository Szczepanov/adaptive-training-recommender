import type { BodyRegion, GuardrailKey, InjuryConstraint, RegionTissueResponse, SessionTemplate, TissueResponseLevel } from './models.ts';

export interface InjuryRestrictions {
    restrictedModalities: SessionTemplate['modality'][];
    impliedGuardrails: GuardrailKey[];
    restrictedCategories: SessionTemplate['category'][];
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
        if (injury.reviewBy && injury.reviewBy < today) {
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
const TISSUE_LEVEL_RANK: Record<TissueResponseLevel, number> = { normal: 0, mild: 1, moderate: 2, severe: 3 };

/** Tightens only -- never returns a less-severe value than either input. */
function moreSevere(a: InjuryConstraint['severity'], b: InjuryConstraint['severity']): InjuryConstraint['severity'] {
    return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Worst signal across a day's four tissue-response observation points, translated into
 * the InjuryConstraint severity it would justify on its own: severe -> exclude,
 * moderate -> limit, mild -> monitor, normal/no signal -> null (nothing to add).
 */
export function deriveTissueSeverity(response: RegionTissueResponse): InjuryConstraint['severity'] | null {
    const levels = [response.morningState, response.painDuringTraining, response.afterTrainingState, response.nextMorningReaction]
        .filter((level): level is TissueResponseLevel => level !== undefined);
    if (levels.length === 0) return null;
    const worst = levels.reduce((worst, level) => (TISSUE_LEVEL_RANK[level] > TISSUE_LEVEL_RANK[worst] ? level : worst));
    if (worst === 'severe') return 'exclude';
    if (worst === 'moderate') return 'limit';
    if (worst === 'mild') return 'monitor';
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
    const byRegion = new Map<BodyRegion, InjuryConstraint>();
    for (const injury of base) {
        if (!injury.region) continue;
        // Total order even if a caller somehow supplies two constraints for one region.
        const existing = byRegion.get(injury.region);
        if (!existing || SEVERITY_RANK[injury.severity] > SEVERITY_RANK[existing.severity]) {
            byRegion.set(injury.region, injury);
        }
    }

    const allRegions = new Set<BodyRegion>([...byRegion.keys(), ...(Object.keys(tissueResponses) as BodyRegion[])]);
    const merged: InjuryConstraint[] = [...regionless];

    for (const region of allRegions) {
        const injury = byRegion.get(region);
        const response = tissueResponses[region];
        const derived = response ? deriveTissueSeverity(response) : null;
        const isActive = !!injury && !(injury.reviewBy !== undefined && injury.reviewBy < today);

        if (injury && isActive && derived) {
            merged.push({ ...injury, severity: moreSevere(injury.severity, derived) });
            continue;
        }
        if (injury) {
            // Pass the base constraint through unchanged -- resolveInjuryRestrictions is
            // what actually drops an expired one; this function never resurrects it.
            merged.push(injury);
        }
        if (derived && (!injury || !isActive)) {
            // Either a brand-new region with no standing constraint, or the standing
            // constraint has lapsed and today's tissue response found a fresh problem --
            // either way this is today-only, so it gets its own bounded reviewBy rather
            // than silently persisting if this result were ever mistakenly saved.
            merged.push({ region, severity: derived, reviewBy: today, note: "Derived from today's tissue check-in" });
        }
    }

    return merged;
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
