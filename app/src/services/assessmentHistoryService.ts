/**
 * Assessment history read service (WP6.1 / D5 / D6).
 *
 * Provides bounded queries without N+1 trial loading:
 * - 1 query per protocol ID for attempts
 * - 1 query per metric ID for current observations
 * - Bounded date range for body-mass context
 * - Lazy trial and revision-chain loading on demand for attempt detail drill-downs.
 */

import {
    PERFORMANCE_TEST_DEFINITIONS,
    type PerformanceTestDefinition,
} from '../observations/performanceTestingCatalog';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../observations/physicalCapitalProtocols';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from '../observations/models';
import {
    buildAssessmentHistory,
    type AssessmentHistoryModel,
} from '../observations/assessmentHistory';
import { assessmentAttemptService, type AssessmentAttemptService } from './assessmentAttemptService';
import { metricObservationService, type MetricObservationService } from './metricObservationService';
import { assessmentTrialService, type AssessmentTrialService } from './assessmentTrialService';
import { measurementProtocolService, type MeasurementProtocolService } from './measurementProtocolService';
import { recoverySnapshotService, type RecoverySnapshotService } from './recoverySnapshotService';
import type { DailyRecoverySnapshot } from '../engine/models';
import { anthropometryService, type AnthropometryService } from './anthropometryService';
import { loadStoredBodyMassSource } from '../anthropometry/bodyMassPreference';
import { extractProviderWeightRecords, PROVIDER_BODY_MASS_SERIES_LOOKBACK_DAYS } from '../anthropometry/bodyMass';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { observationKeyFor } from '../observations/validation';
import type { AnthropometryEntry } from '../anthropometry/models';

export interface AssessmentAttemptDetailData {
    attempt: AssessmentAttempt;
    protocol: MeasurementProtocol;
    trials: readonly AssessmentTrial[];
    metricRevisions: readonly {
        metricId: string;
        head: MetricObservationHead;
        revisions: readonly MetricObservationRevision[];
        currentRevision: MetricObservationRevision;
    }[];
}

export class AssessmentHistoryService {
    private readonly attemptService: AssessmentAttemptService;
    private readonly observationService: MetricObservationService;
    private readonly trialService: AssessmentTrialService;
    private readonly protocolService: MeasurementProtocolService;
    private readonly snapshotService: RecoverySnapshotService;
    private readonly anthropometry: AnthropometryService;

    constructor(
        attemptService: AssessmentAttemptService = assessmentAttemptService,
        observationService: MetricObservationService = metricObservationService,
        trialService: AssessmentTrialService = assessmentTrialService,
        protocolService: MeasurementProtocolService = measurementProtocolService,
        snapshotService: RecoverySnapshotService = recoverySnapshotService,
        anthroService: AnthropometryService = anthropometryService,
    ) {
        this.attemptService = attemptService;
        this.observationService = observationService;
        this.trialService = trialService;
        this.protocolService = protocolService;
        this.snapshotService = snapshotService;
        this.anthropometry = anthroService;
    }

