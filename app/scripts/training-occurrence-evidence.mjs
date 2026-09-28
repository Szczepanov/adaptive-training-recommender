#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function usage() {
    console.error('Usage: npm run evidence:training-occurrence -- <prepared-input.json> [report.json]');
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

function sha256(value) {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
}

function assertKnownKeys(value, allowed, label) {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.sort().join(', ')}.`);
}

function nonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
    return value;
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${label} must be a finite number between ${min} and ${max}.`);
    }
    return value;
}

function validateExposureSet(rows, label) {
    const costDimensions = ['systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular'];
    const stimulusDimensions = ['aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges', 'sprintPower', 'fatigueResistance', 'maxStrength', 'hypertrophy'];
    rows.forEach((row, index) => {
        const prefix = `${label}[${index}]`;
        plainObject(row, prefix);
        if (row.occurrenceKey !== undefined && (typeof row.occurrenceKey !== 'string' || row.occurrenceKey.length === 0 || row.occurrenceKey.length > 128)) {
            throw new Error(`${prefix}.occurrenceKey must be a non-empty opaque alias up to 128 characters.`);
        }
        if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`${prefix}.date must be YYYY-MM-DD.`);
        const cost = plainObject(row.costProfile, `${prefix}.costProfile`);
        for (const dimension of costDimensions) finiteNumber(cost[dimension], `${prefix}.costProfile.${dimension}`);
        const record = plainObject(row.trainingRecordLike, `${prefix}.trainingRecordLike`);
        if (typeof record.type !== 'string' || typeof record.intensity_tag !== 'string') throw new Error(`${prefix}.trainingRecordLike type/intensity_tag must be strings.`);
        finiteNumber(record.duration_min, `${prefix}.trainingRecordLike.duration_min`, { min: 0 });
        finiteNumber(record.training_effect, `${prefix}.trainingRecordLike.training_effect`);
        if (row.deliveredDose !== undefined) {
            const dose = plainObject(row.deliveredDose, `${prefix}.deliveredDose`);
            assertKnownKeys(dose, ['plannedDurationMin', 'completedDurationMin', 'completionRatio'], `${prefix}.deliveredDose`);
            if (dose.plannedDurationMin !== undefined) finiteNumber(dose.plannedDurationMin, `${prefix}.deliveredDose.plannedDurationMin`, { min: 0 });
            if (dose.completedDurationMin !== undefined) finiteNumber(dose.completedDurationMin, `${prefix}.deliveredDose.completedDurationMin`, { min: 0 });
            if (dose.completionRatio !== undefined) finiteNumber(dose.completionRatio, `${prefix}.deliveredDose.completionRatio`, { min: 0, max: 1 });
        }
        if (row.recoveryHours !== undefined) finiteNumber(row.recoveryHours, `${prefix}.recoveryHours`, { min: 0 });
        if (row.stimulusConfidence !== undefined && !['exact', 'inferred', 'unknown'].includes(row.stimulusConfidence)) {
            throw new Error(`${prefix}.stimulusConfidence must be exact, inferred, or unknown.`);
        }
        if (row.stimulusProfile !== undefined) {
            const stimulus = plainObject(row.stimulusProfile, `${prefix}.stimulusProfile`);
            for (const dimension of stimulusDimensions) {
                if (stimulus[dimension] !== undefined) finiteNumber(stimulus[dimension], `${prefix}.stimulusProfile.${dimension}`);
            }
        }
    });
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args[0] === '--help') {
    usage();
    process.exit(args[0] === '--help' ? 0 : 2);
}

const inputPath = path.resolve(args[0]);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const { compareCompletedExposureSets, compareRecommendationOutputs } = await import(
    pathToFileURL(path.resolve('src/training-occurrence/historyCounterfactual.ts')).href
);

