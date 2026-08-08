import type { BodyRegion, GuardrailKey, InjuryConstraint, SessionTemplate } from './models.ts';

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
