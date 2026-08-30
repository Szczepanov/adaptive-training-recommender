import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    assessLabelledFalsePositives,
    buildRespirationThresholdSweep,
    summarizeCounterfactualRows,
} from './respirationReplayAnalysis.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..');
function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const inputPath = resolve(repoRoot, argument('--input') ?? 'raw_cache.json');
const outputDir = resolve(repoRoot, argument('--out-dir') ?? 'artifacts/respiration-real-history-replay/latest');
const labelsArgument = argument('--labels');
const labelsPath = labelsArgument ? resolve(repoRoot, labelsArgument) : null;

if (!existsSync(inputPath)) {
    throw new Error(`Real-history input not found: ${inputPath}`);
}

function valid(values) {
    return values.filter(value => value !== null && value !== undefined);
}

function average(values, minimum) {
    const valuesValid = valid(values);
    return valuesValid.length >= minimum
        ? valuesValid.reduce((sum, value) => sum + value, 0) / valuesValid.length
        : null;
}

function median(values, minimum) {
    const valuesValid = [...valid(values)].sort((a, b) => a - b);
    if (valuesValid.length < minimum) return null;
    const middle = Math.floor(valuesValid.length / 2);
    return valuesValid.length % 2 === 0
        ? (valuesValid[middle - 1] + valuesValid[middle]) / 2
        : valuesValid[middle];
}

function populationStdev(values, minimum) {
    const valuesValid = valid(values);
    if (valuesValid.length < minimum) return null;
    const mean = valuesValid.reduce((sum, value) => sum + value, 0) / valuesValid.length;
    return Math.sqrt(valuesValid.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / valuesValid.length);
}

function mad(values, minimum) {
    const center = median(values, minimum);
    if (center === null) return null;
    return median(values.map(value => Math.abs(value - center)), minimum) * 1.4826;
}

function delta(current, baseline) {
    return current !== null && baseline !== null ? current - baseline : null;
}

function round(value) {
    return value === null ? null : Math.round(value * 10000) / 10000;
}