const requiredMetadata = ['sourceCommit', 'occurrenceSchemaVersion', 'matcherVersion', 'reconciliationPolicyVersion', 'coveragePolicyVersion', 'fitFingerprintVersion'];
const topLevelKeys = ['schemaVersion', 'metadata', 'corpus', 'liveExposures', 'canonicalExposures', 'unknownCanonicalOccurrenceKeys', 'recommendationReplay', 'recommendationSeries', 'canonicalDerivation', 'identityEvidence', 'fitEvidence', 'hardGates', 'deferredBlockers', 'decisions'];
if (input.schemaVersion !== 1 || !input.metadata || !Array.isArray(input.liveExposures) || !Array.isArray(input.canonicalExposures)) {
    throw new Error('Prepared evidence input must have schemaVersion 1, metadata, liveExposures, and canonicalExposures.');
}
assertKnownKeys(plainObject(input, 'prepared evidence input'), topLevelKeys, 'prepared evidence input');
const metadataInput = plainObject(input.metadata, 'metadata');
assertKnownKeys(metadataInput, requiredMetadata, 'metadata');
const missingMetadata = requiredMetadata.filter(key => typeof metadataInput[key] !== 'string' && typeof metadataInput[key] !== 'number');
if (missingMetadata.length) throw new Error(`Prepared evidence metadata is missing: ${missingMetadata.join(', ')}.`);
if (typeof metadataInput.sourceCommit !== 'string' || !/^(?:[0-9a-f]{7,40}|synthetic-fixture)$/.test(metadataInput.sourceCommit)) {
    throw new Error('metadata.sourceCommit must be a Git SHA or synthetic-fixture.');
}
if (!Number.isInteger(metadataInput.occurrenceSchemaVersion) || metadataInput.occurrenceSchemaVersion < 1) {
    throw new Error('metadata.occurrenceSchemaVersion must be a positive integer.');
}
for (const key of requiredMetadata.filter(key => !['sourceCommit', 'occurrenceSchemaVersion'].includes(key))) {
    if (typeof metadataInput[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(metadataInput[key])) {
        throw new Error(`metadata.${key} must be a bounded version token.`);
    }
}
const metadata = Object.fromEntries(requiredMetadata.map(key => [key, metadataInput[key]]));

validateExposureSet(input.liveExposures, 'liveExposures');
validateExposureSet(input.canonicalExposures, 'canonicalExposures');

const gateNames = [
    'noCrossUserEvidenceLeakage', 'noSourceUniquenessViolations', 'noStickyManualDecisionViolations',
    'noCoreSyncFailuresFromFitDecode', 'deterministicReplayStable', 'noKnownFalsePositiveMerges',
    'matchedOccurrenceSingleExposure', 'structuredSemanticAuthorityPreserved', 'missingDetailRemainsUnknown', 'noRawFitPrivatePayloadCommitted',
];
const gateStates = new Set(['pass', 'fail', 'not_evaluated']);
const hardGateInput = input.hardGates === undefined ? {} : plainObject(input.hardGates, 'hardGates');
assertKnownKeys(hardGateInput, gateNames, 'hardGates');
const hardGates = Object.fromEntries(gateNames.map(name => [name, hardGateInput[name] ?? 'not_evaluated']));
for (const [name, state] of Object.entries(hardGates)) if (!gateStates.has(state)) throw new Error(`Invalid hard-gate state for ${name}: ${state}.`);

const deferredNames = ['openRestCrashRecovery', 'linkedProviderProjectionRefresh', 'sourceDeletionRevocation', 'comparableAdaptiveFitIdentity'];
const blockerStates = new Set(['BLOCKING', 'NOT_BLOCKING_FOR_THIS_SURFACE', 'SEPARATE_FOLLOW_UP']);
const deferredInput = input.deferredBlockers === undefined ? {} : plainObject(input.deferredBlockers, 'deferredBlockers');
assertKnownKeys(deferredInput, deferredNames, 'deferredBlockers');
const deferredBlockers = Object.fromEntries(deferredNames.map(name => [name, deferredInput[name] ?? 'SEPARATE_FOLLOW_UP']));
for (const [name, state] of Object.entries(deferredBlockers)) if (!blockerStates.has(state)) throw new Error(`Invalid deferred-blocker state for ${name}: ${state}.`);

const decisionNames = ['broadHistory', 'fitIdentity', 'activitiesFlag'];
const decisionInput = input.decisions === undefined ? {} : plainObject(input.decisions, 'decisions');
assertKnownKeys(decisionInput, decisionNames, 'decisions');
const decisions = {
    broadHistory: decisionInput.broadHistory ?? 'BLOCKED_NEEDS_MORE_EVIDENCE',
    fitIdentity: decisionInput.fitIdentity ?? 'BLOCKED_NEEDS_MORE_EVIDENCE',
    activitiesFlag: decisionInput.activitiesFlag ?? 'KEEP_CURRENT_AUTHORITY',
};
const decisionStates = {
    broadHistory: new Set(['KEEP_CURRENT_AUTHORITY', 'READY_FOR_SEPARATE_ACTIVATION_PR', 'BLOCKED_NEEDS_MORE_EVIDENCE', 'BLOCKED_NEEDS_CAPABILITY', 'NO_SHIP']),
    fitIdentity: new Set(['KEEP_CURRENT_AUTHORITY', 'READY_FOR_SEPARATE_ACTIVATION_PR', 'BLOCKED_NEEDS_MORE_EVIDENCE', 'BLOCKED_NEEDS_CAPABILITY', 'NO_SHIP']),
    activitiesFlag: new Set(['KEEP_CURRENT_AUTHORITY', 'READY_FOR_SEPARATE_ACTIVATION_PR', 'BLOCKED_NEEDS_MORE_EVIDENCE', 'BLOCKED_NEEDS_CAPABILITY', 'NO_SHIP']),
};

const corpusKeys = ['realHistory', 'realHistoryOccurrenceCount', 'originalFit', 'originalFitCount', 'strata'];
const corpusInput = input.corpus === undefined ? {} : plainObject(input.corpus, 'corpus');
assertKnownKeys(corpusInput, corpusKeys, 'corpus');
const corpusState = new Set(['prepared', 'not_supplied']);
const realHistory = corpusInput.realHistory ?? 'not_supplied';
const originalFit = corpusInput.originalFit ?? 'not_supplied';
if (!corpusState.has(realHistory) || !corpusState.has(originalFit)) throw new Error('corpus realHistory/originalFit must be prepared or not_supplied.');
const allowedStrata = [
    'matched_structured_garmin_strength', 'matched_structured_garmin_endurance', 'structured_only', 'garmin_only',
    'same_day_same_modality', 'manual_authored_execution', 'imported_external_execution', 'ambiguous_candidates',
    'repeated_provider_sync', 'manual_unlink_keep_separate', 'timezone_dst_boundary', 'incomplete_garmin_detail',
    'fit_semantic_definition', 'fit_index_only', 'fit_no_workout_evidence', 'fit_malformed_unsupported', 'synthetic_matched',
];
const strataInput = corpusInput.strata === undefined ? {} : plainObject(corpusInput.strata, 'corpus.strata');
assertKnownKeys(strataInput, allowedStrata, 'corpus.strata');
const strata = Object.fromEntries(Object.entries(strataInput).map(([key, value]) => [key, nonNegativeInteger(value, `corpus.strata.${key}`)]));
const corpus = { realHistory, originalFit, strata };
if (corpusInput.realHistoryOccurrenceCount !== undefined) corpus.realHistoryOccurrenceCount = nonNegativeInteger(corpusInput.realHistoryOccurrenceCount, 'corpus.realHistoryOccurrenceCount');
if (corpusInput.originalFitCount !== undefined) corpus.originalFitCount = nonNegativeInteger(corpusInput.originalFitCount, 'corpus.originalFitCount');

const identityKeys = [
    'status', 'structuredOnlyOccurrences', 'providerOnlyOccurrences', 'duplicatePhysicalWorkoutCandidates',
    'sourceLinkConflicts', 'manualDecisionViolations', 'exactIdentityUpgrades', 'exactIdentityDowngrades',
    'repeatedProviderSyncCases', 'allProviderSourceRefsEvaluated',
    'activeOccurrences', 'mergedOccurrencesExcluded', 'matchedOccurrences', 'singleSourceOccurrences', 'ambiguousOccurrences',
    'multiProviderSourceOccurrences', 'nonGarminProviderSourceRefs', 'manualDecisionOccurrences',
    'liveActivitiesAbsentFromCanonical', 'canonicalProviderActivitiesAbsentFromLive', 'reviewedMatchLabels',
    'reviewedFalsePositiveMerges', 'pairedMatched', 'pairedLiveOnly', 'pairedCanonicalOnly', 'pairedAmbiguous',
];
const identityInput = input.identityEvidence === undefined ? {} : plainObject(input.identityEvidence, 'identityEvidence');
assertKnownKeys(identityInput, identityKeys, 'identityEvidence');
const identityEvidence = { status: identityInput.status ?? 'not_supplied' };
if (!new Set(['not_supplied', 'prepared']).has(identityEvidence.status)) throw new Error('identityEvidence.status must be prepared or not_supplied.');
for (const key of identityKeys.filter(key => !['status', 'allProviderSourceRefsEvaluated'].includes(key))) {
    if (identityInput[key] !== undefined) identityEvidence[key] = nonNegativeInteger(identityInput[key], `identityEvidence.${key}`);
}
if (identityInput.allProviderSourceRefsEvaluated !== undefined) {
    if (typeof identityInput.allProviderSourceRefsEvaluated !== 'boolean') throw new Error('identityEvidence.allProviderSourceRefsEvaluated must be boolean.');
    identityEvidence.allProviderSourceRefsEvaluated = identityInput.allProviderSourceRefsEvaluated;
}

const fitDecisionStates = new Set(['KEEP_DIAGNOSTIC', 'READY_FOR_SEPARATE_ACTIVATION_DESIGN', 'BLOCKED_NEEDS_ADAPTIVE_IDENTITY', 'NO_SHIP']);
const fitKeys = [
    'status', 'decision', 'activitiesExamined', 'originalFitAvailable', 'originalFitUnavailable',
    'decodeSuccess', 'decodeFailure', 'unsupportedCount', 'malformedCount', 'semanticDefinitionFingerprintCount',
    'observedIndexFallbackFingerprintCount', 'noWorkoutEvidenceCount', 'deterministicRepeatDecodeMismatches',
    'repeatedFingerprintCount', 'reviewedCollisionCount', 'canonicalMatchedWithFitFingerprint',
    'ambiguousSameDayCasesReviewed', 'discriminationImprovedCount', 'discriminationUnchangedCount', 'reviewedLabelCount',
    'downloadFailure', 'notExaminedRateLimited',
];
const fitInput = input.fitEvidence === undefined ? {} : plainObject(input.fitEvidence, 'fitEvidence');
assertKnownKeys(fitInput, fitKeys, 'fitEvidence');
const fitEvidence = { status: fitInput.status ?? 'not_supplied', decision: fitInput.decision ?? 'BLOCKED_NEEDS_ADAPTIVE_IDENTITY' };
if (!new Set(['not_supplied', 'prepared']).has(fitEvidence.status)) throw new Error('fitEvidence.status must be prepared or not_supplied.');
if (!fitDecisionStates.has(fitEvidence.decision)) throw new Error(`Invalid TO5 decision: ${fitEvidence.decision}.`);
for (const key of fitKeys.filter(key => !['status', 'decision'].includes(key))) {
    if (fitInput[key] !== undefined) fitEvidence[key] = nonNegativeInteger(fitInput[key], `fitEvidence.${key}`);
}

const unknownCanonicalOccurrenceKeys = input.unknownCanonicalOccurrenceKeys ?? [];
if (!Array.isArray(unknownCanonicalOccurrenceKeys) || unknownCanonicalOccurrenceKeys.some(key => typeof key !== 'string' || key.length === 0 || key.length > 128)) {
    throw new Error('unknownCanonicalOccurrenceKeys must contain only non-empty opaque aliases up to 128 characters.');
}
if (new Set(unknownCanonicalOccurrenceKeys).size !== unknownCanonicalOccurrenceKeys.length) {
    throw new Error('unknownCanonicalOccurrenceKeys must not contain duplicates.');
}
const canonicalOccurrenceKeys = new Set(input.canonicalExposures.map(row => row.occurrenceKey).filter(Boolean));
if (unknownCanonicalOccurrenceKeys.some(key => canonicalOccurrenceKeys.has(key))) {
    throw new Error('An unknown canonical occurrence alias cannot also have a canonical exposure row.');
}
const exposureComparison = compareCompletedExposureSets(
    input.liveExposures,
    input.canonicalExposures,
    unknownCanonicalOccurrenceKeys,
);
const oneToOneOccurrencePairing = exposureComparison.duplicateOccurrenceKeys.live === 0
    && exposureComparison.duplicateOccurrenceKeys.canonical === 0
    && exposureComparison.perOccurrence.length === exposureComparison.liveCount
    && exposureComparison.perOccurrence.length === exposureComparison.canonicalCount
    && exposureComparison.perOccurrence.every(row => row.status === 'matched');
const historyEvidenceConsistent = Number.isInteger(corpus.realHistoryOccurrenceCount)
    && corpus.realHistoryOccurrenceCount > 0
    && exposureComparison.liveCount === corpus.realHistoryOccurrenceCount
    && exposureComparison.canonicalCount === corpus.realHistoryOccurrenceCount
    && oneToOneOccurrencePairing;
const fitAccountingConsistent = Number.isInteger(corpus.originalFitCount)
    && corpus.originalFitCount >= 0
    && Number.isInteger(fitEvidence.activitiesExamined)
    && Number.isInteger(fitEvidence.notExaminedRateLimited)
    && fitEvidence.activitiesExamined + fitEvidence.notExaminedRateLimited === corpus.originalFitCount
    && Number.isInteger(fitEvidence.originalFitAvailable)
    && Number.isInteger(fitEvidence.originalFitUnavailable)
    && Number.isInteger(fitEvidence.downloadFailure)
    && fitEvidence.originalFitAvailable + fitEvidence.originalFitUnavailable + fitEvidence.downloadFailure === fitEvidence.activitiesExamined
    && Number.isInteger(fitEvidence.decodeSuccess)
    && Number.isInteger(fitEvidence.decodeFailure)
    && fitEvidence.decodeSuccess + fitEvidence.decodeFailure === fitEvidence.originalFitAvailable
    && Number.isInteger(fitEvidence.semanticDefinitionFingerprintCount)
    && Number.isInteger(fitEvidence.observedIndexFallbackFingerprintCount)
    && Number.isInteger(fitEvidence.noWorkoutEvidenceCount)
    && fitEvidence.semanticDefinitionFingerprintCount + fitEvidence.observedIndexFallbackFingerprintCount
        + fitEvidence.noWorkoutEvidenceCount === fitEvidence.decodeSuccess
    && Number.isInteger(fitEvidence.malformedCount)
    && Number.isInteger(fitEvidence.unsupportedCount)
    && fitEvidence.malformedCount + fitEvidence.unsupportedCount === fitEvidence.decodeFailure;
if (corpus.originalFit === 'prepared' && !fitAccountingConsistent) {
    throw new Error('Prepared FIT evidence denominators are inconsistent: requested, examined, availability, decode and fingerprint counts must reconcile.');
}
const fitEvidenceConsistent = fitAccountingConsistent
    && corpus.originalFitCount > 0
    && fitEvidence.originalFitAvailable > 0
    && Number.isInteger(fitEvidence.reviewedLabelCount)
    && fitEvidence.reviewedLabelCount > 0
    && fitEvidence.reviewedLabelCount <= fitEvidence.originalFitAvailable;
const completeFitCorpusExamined = fitEvidenceConsistent && fitEvidence.notExaminedRateLimited === 0;
// The gate means "no physical workout contributes more than one canonical exposure". Unpaired
// live-only/canonical-only rows are a separate readiness condition (`oneToOneOccurrencePairing`).
if (hardGates.matchedOccurrenceSingleExposure === 'pass' && exposureComparison.duplicateOccurrenceKeys.canonical > 0) {
    throw new Error('matchedOccurrenceSingleExposure cannot be pass when a canonical occurrence alias contributes more than one exposure.');
}

const unknownReasons = [
    'multiple_structured_sources', 'multiple_provider_sources', 'unsupported_provider', 'structured_source_unavailable',
    'structured_source_not_completed', 'legacy_strength_semantics_not_derived', 'non_catalog_structured_semantics',
    'non_catalog_execution_evidence_missing',
    'template_identity_ambiguous', 'provider_source_unavailable', 'no_performed_date',
];
let canonicalDerivation = { status: 'not_supplied' };
if (input.canonicalDerivation !== undefined) {
    const derivation = plainObject(input.canonicalDerivation, 'canonicalDerivation');
    const countKeys = ['windowDays', 'parsedOccurrences', 'invalidRecords', 'crossUserRecordsRejected', 'derived'];
    const optionalCountKeys = ['manualDefinitionMetadataFallbacks'];
    assertKnownKeys(derivation, [...countKeys, ...optionalCountKeys, 'unknownByReason'], 'canonicalDerivation');
    const byReason = plainObject(derivation.unknownByReason ?? {}, 'canonicalDerivation.unknownByReason');
    assertKnownKeys(byReason, unknownReasons, 'canonicalDerivation.unknownByReason');
    canonicalDerivation = {
        status: 'prepared',
        ...Object.fromEntries(countKeys.map(key => [key, nonNegativeInteger(derivation[key], `canonicalDerivation.${key}`)])),
        ...(derivation.manualDefinitionMetadataFallbacks !== undefined
            ? { manualDefinitionMetadataFallbacks: nonNegativeInteger(derivation.manualDefinitionMetadataFallbacks, 'canonicalDerivation.manualDefinitionMetadataFallbacks') }
            : {}),
        unknownByReason: Object.fromEntries(Object.entries(byReason).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, nonNegativeInteger(value, `canonicalDerivation.unknownByReason.${key}`)])),
    };
    if (canonicalDerivation.derived !== input.canonicalExposures.length) {
        throw new Error('canonicalDerivation.derived must equal the number of canonical exposure rows.');
    }
    if ((canonicalDerivation.manualDefinitionMetadataFallbacks ?? 0) > canonicalDerivation.derived) {
        throw new Error('canonicalDerivation.manualDefinitionMetadataFallbacks cannot exceed derived exposures.');
    }
}

