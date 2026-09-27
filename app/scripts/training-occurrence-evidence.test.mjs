import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoots = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function makeInput() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'to-evidence-'));
    tempRoots.push(dir);
    const inputPath = path.join(dir, 'prepared.json');
    const outputPath = path.join(dir, 'report.json');
    const zeroCost = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const input = {
        schemaVersion: 1,
        metadata: {
            sourceCommit: 'synthetic-fixture',
            occurrenceSchemaVersion: 1,
            matcherVersion: 'matcher-v1',
            reconciliationPolicyVersion: 'policy-v1',
            coveragePolicyVersion: '2026-09-canonical-coverage-credit-v1',
            fitFingerprintVersion: 'fit-workout-v2',
        },
        corpus: { realHistory: 'not_supplied', originalFit: 'not_supplied', strata: { synthetic_matched: 1 } },
        liveExposures: [{ occurrenceKey: 'fixture-pair', date: '2026-09-01', costProfile: zeroCost, trainingRecordLike: { type: 'Strength', duration_min: 40, training_effect: 0, intensity_tag: 'moderate' } }],
        canonicalExposures: [{ occurrenceKey: 'fixture-pair', date: '2026-09-01', costProfile: zeroCost, trainingRecordLike: { type: 'Strength', duration_min: 40, training_effect: 0, intensity_tag: 'moderate' } }],
        unknownCanonicalOccurrenceKeys: [],
        recommendationReplay: {
            live: { nonHistoryInputs: { date: '2026-09-01', readiness: { state: 'same' } }, decisionProjection: { mode: 'train', selectedTemplate: 'strength', dose: { minutes: 40 } } },
            canonical: { nonHistoryInputs: { readiness: { state: 'same' }, date: '2026-09-01' }, decisionProjection: { mode: 'train', selectedTemplate: 'strength', dose: { minutes: 40 } } },
        },
    };
    await writeFile(inputPath, JSON.stringify(input), 'utf8');
    return { inputPath, outputPath };
}