function snapshotFor(date, raw, history) {
    const window7 = history.slice(-7);
    const window28 = history.slice(-28);
    const values7 = field => window7.map(item => item[field]);
    const values28 = field => window28.map(item => item[field]);

    const current = {
        sleepScore: raw.sleepScore ?? null,
        restingHr: raw.restingHr ?? null,
        hrvOvernightAvg: raw.hrvOvernightAvg ?? null,
        respirationAvg: raw.respirationAvg ?? null,
        totalSteps: raw.totalSteps ?? null,
    };
    const sleep7 = average(values7('sleepScore'), 4);
    const sleep28 = average(values28('sleepScore'), 14);
    const rhr7 = average(values7('restingHr'), 4);
    const rhr28 = average(values28('restingHr'), 14);
    const hrv7 = average(values7('hrvOvernightAvg'), 4);
    const hrv28 = average(values28('hrvOvernightAvg'), 14);
    const resp7 = median(values7('respirationAvg'), 4);
    const resp28 = median(values28('respirationAvg'), 14);
    const steps7 = average(values7('totalSteps'), 4);
    const steps28 = average(values28('totalSteps'), 14);

    return {
        userId: 'real-history-replay',
        date,
        source: { garminSyncedAt: `${date}T08:00:00.000Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: current.sleepScore,
            sleepDurationSec: raw.sleepDurationSec ?? null,
            restingHr: current.restingHr,
            hrvOvernightAvg: current.hrvOvernightAvg,
            hrvStatus: raw.hrvStatus ?? null,
            respirationAvg: current.respirationAvg,
            bodyBatteryWake: raw.bodyBatteryWake ?? null,
            bodyBatteryChange: raw.bodyBatteryChange ?? null,
            totalSteps: current.totalSteps,
            last3DaysHardSessionsCount: raw.last3DaysHardSessionsCount ?? 0,
            yesterdayTraining: raw.yesterdayTraining ?? null,
            todayTraining: raw.todayTraining ?? null,
        },
        derived: {
            baselineComputationVersion: 3,
            sleepScore7dAvg: round(sleep7),
            sleepScore28dAvg: round(sleep28),
            restingHr7dAvg: round(rhr7),
            restingHr28dAvg: round(rhr28),
            hrv7dAvg: round(hrv7),
            hrv28dAvg: round(hrv28),
            respiration7dAvg: round(resp7),
            respiration28dAvg: round(resp28),
            hrv28dStdev: round(populationStdev(values28('hrvOvernightAvg'), 14)),
            restingHr28dStdev: round(populationStdev(values28('restingHr'), 14)),
            sleepScore28dStdev: round(populationStdev(values28('sleepScore'), 14)),
            respiration28dMad: round(mad(values28('respirationAvg'), 14)),
            steps7dAvg: round(steps7),
            steps28dAvg: round(steps28),
            steps28dStdev: round(populationStdev(values28('totalSteps'), 14)),
            deltas: {
                sleepScoreVs7d: round(delta(current.sleepScore, sleep7)),
                sleepScoreVs28d: round(delta(current.sleepScore, sleep28)),
                restingHrVs7d: round(delta(current.restingHr, rhr7)),
                restingHrVs28d: round(delta(current.restingHr, rhr28)),
                hrvVs7d: round(delta(current.hrvOvernightAvg, hrv7)),
                hrvVs28d: round(delta(current.hrvOvernightAvg, hrv28)),
                respirationVs7d: round(delta(current.respirationAvg, resp7)),
                respirationVs28d: round(delta(current.respirationAvg, resp28)),
                stepsVs7d: round(delta(current.totalSteps, steps7)),
                stepsVs28d: round(delta(current.totalSteps, steps28)),
            },
        },
        dataQuality: {
            sleepScoreAvailable: current.sleepScore !== null,
            restingHrAvailable: current.restingHr !== null,
            hrvAvailable: current.hrvOvernightAvg !== null,
            baseline7dReady: sleep7 !== null && rhr7 !== null && hrv7 !== null && resp7 !== null,
            baseline28dReady: sleep28 !== null && rhr28 !== null && hrv28 !== null && resp28 !== null,
        },
        createdAt: `${date}T08:00:00.000Z`,
        updatedAt: `${date}T08:00:00.000Z`,
    };
}

const cache = JSON.parse(readFileSync(inputPath, 'utf8'));
const labelsByDate = labelsPath ? JSON.parse(readFileSync(labelsPath, 'utf8')) : null;
const dates = Object.keys(cache).sort();
const snapshots = dates.map((date, index) => snapshotFor(date, cache[date], dates.slice(0, index).map(item => cache[item])));

const server = await createServer({
    configFile: false,
    root: appRoot,
    logLevel: 'warn',
    server: { middlewareMode: true },
    appType: 'custom',
});

let adapters;
let rules;
try {
    adapters = await server.ssrLoadModule('/src/engine/adapters.ts');
    rules = await server.ssrLoadModule('/src/engine/rules.ts');
} finally {
    await server.close();
}

const subjective = {
    readiness: 9,
    sleepQuality: 9,
    fatigue: 2,
    soreness: 2,
    stress: 2,
    motivation: 9,
    timeAvailable: 60,
    painFlag: false,
    alreadyTrainedToday: false,
    preferredModalityToday: null,
};
const context = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: {
        hasCableMachine: false,
        hasFreeWeights: true,
        hasTreadmill: false,
        hasIndoorBike: false,
        restrictedModalities: [],
        maxTimeMinutes: 90,
    },
    preferences: {
        avoidedModalities: [],
        deprioritizedModalities: [],
        preferredModalities: [],
        conservativeBias: false,
    },
};

const rows = snapshots.slice(28).map(snapshot => {
    const productionInput = adapters.mapSnapshotToEngineInput(snapshot, 'off');
    const respirationInput = adapters.mapSnapshotToEngineInput(snapshot, 'median-mad-v1');
    const production = rules.evaluateTraining({ subjective, objective: productionInput }, context, snapshot.date);
    const candidate = rules.evaluateTraining({ subjective, objective: respirationInput }, context, snapshot.date);
    return {
        date: snapshot.date,
        respiration: snapshot.raw.respirationAvg,
        respirationDelta7d: snapshot.derived.deltas.respirationVs7d,
        respirationDelta28d: snapshot.derived.deltas.respirationVs28d,
        respirationMad28d: snapshot.derived.respiration28dMad,
        productionMode: production.mode,
        candidateMode: candidate.mode,
        productionScore: production.telemetry?.totalDecisionScore ?? null,
        candidateScore: candidate.telemetry?.totalDecisionScore ?? null,
        productionMetricStrain: production.telemetry?.metricStrain.totalMetricStrain ?? null,
        respirationAddedStrain: round((candidate.telemetry?.metricStrain.totalMetricStrain ?? 0) - (production.telemetry?.metricStrain.totalMetricStrain ?? 0)),
        modeFlip: production.mode !== candidate.mode,
        todayTrainingPresent: snapshot.raw.todayTraining !== null,
        actionableMorning: snapshot.raw.todayTraining === null,
    };
});

const flips = rows.filter(row => row.modeFlip);
const respirationReady = rows.filter(row => row.respirationMad28d !== null);
const actionableRows = rows.filter(row => row.actionableMorning);
const alreadyTrainedRows = rows.filter(row => !row.actionableMorning);
const counterfactual = summarizeCounterfactualRows(rows);
const actionableCounterfactual = summarizeCounterfactualRows(actionableRows);
const alreadyTrainedCounterfactual = summarizeCounterfactualRows(alreadyTrainedRows);

const report = {
    generatedFrom: 'real-history-replay',
    input: inputPath,
    dateRange: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
    totalInputDays: dates.length,
    evaluatedDays: rows.length,
    warmupDays: Math.min(28, dates.length),
    respirationCoverage: {
        inputDaysWithRespiration: dates.filter(date => cache[date].respirationAvg !== null && cache[date].respirationAvg !== undefined).length,
        evaluatedDaysWithMeasuredMad: respirationReady.length,
    },
    counterfactual: {
        subjectiveContext: 'fixed green check-in (readiness/sleep quality/motivation 9; fatigue/soreness/stress 2)',
        productionPolicy: 'off',
        candidatePolicy: 'median-mad-v1',
        ...counterfactual,
    },
    actionableCounterfactual,
    alreadyTrainedCounterfactual,
    thresholdSweep: buildRespirationThresholdSweep(rows),
    falsePositiveAssessment: assessLabelledFalsePositives(rows, labelsByDate),
    rows,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
    '# Respiration real-history counterfactual replay',
    '',
    `- Input range: ${report.dateRange.start} to ${report.dateRange.end}`,
    `- Input days: ${report.totalInputDays}; evaluated after 28-day warmup: ${report.evaluatedDays}`,
    `- Respiration coverage: ${report.respirationCoverage.inputDaysWithRespiration}/${report.totalInputDays} input days`,
    `- Candidate policy: ${report.counterfactual.candidatePolicy}`,
    '',
    '## Recommendation counterfactual',
    '',
    `- Actionable morning mode flips: ${report.actionableCounterfactual.modeFlipCount}/${report.actionableCounterfactual.evaluatedDays} (${report.actionableCounterfactual.modeFlipRate === null ? 'n/a' : `${(report.actionableCounterfactual.modeFlipRate * 100).toFixed(1)}%`})`,
    `- Actionable flip directions: ${JSON.stringify(report.actionableCounterfactual.flipDirections)}`,
    `- Aggregate mode flips (includes already-trained days): ${report.counterfactual.modeFlipCount}/${report.evaluatedDays} (${report.counterfactual.modeFlipRate === null ? 'n/a' : `${(report.counterfactual.modeFlipRate * 100).toFixed(1)}%`})`,
    `- Already-trained rows: ${report.alreadyTrainedCounterfactual.evaluatedDays}`,
    `- Mean added respiration strain on actionable mornings: ${report.actionableCounterfactual.meanRespirationAddedStrain}`,
    `- Maximum added respiration strain on actionable mornings: ${report.actionableCounterfactual.maxRespirationAddedStrain}`,
    '',
    '## Personal-delta threshold sweep',
    '',
    '- Existing readiness-strain overlap uses the production aggregate metric strain (sleep + RHR + HRV). It is descriptive overlap, not adverse RHR/low-HRV physiological corroboration.',
    '',
    '| Candidate | Minimum Δ28d | Minimum Δ7d | Matches | Actionable | Already conservative | 2-night persistent | Existing readiness-strain overlap | No readiness-strain overlap | Resolving tails |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...report.thresholdSweep.map(candidate => `| ${candidate.id} | ${candidate.minimumDelta28d} | ${candidate.minimumDelta7d} | ${candidate.matchedDays} | ${candidate.actionableMatchedDays} | ${candidate.actionableDaysAlreadyConservative} | ${candidate.persistentTwoNightDays} | ${candidate.existingReadinessStrainOverlapDays} | ${candidate.noExistingReadinessStrainOverlapDays} | ${candidate.resolvingTailDays} |`),
    '',
    '## False positives',
    '',
    `- ${report.falsePositiveAssessment.note}`,
    '',
    '## Flipped days',
    '',
    '| Date | Respiration | Δ7d | Δ28d | MAD28d | Production | Candidate | Added strain |',
    '|---|---:|---:|---:|---:|---|---|---:|',
    ...flips.map(row => `| ${row.date} | ${row.respiration ?? '—'} | ${row.respirationDelta7d ?? '—'} | ${row.respirationDelta28d ?? '—'} | ${row.respirationMad28d ?? '—'} | ${row.productionMode} | ${row.candidateMode} | ${row.respirationAddedStrain} |`),
    '',
    '> This is a real-history counterfactual, not a clinical validation study. The subjective context is held green and no illness labels are available.',
].join('\n') + '\n';
writeFileSync(resolve(outputDir, 'report.md'), markdown);
console.log(`Replay report written to ${outputDir}`);
console.log(JSON.stringify({
    evaluatedDays: report.evaluatedDays,
    actionableDays: report.actionableCounterfactual.evaluatedDays,
    actionableModeFlipCount: report.actionableCounterfactual.modeFlipCount,
    actionableModeFlipRate: report.actionableCounterfactual.modeFlipRate,
    aggregateModeFlipCount: report.counterfactual.modeFlipCount,
    falsePositiveRate: report.falsePositiveAssessment.rate,
}, null, 2));
