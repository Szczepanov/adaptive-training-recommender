import { deriveTrialObservationRevisions } from '../observations/assessmentDerivation';
import { assertValidAssessmentTrialSet } from '../observations/assessmentTrials';
import { assertFixedLoadComparisonContext, isFixedLoadVelocityProtocol } from '../observations/fixedLoadVelocity';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    ComparisonContext,
    DerivationEvidenceRef,
    MeasurementProtocol,
    MetricObservationDevice,
    MetricObservationRevision,
} from '../observations/models';
import { observationKeyFor } from '../observations/validation';
import { assessmentAttemptService, type AssessmentAttemptService } from './assessmentAttemptService';
import { assessmentTrialService, type AssessmentTrialService } from './assessmentTrialService';
import { metricObservationService, type MetricObservationService } from './metricObservationService';

export interface SaveTrialAssessmentInput {
    userId: string;
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    trials: readonly AssessmentTrial[];
    context: ComparisonContext;
    observedAt: string;
    sourceRef?: string;
    device?: MetricObservationDevice;
    notes?: string;
    allowMissingBenchmark?: boolean;
}

export interface SaveTrialAssessmentResult {
    attempt: AssessmentAttempt;
    trials: readonly AssessmentTrial[];
    observations: readonly MetricObservationRevision[];
    missingMetricIds: readonly string[];
}

export interface CorrectTrialInput {
    userId: string;
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    trial: AssessmentTrial;
    context: ComparisonContext;
    observedAt: string;
    sourceRef?: string;
    device?: MetricObservationDevice;
}

export interface CorrectTrialResult {
    trials: readonly AssessmentTrial[];
    observations: readonly MetricObservationRevision[];
    updatedObservations: readonly MetricObservationRevision[];
}

function sameEvidenceRefs(
    a?: readonly DerivationEvidenceRef[],
    b?: readonly DerivationEvidenceRef[],
): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((refA, idx) => {
        const refB = b[idx];
        return refA.kind === refB.kind
            && refA.assessmentAttemptId === refB.assessmentAttemptId
            && refA.trialId === refB.trialId;
    });
}

export class AssessmentCaptureService {
    private readonly trialService: AssessmentTrialService;
    private readonly attemptService: AssessmentAttemptService;
    private readonly observationService: MetricObservationService;

    constructor(
        trialService: AssessmentTrialService = assessmentTrialService,
        attemptService: AssessmentAttemptService = assessmentAttemptService,
        observationService: MetricObservationService = metricObservationService,
    ) {
        this.trialService = trialService;
        this.attemptService = attemptService;
        this.observationService = observationService;
    }

    /**
     * WP5.4 Save orchestration:
     * 1. createTrials (atomic, idempotent on exact retry)
     * 2. listTrialsForAttempt
     * 3. deriveTrialObservationRevisions
     * 4. metricObservationService.createInitialRevision per observation
     * 5. completeAttempt
     *
     * If missingMetricIds is non-empty and allowMissingBenchmark is false, no observations
     * are created and the attempt remains in_progress. A retry converges idempotently.
     */
    async saveTrialAssessment(input: SaveTrialAssessmentInput): Promise<SaveTrialAssessmentResult> {
        const { userId, protocol, attempt, trials, context, observedAt, sourceRef, device, notes, allowMissingBenchmark } = input;
        if (attempt.state === 'abandoned') {
            throw new Error('Cannot record trials or observations on an abandoned attempt');
        }

        const currentAttempt = await this.attemptService.getAttempt(userId, attempt.id) ?? attempt;
        if (currentAttempt.state === 'abandoned') {
            throw new Error('Cannot record trials or observations on an abandoned attempt');
        }

        if (currentAttempt.state === 'scheduled') {
            // Trials may only be recorded once the linked execution has started the attempt;
            // silently skipping the write would complete an attempt with no evidence.
            throw new Error('Cannot record trials before the assessment attempt has started');
        }

        // 1. Create trials if in_progress and not already stored
        if (currentAttempt.state === 'in_progress') {
            assertFixedLoadComparisonContext(protocol, trials, context);
            if (isFixedLoadVelocityProtocol(protocol)) assertValidAssessmentTrialSet(trials, protocol, attempt.id);
            await this.trialService.createTrials(userId, protocol, attempt.id, trials);
        }

        // 2. Fetch full stored trial set
        const storedTrials = await this.trialService.listTrialsForAttempt(userId, protocol, attempt.id);
        if (currentAttempt.state === 'in_progress') {
            // After a partial save the stored trials are immutable evidence. A resubmission that
            // drops one (e.g. a removed draft row) must not let the dropped trial silently feed
            // the benchmark.
            const submittedIds = new Set(trials.map(trial => trial.id));
            const unsubmitted = storedTrials.filter(stored => stored.correctionIndex === 0 && !submittedIds.has(stored.id));
            if (unsubmitted.length > 0) {
                throw new Error(`Already-saved trials are missing from this submission: ${unsubmitted.map(trial => trial.id).join(', ')}. Saved trials cannot be removed.`);
            }
        }

        // 3. Derive canonical observations
        const derivation = await deriveTrialObservationRevisions({
            protocol,
            attempt: currentAttempt,
            trials: storedTrials,
            context,
            observedAt,
            sourceRef,
            device,
        });

        // If there are missing metrics and caller has not explicitly confirmed completion without a benchmark,
        // stop here and keep user in capture.
        if (derivation.missingMetricIds.length > 0 && !allowMissingBenchmark) {
            return {
                attempt: currentAttempt,
                trials: storedTrials,
                observations: [],
                missingMetricIds: derivation.missingMetricIds,
            };
        }

        // 4. Create initial revision for each validly derived observation (idempotent on retry)
        const savedObservations: MetricObservationRevision[] = [];
        for (const obs of derivation.observations) {
            const saved = await this.observationService.createInitialRevision(userId, obs);
            savedObservations.push(saved);
        }

        // 5. Complete attempt if currently in_progress
        let finalAttempt = currentAttempt;
        if (currentAttempt.state === 'in_progress') {
            const explanatoryNote = derivation.missingMetricIds.length > 0
                ? (notes ? `${notes} · Completed without benchmarks for: ${derivation.missingMetricIds.join(', ')}` : `Completed without benchmarks for: ${derivation.missingMetricIds.join(', ')}`)
                : notes;
            await this.attemptService.completeAttempt(userId, attempt.id, observedAt, explanatoryNote);
            finalAttempt = await this.attemptService.getAttempt(userId, attempt.id) ?? {
                ...currentAttempt,
                state: 'completed',
                completedAt: observedAt,
                notes: explanatoryNote,
            };
        }

        return {
            attempt: finalAttempt,
            trials: storedTrials,
            observations: savedObservations,
            missingMetricIds: derivation.missingMetricIds,
        };
    }

