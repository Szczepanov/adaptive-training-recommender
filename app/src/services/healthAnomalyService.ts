import type { DataState } from '../engine/dataState';
import {
    evaluatePhysiologicalAnomaly,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
} from '../engine/healthAnomaly';
import { HEALTH_ANOMALY_BASELINE_WINDOW_DAYS, mapRecoverySnapshotToHealthAnomalyFeatures } from '../engine/healthAnomalyFeatures';
import type {
    HealthAnomalyAssessmentRevision,
    HealthAnomalyInput,
    HealthAnomalyPolicy,
    HealthAnomalySourceIdentity,
    HealthAnomalyThresholdPolicy,
    PhysiologicalAnomalyAssessment,
} from '../engine/healthAnomalyModels';
import type { AuthoredPlanBlock, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { checkinService, type CheckinService } from './checkinService';
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
type CheckinSource = Pick<CheckinService, 'getCheckinState'>;
type PlanBlockSource = Pick<PlanBlockService, 'getBlocksInRangeState'>;
type AssessmentStore = Pick<HealthAnomalyAssessmentRepository, 'getLatestForDate' | 'persistImmutable'>;

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
 * HA0.2/HA4 composition boundary. Optional history sources degrade to a one-day assessment;
 * only persistence failure itself rejects a requested non-off assessment. Nothing here feeds
 * the readiness/recommendation engine.
 */
export class HealthAnomalyService {
    private readonly recovery: RecoverySource;
    private readonly checkins: CheckinSource;
    private readonly planBlocks: PlanBlockSource;
    private readonly assessments: AssessmentStore;

    constructor(
        recovery: RecoverySource = recoverySnapshotService,
        checkins: CheckinSource = checkinService,
        planBlocks: PlanBlockSource = planBlockService,
        assessments: AssessmentStore = healthAnomalyAssessmentRepository,
    ) {
        this.recovery = recovery;
        this.checkins = checkins;
        this.planBlocks = planBlocks;
        this.assessments = assessments;
    }

    async assessAndPersist(
        userId: string,
        date: string,
        policy: HealthAnomalyPolicy,
        thresholds: HealthAnomalyThresholdPolicy = SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
        computedAt: string = new Date().toISOString(),
    ): Promise<HealthAnomalyServiceResult | null> {
        if (policy === 'off') return null;

        const historyStart = addDaysToLocalDateString(date, -HEALTH_ANOMALY_BASELINE_WINDOW_DAYS);
        const previousDate = addDaysToLocalDateString(date, -1);
        const [snapshotState, checkinState, historyState, travelState, previousAssessment] = await Promise.all([
            this.recovery.getRecoverySnapshotState(userId, date),
            this.checkins.getCheckinState(userId, date),
            this.recovery.getRecoverySnapshotsInRangeState(userId, historyStart, date),
            this.planBlocks.getBlocksInRangeState(userId, date, date),
            this.assessments.getLatestForDate(userId, previousDate).catch(() => null),
        ]);

        const snapshot = availableData(snapshotState);
        const checkin = availableData(checkinState);
        const history = availableData(historyState) ?? [];
        const features = snapshot ? mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history) : null;
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
            structuredContext: {
                authoredTravelActive,
                authoredTravelRevision: travelState.status === 'AVAILABLE' ? travelState.revision ?? null : null,
            },
            persistence: {
                previousState: previousAssessment?.assessment.state ?? null,
                previousEpisodeId: previousAssessment?.assessment.episodeId ?? null,
                previousEpisodeDay: previousAssessment?.assessment.episodeDay ?? null,
                previousAssessmentDate: previousAssessment?.date ?? null,
                unexplainedPersistenceDays: previousAssessment && previousAssessment.assessment.unexplainedEvidence.length > 0
                    ? previousAssessment.assessment.persistenceDays
                    : 0,
            },
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
        };
        const revision = buildHealthAnomalyAssessmentRevision({
            userId,
            date,
            computedAt,
            mode: policy,
            thresholdPolicy: thresholds,
            source,
            assessment,
        });
        const persisted = await this.assessments.persistImmutable(revision);
        return { assessment: persisted.assessment, revision: persisted };
    }
}

export const healthAnomalyService = new HealthAnomalyService();