let recommendationSeries = { status: 'not_run' };
if (input.recommendationSeries !== undefined) {
    const series = plainObject(input.recommendationSeries, 'recommendationSeries');
    assertKnownKeys(series, ['status', 'referenceSource', 'nonHistoryInputsHash', 'evaluatedDates', 'changedDates', 'unresolvedDates', 'changedFieldCounts', 'repeatRunIdentical'], 'recommendationSeries');
    if (series.status !== 'compared') throw new Error('recommendationSeries.status must be compared.');
    if (typeof series.referenceSource !== 'string' || !/^simulation-scenario:[a-z0-9_]{1,80}$/.test(series.referenceSource)) {
        throw new Error('recommendationSeries.referenceSource must name a simulation reference scenario.');
    }
    if (typeof series.nonHistoryInputsHash !== 'string' || !/^[0-9a-f]{64}$/.test(series.nonHistoryInputsHash)) {
        throw new Error('recommendationSeries.nonHistoryInputsHash must be a SHA-256 hex digest.');
    }
    if (typeof series.repeatRunIdentical !== 'boolean') throw new Error('recommendationSeries.repeatRunIdentical must be boolean.');
    const projectionFields = ['verdict', 'mode', 'selectedTemplate', 'prescription', 'dose', 'variant', 'coverage', 'sequence', 'fatigue', 'guardrails'];
    const fieldCounts = plainObject(series.changedFieldCounts ?? {}, 'recommendationSeries.changedFieldCounts');
    assertKnownKeys(fieldCounts, projectionFields, 'recommendationSeries.changedFieldCounts');
    recommendationSeries = {
        status: 'compared',
        referenceSource: series.referenceSource,
        nonHistoryInputsHash: series.nonHistoryInputsHash,
        evaluatedDates: nonNegativeInteger(series.evaluatedDates, 'recommendationSeries.evaluatedDates'),
        changedDates: nonNegativeInteger(series.changedDates, 'recommendationSeries.changedDates'),
        unresolvedDates: nonNegativeInteger(series.unresolvedDates, 'recommendationSeries.unresolvedDates'),
        changedFieldCounts: Object.fromEntries(Object.entries(fieldCounts).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, nonNegativeInteger(value, `recommendationSeries.changedFieldCounts.${key}`)])),
        repeatRunIdentical: series.repeatRunIdentical,
    };
}

