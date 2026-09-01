import { describe, expect, it } from 'vitest';
import type {
    BodyRegion,
    DailyReadiness,
    DailySubjectiveCheckin,
    GuardrailKey,
    InjuryConstraint,
    RegionTissueResponse,
    SessionTemplate,
    TissueResponseLevel,
    UserContext,
} from './models';
import { resolveClinicalEnvelopeSources } from './adapters';
import { resolveInjuryPolicy } from './injuryPolicy';
import { evaluateEnvelopes, evaluateTraining } from './rules';

const TODAY = '2026-09-01';
const REGIONS: readonly BodyRegion[] = [
    'knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps',
    'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist',
];
const SEVERITIES: readonly InjuryConstraint['severity'][] = ['monitor', 'limit', 'exclude'];
const TISSUE_SIGNALS: readonly (keyof Pick<RegionTissueResponse, 'morningState' | 'painDuringTraining' | 'afterTrainingState' | 'nextMorningReaction'>)[] = [
    'morningState', 'painDuringTraining', 'afterTrainingState', 'nextMorningReaction',
];
const TISSUE_LEVELS: readonly TissueResponseLevel[] = ['normal', 'mild', 'moderate', 'severe'];

interface LegacyInjuryRestrictions {
    restrictedModalities: SessionTemplate['modality'][];
    impliedGuardrails: GuardrailKey[];
    restrictedCategories: SessionTemplate['category'][];
}

const LEGACY_SEVERITY_RANK: Record<InjuryConstraint['severity'], number> = { monitor: 0, limit: 1, exclude: 2 };

/** Frozen pre-SEP-B oracle copied from the behavior-owning implementation before lineage was added.
 * Do not refactor this helper to call production injury resolvers: its independence is the proof. */
function legacyResolveInjuryRestrictions(
    injuries: InjuryConstraint[] | undefined,
    today: string,
): LegacyInjuryRestrictions {
    if (!injuries || injuries.length === 0) {
        return { restrictedModalities: [], impliedGuardrails: [], restrictedCategories: [] };
    }

    const modalitiesSet = new Set<SessionTemplate['modality']>();
    const guardrailsSet = new Set<GuardrailKey>();
    const categoriesSet = new Set<SessionTemplate['category']>();

    for (const injury of injuries) {
        if (injury.reviewBy !== undefined && injury.reviewBy < today) continue;

        for (const modality of injury.restrictedModalities ?? []) modalitiesSet.add(modality);
        if (injury.severity === 'monitor') continue;

        const isExclude = injury.severity === 'exclude';
        switch (injury.region) {
            case 'knee':
            case 'achilles':
            case 'ankle':
            case 'calf':
                guardrailsSet.add('avoid_high_impact');
                if (isExclude) modalitiesSet.add('Running');
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
                if (isExclude) categoriesSet.add('Upper-body Strength');
                break;
            case undefined:
                break;
        }
    }

    return {
        restrictedModalities: Array.from(modalitiesSet),
        impliedGuardrails: Array.from(guardrailsSet),
        restrictedCategories: Array.from(categoriesSet),
    };
}

function legacyDeriveTissueSeverity(response: RegionTissueResponse): InjuryConstraint['severity'] | null {
    const { morningState, painDuringTraining, afterTrainingState, nextMorningReaction } = response;
    const levels = [morningState, painDuringTraining, afterTrainingState, nextMorningReaction]
        .filter((level): level is TissueResponseLevel => level !== undefined);
    if (levels.length === 0) return null;

    if (levels.some((level) => level === 'severe')) return 'exclude';
    if (morningState === 'moderate' || afterTrainingState === 'moderate' || nextMorningReaction === 'moderate') return 'limit';
    if (painDuringTraining === 'moderate') return 'monitor';
    if (levels.some((level) => level === 'mild')) return 'monitor';
    return null;
}

function legacyMoreSevere(
    a: InjuryConstraint['severity'],
    b: InjuryConstraint['severity'],
): InjuryConstraint['severity'] {
    return LEGACY_SEVERITY_RANK[a] >= LEGACY_SEVERITY_RANK[b] ? a : b;
}

