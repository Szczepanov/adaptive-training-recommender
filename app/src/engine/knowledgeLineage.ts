import type { DailyReadiness, KnowledgeLineageRef, UserContext, UserEvent } from './models';
import type { KnowledgeStatus } from '../knowledge/sportsKnowledge';
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

/**
 * Freeze the currently active registry versions for the claims materially consumed by one decision.
 * Statements, citations and source metadata deliberately remain in Git rather than being copied to Firestore.
 */
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
                drift.push({
                    claimId: ref.claimId,
                    recordedVersion: ref.version,
                    currentVersion: current.version,
                    currentStatus: current.status,
                });
            }
        } catch {
            drift.push({
                claimId: ref.claimId,
                recordedVersion: ref.version,
                currentStatus: 'missing',
            });
        }
    }
    return { status: drift.length > 0 ? 'drifted' : 'matches_current', drift };
}

/**
 * Claim IDs for the subjective classifier evaluated by every normal readiness decision.
 * `SubjectiveInput` is normalized before it reaches the engine: a complete minimum-safety
 * check-in can therefore include neutral defaults for other scale dimensions. The product
 * policy claim documents that participation without misrepresenting the defaults as measured
 * evidence. Provisional safety fallbacks do not call this helper or create an audit.
 */
export function subjectiveReadinessKnowledgeRefs(): string[] {
    return mergeKnowledgeRefs([
        KNOWLEDGE_CLAIM_IDS.contextualMonitoring,
        KNOWLEDGE_CLAIM_IDS.measurementQualityLimits,
        KNOWLEDGE_CLAIM_IDS.exactCutpointLimits,
        KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
    ]);
}

/** Claim IDs for the compact injury/symptom-policy facts captured at composition time.
 * Standing-injury region families are read from the trace because they are provenance facts.
 * Current clinical source attribution is read from `SubjectiveInput`, the same decision input
 * consumed by `rules.ts`; trace data must not be promoted into current-pain policy authority. */
export function injuryPolicyKnowledgeRefs(readiness: DailyReadiness, context: UserContext): string[] {
    const trace = context.injuryPolicyTrace;
    const refs: string[] = [];
    if (trace?.tissueSeverityApplied) {
        refs.push(
            KNOWLEDGE_CLAIM_IDS.tissueResponseTemporalMonitoring,
            KNOWLEDGE_CLAIM_IDS.tissueResponseSeverityPolicy,
        );
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
        if (currentClinicalSources.includes('pain_or_injury')) {
            refs.push(KNOWLEDGE_CLAIM_IDS.symptomsRequireContextualAssessment);
        }
    }
    return mergeKnowledgeRefs(refs);
}

/**
 * Claim IDs for the covered objective- and subjective-readiness policies actually evaluated for this input.
 * A long-horizon value is only consumed by metricStrain when its 7-day anchor exists, so
 * 28-day-only fields must not create lineage for a branch that returned before reading them.
 */
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
    const hasObjectiveDecisionInput = hasPhysiologicalStrainInput
        || hasSleepAbsolute
        || hasBodyBattery
        || hasRecentHardPenalty
        || context.preferences.conservativeBias;

    const refs: string[] = [...subjectiveReadinessKnowledgeRefs()];
    if (hasHrv) refs.push(KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional);
    if (hasRhr) refs.push(KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring);
    if (hasSleepRelative || hasSleepAbsolute) {
        refs.push(KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.wearableSleepMeasurementLimits);
    }
    if (hasRespiration) refs.push(KNOWLEDGE_CLAIM_IDS.respirationLongitudinalContext);
    if (hasPhysiologicalStrainInput) refs.push(KNOWLEDGE_CLAIM_IDS.readinessPhysiologicalStrainModel);
    if (hasSleepAbsolute || hasBodyBattery) refs.push(KNOWLEDGE_CLAIM_IDS.readinessAbsoluteDeviceFloors);
    if (hasHrv || hasRhr) refs.push(KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors);
    if (hasRecentHardPenalty) {
        refs.push(KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty);
    }
    if (hasObjectiveDecisionInput) refs.push(KNOWLEDGE_CLAIM_IDS.readinessModeThresholds);
    return mergeKnowledgeRefs(refs, injuryPolicyKnowledgeRefs(readiness, context));
}

/** True when the event category is governed by the endurance taper knowledge claims. */
function isEnduranceEvent(event: UserEvent | null | undefined): boolean {
    return event?.category === 'running_race'
        || event?.category === 'cycling_event'
        || event?.category === 'triathlon';
}

/**
 * Attributes intent-aware ranking policies whose gates/costs are evaluated for the supplied plan
 * state and whose knowledge-coverage inventory row is `covered` or `partial` (see
 * `knowledge/knowledgeCoverage.ts`) — never a row still `uncovered`, and never on a coarser signal
 * than the one the coverage row actually claims.
 *
 * The `taperActive` gate below is precise enough for the taper-window/volume and taper-sharpening
 * claims: both describe behavior that is, by definition, exactly what `taperActive` means. It is
 * NOT precise enough for `spacing.pre_event_restrictions` (SKR3 W0, 2026-09-02): that family's
 * `preEventRestrictionsPolicy` claim describes optimizer restrictions gated on exact days-to-event
 * (`engine/optimizer.ts:evaluateRecoveryConstraints`), which can differ from `taperActive` — e.g. a
 * legacy A/B taper can be active up to 14 days out while the exhaustive-work restriction only
 * evaluates within 7. Attributing it here would over-claim lineage on days where the restriction
 * never actually fires. It stays unattributed until days-to-event is threaded into this function's
 * input, uncovered optimizer coefficients (`engine/optimizer.ts` weights with no coverage row above
 * `uncovered`) are never attributed at all.
 */
export function trainingIntentKnowledgeRefs(intent: {
    history: readonly unknown[];
    periodization: {
        focusEvent: UserEvent | null;
        phase: { taperActive: boolean };
    };
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