let recommendationComparison = { status: 'not_run' };
if (input.recommendationReplay) {
    const replay = plainObject(input.recommendationReplay, 'recommendationReplay');
    assertKnownKeys(replay, ['live', 'canonical', 'classifications'], 'recommendationReplay');
    const projectionKeys = ['verdict', 'mode', 'selectedTemplate', 'prescription', 'dose', 'variant', 'coverage', 'sequence', 'fatigue', 'guardrails'];
    for (const sideName of ['live', 'canonical']) {
        const side = plainObject(replay[sideName], `recommendationReplay.${sideName}`);
        assertKnownKeys(side, ['nonHistoryInputs', 'decisionProjection'], `recommendationReplay.${sideName}`);
        if (!side.nonHistoryInputs || !side.decisionProjection) {
            throw new Error('Recommendation replay requires nonHistoryInputs and decisionProjection for both history variants.');
        }
        assertKnownKeys(plainObject(side.decisionProjection, `recommendationReplay.${sideName}.decisionProjection`), projectionKeys, `recommendationReplay.${sideName}.decisionProjection`);
    }
    const classifications = replay.classifications === undefined ? {} : plainObject(replay.classifications, 'recommendationReplay.classifications');
    assertKnownKeys(classifications, projectionKeys, 'recommendationReplay.classifications');
    for (const [field, classification] of Object.entries(classifications)) {
        if (!new Set(['expected', 'explainable', 'unresolved']).has(classification)) {
            throw new Error(`Invalid recommendation classification for ${field}: ${classification}.`);
        }
    }
    const liveNonHistoryInputsHash = sha256(replay.live.nonHistoryInputs);
    const canonicalNonHistoryInputsHash = sha256(replay.canonical.nonHistoryInputs);
    const sameNonHistoryInputs = liveNonHistoryInputsHash === canonicalNonHistoryInputsHash;
    recommendationComparison = {
        status: sameNonHistoryInputs ? 'compared' : 'inputs_mismatch',
        liveNonHistoryInputsHash,
        canonicalNonHistoryInputsHash,
        delta: sameNonHistoryInputs
            ? compareRecommendationOutputs(replay.live.decisionProjection, replay.canonical.decisionProjection, classifications)
            : { status: 'not_compared', reason: 'non_history_inputs_hash_mismatch' },
    };
}

