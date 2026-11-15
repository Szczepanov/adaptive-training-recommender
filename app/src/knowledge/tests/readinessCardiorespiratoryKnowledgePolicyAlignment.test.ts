import { describe, expect, it } from 'vitest';
import {
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
    evaluatePhysiologicalAnomaly,
} from '../../derived/flags/illnessAnomaly/healthAnomaly';
import {
    HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS,
    HEALTH_ANOMALY_BASELINE_WINDOW_DAYS,
    HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS,
    HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS,
} from '../../derived/flags/illnessAnomaly/healthAnomalyFeatures';
import { evaluateIllnessAnomalyFlag } from '../../derived/flags/illnessAnomaly/illnessAnomalyFlag';
import { summarizePersonalOutcomeCalibration } from '../../derived/flags/illnessAnomaly/healthAnomalyOutcome';
import {
    CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR,
    READINESS_CARDIORESPIRATORY_CLAIM_IDS,
} from '../readinessCardiorespiratoryKnowledge';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from '../sportsKnowledgeRegistry';
import { REVIEWED_NON_AUTHORITY_SURFACES } from '../knowledgeCoverage';

describe('readiness cardiorespiratory visible early-warning knowledge policy alignment', () => {
    it('registers cardiorespiratory-illness-escalation with valid peer-reviewed sources in the canonical registry', () => {
        const validation = validateCanonicalSportsKnowledgeRegistry();
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);

        expect(KNOWLEDGE_CLAIM_IDS.cardiorespiratoryIllnessEscalation).toBe('cardiorespiratory-illness-escalation');
        expect(READINESS_CARDIORESPIRATORY_CLAIM_IDS.cardiorespiratoryIllnessEscalation).toBe('cardiorespiratory-illness-escalation');

        const claim = getActiveKnowledgeClaim('cardiorespiratory-illness-escalation');
        expect(claim.claimType).toBe('safety');
        expect(claim.status).toBe('active');
        expect(claim.evidence.map(item => item.sourceId)).toEqual(expect.arrayContaining([
            'MISHRA-2020-SMARTWATCH-PRESYMPTOMATIC-COVID',
            'ALAVI-2021-NIGHTSIGNAL-WEARABLE-ALERTING',
            'GRZESIAK-2021-VIRAL-CHALLENGE-WEARABLES',
            'GAUR-2024-GARMIN-ACTIVITY-MATCHED-HRV',
            'ZWIERS-2025-COVID-RED-RANDOMIZED-TRIAL',
            'SCHWELLNUS-2022-IOC-RESPIRATORY-PART1',
            'SCHWELLNUS-2022-IOC-RESPIRATORY-PART2',
            'ESMAEILPOUR-2024-WEARABLE-INFECTION-VALIDATION',
        ]));

        expect(getKnowledgeSource('SCHWELLNUS-2022-IOC-RESPIRATORY-PART1').sourceType).toBe('consensus');
        expect(getKnowledgeSource('ZWIERS-2025-COVID-RED-RANDOMIZED-TRIAL').sourceType).toBe('randomized_trial');
        expect(getKnowledgeSource('GAUR-2024-GARMIN-ACTIVITY-MATCHED-HRV').externalIds).toEqual(
            expect.arrayContaining([{ type: 'pmid', value: '39110968' }]),
        );
    });

    it('pins VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS and feature constants to the knowledge descriptor', () => {
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.policyVersion);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.moderateDeviation)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.moderateDeviation);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.strongDeviation)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.strongDeviation);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.minimumCoreSignalsForMultiSignal)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.minimumCoreSignalsForMultiSignal);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.persistenceDaysForEscalation)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.persistenceDaysForEscalation);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.emergingHistoryCount)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.emergingHistoryCount);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.minimumHistoryCount)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.minimumHistoryCount);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.minimumRecentDayCoverage)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.minimumRecentDayCoverage);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.maxBaselineAgeDays)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.maxBaselineAgeDays);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.allowFirstNightMultiDomainEscalation)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.allowFirstNightMultiDomainEscalation);
        expect(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.downgradeResolvingRespiration)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.downgradeResolvingRespiration);

        expect(HEALTH_ANOMALY_BASELINE_WINDOW_DAYS)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.baselineWindowDays);
        expect(HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.emergingHistoryCount);
        expect(HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.minimumHistoryCount);
        expect(HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS)
            .toBe(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.activityShrinkagePriorDays);

        const claim = getActiveKnowledgeClaim('cardiorespiratory-illness-escalation');
        expect(claim.statement).toContain('>=1.5 SD');
        expect(claim.statement).toContain('>=2.5 SD');
        expect(claim.statement).toContain('K=5');
        expect(claim.limitations.join(' ')).toContain('>=3 prior episodes');
    });

    it('keeps autonomous tightening gated outside live decision authority and maps cold-start missingness cleanly', () => {
        const entry = REVIEWED_NON_AUTHORITY_SURFACES.find(
            surface => surface.ref === 'derived/flags/illnessAnomaly/healthAnomaly.ts',
        );
        expect(entry?.reason).toContain('VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS');
        expect(entry?.reason).toContain('cardiorespiratory-illness-escalation');

        const insufficient = evaluatePhysiologicalAnomaly({
            date: '2026-08-21',
            timezone: 'Europe/Warsaw',
            recoverySnapshot: null,
            subjectiveCheckin: null,
            coreSignals: [],
            supportingSignals: [],
            dataQuality: [],
            last3DaysHardSessionsCount: 0,
            persistence: {
                previousState: null,
                previousEpisodeId: null,
                previousEpisodeDay: null,
                previousAssessmentDate: null,
                unexplainedPersistenceDays: 0,
            },
        }, 'visible-v1', VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS);

        expect(insufficient?.state).toBe('insufficient_evidence');
        expect(evaluateIllnessAnomalyFlag(insufficient)).toMatchObject({
            active: null,
            state: 'missing',
            reasonCode: 'no_core_signals',
        });

        expect(summarizePersonalOutcomeCalibration([], '2026-08-21').calibrationEligible).toBe(false);
        expect(CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR.outcomeCalibrationMinEpisodes).toBe(3);
    });
});
