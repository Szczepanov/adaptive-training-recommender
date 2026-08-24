import type { AthleteScenario } from './scenarios';
import { SCENARIOS } from './scenarios';
import { runScenario } from './analyze';
import { computeScenarioResultDistance, type PlanDistanceBreakdown } from './planDistance';
import type { SubjectiveDriftPolicy } from '../rules';

import { generateWeekAheadPlanWithIntent } from '../planner';

export interface BlindCandidateComparison {
    scenarioId: string;
    scenarioLabel: string;
    distance: PlanDistanceBreakdown;
    hasDifference: boolean;
    candidateAlphaSummary: {
        restOrRecoveryDays: number;
        modeCounts: { train: number; modify: number; recover: number };
        violations: string[];
    };
    candidateBetaSummary: {
        restOrRecoveryDays: number;
        modeCounts: { train: number; modify: number; recover: number };
        violations: string[];
    };
}

export interface BlindAbReport {
    schema: 'adaptive-training-recommender/blind-ab-report@1';
    timestamp: string;
    totalScenarios: number;
    differentiatingScenariosCount: number;
    meanCompositeDistance: number;
    meanModeHammingDistance: number;
    meanSessionEditDistance: number;
    scenarioComparisons: BlindCandidateComparison[];
    unblindingKey: {
        candidateAlpha: string;
        candidateBeta: string;
    };
}

/**
 * Runs a blind A/B comparative simulation across the scenario corpus between two policies.
 */
export async function runBlindAbComparison(
    policyAlpha: SubjectiveDriftPolicy = 'off',
    policyBeta: SubjectiveDriftPolicy = 'drift',
    scenarios: readonly AthleteScenario[] = SCENARIOS
): Promise<BlindAbReport> {
    // Randomize blinded assignments if desired or deterministically label them
    const isSwapped = false;
    const actualAlpha = isSwapped ? policyBeta : policyAlpha;
    const actualBeta = isSwapped ? policyAlpha : policyBeta;

    const comparisons: BlindCandidateComparison[] = [];
    let totalCompositeDist = 0;
    let totalModeDist = 0;
    let totalEditDist = 0;
    let diffCount = 0;

    for (const scenario of scenarios) {
        const resultAlpha = await runScenario(scenario, generateWeekAheadPlanWithIntent, { subjectiveDriftPolicy: actualAlpha });
        const resultBeta = await runScenario(scenario, generateWeekAheadPlanWithIntent, { subjectiveDriftPolicy: actualBeta });

        const distance = computeScenarioResultDistance(resultAlpha, resultBeta);
        const hasDiff = distance.compositeDistance > 0;
        if (hasDiff) diffCount++;

        totalCompositeDist += distance.compositeDistance;
        totalModeDist += distance.modeHammingDistance;
        totalEditDist += distance.sessionEditDistance;

        comparisons.push({
            scenarioId: scenario.id,
            scenarioLabel: scenario.label,
            distance,
            hasDifference: hasDiff,
            candidateAlphaSummary: {
                restOrRecoveryDays: resultAlpha.restOrRecoveryDayCount,
                modeCounts: resultAlpha.fatigueTierDayCounts,
                violations: resultAlpha.constraintViolations,
            },
            candidateBetaSummary: {
                restOrRecoveryDays: resultBeta.restOrRecoveryDayCount,
                modeCounts: resultBeta.fatigueTierDayCounts,
                violations: resultBeta.constraintViolations,
            },
        });
    }

    const total = scenarios.length;
    return {
        schema: 'adaptive-training-recommender/blind-ab-report@1',
        timestamp: new Date().toISOString(),
        totalScenarios: total,
        differentiatingScenariosCount: diffCount,
        meanCompositeDistance: Math.round((totalCompositeDist / total) * 10000) / 10000,
        meanModeHammingDistance: Math.round((totalModeDist / total) * 10000) / 10000,
        meanSessionEditDistance: Math.round((totalEditDist / total) * 10000) / 10000,
        scenarioComparisons: comparisons,
        unblindingKey: {
            candidateAlpha: `Subjective Drift: ${actualAlpha}`,
            candidateBeta: `Subjective Drift: ${actualBeta}`,
        },
    };
}
