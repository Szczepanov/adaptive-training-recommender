import type { UserContext } from '../models';
import {
    computeSubjectiveBaseline,
    REFERENCE_SUBJECTIVE_BASELINE_POLICY,
    type SubjectiveBaselinePolicy,
    type SubjectiveCheckinForBaseline,
} from '../subjectiveBaseline';
import {
    buildSubjectiveDriftDecisionEvidence,
    type SubjectiveDriftDecisionEvidence,
} from './subjectiveDriftEvidence';
import {
    REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    type SubjectiveDriftWeights,
} from '../rules';
import {
    SUBJECTIVE_PROFILE_KINDS,
    subjectiveProfileDay,
    subjectiveProfileReadiness,
    type SubjectiveProfileKind,
} from './subjectiveProfiles';
import { addDaysToLocalDateString } from '../../utils/localDate';

export interface SubjectiveDriftSensitivityConfig {
    id: string;
    baselinePolicy: SubjectiveBaselinePolicy;
    weights: SubjectiveDriftWeights;
}

export interface SubjectiveDriftComparisonDay {
    profile: SubjectiveProfileKind;
    configId: string;
    date: string;
    dayIndex: number;
    baselineAvailable: boolean;
    evidence: SubjectiveDriftDecisionEvidence | null;
}

export interface SubjectiveDriftProfileSummary {
    profile: SubjectiveProfileKind;
    configId: string;
    evaluatedDays: number;
    baselineAvailableDays: number;
    changedModeDays: number;
    trainToModifyDays: number;
    trainToRecoverDays: number;
    modifyToRecoverDays: number;
    recoverShareOff: number;
    recoverShareDrift: number;
    meanContribution: number;
    maxContribution: number;
}

export interface SubjectiveDriftMechanicsReport {
    startDate: string;
    totalDays: number;
    warmupDays: number;
    configs: SubjectiveDriftSensitivityConfig[];
    days: SubjectiveDriftComparisonDay[];
    summaries: SubjectiveDriftProfileSummary[];
    scope: 'readiness-mechanics-only';
    limitations: string[];
}

const DEFAULT_CONTEXT: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: {
        hasCableMachine: true,
        hasFreeWeights: true,
        hasTreadmill: true,
        hasIndoorBike: true,
        maxTimeMinutes: 90,
    },
    preferences: {
        avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false,
    },
};

const HALF_WEIGHTS: SubjectiveDriftWeights = {
    readiness: 0.5, sleepQuality: 0.5, fatigue: 0.5, soreness: 0.5, mentalStress: 0.5, motivation: 0.5,
};
const FATIGUE_SORENESS_ONLY: SubjectiveDriftWeights = {
    readiness: 0, sleepQuality: 0, fatigue: 1, soreness: 1, mentalStress: 0, motivation: 0,
};

export const SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS: SubjectiveDriftSensitivityConfig[] = [
    { id: 'reference-7-28-equal', baselinePolicy: REFERENCE_SUBJECTIVE_BASELINE_POLICY, weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS },
    {
        id: 'short-5-21-equal',
        baselinePolicy: {
            ...REFERENCE_SUBJECTIVE_BASELINE_POLICY,
            estimatorId: 'sensitivity-mean-stdev-5-21',
            recentWindowDays: 5, longWindowDays: 21, minRecentRecordedDays: 3, minLongRecordedDays: 8,
        },
        weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    },
    {
        id: 'long-10-35-equal',
        baselinePolicy: {
            ...REFERENCE_SUBJECTIVE_BASELINE_POLICY,
            estimatorId: 'sensitivity-mean-stdev-10-35',
            recentWindowDays: 10, longWindowDays: 35, minRecentRecordedDays: 5, minLongRecordedDays: 14,
        },
        weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    },
    {
        id: 'reference-higher-coverage',
        baselinePolicy: {
            ...REFERENCE_SUBJECTIVE_BASELINE_POLICY,
            estimatorId: 'sensitivity-mean-stdev-7-28-high-coverage',
            minRecentRecordedDays: 6, minLongRecordedDays: 20,
        },
        weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    },
    {
        id: 'reference-floor-0.5',
        baselinePolicy: { ...REFERENCE_SUBJECTIVE_BASELINE_POLICY, estimatorId: 'sensitivity-mean-stdev-7-28-floor-0.5', variabilityFloor: 0.5 },
        weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    },
    {
        id: 'reference-floor-1.5',
        baselinePolicy: { ...REFERENCE_SUBJECTIVE_BASELINE_POLICY, estimatorId: 'sensitivity-mean-stdev-7-28-floor-1.5', variabilityFloor: 1.5 },
        weights: REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    },
    { id: 'reference-half-weights', baselinePolicy: REFERENCE_SUBJECTIVE_BASELINE_POLICY, weights: HALF_WEIGHTS },
    { id: 'reference-fatigue-soreness-only', baselinePolicy: REFERENCE_SUBJECTIVE_BASELINE_POLICY, weights: FATIGUE_SORENESS_ONLY },
];

