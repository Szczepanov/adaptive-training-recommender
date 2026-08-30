export const RESPIRATION_ELEVATION_CANDIDATES = Object.freeze([
    { id: 'E1', minimumDelta28d: 0.75, minimumDelta7d: 0.25 },
    { id: 'E2', minimumDelta28d: 1, minimumDelta7d: 0.5 },
    { id: 'E3', minimumDelta28d: 1.25, minimumDelta7d: 0.75 },
    { id: 'S1', minimumDelta28d: 2, minimumDelta7d: 1 },
]);

function modeCounts(values) {
    return values.reduce((counts, value) => {
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
    }, {});
}

function round(value) {
    return value === null ? null : Math.round(value * 10000) / 10000;
}

function mean(values) {
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

export function summarizeCounterfactualRows(rows) {
    const flips = rows.filter(row => row.modeFlip);
    const addedStrain = rows
        .map(row => row.respirationAddedStrain)
        .filter(value => Number.isFinite(value));
    return {
        evaluatedDays: rows.length,
        productionModeCounts: modeCounts(rows.map(row => row.productionMode)),
        candidateModeCounts: modeCounts(rows.map(row => row.candidateMode)),
        modeFlipCount: flips.length,
        modeFlipRate: rows.length > 0 ? flips.length / rows.length : null,
        flipDirections: modeCounts(flips.map(row => `${row.productionMode}->${row.candidateMode}`)),
        meanRespirationAddedStrain: round(mean(addedStrain)),
        maxRespirationAddedStrain: round(addedStrain.length > 0 ? Math.max(...addedStrain) : null),
        flippedDates: flips.map(row => row.date),
    };
}

function hasMeasuredDeltas(row) {
    return Number.isFinite(row.respirationDelta7d) && Number.isFinite(row.respirationDelta28d);
}

function previousCalendarDate(date) {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return parsed.toISOString().slice(0, 10);
}

export function classifyRespirationThreshold(row, candidate) {
    if (!hasMeasuredDeltas(row)) return 'unavailable';
    if (row.respirationDelta7d <= 0 && row.respirationDelta28d > 0) return 'resolving';
    if (
        row.respirationDelta28d >= candidate.minimumDelta28d
        && row.respirationDelta7d >= candidate.minimumDelta7d
    ) return 'elevated';
    return 'normal';
}

export function buildRespirationThresholdSweep(rows, candidates = RESPIRATION_ELEVATION_CANDIDATES) {
    return candidates.map(candidate => {
        const classified = rows.map(row => ({ row, status: classifyRespirationThreshold(row, candidate) }));
        const matched = classified.filter(item => item.status === 'elevated').map(item => item.row);
        const actionable = matched.filter(row => row.actionableMorning);
        const alreadyConservative = actionable.filter(row => row.productionMode !== 'train');
        const matchedDates = new Set(matched.map(row => row.date));
        const persistent = matched.filter(row => matchedDates.has(previousCalendarDate(row.date)));
        // `productionMetricStrain` is the existing aggregate readiness strain (sleep + RHR + HRV),
        // not physiological corroboration. Keep this overlap descriptive and separate from the
        // health-anomaly replay's adverse RHR/low-HRV corroboration predicate.
        const existingReadinessStrainOverlap = matched.filter(row => (row.productionMetricStrain ?? 0) > 0);
        const noExistingReadinessStrainOverlap = matched.filter(row => (row.productionMetricStrain ?? 0) <= 0);
        const resolving = classified.filter(item => item.status === 'resolving').map(item => item.row);
        return {
            ...candidate,
            matchedDays: matched.length,
            matchedDates: matched.map(row => row.date),
            actionableMatchedDays: actionable.length,
            actionableMatchedDates: actionable.map(row => row.date),
            matchedDaysWithoutSameDayTraining: matched.filter(row => !row.todayTrainingPresent).length,
            actionableDaysAlreadyConservative: alreadyConservative.length,
            actionableDaysAlreadyConservativeRate: actionable.length > 0
                ? alreadyConservative.length / actionable.length
                : null,
            persistentTwoNightDays: persistent.length,
            persistentTwoNightDates: persistent.map(row => row.date),
            existingReadinessStrainOverlapDays: existingReadinessStrainOverlap.length,
            existingReadinessStrainOverlapDates: existingReadinessStrainOverlap.map(row => row.date),
            noExistingReadinessStrainOverlapDays: noExistingReadinessStrainOverlap.length,
            noExistingReadinessStrainOverlapDates: noExistingReadinessStrainOverlap.map(row => row.date),
            resolvingTailDays: resolving.length,
            resolvingTailDates: resolving.map(row => row.date),
        };
    });
}

export function assessLabelledFalsePositives(rows, labelsByDate) {
    if (!labelsByDate) {
        return {
            labelledSubjectiveCheckins: false,
            labelledIllnessOutcomes: false,
            labelledActionableDays: 0,
            labelledHealthyActionableDays: 0,
            count: null,
            rate: null,
            note: 'No symptom, illness, or follow-up labels were supplied; conservative days are unlabelled signals, not measurable false positives.',
        };
    }
    const labelledActionable = rows.filter(row => row.actionableMorning && labelsByDate[row.date]);
    const healthy = labelledActionable.filter(row => labelsByDate[row.date].healthy === true);
    const falsePositives = healthy.filter(row => row.modeFlip);
    return {
        labelledSubjectiveCheckins: labelledActionable.some(row => labelsByDate[row.date].symptomsReported !== undefined),
        labelledIllnessOutcomes: labelledActionable.some(row => labelsByDate[row.date].healthy !== undefined),
        labelledActionableDays: labelledActionable.length,
        labelledHealthyActionableDays: healthy.length,
        count: falsePositives.length,
        rate: healthy.length > 0 ? falsePositives.length / healthy.length : null,
        dates: falsePositives.map(row => row.date),
        note: healthy.length > 0
            ? 'A false positive is an actionable, labelled-healthy day where the broad counterfactual changed recommendation mode.'
            : 'Labels were supplied, but none identify an actionable day as healthy; false-positive rate remains unavailable.',
    };
}
