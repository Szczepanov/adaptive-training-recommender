import type { DataState } from '../engine/dataState';
import {
    evaluatePhysiologicalAnomaly,
    isAdverseCoreSignalEvidence,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
} from '../derived/flags/illnessAnomaly/healthAnomaly';
import { HEALTH_ANOMALY_BASELINE_WINDOW_DAYS, mapRecoverySnapshotToHealthAnomalyFeatures } from '../derived/flags/illnessAnomaly/healthAnomalyFeatures';
import { summarizePersonalOutcomeCalibration } from '../derived/flags/illnessAnomaly/healthAnomalyOutcome';
import type {
    HealthAnomalyAssessmentRevision,
    HealthAnomalyInput,
    HealthAnomalyPolicy,
    HealthAnomalySourceIdentity,
    HealthAnomalyThresholdPolicy,
    PhysiologicalAnomalyAssessment,
} from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import type { AuthoredPlanBlock, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { checkinService, type CheckinService } from './checkinService';
import {
    healthAnomalyOutcomeRepository,
    type HealthAnomalyOutcomeRepository,
} from './healthAnomalyOutcomeService';
import {
    buildHealthAnomalyAssessmentRevision,
    healthAnomalyAssessmentRepository,
    stableHealthAnomalyHash,
    type HealthAnomalyAssessmentRepository,
} from './healthAnomalyPersistence';
import { planBlockService, type PlanBlockService } from './planBlockService';
import { recoverySnapshotService, type RecoverySnapshotService } from './recoverySnapshotService';

type PlanBlockWithId = AuthoredPlanBlock & { id: string };

type RecoverySource = Pick<RecoverySnapshotService, 'getRecoverySnapshotState' | 'getRecoverySnapshotsInRangeState'>;
type CheckinSource = Pick<CheckinService, 'getCheckinState'> & Partial<Pick<CheckinService, 'getCheckinsInRangeState'>>;
type PlanBlockSource = Pick<PlanBlockService, 'getBlocksInRangeState'>;
type AssessmentStore = Pick<HealthAnomalyAssessmentRepository, 'getLatestForDate' | 'persistImmutable'>;
type OutcomeSource = Pick<HealthAnomalyOutcomeRepository, 'listForUser'>;

export interface HealthAnomalyServiceResult {
    assessment: PhysiologicalAnomalyAssessment;
    revision: HealthAnomalyAssessmentRevision;
}

function availableData<T>(state: DataState<T>): T | null {
    return state.status === 'AVAILABLE' ? state.data : null;
}

/**
 * Keep the parser/store revision when available for debugging, but bind the immutable HA
 * identity to the exact canonical content as well. A corrected/rebuilt document therefore
 * cannot collide merely because its updatedAt/garminSyncedAt timestamp happened to stay the same.
 */
function snapshotRevision(snapshot: DailyRecoverySnapshot, externalRevision: string | null = null): string {
    return `snapshot:${externalRevision ?? 'none'}:${stableHealthAnomalyHash(snapshot)}`;
}

function checkinRevision(checkin: DailySubjectiveCheckin, externalRevision: string | null = null): string {
    return `checkin:${externalRevision ?? 'none'}:${stableHealthAnomalyHash(checkin)}`;
}

function activeTravelBlock(blocks: readonly PlanBlockWithId[], date: string): boolean {
    return blocks.some(block => block.phase === 'travel' && block.startDate <= date && date <= block.endDate);
}

/**
 * HA0.2/HA4 composition boundary. Missing optional recovery/check-in/travel/baseline history
 * may degrade to a one-day assessment, but a previous-assessment read failure must propagate:
 * persisting from unknown episode/persistence state would create an unsafe immutable revision.
 * Nothing here feeds the readiness/recommendation engine.
 */
export class HealthAnomalyService {
    private readonly recovery: RecoverySource;
    private readonly checkins: CheckinSource;
    private readonly planBlocks: PlanBlockSource;
    private readonly assessments: AssessmentStore;
    private readonly outcomes: OutcomeSource;

    constructor(
        recovery: RecoverySource = recoverySnapshotService,
        checkins: CheckinSource = checkinService,
        planBlocks: PlanBlockSource = planBlockService,
        assessments: AssessmentStore = healthAnomalyAssessmentRepository,
        outcomes?: OutcomeSource,
    ) {
        this.recovery = recovery;
        this.checkins = checkins;
        this.planBlocks = planBlocks;
        this.assessments = assessments;
        this.outcomes = outcomes ?? (
            recovery === recoverySnapshotService
            && checkins === checkinService
            && planBlocks === planBlockService
            && assessments === healthAnomalyAssessmentRepository
                ? healthAnomalyOutcomeRepository
                : { listForUser: async () => [] }
        );
    }

    async assessAndPersist(
        userId: string,
        date: string,
        policy: HealthAnomalyPolicy,
        thresholds: HealthAnomalyThresholdPolicy = policy === 'visible-v1'
            ? VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS
            : SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
        computedAt: string = new Date().toISOString(),
    ): Promise<HealthAnomalyServiceResult | null> {
        if (policy === 'off') return null;

        const historyStart = addDaysToLocalDateString(date, -HEALTH_ANOMALY_BASELINE_WINDOW_DAYS);
        const previousDate = addDaysToLocalDateString(date, -1);
        const [
            snapshotState,
            checkinState,
            historyState,
            checkinHistoryState,
            travelState,
            previousAssessment,
            priorOutcomes,
        ] = await Promise.all([
            this.recovery.getRecoverySnapshotState(userId, date),
            this.checkins.getCheckinState(userId, date),
            this.recovery.getRecoverySnapshotsInRangeState(userId, historyStart, date),
            this.checkins.getCheckinsInRangeState
                ? this.checkins.getCheckinsInRangeState(userId, historyStart, date)
                : Promise.resolve<DataState<DailySubjectiveCheckin[]>>({ status: 'MISSING' }),
            this.planBlocks.getBlocksInRangeState(userId, date, date),
            this.assessments.getLatestForDate(userId, previousDate),
            this.outcomes.listForUser(userId).catch(() => []),
        ]);

        const snapshot = availableData(snapshotState);
        const checkin = availableData(checkinState);
        const history = availableData(historyState) ?? [];
        const checkinHistory = availableData(checkinHistoryState) ?? [];
        const contaminatedDates = Array.from(new Set(
            checkinHistory
                .filter(item => item.date < date && (item.healthContext?.symptoms?.present === true || item.illnessSymptoms === true))
                .map(item => item.date),
        )).sort();
        const features = snapshot ? mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history, { contaminatedDates }) : null;
        const personalCalibration = summarizePersonalOutcomeCalibration(priorOutcomes, date);
        const authoredTravelActive = travelState.status === 'AVAILABLE'
            ? activeTravelBlock(travelState.data, date)
            : travelState.status === 'MISSING' ? false : null;

        const input: HealthAnomalyInput = {
            date,
            timezone: 'Europe/Warsaw',
            recoverySnapshot: snapshot,
            subjectiveCheckin: checkin,
            features,
            coreSignals: [],
            supportingSignals: [],
            dataQuality: features?.coreSignals.map(signal => signal.dataQuality) ?? [],
            last3DaysHardSessionsCount: snapshot?.raw.last3DaysHardSessionsCount ?? 0,
            last3DaysHighCostSessionsCount: snapshot?.raw.last3DaysHighCostSessionsCount ?? 0,
            structuredContext: {
                authoredTravelActive,
                authoredTravelRevision: travelState.status === 'AVAILABLE' ? travelState.revision ?? null : null,
            },
            persistence: {
                previousState: previousAssessment?.assessment.state ?? null,
                previousEpisodeId: previousAssessment?.assessment.episodeId ?? null,
                previousEpisodeDay: previousAssessment?.assessment.episodeDay ?? null,
                previousAssessmentDate: previousAssessment?.date ?? null,
                // Preserve consecutive abnormal physiology even when the prior day had a
                // strong competing explanation. Context may qualify interpretation, but it
                // must not reset the physiological trace.
                unexplainedPersistenceDays: previousAssessment
                    && previousAssessment.assessment.coreSignals.some(isAdverseCoreSignalEvidence)
                    ? previousAssessment.assessment.persistenceDays
                    : 0,
                priorUnexplainedDays: previousAssessment
                    && previousAssessment.assessment.unexplainedEvidence.length > 0
                    ? (previousAssessment.assessment.unexplainedPersistenceDays
                        ?? previousAssessment.assessment.persistenceDays)
                    : 0,
            },
            personalCalibration,
        };

        const assessment = evaluatePhysiologicalAnomaly(input, policy, thresholds);
        if (!assessment) return null;

        const source: HealthAnomalySourceIdentity = {
            timezone: 'Europe/Warsaw',
            recoverySnapshotRevision: snapshotState.status === 'AVAILABLE'
                ? snapshotRevision(snapshotState.data, snapshotState.revision ?? null)
                : null,
            checkinRevision: checkinState.status === 'AVAILABLE'
                ? checkinRevision(checkinState.data, checkinState.revision ?? null)
                : null,
            historyWindowStart: historyStart,
            historyWindowEndExclusive: date,
            historySnapshotRevisions: history.map(item => ({
                date: item.date,
                revision: snapshotRevision(item),
            })),
            travelContextRevision: travelState.status === 'AVAILABLE' ? travelState.revision ?? null : null,
            persistenceLookbackStart: previousDate,
            ...(previousAssessment ? { previousAssessmentRevisionId: previousAssessment.revisionId } : {}),
            ...(contaminatedDates.length > 0 ? { contaminatedDates } : {}),
            ...(personalCalibration.priorEpisodesCount > 0
                ? { personalCalibrationRevision: stableHealthAnomalyHash(personalCalibration) }
                : {}),
        };
        const build = (supersedesRevisionId?: string) => buildHealthAnomalyAssessmentRevision({
            userId,
            date,
            computedAt,
            mode: policy,
            thresholdPolicy: thresholds,
            source: supersedesRevisionId ? { ...source, supersedesRevisionId } : source,
            assessment,
        });
        const persisted = await this.persistAsLatest(userId, date, computedAt, build);
        return { assessment: persisted.assessment, revision: persisted };
    }

    /**
     * Revisions are content-addressed, so an identity that repeats an older same-date revision
     * (A, corrected to B, then back to A) returns A's document with its old `computedAt`, and
     * B would stay latest. A repeat of the latest revision stays idempotent; a repeat of a
     * superseded one is chained to the latest so a fresh immutable revision is appended.
     */
    private async persistAsLatest(
        userId: string,
        date: string,
        computedAt: string,
        build: (supersedesRevisionId?: string) => HealthAnomalyAssessmentRevision,
    ): Promise<HealthAnomalyAssessmentRevision> {
        const persisted = await this.assessments.persistImmutable(build());
        if (persisted.computedAt === computedAt) return persisted;
        // The write succeeded; an unreadable same-date history leaves the repeat as-is (pre-chain behaviour).
        const latest = await this.assessments.getLatestForDate(userId, date).catch(() => null);
        if (!latest || latest.revisionId === persisted.revisionId) return persisted;
        const latestLink = latest.source.supersedesRevisionId;
        if (latestLink && build(latestLink).revisionId === latest.revisionId) return latest;
        return this.assessments.persistImmutable(build(latest.revisionId));
    }
}

export const healthAnomalyService = new HealthAnomalyService();
