import type { AthleteEvidenceLineageRef, DailyReadiness, KnowledgeLineageRef, UserContext, UserEvent } from './models';
import type { KnowledgeStatus } from '../knowledge/sportsKnowledge';
import type { AthleteEvidenceRecord } from '../knowledge/athleteEvidence';
import {
    getActiveKnowledgeClaim,
    getKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
} from '../knowledge/sportsKnowledgeRegistry';

export const MAX_KNOWLEDGE_LINEAGE_REFS = 64;

export type KnowledgeLineageStatus = 'matches_current' | 'drifted' | 'lineage_unavailable';

export interface KnowledgeLineageDrift {
    claimId: string;
    recordedVersion: number;
    currentVersion?: number;
    currentStatus: KnowledgeStatus | 'missing';
}

/** Stable, deterministic union used before a decision crosses the persistence boundary. */
export function mergeKnowledgeRefs(
    ...groups: Array<readonly string[] | null | undefined>
): string[] {
    return [...new Set(groups.flatMap(group => group ?? []))].sort();
}

/** Freeze currently active registry versions for claims materially consumed by one decision. */
export function snapshotKnowledgeLineage(refs: readonly string[]): KnowledgeLineageRef[] {
    const claimIds = mergeKnowledgeRefs(refs);
    if (claimIds.length > MAX_KNOWLEDGE_LINEAGE_REFS) {
        throw new Error(`Recommendation knowledge lineage exceeds ${MAX_KNOWLEDGE_LINEAGE_REFS} claims`);
    }
    return claimIds.map(claimId => {
        const claim = getActiveKnowledgeClaim(claimId);
        return { claimId: claim.id, version: claim.version };
    });
}

/** Compare persisted knowledge identity with the registry bundled in the current build. */
export function compareKnowledgeLineage(
    lineage: readonly KnowledgeLineageRef[] | undefined,
): { status: KnowledgeLineageStatus; drift: KnowledgeLineageDrift[] } {
    if (lineage === undefined) return { status: 'lineage_unavailable', drift: [] };

    const drift: KnowledgeLineageDrift[] = [];
    for (const ref of lineage) {
        try {
            const current = getKnowledgeClaim(ref.claimId);
            if (current.version !== ref.version || current.status !== 'active') {
                drift.push({ claimId: ref.claimId, recordedVersion: ref.version, currentVersion: current.version, currentStatus: current.status });
            }
        } catch {
            drift.push({ claimId: ref.claimId, recordedVersion: ref.version, currentStatus: 'missing' });
        }
    }
    return { status: drift.length > 0 ? 'drifted' : 'matches_current', drift };
}

/** Claim IDs for the subjective classifier evaluated by every normal readiness decision. */
export function subjectiveReadinessKnowledgeRefs(): string[] {
    return mergeKnowledgeRefs([
        KNOWLEDGE_CLAIM_IDS.contextualMonitoring,
        KNOWLEDGE_CLAIM_IDS.measurementQualityLimits,
        KNOWLEDGE_CLAIM_IDS.exactCutpointLimits,
        KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
    ]);
}

/** Claim IDs for compact injury/symptom-policy facts captured at composition time. */
export function injuryPolicyKnowledgeRefs(readiness: DailyReadiness, context: UserContext): string[] {
    const trace = context.injuryPolicyTrace;
    const refs: string[] = [];
    if (trace?.tissueSeverityApplied) {
        refs.push(KNOWLEDGE_CLAIM_IDS.tissueResponseTemporalMonitoring, KNOWLEDGE_CLAIM_IDS.tissueResponseSeverityPolicy);
    }
    for (const family of trace?.regionMappingFamilies ?? []) {
        refs.push(KNOWLEDGE_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement);
        if (family === 'lower_limb_impact') refs.push(KNOWLEDGE_CLAIM_IDS.lowerLimbImpactPolicy);
        if (family === 'lower_limb_strength') refs.push(KNOWLEDGE_CLAIM_IDS.lowerLimbStrengthPolicy);
        if (family === 'lumbar_loading') refs.push(KNOWLEDGE_CLAIM_IDS.lumbarLoadingPolicy);
        if (family === 'upper_limb_loading') refs.push(KNOWLEDGE_CLAIM_IDS.upperLimbLoadingPolicy);
    }

    const currentClinicalSources = readiness.subjective.clinicalEnvelopeSources
        ?? (readiness.subjective.painFlag ? ['pain_or_injury'] as const : []);
    if (readiness.subjective.painFlag || currentClinicalSources.length > 0) {
        refs.push(KNOWLEDGE_CLAIM_IDS.genericClinicalEnvelopePolicy);
        if (currentClinicalSources.includes('pain_or_injury')) refs.push(KNOWLEDGE_CLAIM_IDS.symptomsRequireContextualAssessment);
    }
    return mergeKnowledgeRefs(refs);
}

