#!/usr/bin/env node
/**
 * TO4 (#646) preparation step: raw user-scoped record export -> sanitized prepared input for
 * `training-occurrence-evidence.mjs`. Runs the production parsers, the live history snapshot,
 * the canonical broad-history adapter and the two-pass recommendation counterfactual.
 * Reads one local file, writes local ignored files only; no network, Firestore or flag access.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = resolve(appRoot, 'artifacts', 'training-occurrence');
const COVERAGE_POLICY_VERSION = '2026-09-canonical-coverage-credit-v1';
const FIT_FINGERPRINT_VERSION = 'fit-workout-v2';
const DEFAULT_REFERENCE_SCENARIO = 'evergreen_balanced_four_sessions';

function argument(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function usage() {
    console.error('Usage: npm run evidence:training-occurrence:prepare -- --records <records.json> [--out <prepared-input.json>]');
    console.error('       [--review-sheet-out <private-review.json>] [--labels <labels.json>] [--fit-evidence <fit-evidence.json>] [--reference-scenario <id>] [--no-replay]');
    console.error(`All paths must be under ${relative(process.cwd(), artifactsRoot) || artifactsRoot} (git-ignored).`);
}

/** Refuses any read/write outside the ignored evidence directory so private material cannot
 * be written somewhere that a routine `git add` would pick up. */
function realpathOfNearestExisting(path) {
    // Resolve symlinks/junctions on the part of the path that exists so a link inside the
    // artifact directory cannot redirect a write into a tracked directory.
    return existsSync(path) ? realpathSync.native(path) : join(realpathOfNearestExisting(dirname(path)), basename(path));
}

