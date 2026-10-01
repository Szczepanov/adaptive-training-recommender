import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../observations/physicalCapitalProtocols';
import {
    buildAssessmentDiagnosticExport,
    type AssessmentDiagnosticExport,
    type CanonicalObservationExport,
    type ResolvedContextExport,
} from '../observations/assessmentExport';
import { observationKeyFor } from '../observations/validation';
import { assessmentAttemptService, type AssessmentAttemptService } from './assessmentAttemptService';
import { assessmentTrialService, type AssessmentTrialService } from './assessmentTrialService';
import { metricObservationService, type MetricObservationService } from './metricObservationService';
import type { AssessmentAttempt, AssessmentTrial, ComparisonContext } from '../observations/models';

export class AssessmentExportService {
    private readonly attemptService: AssessmentAttemptService;
    private readonly trialService: AssessmentTrialService;
    private readonly observationService: MetricObservationService;

    constructor(
        attemptService: AssessmentAttemptService = assessmentAttemptService,
        trialService: AssessmentTrialService = assessmentTrialService,
        observationService: MetricObservationService = metricObservationService,
    ) {
        this.attemptService = attemptService;
        this.trialService = trialService;
        this.observationService = observationService;
    }

    /**
     * Bounded query across the bundled physical-capital protocols:
     * Reads attempts for each protocol, their raw trials, and the canonical observation revision chains.
     * No global scans.
     */
    async loadDiagnosticExport(userId: string): Promise<AssessmentDiagnosticExport> {
        const protocols = PHYSICAL_CAPITAL_PROTOCOL_REVISIONS;
        const allAttempts: AssessmentAttempt[] = [];
        const allTrials: AssessmentTrial[] = [];
        const allObservations: CanonicalObservationExport[] = [];
        const allResolvedContext: ResolvedContextExport[] = [];

        // Multiple immutable revisions can share one protocol id. Query each id once,
        // then partition by locked revision locally rather than repeating the same
        // Firestore attempt query for every revision in the export registry.
        const attemptsByProtocolId = new Map<string, AssessmentAttempt[]>();
        for (const protocolId of new Set(protocols.map(protocol => protocol.id))) {
            attemptsByProtocolId.set(
                protocolId,
                await this.attemptService.listAttemptsForProtocol(userId, protocolId),
            );
        }

        for (const protocol of protocols) {
            const attempts = (attemptsByProtocolId.get(protocol.id) ?? [])
                .filter(attempt => attempt.protocolRef.revision === protocol.revision);
            for (const attempt of attempts) {
                allAttempts.push(attempt);
                const trials = await this.trialService.listTrialsForAttempt(userId, protocol, attempt.id);
                allTrials.push(...trials);

                let attemptContext: ComparisonContext = {};
                const seriesKeys: Record<string, string> = {};

                for (const metricId of protocol.metricIds) {
                    const key = observationKeyFor(attempt.id, metricId);
                    const head = await this.observationService.getHead(userId, key);
                    if (head) {
                        const revisions = await this.observationService.listRevisionsForObservation(userId, key);
                        if (revisions.length > 0) {
                            allObservations.push({ observationKey: key, head, revisions });
                            const latestRev = revisions.find(r => r.revision === head.headRevision) ?? revisions[revisions.length - 1];
                            attemptContext = { ...attemptContext, ...latestRev.context as ComparisonContext };
                            seriesKeys[metricId] = latestRev.comparisonSeriesKey;
                        }
                    }
                }

                if (trials.length > 0 && Object.keys(attemptContext).length === 0) {
                    attemptContext = { ...trials[0].context as ComparisonContext };
                }

                allResolvedContext.push({
                    attemptId: attempt.id,
                    protocolId: protocol.id,
                    protocolRevision: protocol.revision,
                    context: attemptContext,
                    seriesKeys,
                });
            }
        }

        return buildAssessmentDiagnosticExport({
            protocols,
            attempts: allAttempts,
            trials: allTrials,
            canonicalObservations: allObservations,
            resolvedContext: allResolvedContext,
        });
    }
}

export const assessmentExportService = new AssessmentExportService();

export function downloadDiagnosticExportFile(filename: string, jsonString: string): void {
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoking synchronously can cancel the download in some browsers; release on the next task.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsvFile(filename: string, csvString: string): void {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