for (const [name, allowed] of Object.entries(decisionStates)) if (!allowed.has(decisions[name])) throw new Error(`Invalid decision for ${name}: ${decisions[name]}.`);
const everyHardGatePassed = gateNames.every(name => hardGates[name] === 'pass');
if (decisions.broadHistory === 'READY_FOR_SEPARATE_ACTIVATION_PR'
    && (!everyHardGatePassed || corpus.realHistory !== 'prepared' || !historyEvidenceConsistent || exposureComparison.unknownCanonicalOccurrenceCount > 0
        || !((recommendationComparison.status === 'compared' && recommendationComparison.delta.classification !== 'unresolved')
            || (recommendationSeries.status === 'compared' && recommendationSeries.evaluatedDates > 0
                && recommendationSeries.unresolvedDates === 0 && recommendationSeries.repeatRunIdentical))
        || deferredBlockers.linkedProviderProjectionRefresh === 'BLOCKING' || deferredBlockers.sourceDeletionRevocation === 'BLOCKING')) {
    throw new Error('Broad-history readiness requires prepared real history, one-to-one occurrence pairing, every hard gate passed, complete canonical derivation, a verified same-input replay, and no blocking provider lifecycle items.');
}
if (decisions.fitIdentity === 'READY_FOR_SEPARATE_ACTIVATION_PR'
    && (fitEvidence.decision !== 'READY_FOR_SEPARATE_ACTIVATION_DESIGN' || !everyHardGatePassed
        || corpus.originalFit !== 'prepared' || !completeFitCorpusExamined)) {
    throw new Error('FIT-identity readiness requires a qualified TO5 design decision, prepared original FIT with explicit availability accounting, reviewed labels, and every hard gate passed.');
}
if (fitEvidence.decision === 'READY_FOR_SEPARATE_ACTIVATION_DESIGN'
    && (!everyHardGatePassed || corpus.originalFit !== 'prepared' || !completeFitCorpusExamined)) {
    throw new Error('TO5 readiness requires prepared original FIT with explicit availability accounting, reviewed labels, and every hard gate passed.');
}
if (decisions.activitiesFlag === 'READY_FOR_SEPARATE_ACTIVATION_PR') {
    throw new Error('Activities read-model activation is outside this TO4/TO5 runner: ADR-0034 Stage-3 rollout gates require a separate reviewed evidence path.');
}

const report = {
    schemaVersion: 1,
    metadata,
    authorityBoundary: {
        canonicalWeeklyCoverage: 'live-performed-training-facts',
        broadCompletedHistoryForFatigueAndDeliveredDose: 'legacy-completed-training-events',
        fitIdentity: 'diagnostic-only',
        activitiesPolicy: 'unchanged-by-this-run',
    },
    corpus,
    identityEvidence,
    canonicalDerivation,
    exposureComparison,
    recommendationComparison,
    recommendationSeries,
    fitEvidence,
    hardGates,
    deferredBlockers,
    decisions,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;

if (args[1]) await writeFile(path.resolve(args[1]), rendered, 'utf8');
else process.stdout.write(rendered);