describe('training-occurrence evidence runner', () => {
    it('writes a deterministic sanitized report from prepared data and identifies missing real strata honestly', async () => {
        const { inputPath, outputPath } = await makeInput();
        const run = () => spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath, outputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run().status).toBe(0);
        const first = await readFile(outputPath, 'utf8');
        expect(run().status).toBe(0);
        const second = await readFile(outputPath, 'utf8');

        expect(second).toBe(first);
        expect(JSON.parse(first)).toMatchObject({
            corpus: { realHistory: 'not_supplied', originalFit: 'not_supplied' },
            exposureComparison: { liveCount: 1, canonicalCount: 1, countDelta: 0 },
            recommendationComparison: { status: 'compared', delta: { classification: 'unchanged' } },
        });
    });

    it('refuses to compare recommendation outputs when independently canonicalized non-history inputs differ', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.recommendationReplay.canonical.nonHistoryInputs.readiness.state = 'changed';
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).toBe(0);
        expect(JSON.parse(run.stdout).recommendationComparison).toMatchObject({
            status: 'inputs_mismatch',
            delta: { status: 'not_compared', reason: 'non_history_inputs_hash_mismatch' },
        });
    });

    it('rejects a ready activation decision when real evidence and hard-gate results are absent', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.decisions = { broadHistory: 'READY_FOR_SEPARATE_ACTIVATION_PR' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Broad-history readiness requires prepared real history');
    });

    it('rejects a claimed history denominator that is not represented by both exposure evidence sets', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.corpus = { realHistory: 'prepared', realHistoryOccurrenceCount: 1, originalFit: 'not_supplied', strata: { matched_structured_garmin_strength: 1 } };
        input.liveExposures = [];
        input.canonicalExposures = [];
        input.hardGates = Object.fromEntries([
            'noCrossUserEvidenceLeakage', 'noSourceUniquenessViolations', 'noStickyManualDecisionViolations',
            'noCoreSyncFailuresFromFitDecode', 'deterministicReplayStable', 'noKnownFalsePositiveMerges',
            'matchedOccurrenceSingleExposure', 'structuredSemanticAuthorityPreserved', 'missingDetailRemainsUnknown', 'noRawFitPrivatePayloadCommitted',
        ].map(name => [name, 'pass']));
        input.decisions = { broadHistory: 'READY_FOR_SEPARATE_ACTIVATION_PR' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Broad-history readiness requires prepared real history');
    });

    it('rejects inconsistent prepared FIT denominator accounting even while authority stays blocked', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.corpus = { realHistory: 'not_supplied', originalFit: 'prepared', originalFitCount: 3, strata: {} };
        input.fitEvidence = {
            status: 'prepared', decision: 'BLOCKED_NEEDS_ADAPTIVE_IDENTITY',
            activitiesExamined: 2, notExaminedRateLimited: 0,
            originalFitAvailable: 2, originalFitUnavailable: 0, downloadFailure: 0,
            decodeSuccess: 2, decodeFailure: 0,
            semanticDefinitionFingerprintCount: 1, observedIndexFallbackFingerprintCount: 0, noWorkoutEvidenceCount: 1,
            malformedCount: 0, unsupportedCount: 0,
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Prepared FIT evidence denominators are inconsistent');
    });

    it('reports a fully unavailable prepared FIT corpus as missing evidence instead of malformed accounting', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.corpus = { realHistory: 'not_supplied', originalFit: 'prepared', originalFitCount: 2, strata: {} };
        input.fitEvidence = {
            status: 'prepared', decision: 'BLOCKED_NEEDS_ADAPTIVE_IDENTITY',
            activitiesExamined: 2, notExaminedRateLimited: 0,
            originalFitAvailable: 0, originalFitUnavailable: 2, downloadFailure: 0,
            decodeSuccess: 0, decodeFailure: 0,
            semanticDefinitionFingerprintCount: 0, observedIndexFallbackFingerprintCount: 0, noWorkoutEvidenceCount: 0,
            malformedCount: 0, unsupportedCount: 0,
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).toBe(0);
        expect(JSON.parse(run.stdout).fitEvidence).toMatchObject({
            status: 'prepared', originalFitAvailable: 0, originalFitUnavailable: 2,
        });
    });
    it('blocks TO5 readiness when a rate limit leaves part of the declared FIT corpus unexamined', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.corpus = { realHistory: 'not_supplied', originalFit: 'prepared', originalFitCount: 3, strata: {} };
        input.fitEvidence = {
            status: 'prepared', decision: 'READY_FOR_SEPARATE_ACTIVATION_DESIGN',
            activitiesExamined: 2, notExaminedRateLimited: 1,
            originalFitAvailable: 2, originalFitUnavailable: 0, downloadFailure: 0,
            decodeSuccess: 2, decodeFailure: 0,
            semanticDefinitionFingerprintCount: 1, observedIndexFallbackFingerprintCount: 0, noWorkoutEvidenceCount: 1,
            malformedCount: 0, unsupportedCount: 0, reviewedLabelCount: 1,
        };
        input.hardGates = Object.fromEntries([
            'noCrossUserEvidenceLeakage', 'noSourceUniquenessViolations', 'noStickyManualDecisionViolations',
            'noCoreSyncFailuresFromFitDecode', 'deterministicReplayStable', 'noKnownFalsePositiveMerges',
            'matchedOccurrenceSingleExposure', 'structuredSemanticAuthorityPreserved', 'missingDetailRemainsUnknown', 'noRawFitPrivatePayloadCommitted',
        ].map(name => [name, 'pass']));
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('TO5 readiness requires prepared original FIT');
    });
    it('rejects TO5 readiness without original FIT files and reviewed labels', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.fitEvidence = { decision: 'READY_FOR_SEPARATE_ACTIVATION_DESIGN' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('TO5 readiness requires prepared original FIT');
    });

    it('rejects unknown reportable metadata instead of copying private caller fields into a sanitized report', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.metadata.userId = 'private-user';
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('metadata contains unsupported fields: userId');
    });

    it('reports prepared canonical-derivation and recommendation-series aggregates and rejects inconsistent ones', async () => {
        const { inputPath, outputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.canonicalDerivation = { windowDays: 7, parsedOccurrences: 2, invalidRecords: 0, crossUserRecordsRejected: 0, derived: 1, unknownByReason: { provider_source_unavailable: 1 } };
        input.recommendationSeries = {
            status: 'compared', referenceSource: 'simulation-scenario:evergreen_balanced_four_sessions',
            nonHistoryInputsHash: 'a'.repeat(64), evaluatedDates: 3, changedDates: 1, unresolvedDates: 1,
            changedFieldCounts: { fatigue: 1 }, repeatRunIdentical: true,
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = () => spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath, outputPath,
        ], { cwd: appRoot, encoding: 'utf8' });
        expect(run().status).toBe(0);
        expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({
            canonicalDerivation: { status: 'prepared', derived: 1, unknownByReason: { provider_source_unavailable: 1 } },
            recommendationSeries: { status: 'compared', unresolvedDates: 1, changedFieldCounts: { fatigue: 1 } },
        });

        input.canonicalDerivation.derived = 2;
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const mismatch = run();
        expect(mismatch.status).not.toBe(0);
        expect(mismatch.stderr).toContain('canonicalDerivation.derived must equal');

        input.canonicalDerivation.derived = 1;
        input.canonicalDerivation.unknownByReason = { free_text_reason: 1 };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        expect(run().stderr).toContain('unsupported fields: free_text_reason');
    });

    it('rejects equal-count broad-history readiness when occurrence aliases are not paired one-to-one', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.corpus = { realHistory: 'prepared', realHistoryOccurrenceCount: 1, originalFit: 'not_supplied', strata: { matched_structured_garmin_strength: 1 } };
        input.liveExposures[0].occurrenceKey = 'live-only';
        input.canonicalExposures[0].occurrenceKey = 'canonical-only';
        input.hardGates = Object.fromEntries([
            'noCrossUserEvidenceLeakage', 'noSourceUniquenessViolations', 'noStickyManualDecisionViolations',
            'noCoreSyncFailuresFromFitDecode', 'deterministicReplayStable', 'noKnownFalsePositiveMerges',
            'matchedOccurrenceSingleExposure', 'structuredSemanticAuthorityPreserved', 'missingDetailRemainsUnknown', 'noRawFitPrivatePayloadCommitted',
        ].map(name => [name, 'pass']));
        input.decisions = { broadHistory: 'READY_FOR_SEPARATE_ACTIVATION_PR' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Broad-history readiness requires');
    });

    it('rejects a single-exposure pass when one canonical alias contributes two exposures', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.canonicalExposures.push({ ...input.canonicalExposures[0] });
        input.hardGates = { matchedOccurrenceSingleExposure: 'pass' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });
        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('matchedOccurrenceSingleExposure cannot be pass');
    });

    it('accepts a prepared real-shaped export with an unpaired live-only activity end to end', async () => {
        const { prepareTo4Evidence } = await import('../src/training-occurrence/to4EvidencePreparation.ts');
        const { workoutForTemplate } = await import('../src/workouts/prescription.ts');
        const { inputPath, outputPath } = await makeInput();
        const occurrence = {
            schemaVersion: 1, performedOccurrenceId: 'p1', userId: 'u1', status: 'active', localDate: '2026-08-06', modality: 'cycling',
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'a1' }, { kind: 'provider_activity', provider: 'garmin', activityId: 'a1b' }],
            reconciliation: { state: 'matched' }, createdAt: 'x', updatedAt: 'x',
        };
        const activity = (activityId, date) => ({ id: activityId, data: { activityId, date, type: 'cycling', durationMin: 45, trainingEffectAerobic: 3, trainingEffectAnaerobic: null, averageHr: 140, activityTrainingLoad: 90, intensityTag: 'moderate' } });
        const prepared = prepareTo4Evidence({
            schemaVersion: 1, userId: 'u1', window: { startDate: '2026-08-01', endDateExclusive: '2026-08-08' },
            performedTrainingOccurrences: [
                { id: 'p1', data: occurrence },
                { id: 'p3', data: { ...occurrence, performedOccurrenceId: 'p3', localDate: '2026-08-05', sourceRefs: [{ kind: 'structured_execution', executionId: 'e3' }, { kind: 'provider_activity', provider: 'garmin', activityId: 'a3' }] } },
            ],
            sessionExecutions: [{ id: 'e3', data: {
                userId: 'u1', executionId: 'e3', date: '2026-08-05', sessionSource: { kind: 'catalog', workoutId: workoutForTemplate('end_mod_02').id, catalogVersion: 'v1' },
                startedAt: '2026-08-05T16:00:00Z', completedAt: '2026-08-05T16:45:00Z', updatedAt: 'x', state: 'completed', schemaVersion: 1,
            } }],
            activities: [activity('a1', '2026-08-06'), activity('a1b', '2026-08-06'), activity('a2', '2026-08-07'), activity('a3', '2026-08-05')], dailyRecommendations: [],
        }, { sourceCommit: 'synthetic-fixture', coveragePolicyVersion: 'coverage-v1', fitFingerprintVersion: 'fit-workout-v2' });
        await writeFile(inputPath, JSON.stringify(prepared.preparedInput), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath, outputPath,
        ], { cwd: appRoot, encoding: 'utf8' });
        expect(run.stderr).toBe('');
        const report = JSON.parse(await readFile(outputPath, 'utf8'));
        expect(report.identityEvidence).toMatchObject({ pairedLiveOnly: 1, multiProviderSourceOccurrences: 1 });
        expect(report.canonicalDerivation.unknownByReason).toEqual({ multiple_provider_sources: 1 });
        expect(report.hardGates).toMatchObject({
            missingDetailRemainsUnknown: 'pass',
            matchedOccurrenceSingleExposure: 'pass',
            structuredSemanticAuthorityPreserved: 'pass',
        });
    });

    it('keeps Activities activation out of scope instead of inferring it from unrelated TO4/TO5 gates', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.decisions = { activitiesFlag: 'READY_FOR_SEPARATE_ACTIVATION_PR' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Activities read-model activation is outside this TO4/TO5 runner');
    });

    it('rejects the top-level FIT activation decision when TO5 evidence is still blocked', async () => {
        const { inputPath } = await makeInput();
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        input.decisions = { fitIdentity: 'READY_FOR_SEPARATE_ACTIVATION_PR' };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const run = spawnSync(process.execPath, [
            '--experimental-strip-types', 'scripts/training-occurrence-evidence.mjs', inputPath,
        ], { cwd: appRoot, encoding: 'utf8' });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('FIT-identity readiness requires a qualified TO5 design decision');
    });
});