function artifactPath(path, label) {
    mkdirSync(artifactsRoot, { recursive: true });
    const root = realpathSync.native(artifactsRoot);
    const resolved = realpathOfNearestExisting(resolve(path));
    if (!resolved.startsWith(`${root}${sep}`)) {
        throw new Error(`${label} must be a file under ${artifactsRoot}.`);
    }
    return resolved;
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function addDays(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

if (process.argv.includes('--help') || !argument('--records')) {
    usage();
    process.exit(process.argv.includes('--help') ? 0 : 2);
}

const recordsPath = artifactPath(argument('--records'), '--records');
const outPath = artifactPath(argument('--out', resolve(artifactsRoot, 'prepared-input.json')), '--out');
const reviewSheetPath = artifactPath(argument('--review-sheet-out', resolve(artifactsRoot, 'private-review-sheet.json')), '--review-sheet-out');
const labelsArgument = argument('--labels');
const labelsFile = labelsArgument ? JSON.parse(readFileSync(artifactPath(labelsArgument, '--labels'), 'utf8')) : undefined;
const scenarioId = argument('--reference-scenario', DEFAULT_REFERENCE_SCENARIO);
if (!existsSync(recordsPath)) throw new Error(`Record export not found: ${recordsPath}`);
const recordsBytes = readFileSync(recordsPath);
const records = JSON.parse(recordsBytes.toString('utf8'));
// Aliases are only stable for one exact export; labels must name the export they were written for.
const recordsSha256 = createHash('sha256').update(recordsBytes).digest('hex');
if (labelsFile && labelsFile.recordsSha256 !== recordsSha256) {
    throw new Error('Labels were written for a different record export (recordsSha256 mismatch); relabel from the current review sheet.');
}
const labels = labelsFile?.labels;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim();

const server = await createServer({
    configFile: false, root: appRoot, logLevel: 'warn', server: { middlewareMode: true }, appType: 'custom',
});
try {
    const { prepareTo4Evidence } = await server.ssrLoadModule('/src/training-occurrence/to4EvidencePreparation.ts');
    const { hashSessionDefinition } = await server.ssrLoadModule('/src/sessions/sessionDefinitionHash.ts');
    const { parseSessionDefinitionRevisionDocument } = await server.ssrLoadModule('/src/persistence/parsers/sessionDefinition.ts');
    const { runHistoryCounterfactualSeries } = await server.ssrLoadModule('/src/training-occurrence/historyRecommendationCounterfactual.ts');
    const { SCENARIOS } = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');

    const manualSources = (records.sessionExecutions ?? [])
        .map(({ data }) => data?.sessionSource)
        .filter(source => source?.kind === 'manual');
    const manualDefinitionRevisions = [];
    for (const document of records.sessionDefinitionRevisions ?? []) {
        const data = document.data;
        const source = manualSources.find(candidate => candidate.definitionId === data?.definitionId
            && candidate.revision === data?.revision
            && candidate.contentHash === data?.contentHash);
        if (!source || document.id !== String(source.revision)) continue;
        const parsed = parseSessionDefinitionRevisionDocument(data, {
            userId: records.userId,
            definitionId: source.definitionId,
            revision: source.revision,
        }, `session_definitions/${source.definitionId}/revisions/${source.revision}`);
        if (parsed.status !== 'AVAILABLE' || parsed.data.contentHash !== source.contentHash) continue;
        if (await hashSessionDefinition(parsed.data.definition) !== source.contentHash) continue;
        manualDefinitionRevisions.push({ definition: parsed.data.definition, contentHash: parsed.data.contentHash });
    }

    const prepared = prepareTo4Evidence(records, {
        sourceCommit,
        coveragePolicyVersion: COVERAGE_POLICY_VERSION,
        fitFingerprintVersion: FIT_FINGERPRINT_VERSION,
        labels,
        manualDefinitionRevisions,
    });

    if (!process.argv.includes('--no-replay')) {
        const scenario = SCENARIOS.find(candidate => candidate.id === scenarioId);
        if (!scenario) throw new Error(`Unknown reference scenario: ${scenarioId}`);
        // A fixed reference day isolates the engine's sensitivity to history alone. It is not
        // the athlete's real readiness/context for each date; the report must say so.
        const inputs = {
            readiness: scenario.readinessForWeek(0),
            context: scenario.context,
            events: [...(scenario.events ?? (scenario.event ? [scenario.event] : []))],
            fixedActivities: scenario.fixedActivities ?? [],
            trainingIntentProfile: scenario.trainingIntentProfile ?? null,
            preferences: scenario.preferences ?? null,
        };
        const dates = [];
        for (let date = addDays(records.window.startDate, 7); date <= records.window.endDateExclusive; date = addDays(date, 1)) dates.push(date);
        const series = await runHistoryCounterfactualSeries(inputs, prepared.liveExposures, prepared.canonicalExposures, dates);
        const repeat = await runHistoryCounterfactualSeries(inputs, prepared.liveExposures, prepared.canonicalExposures, dates);
        prepared.preparedInput.recommendationSeries = {
            status: 'compared',
            referenceSource: `simulation-scenario:${scenarioId}`,
            nonHistoryInputsHash: createHash('sha256').update(canonicalJson(inputs), 'utf8').digest('hex'),
            evaluatedDates: series.evaluatedDates,
            changedDates: series.changedDates,
            unresolvedDates: series.unresolvedDates,
            changedFieldCounts: series.changedFieldCounts,
            repeatRunIdentical: canonicalJson(series) === canonicalJson(repeat),
        };
        if (canonicalJson(series) !== canonicalJson(repeat)) prepared.preparedInput.hardGates.deterministicReplayStable = 'fail';
        // Per-date projections can reveal the athlete's training pattern; keep them private.
        writeJson(resolve(dirname(reviewSheetPath), 'private-recommendation-series.json'), series);
    }

    const fitArgument = argument('--fit-evidence');
    if (fitArgument) {
        // Only the aggregate crosses into the prepared input; private per-file rows stay behind.
        const { aggregate } = JSON.parse(readFileSync(artifactPath(fitArgument, '--fit-evidence'), 'utf8'));
        if (aggregate?.fitFingerprintVersion !== FIT_FINGERPRINT_VERSION) throw new Error('FIT evidence was produced by a different fingerprint version.');
        const { fitFingerprintVersion: _version, ...counts } = aggregate;
        prepared.preparedInput.corpus.originalFit = 'prepared';
        prepared.preparedInput.corpus.originalFitCount = (counts.activitiesExamined ?? 0)
            + (counts.notExaminedRateLimited ?? 0);
        prepared.preparedInput.fitEvidence = { status: 'prepared', decision: 'BLOCKED_NEEDS_ADAPTIVE_IDENTITY', ...counts };
    }

    writeJson(outPath, prepared.preparedInput);
    writeJson(reviewSheetPath, { recordsSha256, rows: prepared.privateReviewSheet });
    console.log(`Prepared input: ${outPath}`);
    console.log(`Private review sheet (do not commit): ${reviewSheetPath}`);
} finally {
    await server.close();
}