function profileHistoryRow(kind: SubjectiveProfileKind, dayIndex: number, date: string): SubjectiveCheckinForBaseline {
    const values = subjectiveProfileDay(kind, dayIndex);
    return {
        date,
        readiness: values.readiness,
        sleepQuality: values.sleepQuality,
        fatigue: values.fatigue,
        soreness: values.soreness,
        mentalStress: values.stress,
        motivation: values.motivation,
    };
}
function ratio(count: number, total: number): number { return total === 0 ? 0 : count / total; }
function summarizeRows(profile: SubjectiveProfileKind, configId: string, rows: SubjectiveDriftComparisonDay[]): SubjectiveDriftProfileSummary {
    const evidence = rows.flatMap(row => row.evidence ? [row.evidence] : []);
    const changed = evidence.filter(item => item.decisionRelevant);
    const contributions = evidence.map(item => item.contribution);
    return {
        profile, configId, evaluatedDays: rows.length, baselineAvailableDays: evidence.length,
        changedModeDays: changed.length,
        trainToModifyDays: changed.filter(item => item.modeWithoutDrift === 'train' && item.modeWithDrift === 'modify').length,
        trainToRecoverDays: changed.filter(item => item.modeWithoutDrift === 'train' && item.modeWithDrift === 'recover').length,
        modifyToRecoverDays: changed.filter(item => item.modeWithoutDrift === 'modify' && item.modeWithDrift === 'recover').length,
        recoverShareOff: ratio(evidence.filter(item => item.modeWithoutDrift === 'recover').length, evidence.length),
        recoverShareDrift: ratio(evidence.filter(item => item.modeWithDrift === 'recover').length, evidence.length),
        meanContribution: contributions.length === 0 ? 0 : contributions.reduce((a, b) => a + b, 0) / contributions.length,
        maxContribution: contributions.length === 0 ? 0 : Math.max(...contributions),
    };
}

/** Readiness-mechanics comparison only. It deliberately does not claim planner quality or
 * real-world predictive usefulness; final 9.6b must thread the policy through the real
 * planner/hard-gate path. */
export function runSubjectiveDriftMechanicsComparison(options: {
    startDate?: string;
    totalDays?: number;
    warmupDays?: number;
    configs?: SubjectiveDriftSensitivityConfig[];
    context?: UserContext;
} = {}): SubjectiveDriftMechanicsReport {
    const startDate = options.startDate ?? '2026-01-01';
    const totalDays = options.totalDays ?? 70;
    const warmupDays = options.warmupDays ?? 35;
    const configs = options.configs ?? SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS;
    const context = options.context ?? DEFAULT_CONTEXT;
    if (warmupDays < Math.max(...configs.map(config => config.baselinePolicy.longWindowDays))) {
        throw new RangeError('warmupDays must cover the longest baseline reference window.');
    }
    if (totalDays <= warmupDays) throw new RangeError('totalDays must exceed warmupDays.');

    const days: SubjectiveDriftComparisonDay[] = [];
    for (const profile of SUBJECTIVE_PROFILE_KINDS) {
        const history: SubjectiveCheckinForBaseline[] = [];
        for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
            const date = addDaysToLocalDateString(startDate, dayIndex);
            if (dayIndex >= warmupDays) {
                for (const config of configs) {
                    const baseline = computeSubjectiveBaseline(history, date, config.baselinePolicy);
                    const readiness = { ...subjectiveProfileReadiness(profile, dayIndex), subjectiveBaseline: baseline };
                    const evidence = buildSubjectiveDriftDecisionEvidence(readiness, context, date, undefined, config.weights);
                    days.push({ profile, configId: config.id, date, dayIndex, baselineAvailable: baseline !== null, evidence });
                }
            }
            history.push(profileHistoryRow(profile, dayIndex, date));
        }
    }

    const summaries: SubjectiveDriftProfileSummary[] = [];
    for (const profile of SUBJECTIVE_PROFILE_KINDS) {
        for (const config of configs) {
            summaries.push(summarizeRows(profile, config.id, days.filter(row => row.profile === profile && row.configId === config.id)));
        }
    }
    return {
        startDate, totalDays, warmupDays, configs, days, summaries,
        scope: 'readiness-mechanics-only',
        limitations: [
            'Synthetic profiles test safety/mechanics; they do not establish real-world predictive usefulness.',
            'This layer does not run workout ranking, hard eligibility gates, weekly objectives, or selection quality.',
            'Contribution-cap sensitivity is intentionally deferred until the canonical 9.3 helper accepts a cap policy parameter.',
            'Production remains SubjectiveDriftPolicy=off; this report is measurement evidence only.',
        ],
    };
}