/** Claim IDs for covered objective/subjective readiness policies evaluated for this input. */
export function readinessKnowledgeRefs(readiness: DailyReadiness, context: UserContext): string[] {
    const objective = readiness.objective;
    const hasHrv = objective.hrv_delta !== null;
    const hasRhr = objective.rhr_delta !== null;
    const hasSleepRelative = objective.sleep_score_delta_7d !== null;
    const hasSleepAbsolute = objective.sleep_score !== null;
    const hasRespiration = (objective.respiration_delta ?? null) !== null;
    const hasBodyBattery = objective.body_battery_wake !== null;
    const hasRecentHardPenalty = (objective.last_3_days_hard_sessions_count || 0) >= 2;
    const hasPhysiologicalStrainInput = hasHrv || hasRhr || hasSleepRelative || hasRespiration;
    const hasObjectiveDecisionInput = hasPhysiologicalStrainInput || hasSleepAbsolute || hasBodyBattery || hasRecentHardPenalty || context.preferences.conservativeBias;

    const refs: string[] = [...subjectiveReadinessKnowledgeRefs()];
    if (hasHrv) refs.push(KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional);
    if (hasRhr) refs.push(KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring);
    if (hasSleepRelative || hasSleepAbsolute) refs.push(KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.wearableSleepMeasurementLimits);
    if (hasRespiration) refs.push(KNOWLEDGE_CLAIM_IDS.respirationLongitudinalContext);
    if (hasPhysiologicalStrainInput) refs.push(KNOWLEDGE_CLAIM_IDS.readinessPhysiologicalStrainModel);
    if (hasSleepAbsolute || hasBodyBattery) refs.push(KNOWLEDGE_CLAIM_IDS.readinessAbsoluteDeviceFloors);
    if (hasHrv || hasRhr) refs.push(KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors);
    if (hasRecentHardPenalty) refs.push(KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty);
    if (hasObjectiveDecisionInput) refs.push(KNOWLEDGE_CLAIM_IDS.readinessModeThresholds);
    return mergeKnowledgeRefs(refs, injuryPolicyKnowledgeRefs(readiness, context));
}

function isEnduranceEvent(event: UserEvent | null | undefined): boolean {
    return event?.category === 'running_race' || event?.category === 'cycling_event' || event?.category === 'triathlon';
}

/** Attributes intent-aware ranking policies actually evaluated for the supplied plan state. */
export function trainingIntentKnowledgeRefs(intent: {
    history: readonly unknown[];
    periodization: { focusEvent: UserEvent | null; phase: { taperActive: boolean } };
}): string[] {
    const refs: string[] = [
        KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution,
        KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands,
        KNOWLEDGE_CLAIM_IDS.internalResponseStrainModel,
    ];

    if (intent.history.length > 0) {
        refs.push(
            KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance,
            KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives,
            KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue,
            KNOWLEDGE_CLAIM_IDS.anchorSpacing,
            KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap,
            KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing,
            KNOWLEDGE_CLAIM_IDS.concurrentStrengthEnduranceContext,
            KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency,
        );
    }

    if (intent.periodization.phase.taperActive && isEnduranceEvent(intent.periodization.focusEvent)) {
        refs.push(
            KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper,
            KNOWLEDGE_CLAIM_IDS.taperWindowsVolumePolicy,
            KNOWLEDGE_CLAIM_IDS.taperSharpeningPolicy,
        );
    }
    return mergeKnowledgeRefs(refs);
}