    /**
     * WP5.5 Post-completion trial correction flow:
     * 1. Build the superseding trial candidate (correctionIndex + 1) without writing.
     * 2. Re-derive with identityByMetric: current revision + 1.
     * 3. Fail closed if a correction leaves a previously benchmarked metric with no valid trial.
     * 4. Atomically commit the superseding trial plus every changed canonical revision/head.
     */
    async correctTrial(input: CorrectTrialInput): Promise<CorrectTrialResult> {
        const { userId, protocol, attempt, trial, context, observedAt, sourceRef, device } = input;
        if (attempt.state === 'abandoned') {
            throw new Error('Cannot correct trials on an abandoned attempt');
        }

        const currentAttempt = await this.attemptService.getAttempt(userId, attempt.id) ?? attempt;
        if (currentAttempt.state === 'abandoned') {
            throw new Error('Cannot correct trials on an abandoned attempt');
        }

        // 1. Build the candidate trial set in memory. Nothing is written until the correction
        //    is known to be derivable, so a rejected correction leaves no orphaned trial record.
        //    An exact retry after a partial failure finds the trial already stored.
        const storedTrials = await this.trialService.listTrialsForAttempt(userId, protocol, attempt.id);
        const alreadyStored = storedTrials.some(stored => stored.id === trial.id);
        const allTrials = alreadyStored ? storedTrials : [...storedTrials, trial];
        assertValidAssessmentTrialSet(allTrials, protocol, attempt.id);

        // 2. Fetch current observation revisions for all metrics
        const currentObservationsByMetric = new Map<string, MetricObservationRevision>();
        for (const metricId of protocol.metricIds) {
            const current = await this.observationService.getCurrentRevision(
                userId,
                observationKeyFor(attempt.id, metricId),
            );
            if (current) currentObservationsByMetric.set(metricId, current);
        }
        if (isFixedLoadVelocityProtocol(protocol)) {
            for (const current of currentObservationsByMetric.values()) {
                assertFixedLoadComparisonContext(protocol, allTrials, current.context);
            }
        }

        // 4. Build identityByMetric
        const identityByMetric: Record<string, { revision: number; supersedesRevision: number; correctionReason: string }> = {};
        for (const [metricId, current] of currentObservationsByMetric.entries()) {
            identityByMetric[metricId] = {
                revision: current.revision + 1,
                supersedesRevision: current.revision,
                correctionReason: trial.correctionReason ?? 'Trial corrected',
            };
        }

        // 5. Re-derive observations. Corrections keep the execution provenance of the revision
        //    they supersede unless the caller supplies one.
        const inheritedSourceRef = sourceRef
            ?? [...currentObservationsByMetric.values()].find(current => current.sourceRef)?.sourceRef;
        const derivation = await deriveTrialObservationRevisions({
            protocol,
            attempt: currentAttempt,
            trials: allTrials,
            context,
            observedAt,
            sourceRef: inheritedSourceRef,
            device,
            identityByMetric,
        });

        // 6. Fail closed if a previously benchmarked metric now has no valid trial
        for (const missingMetricId of derivation.missingMetricIds) {
            if (currentObservationsByMetric.has(missingMetricId)) {
                throw new Error(
                    `Correction would leave metric ${missingMetricId} without any valid trial. Metric observations cannot be invalidated without a replacement valid trial.`,
                );
            }
        }

        // 7. Prepare every changed canonical revision in memory. The trial service commits the
        //    superseding raw trial and this complete revision set in one Firestore transaction.
        const updatedObservations: MetricObservationRevision[] = [];
        const allResultObservations: MetricObservationRevision[] = [];

        for (const newObs of derivation.observations) {
            const current = currentObservationsByMetric.get(newObs.metricId);
            if (!current) {
                // A completed-without-benchmark attempt may acquire its first valid benchmark
                // through a later superseding trial.
                const initial: MetricObservationRevision = {
                    ...newObs,
                    revision: 1,
                };
                updatedObservations.push(initial);
                allResultObservations.push(initial);
                continue;
            }

            const valueChanged = current.value !== newObs.value || current.unit !== newObs.unit;
            const evidenceChanged = !sameEvidenceRefs(current.derivedFromEvidenceRefs, newObs.derivedFromEvidenceRefs);

            if (valueChanged || evidenceChanged) {
                updatedObservations.push(newObs);
                allResultObservations.push(newObs);
            } else {
                allResultObservations.push(current);
            }
        }

        await this.trialService.commitCorrection(userId, protocol, trial, updatedObservations);

        return {
            trials: allTrials,
            observations: allResultObservations,
            updatedObservations,
        };
    }
}

export const assessmentCaptureService = new AssessmentCaptureService();