    /**
     * Loads the athlete's assessment history for all bundled catalog tests.
     * Bounded queries only: no trial reads, surfaces unreadable records (D5, D6).
     */
    async loadAssessmentHistory(
        userId: string,
        definitions: readonly PerformanceTestDefinition[] = PERFORMANCE_TEST_DEFINITIONS,
    ): Promise<AssessmentHistoryModel> {
        // Collect distinct protocol IDs and metric IDs. Include known immutable
        // historical revisions for the selected bundled protocols so a later protocol
        // revision cannot make an older metric disappear from History.
        const protocolIds = Array.from(new Set(definitions.map(d => d.protocol.id)));
        const selectedProtocolIds = new Set(protocolIds);
        const historicalMetricIds = PHYSICAL_CAPITAL_PROTOCOL_REVISIONS
            .filter(protocol => selectedProtocolIds.has(protocol.id))
            .flatMap(protocol => protocol.metricIds);
        const metricIds = Array.from(new Set([
            ...definitions.flatMap(d => d.protocol.metricIds),
            ...historicalMetricIds,
        ]));

        // 1. Fetch attempts per protocol ID
        let totalUnreadableAttempts = 0;
        const allAttempts: AssessmentAttempt[] = [];

        for (const protocolId of protocolIds) {
            const result = await this.attemptService.listAttemptsForProtocolWithDiagnostics(userId, protocolId);
            allAttempts.push(...result.attempts);
            totalUnreadableAttempts += result.unreadableCount;
        }

        // 2. Fetch current observation revisions per metric ID
        let totalUnreadableObservations = 0;
        const allObservations: { head: MetricObservationHead; revision: MetricObservationRevision }[] = [];

        for (const metricId of metricIds) {
            const result = await this.observationService.listCurrentObservationsForMetricWithDiagnostics(
                userId,
                metricId,
            );
            allObservations.push(...result.observations);
            totalUnreadableObservations += result.unreadableCount;
        }

        // 3. Body mass context: find date bounds of observations
        const observationDates = allObservations.map(o => getLocalDateString(new Date(o.revision.observedAt)));
        let manualEntries: AnthropometryEntry[] = [];
        let snapshots: DailyRecoverySnapshot[] = [];
        let providerSeriesStatus: 'known' | 'unknown' = 'known';

        if (observationDates.length > 0) {
            const sortedDates = [...observationDates].sort();
            const minDate = sortedDates[0];
            const maxDate = sortedDates[sortedDates.length - 1];

            try {
                // Read the provider-series lookback before the earliest test date as well, so
                // provider-first selection reflects whether the athlete has a usable provider
                // series, not merely whether the scale was used on a test day.
                const startDate = addDaysToLocalDateString(minDate, -(PROVIDER_BODY_MASS_SERIES_LOOKBACK_DAYS - 1));
                const endDateExclusive = addDaysToLocalDateString(maxDate, 1);
                const snapshotState = await this.snapshotService.getRecoverySnapshotsInRangeState(userId, startDate, endDateExclusive);
                if (snapshotState.status === 'AVAILABLE') {
                    snapshots = snapshotState.data;
                    // Partially unreadable rows could hide a weigh-in; treat the series as unknown.
                    if (snapshotState.issues && snapshotState.issues.length > 0) providerSeriesStatus = 'unknown';
                } else if (snapshotState.status !== 'MISSING') {
                    providerSeriesStatus = 'unknown';
                }
            } catch {
                providerSeriesStatus = 'unknown';
            }

            try {
                manualEntries = await this.anthropometry.getEntriesInRange(userId, minDate, maxDate);
            } catch {
                manualEntries = [];
            }
        }

        const preferredSource = loadStoredBodyMassSource();
        const providerRecords = extractProviderWeightRecords(snapshots);

        return buildAssessmentHistory({
            definitions,
            attempts: allAttempts,
            observations: allObservations,
            bodyMassOptions: {
                manualEntries,
                providerRecords,
                preferredSource,
                providerSeriesStatus,
            },
            unreadableAttemptsCount: totalUnreadableAttempts,
            unreadableObservationsCount: totalUnreadableObservations,
        });
    }

    /**
     * Lazy detail loading for one assessment attempt (WP6.3 / D5).
     * Loads raw trials (including superseded records) and observation revision chains.
     */
    async loadAttemptDetail(
        userId: string,
        attempt: AssessmentAttempt,
    ): Promise<AssessmentAttemptDetailData | null> {
        let protocol = await this.protocolService.getRevision(userId, attempt.protocolRef.id, attempt.protocolRef.revision);
        if (!protocol) {
            // Check bundled definitions as fallback
            const bundled = PERFORMANCE_TEST_DEFINITIONS.find(
                d => d.protocol.id === attempt.protocolRef.id && d.protocol.revision === attempt.protocolRef.revision,
            );
            if (bundled) {
                protocol = bundled.protocol;
            } else {
                return null;
            }
        }

        // Lazy load trials
        const trials = await this.trialService.listTrialsForAttempt(userId, protocol, attempt.id);

        // Lazy load observation revision chains
        const metricRevisions: AssessmentAttemptDetailData['metricRevisions'][number][] = [];
        for (const metricId of protocol.metricIds) {
            const key = observationKeyFor(attempt.id, metricId);
            const head = await this.observationService.getHead(userId, key);
            if (!head) continue;

            const revisions = await this.observationService.listRevisionsForObservation(userId, key);
            const currentRevision = revisions.find(r => r.revision === head.headRevision) ?? revisions[revisions.length - 1];
            if (currentRevision) {
                metricRevisions.push({
                    metricId,
                    head,
                    revisions,
                    currentRevision,
                });
            }
        }

        return {
            attempt,
            protocol,
            trials,
            metricRevisions,
        };
    }
}

export const assessmentHistoryService = new AssessmentHistoryService();
