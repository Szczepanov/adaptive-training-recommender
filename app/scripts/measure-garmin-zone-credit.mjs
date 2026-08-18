import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/measure-garmin-zone-credit.mjs <reduced-activities.json|->');
  process.exit(1);
}

const input = inputPath === '-'
  ? readFileSync(0, 'utf8')
  : readFileSync(resolve(inputPath), 'utf8');
let activities;
try {
  activities = JSON.parse(input);
} catch (error) {
  console.error(`Malformed evidence JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!Array.isArray(activities)) {
  console.error('Evidence input must be a JSON array.');
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let report;
try {
  const module = await server.ssrLoadModule('/src/engine/garminTelemetryComparison.ts');
  report = module.compareGarminZoneCredit(activities);
} finally {
  await server.close();
}

const objectiveKeys = [...new Set(report.rows.flatMap(row => Object.keys(row.creditDelta)))];
const meanDeltaByObjective = Object.fromEntries(objectiveKeys.map(key => {
  const values = report.rows.map(row => row.creditDelta[key] ?? 0);
  const mean = values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return [key, Math.round(mean * 1000) / 1000];
}));
const durationCoverageRatios = report.rows
  .map(row => row.durationCoverageRatio)
  .filter(value => typeof value === 'number');

console.log(JSON.stringify({
  evidenceClass: 'bounded de-identified real Garmin history; no outcome labels',
  candidatePolicyId: report.candidatePolicyId,
  activityCount: report.activityCount,
  eligibleActivityCount: report.eligibleActivityCount,
  fallbackActivityCount: report.fallbackActivityCount,
  disagreementActivityCount: report.disagreementActivityCount,
  meanAbsoluteCreditDelta: report.meanAbsoluteCreditDelta,
  meanCreditDeltaByObjective: meanDeltaByObjective,
  durationCoverageRatioRange: durationCoverageRatios.length === 0 ? null : {
    min: Math.min(...durationCoverageRatios),
    max: Math.max(...durationCoverageRatios),
  },
}, null, 2));
