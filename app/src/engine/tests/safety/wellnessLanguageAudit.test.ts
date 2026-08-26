import { describe, it, expect } from 'vitest';
import { TEMPLATES, ENRICHED_TEMPLATES } from '../../templates';
import { ELIGIBILITY_REASON_LABEL } from '../../eligibility';
import { createProvisionalSafetyRecommendation } from '../../safetyCheckin';
import { evaluatePhysiologicalAnomaly, SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from '../../healthAnomaly';
import { generateAdversarialCheckin, createPseudoRandom } from '../../testing/adversarialGenerators';
import type { HealthAnomalyInput } from '../../healthAnomalyModels';
import type { DailyRecoverySnapshot } from '../../models';

function createTestSnapshot(date: string, overrides: Partial<DailyRecoverySnapshot['raw']> = {}): DailyRecoverySnapshot {
    return {
        userId: 'adversarial-user',
        date,
        source: {
            garminSyncedAt: `${date}T06:00:00Z`,
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
        },
        raw: {
            sleepScore: 80,
            sleepDurationSec: 450 * 60,
            restingHr: 50,
            hrvOvernightAvg: 60,
            hrvStatus: 'balanced',
            respirationAvg: 14.0,
            bodyBatteryWake: 80,
            bodyBatteryChange: 50,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
            ...overrides,
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 80,
            sleepScore28dAvg: 80,
            restingHr7dAvg: 50,
            restingHr28dAvg: 50,
            hrv7dAvg: 60,
            hrv28dAvg: 60,
            respiration7dAvg: 14.0,
            respiration28dAvg: 14.0,
            deltas: {
                sleepScoreVs7d: 0,
                sleepScoreVs28d: 0,
                restingHrVs7d: 0,
                restingHrVs28d: 0,
                hrvVs7d: 0,
                hrvVs28d: 0,
                respirationVs7d: 0,
                respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    };
}

const FORBIDDEN_DIAGNOSTIC_TERMS = [
    /\bdiagnos(is|ed|tic|e)\b/i,
    /\bpatholog(y|ical)\b/i,
    /\binfection\b/i,
    /\binfectious\b/i,
    /\bcovid\b/i,
    /\binfluenza\b/i,
    /\bdisease\b/i,
    /\bcure\b/i,
    /\bprescribe medication\b/i,
    /\bmedical condition\b/i,
];

describe('Non-Diagnostic Wellness Language Audit', () => {
    it('Session template titles and descriptions use neutral training/wellness terminology', () => {
        const allTemplates = [...TEMPLATES, ...ENRICHED_TEMPLATES];
        for (const template of allTemplates) {
            for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
                expect(
                    template.title,
                    `Template title "${template.title}" matched forbidden pattern ${forbidden}`,
                ).not.toMatch(forbidden);
                expect(
                    template.description,
                    `Template description "${template.description}" matched forbidden pattern ${forbidden}`,
                ).not.toMatch(forbidden);
            }
        }
    });

    it('Eligibility gate descriptions use clear, non-diagnostic reasons', () => {
        for (const [key, label] of Object.entries(ELIGIBILITY_REASON_LABEL)) {
            for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
                expect(
                    label,
                    `Eligibility reason label for "${key}" matched forbidden pattern ${forbidden}`,
                ).not.toMatch(forbidden);
            }
        }
    });

    it('Safety fallback recommendations use non-diagnostic recovery language', () => {
        const missingRec = createProvisionalSafetyRecommendation('missing');
        const incompleteRec = createProvisionalSafetyRecommendation('incomplete');

        for (const rec of [missingRec, incompleteRec]) {
            for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
                expect(rec.rationale).not.toMatch(forbidden);
                if (rec.envelopes?.safety.clinicalReason) {
                    expect(rec.envelopes.safety.clinicalReason).not.toMatch(forbidden);
                }
            }
        }
    });

    it('Physiological anomaly evaluations always append NOT_A_DIAGNOSIS caution to non-normal states', () => {
        const date = '2026-08-26';
        const input: HealthAnomalyInput = {
            date,
            timezone: 'Europe/Warsaw',
            last3DaysHardSessionsCount: 0,
            coreSignals: [
                { signal: 'hrv', status: 'strong_anomaly', direction: 'low', currentValue: 30, baselineValue: 60, scaleValue: 5, standardizedDeviation: -2.8, estimator: 'log-mean-stdev-28d', baselineVersion: 1 },
                { signal: 'rhr', status: 'strong_anomaly', direction: 'high', currentValue: 65, baselineValue: 50, scaleValue: 2, standardizedDeviation: 3.2, estimator: 'mean-stdev-28d', baselineVersion: 1 },
                { signal: 'respiration', status: 'strong_anomaly', direction: 'high', currentValue: 18.0, baselineValue: 14.0, scaleValue: 1, standardizedDeviation: 2.8, estimator: 'median-mad-28d', baselineVersion: 1 },
            ],
            supportingSignals: [],
            dataQuality: [
                { signal: 'hrv', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'rhr', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'respiration', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
            ],
            persistence: {
                previousState: 'watch_unexplained',
                previousAssessmentDate: '2026-08-25',
                unexplainedPersistenceDays: 2,
                previousEpisodeId: 'ep-1',
                previousEpisodeDay: 2,
            },
            recoverySnapshot: createTestSnapshot(date, {
                sleepScore: 75,
                bodyBatteryWake: 40,
                stress: { avg: 30 },
                trainingReadiness: { score: 45 },
            }),
            subjectiveCheckin: generateAdversarialCheckin(createPseudoRandom(9), date, {
                readiness: 4,
                sleepQuality: 6,
                fatigue: 6,
                soreness: 4,
                mentalStress: 4,
                motivation: 4,
                painOrInjury: false,
                illnessSymptoms: false,
                alreadyTrainedToday: false,
            }),
        };

        const assessment = evaluatePhysiologicalAnomaly(input, 'shadow-v1', SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS);
        expect(assessment).toBeDefined();
        expect(assessment?.state).toBe('possible_illness_or_systemic_stress');
        // Must contain explicit NOT_A_DIAGNOSIS caution
        expect(assessment?.rationale.cautions).toContain('NOT_A_DIAGNOSIS');

        // Check that rationale facts and explanations are free of diagnostic claims
        for (const fact of assessment?.rationale.facts ?? []) {
            for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
                expect(fact.code).not.toMatch(forbidden);
            }
        }
    });
});
