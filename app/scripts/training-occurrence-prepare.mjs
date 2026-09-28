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
import { assertEvidenceLabelsMatchProvenance, historicalSourceTreeSha256 } from './training-occurrence-source-tree.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: appRoot, encoding: 'utf8' }).trim();
const artifactsRoot = resolve(appRoot, 'artifacts', 'training-occurrence');
const COVERAGE_POLICY_VERSION = '2026-09-canonical-coverage-credit-v1';
const FIT_FINGERPRINT_VERSION = 'fit-workout-v2';

function argument(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function usage() {
    console.error('Usage: npm run evidence:training-occurrence:prepare -- --records <records.json> [--out <prepared-input.json>]');
    console.error('       [--review-sheet-out <private-review.json>] [--labels <labels.json>] [--recommendation-labels <labels.json>] [--fit-evidence <fit-evidence.json>]');
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

if (process.argv.includes('--help') || !argument('--records')) {
    usage();
    process.exit(process.argv.includes('--help') ? 0 : 2);
}

const recordsPath = artifactPath(argument('--records'), '--records');
const outPath = artifactPath(argument('--out', resolve(artifactsRoot, 'prepared-input.json')), '--out');
const reviewSheetPath = artifactPath(argument('--review-sheet-out', resolve(artifactsRoot, 'private-review-sheet.json')), '--review-sheet-out');
const labelsArgument = argument('--labels');
const labelsFile = labelsArgument ? JSON.parse(readFileSync(artifactPath(labelsArgument, '--labels'), 'utf8')) : undefined;
const recommendationLabelsArgument = argument('--recommendation-labels');
const recommendationLabelsFile = recommendationLabelsArgument
    ? JSON.parse(readFileSync(artifactPath(recommendationLabelsArgument, '--recommendation-labels'), 'utf8'))
    : undefined;
if (!existsSync(recordsPath)) throw new Error(`Record export not found: ${recordsPath}`);
const recordsBytes = readFileSync(recordsPath);
const records = JSON.parse(recordsBytes.toString('utf8'));
const recordsSha256 = createHash('sha256').update(recordsBytes).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const sourceTreeSha256 = historicalSourceTreeSha256(repoRoot);
const evidenceProvenance = { recordsSha256, sourceCommit, sourceTreeSha256 };
assertEvidenceLabelsMatchProvenance(labelsFile, evidenceProvenance, 'Occurrence');
const labels = labelsFile?.labels;

const server = await createServer({
    configFile: false, root: appRoot, logLevel: 'warn', server: { middlewareMode: true }, appType: 'custom',
});
try {
    const { prepareTo4Evidence } = await server.ssrLoadModule('/src/training-occurrence/to4EvidencePreparation.ts');
    const { hashSessionDefinition } = await server.ssrLoadModule('/src/sessions/sessionDefinitionHash.ts');
    const { parseSessionDefinitionRevisionDocument } = await server.ssrLoadModule('/src/persistence/parsers/sessionDefinition.ts');
    const { assembleOfflineHistoricalContext } = await server.ssrLoadModule('/src/training-occurrence/offlineContextAssembler.ts');
    const { runHistoryCounterfactualSeries } = await server.ssrLoadModule('/src/training-occurrence/historyRecommendationCounterfactual.ts');
    const { POLICY_VERSION } = await server.ssrLoadModule('/src/engine/policy.ts');

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
        sourceTreeSha256,
        coveragePolicyVersion: COVERAGE_POLICY_VERSION,
        fitFingerprintVersion: FIT_FINGERPRINT_VERSION,
        labels,
        manualDefinitionRevisions,
    });

    const policyVersion = POLICY_VERSION;
    assertEvidenceLabelsMatchProvenance(recommendationLabelsFile, evidenceProvenance, 'Recommendation');
    if (recommendationLabelsFile && (recommendationLabelsFile.policyVersion !== policyVersion
        || !Array.isArray(recommendationLabelsFile.labels))) {
        throw new Error('Recommendation labels must match this export, source commit, source tree and policy version.');
    }
    const context = assembleOfflineHistoricalContext(prepared.sourceEvidence, records.userId);
    const seriesOptions = {
        dates: context.dates,
        inputForDate: context.inputForDate,
        recordsSha256,
        sourceCommit,
        sourceTreeSha256,
        policyVersion,
        reviewLabels: recommendationLabelsFile?.labels,
    };
    const series = await runHistoryCounterfactualSeries(seriesOptions);
    const repeat = await runHistoryCounterfactualSeries(seriesOptions);
    const repeatRunIdentical = canonicalJson(series) === canonicalJson(repeat);
    const seriesDigest = createHash('sha256').update(canonicalJson(series), 'utf8').digest('hex');
    prepared.preparedInput.recommendationSeries = {
        status: series.evaluatedDates > 0 && series.notReplayableDates === 0 && repeatRunIdentical ? 'compared' : 'blocked',
        referenceSource: series.referenceSource,
        seriesDigest,
        candidateDates: series.candidateDates,
        evaluatedDates: series.evaluatedDates,
        notApplicableDates: series.notApplicableDates,
        notReplayableDates: series.notReplayableDates,
        changedDates: series.changedDates,
        expectedDates: series.expectedDates,
        explainableDates: series.explainableDates,
        unresolvedDates: series.unresolvedDates,
        changedFieldCounts: series.changedFieldCounts,
        notReplayableByReason: series.notReplayableByReason,
        classificationReasonCounts: series.classificationReasonCounts,
        repeatRunIdentical,
    };
    if (!repeatRunIdentical) prepared.preparedInput.hardGates.deterministicReplayStable = 'fail';
    // Per-date output and source coverage can reveal private training patterns; keep them local.
    const datesByAlias = Object.fromEntries(context.dates.map((date, index) => [
        `D${String(index + 1).padStart(3, '0')}`, date,
    ]));
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

    const finalSourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const finalSourceTreeSha256 = historicalSourceTreeSha256(repoRoot);
    if (finalSourceCommit !== sourceCommit || finalSourceTreeSha256 !== sourceTreeSha256) {
        throw new Error('source_tree_changed_during_historical_preparation');
    }
    writeJson(artifactPath(resolve(dirname(reviewSheetPath), 'private-recommendation-series.json'), '--private-recommendation-series'), {
        recordsSha256, sourceCommit, sourceTreeSha256, policyVersion, datesByAlias, series,
    });
    writeJson(artifactPath(resolve(dirname(reviewSheetPath), 'private-source-coverage.json'), '--private-source-coverage'), context.sourceCoverage);
    writeJson(outPath, prepared.preparedInput);
    writeJson(reviewSheetPath, { ...evidenceProvenance, rows: prepared.privateReviewSheet });
    console.log(`Prepared input: ${outPath}`);
    console.log(`Private review sheet (do not commit): ${reviewSheetPath}`);
} finally {
    await server.close();
}