/** Maximum number of athlete-specific evidence refs permitted in a decision lineage snapshot. */
export const MAX_ATHLETE_EVIDENCE_LINEAGE_REFS = 16;

function assertSingleAthleteScope(records: readonly AthleteEvidenceRecord[]): void {
    const userIds = new Set(records.map(record => record.userId));
    if (userIds.size > 1) {
        throw new Error('Athlete evidence lineage cannot mix records from multiple users');
    }
    const ids = new Set<string>();
    for (const record of records) {
        if (ids.has(record.id)) throw new Error(`Athlete evidence lineage contains duplicate record id "${record.id}"`);
        ids.add(record.id);
    }
}

/** Freeze active athlete evidence records materially applied as policy refinements (SKR4). */
export function snapshotAthleteEvidenceLineage(
    records: readonly AthleteEvidenceRecord[] | undefined
): AthleteEvidenceLineageRef[] | undefined {
    if (!records || records.length === 0) return undefined;
    if (records.length > MAX_ATHLETE_EVIDENCE_LINEAGE_REFS) {
        throw new Error(`Athlete evidence lineage exceeds ${MAX_ATHLETE_EVIDENCE_LINEAGE_REFS} records`);
    }
    assertSingleAthleteScope(records);
    for (const record of records) {
        if (record.status !== 'active') {
            throw new Error(`Athlete evidence lineage may snapshot only active records; "${record.id}" is ${record.status}`);
        }
    }
    return [...records]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(record => ({
            recordId: record.id,
            version: record.version,
            domain: record.domain,
            refinementType: record.refinementType,
            baseKnowledgeClaimId: record.baseKnowledgeClaimId,
        }));
}

export type AthleteEvidenceLineageStatus = 'matches_current' | 'drifted' | 'lineage_unavailable';

export interface AthleteEvidenceLineageDrift {
    recordId: string;
    recordedVersion: number;
    currentVersion?: number;
    status: 'missing' | 'inactive' | 'version_mismatch' | 'definition_mismatch';
}

/** Compare persisted athlete evidence lineage against one athlete's current profile. */
export function compareAthleteEvidenceLineage(
    persistedLineage: readonly AthleteEvidenceLineageRef[] | undefined,
    currentRecords: readonly AthleteEvidenceRecord[] | undefined
): { status: AthleteEvidenceLineageStatus; drift: AthleteEvidenceLineageDrift[] } {
    if (persistedLineage === undefined) return { status: 'lineage_unavailable', drift: [] };
    if (persistedLineage.length === 0) return { status: 'matches_current', drift: [] };

    const current = currentRecords ?? [];
    if (current.length > 0) assertSingleAthleteScope(current);
    const currentMap = new Map(current.map(record => [record.id, record]));
    const drift: AthleteEvidenceLineageDrift[] = [];

    for (const ref of persistedLineage) {
        const record = currentMap.get(ref.recordId);
        if (!record) {
            drift.push({ recordId: ref.recordId, recordedVersion: ref.version, status: 'missing' });
        } else if (record.status !== 'active') {
            drift.push({ recordId: ref.recordId, recordedVersion: ref.version, currentVersion: record.version, status: 'inactive' });
        } else if (record.version !== ref.version) {
            drift.push({ recordId: ref.recordId, recordedVersion: ref.version, currentVersion: record.version, status: 'version_mismatch' });
        } else if (
            record.domain !== ref.domain ||
            record.refinementType !== ref.refinementType ||
            record.baseKnowledgeClaimId !== ref.baseKnowledgeClaimId
        ) {
            drift.push({ recordId: ref.recordId, recordedVersion: ref.version, currentVersion: record.version, status: 'definition_mismatch' });
        }
    }

    return { status: drift.length > 0 ? 'drifted' : 'matches_current', drift };
}
