import type { ScenarioDecisionTrace, ScenarioResult } from './analyze';

export interface PlanDistanceBreakdown {
    modeHammingDistance: number;
    sessionJaccardDistance: number;
    sessionEditDistance: number;
    systemicCostL1Distance: number;
    cardiovascularCostL1Distance: number;
    restPlacementDistance: number;
    compositeDistance: number;
}

/**
 * Calculates normalized Levenshtein edit distance between two sequences of strings.
 */
function sequenceEditDistance(seqA: readonly string[], seqB: readonly string[]): number {
    const m = seqA.length;
    const n = seqB.length;
    if (m === 0 && n === 0) return 0;
    if (m === 0) return 1;
    if (n === 0) return 1;

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = seqA[i - 1] === seqB[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,      // deletion
                dp[i][j - 1] + 1,      // insertion
                dp[i - 1][j - 1] + cost // substitution
            );
        }
    }

    const maxLen = Math.max(m, n);
    return maxLen === 0 ? 0 : Math.min(1, dp[m][n] / maxLen);
}

/**
 * Calculates the Jaccard distance (1 - IoU) between two sets of session templates.
 */
function jaccardDistance(templatesA: readonly string[], templatesB: readonly string[]): number {
    const setA = new Set(templatesA);
    const setB = new Set(templatesB);
    if (setA.size === 0 && setB.size === 0) return 0;

    let intersectionCount = 0;
    for (const item of setA) {
        if (setB.has(item)) intersectionCount++;
    }
    const unionCount = new Set([...setA, ...setB]).size;
    if (unionCount === 0) return 0;
    return 1 - (intersectionCount / unionCount);
}

const REST_OR_RECOVERY_CATEGORIES = new Set(['Rest', 'Mobility/Recovery', 'Active Recovery']);

function isRestOrRecovery(trace: ScenarioDecisionTrace): boolean {
    return trace.mode === 'recover' ||
        REST_OR_RECOVERY_CATEGORIES.has(trace.selected.category) ||
        trace.selected.templateId.toLowerCase().includes('rest') ||
        trace.selected.templateId.toLowerCase().includes('recovery');
}

/**
 * Compares two multi-day simulation traces date-by-date and produces deterministic,
 * bounded distance metrics.
 */
export function computePlanDistance(
    tracesA: readonly ScenarioDecisionTrace[],
    tracesB: readonly ScenarioDecisionTrace[]
): PlanDistanceBreakdown {
    const daysCount = Math.max(tracesA.length, tracesB.length);
    if (daysCount === 0) {
        return {
            modeHammingDistance: 0,
            sessionJaccardDistance: 0,
            sessionEditDistance: 0,
            systemicCostL1Distance: 0,
            cardiovascularCostL1Distance: 0,
            restPlacementDistance: 0,
            compositeDistance: 0,
        };
    }

    let modeDiffCount = 0;
    let systemicCostDiffSum = 0;
    let cardioCostDiffSum = 0;
    let restPlacementDiffCount = 0;

    const templatesA: string[] = [];
    const templatesB: string[] = [];

    for (let i = 0; i < daysCount; i++) {
        const a = tracesA[i];
        const b = tracesB[i];

        if (!a && b) {
            modeDiffCount++;
            restPlacementDiffCount++;
            systemicCostDiffSum += b.selected.projectedCost.systemic;
            cardioCostDiffSum += b.selected.projectedCost.cardiovascular;
            templatesB.push(b.selected.templateId);
            continue;
        }
        if (a && !b) {
            modeDiffCount++;
            restPlacementDiffCount++;
            systemicCostDiffSum += a.selected.projectedCost.systemic;
            cardioCostDiffSum += a.selected.projectedCost.cardiovascular;
            templatesA.push(a.selected.templateId);
            continue;
        }

        if (a && b) {
            templatesA.push(a.selected.templateId);
            templatesB.push(b.selected.templateId);

            if (a.mode !== b.mode) modeDiffCount++;
            if (isRestOrRecovery(a) !== isRestOrRecovery(b)) restPlacementDiffCount++;

            systemicCostDiffSum += Math.abs(a.selected.projectedCost.systemic - b.selected.projectedCost.systemic);
            cardioCostDiffSum += Math.abs(a.selected.projectedCost.cardiovascular - b.selected.projectedCost.cardiovascular);
        }
    }

    const modeHammingDistance = modeDiffCount / daysCount;
    const sessionJaccardDistance = jaccardDistance(templatesA, templatesB);
    const sessionEditDistance = sequenceEditDistance(templatesA, templatesB);
    const systemicCostL1Distance = systemicCostDiffSum / daysCount;
    const cardiovascularCostL1Distance = cardioCostDiffSum / daysCount;
    const restPlacementDistance = restPlacementDiffCount / daysCount;

    // Calibrated composite distance (0..1)
    const compositeDistance = Math.min(1,
        0.25 * modeHammingDistance +
        0.30 * sessionEditDistance +
        0.15 * sessionJaccardDistance +
        0.15 * Math.min(1, systemicCostL1Distance * 1.5) +
        0.15 * restPlacementDistance
    );

    const round4 = (v: number) => Math.round(v * 10000) / 10000;

    return {
        modeHammingDistance: round4(modeHammingDistance),
        sessionJaccardDistance: round4(sessionJaccardDistance),
        sessionEditDistance: round4(sessionEditDistance),
        systemicCostL1Distance: round4(systemicCostL1Distance),
        cardiovascularCostL1Distance: round4(cardiovascularCostL1Distance),
        restPlacementDistance: round4(restPlacementDistance),
        compositeDistance: round4(compositeDistance),
    };
}

/**
 * Calculates plan distance between two full ScenarioResult outputs.
 */
export function computeScenarioResultDistance(
    resultA: ScenarioResult,
    resultB: ScenarioResult
): PlanDistanceBreakdown {
    return computePlanDistance(resultA.decisionTraces, resultB.decisionTraces);
}