/** Frozen pre-SEP-B effective-constraint composition oracle. */
function legacyResolveEffectiveInjuryConstraints(
    baseInjuries: InjuryConstraint[] | undefined,
    tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    today: string,
): InjuryConstraint[] {
    const base = baseInjuries ?? [];
    if (!tissueResponses || Object.keys(tissueResponses).length === 0) return base;

    const regionless = base.filter(injury => !injury.region);
    const byRegion = new Map<BodyRegion, InjuryConstraint[]>();
    for (const injury of base) {
        if (!injury.region) continue;
        const existing = byRegion.get(injury.region);
        if (existing) existing.push(injury);
        else byRegion.set(injury.region, [injury]);
    }

    const allRegions = new Set<BodyRegion>([
        ...byRegion.keys(),
        ...(Object.keys(tissueResponses) as BodyRegion[]),
    ]);
    const merged: InjuryConstraint[] = [...regionless];

    for (const region of allRegions) {
        const injuriesForRegion = byRegion.get(region) ?? [];
        const response = tissueResponses[region];
        const derived = response ? legacyDeriveTissueSeverity(response) : null;

        let anyActive = false;
        for (const injury of injuriesForRegion) {
            const isActive = !(injury.reviewBy !== undefined && injury.reviewBy < today);
            if (isActive) anyActive = true;
            if (isActive && derived) {
                merged.push({ ...injury, severity: legacyMoreSevere(injury.severity, derived) });
            } else {
                merged.push(injury);
            }
        }
        if (derived && !anyActive) {
            merged.push({ region, severity: derived, reviewBy: today, note: "Derived from today's tissue check-in" });
        }
    }

    return merged;
}

const readiness: DailyReadiness = {
    subjective: {
        readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
    },
    objective: {
        total_steps: null, sleep_score: null, sleep_duration_min: null, rhr: null, rhr_7d_avg: null,
        rhr_delta: null, hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null, respiration: null,
        body_battery_wake: null, last_3_days_hard_sessions_count: 0, yesterday_training: null,
        today_training: null, sleep_score_delta_7d: null, rhr_delta_28d: null, hrv_delta_28d: null,
        sleep_score_delta_28d: null, hrv_stdev_28d: null, rhr_stdev_28d: null, sleep_score_stdev_28d: null,
    },
};

function contextFromPolicy(policy: ReturnType<typeof resolveInjuryPolicy>): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: true, hasIndoorBike: true,
            ...policy.restrictions, maxTimeMinutes: 180,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        injuryPolicyTrace: policy.trace,
    };
}

function decisionSurface(rec: ReturnType<typeof evaluateTraining>) {
    const surface = { ...rec };
    delete surface.knowledgeRefs;
    return surface;
}

function checkin(overrides: Partial<DailySubjectiveCheckin>): DailySubjectiveCheckin {
    return overrides as DailySubjectiveCheckin;
}

describe('injury-policy lineage equivalence', () => {
    it('matches the frozen pre-SEP-B restriction oracle across every region, severity, and expiry state', () => {
        for (const region of REGIONS) {
            for (const severity of SEVERITIES) {
                for (const reviewBy of [undefined, TODAY, '2026-08-31'] as const) {
                    const injuries: InjuryConstraint[] = [{ region, severity, reviewBy }];
                    const resolved = resolveInjuryPolicy(injuries, undefined, TODAY);
                    expect(resolved.effectiveInjuries).toEqual(injuries);
                    expect(resolved.restrictions).toEqual(legacyResolveInjuryRestrictions(injuries, TODAY));
                }
            }
        }
    });

    it('matches the frozen pre-SEP-B tissue-composition oracle for every signal, level, region, and standing severity', () => {
        for (const region of REGIONS) {
            for (const signal of TISSUE_SIGNALS) {
                for (const level of TISSUE_LEVELS) {
                    const response = { region, morningState: 'normal', [signal]: level } as RegionTissueResponse;
                    for (const standingSeverity of [undefined, ...SEVERITIES] as const) {
                        const injuries = standingSeverity === undefined
                            ? undefined
                            : [{ region, severity: standingSeverity }] satisfies InjuryConstraint[];
                        const responses = { [region]: response } as Partial<Record<BodyRegion, RegionTissueResponse>>;
                        const legacyEffective = legacyResolveEffectiveInjuryConstraints(injuries, responses, TODAY);
                        const resolved = resolveInjuryPolicy(injuries, responses, TODAY);
                        expect(resolved.effectiveInjuries).toEqual(legacyEffective);
                        expect(resolved.restrictions).toEqual(legacyResolveInjuryRestrictions(legacyEffective, TODAY));
                    }
                }
            }
        }
    });

    it('matches the frozen oracle for multi-constraint pass-through, regionless restrictions, and expired-plus-fresh tissue state', () => {
        const injuries: InjuryConstraint[] = [
            { region: 'knee', severity: 'exclude', reviewBy: '2026-08-31', restrictedModalities: ['Cycling'] },
            { region: 'shoulder', severity: 'monitor', restrictedModalities: ['Running'] },
            { region: 'shoulder', severity: 'limit' },
            { severity: 'limit', restrictedModalities: ['Cycling'] },
        ];
        const responses = {
            knee: { region: 'knee' as const, morningState: 'moderate' as const },
            shoulder: { region: 'shoulder' as const, morningState: 'normal' as const, nextMorningReaction: 'severe' as const },
        };
        const legacyEffective = legacyResolveEffectiveInjuryConstraints(injuries, responses, TODAY);
        const resolved = resolveInjuryPolicy(injuries, responses, TODAY);
        expect(resolved.effectiveInjuries).toEqual(legacyEffective);
        expect(resolved.restrictions).toEqual(legacyResolveInjuryRestrictions(legacyEffective, TODAY));
    });

    it('keeps the refactored clinical flag identical to the frozen pre-SEP-B boolean semantics', () => {
        const cases: Array<{ input: DailySubjectiveCheckin | undefined; expected: boolean; sources: string[] }> = [
            { input: undefined, expected: false, sources: [] },
            { input: checkin({ painOrInjury: false, illnessSymptoms: false }), expected: false, sources: [] },
            { input: checkin({ painOrInjury: true, illnessSymptoms: false }), expected: true, sources: ['pain_or_injury'] },
            { input: checkin({ painOrInjury: false, illnessSymptoms: true }), expected: true, sources: ['non_allergy_illness'] },
            {
                input: checkin({ painOrInjury: false, illnessSymptoms: true, healthContext: { symptoms: { present: true, suspectedCause: 'allergy', severity: 'mild', types: ['congestion', 'sneezing'] } } }),
                expected: false,
                sources: [],
            },
            {
                input: checkin({ painOrInjury: false, illnessSymptoms: true, healthContext: { symptoms: { present: true, suspectedCause: 'allergy', severity: 'severe', types: ['congestion'] } } }),
                expected: true,
                sources: ['non_allergy_illness'],
            },
            {
                input: checkin({ painOrInjury: false, illnessSymptoms: true, healthContext: { symptoms: { present: true, suspectedCause: 'allergy', severity: 'moderate', types: ['cough'] } } }),
                expected: true,
                sources: ['non_allergy_illness'],
            },
            {
                input: checkin({ painOrInjury: true, illnessSymptoms: true, healthContext: { symptoms: { present: true, suspectedCause: 'allergy', severity: 'mild', types: ['runny_nose'] } } }),
                expected: true,
                sources: ['pain_or_injury'],
            },
        ];

        for (const testCase of cases) {
            const sources = resolveClinicalEnvelopeSources(testCase.input);
            expect(sources).toEqual(testCase.sources);
            expect(sources.length > 0).toBe(testCase.expected);
        }
    });

    it('changes only knowledge lineage, never envelope or selected recommendation', () => {
        const policy = resolveInjuryPolicy([{ region: 'knee', severity: 'exclude' }], undefined, TODAY);
        const tracedContext = contextFromPolicy(policy);
        const untracedContext = { ...tracedContext, injuryPolicyTrace: undefined };

        expect(evaluateEnvelopes(readiness, tracedContext)).toEqual(evaluateEnvelopes(readiness, untracedContext));
        expect(decisionSurface(evaluateTraining(readiness, tracedContext, TODAY)))
            .toEqual(decisionSurface(evaluateTraining(readiness, untracedContext, TODAY)));
    });
});
