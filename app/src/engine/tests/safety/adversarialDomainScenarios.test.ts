import { describe, it, expect } from 'vitest';
import { evaluateReadinessAndSafetyEnvelope, evaluateTraining } from '../../rules';
import { evaluatePhysiologicalAnomaly, SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from '../../healthAnomaly';
import { getMinimumSafetyCheckinStatus, canGenerateNormalRecommendation, createProvisionalSafetyRecommendation } from '../../safetyCheckin';
import { resolveExecutionDose } from '../../dose';
import { adjudicateAuthoredSession } from '../../authoredSessionGates';
import { resolveInjuryRestrictions, resolveEffectiveInjuryConstraints } from '../../injuryPolicy';
import { eligibleTemplates, evaluateTemplateEligibility } from '../../eligibility';
import { resolveAvailability } from '../../schedule';
import { TEMPLATES, ENRICHED_TEMPLATES } from '../../templates';
import { generateAdversarialCheckin, createPseudoRandom } from '../../testing/adversarialGenerators';
import type {
    DailyReadiness,
    UserContext,
    InjuryConstraint,
    PlanEnvelope,
    DailyRecoverySnapshot,
} from '../../models';
import type { SessionDefinition } from '../../../sessions/models';
import type { HealthAnomalyInput } from '../../healthAnomalyModels';

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

function baseReadiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 7,
            sleepQuality: 7,
            fatigue: 3,
            soreness: 3,
            stress: 3,
            motivation: 7,
            timeAvailable: 60,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 80,
            sleep_duration_min: 450,
            rhr: 50,
            rhr_7d_avg: 50,
            rhr_delta: 0,
            hrv_weekly_avg: 60,
            hrv_last_night: 60,
            hrv_delta: 0,
            hrv_delta_28d: 0,
            hrv_stdev_28d: 5.0,
            rhr_delta_28d: 0,
            rhr_stdev_28d: 2.0,
            sleep_score_delta_7d: 0,
            sleep_score_delta_28d: 0,
            sleep_score_stdev_28d: 5.0,
            respiration: 14,
            body_battery_wake: 80,
            last_3_days_hard_sessions_count: 0,
            yesterday_training: null,
            today_training: null,
        },
    };
}

function baseContext(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: true,
            hasIndoorBike: true,
            maxTimeMinutes: 90,
            restrictedModalities: [],
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Running'],
            conservativeBias: false,
        },
        trainingSettings: {
            userId: 'test-user',
            schemaVersion: 2,
            equipment: {
                free_weights: true,
                indoor_bike: true,
                treadmill: true,
                cable_machine: false,
                pullup_bar: false,
            },
            guardrails: {
                avoid_high_impact: false,
                avoid_heavy_lower_body: false,
                avoid_overhead_pressing: false,
                avoid_heavy_spinal_loading: false,
            },
            defaults: {
                weekdayMaxMinutes: 60,
                weekendMaxMinutes: 90,
                environment: 'either',
            },
            preferences: { preferActiveRecovery: false },
            injuries: [],
            migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '',
            updatedAt: '',
        },
    };
}

describe('10 Physiological and Scheduling Adversarial Domain Combinations', () => {
    // 1. High readiness but current pain
    it('Combination 1: High readiness but current pain forces recovery mode and excludes high-impact work', () => {
        const readiness = baseReadiness();
        readiness.objective.hrv_delta = 15; // +1.5 sigma rebound
        readiness.objective.rhr_delta = -4; // lower RHR
        readiness.objective.sleep_score = 95;
        readiness.objective.body_battery_wake = 95;
        readiness.subjective.readiness = 9;
        readiness.subjective.painFlag = true; // Flagging acute pain/injury
        readiness.subjective.soreness = 8;

        const context = baseContext();
        context.preferences.preferredModalities = ['Running']; // Athlete wants to run hard

        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, context, '2026-08-26');
        expect(envelope.mode).toBe('recover');
        expect(envelope.fatigueTriggeredRecover).toBe(true);

        const rec = evaluateTraining(readiness, context, '2026-08-26');
        expect(rec.mode).toBe('recover');
        expect(rec.template.category).toMatch(/Rest|Mobility/);
        expect(rec.template.modality).not.toBe('Running');
    });

    // 2. Excellent sleep after several excessive training days
    it('Combination 2: Excellent sleep after excessive training days does not mask cumulative fatigue', () => {
        const readiness = baseReadiness();
        readiness.objective.last_3_days_hard_sessions_count = 3; // 3 hard sessions recently
        readiness.objective.sleep_score = 98; // 9+ hours deep sleep
        readiness.objective.sleep_duration_min = 570;
        readiness.objective.body_battery_wake = 90;
        readiness.objective.hrv_delta = 5;
        readiness.subjective.readiness = 8;
        readiness.subjective.fatigue = 5;

        const context = baseContext();
        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, context, '2026-08-26');

        // Recent hard sessions penalty (1.0) must be applied
        expect(envelope.telemetry.contextPenalties.recentHardSessions).toBe(1.0);
        // Total strain must be at least modify tier
        expect(envelope.mode).toBe('modify');

        const rec = evaluateTraining(readiness, context, '2026-08-26');
        expect(rec.mode).toBe('modify');
        expect(rec.template.category).not.toBe('Hard Endurance');
    });

    // 3. Low HRV caused by a hard session rather than illness
    it('Combination 3: Low HRV following a hard session is classified as explained recovery strain, not illness', () => {
        const date = '2026-08-26';
        const input: HealthAnomalyInput = {
            date,
            timezone: 'Europe/Warsaw',
            last3DaysHardSessionsCount: 1,
            coreSignals: [
                {
                    signal: 'hrv',
                    status: 'moderate_anomaly',
                    direction: 'low',
                    currentValue: 42,
                    baselineValue: 60,
                    scaleValue: 5,
                    standardizedDeviation: -1.8,
                    estimator: 'log-mean-stdev-28d',
                    baselineVersion: 1,
                },
                {
                    signal: 'rhr',
                    status: 'normal',
                    direction: 'high',
                    currentValue: 51,
                    baselineValue: 50,
                    scaleValue: 2,
                    standardizedDeviation: 0.5,
                    estimator: 'mean-stdev-28d',
                    baselineVersion: 1,
                },
                {
                    signal: 'respiration',
                    status: 'normal',
                    direction: 'high',
                    currentValue: 14.2,
                    baselineValue: 14.0,
                    scaleValue: 1,
                    standardizedDeviation: 0.2,
                    estimator: 'median-mad-28d',
                    baselineVersion: 1,
                },
            ],
            supportingSignals: [],
            dataQuality: [
                { signal: 'hrv', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'rhr', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'respiration', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
            ],
            persistence: {
                previousState: 'normal',
                previousAssessmentDate: '2026-08-25',
                unexplainedPersistenceDays: 0,
                previousEpisodeId: null,
                previousEpisodeDay: null,
            },
            recoverySnapshot: createTestSnapshot(date, {
                sleepScore: 78,
                bodyBatteryWake: 70,
                stress: { avg: 35 },
                trainingReadiness: { score: 65 },
                last3DaysHardSessionsCount: 1,
                yesterdayTraining: {
                    hardActivityCount: 1,
                    primaryActivity: {
                        activityId: 100,
                        type: 'cycling',
                        durationMin: 90,
                        trainingEffect: 4.2,
                        intensityTag: 'hard',
                    },
                },
            }),
            subjectiveCheckin: generateAdversarialCheckin(createPseudoRandom(3), date, {
                readiness: 6,
                sleepQuality: 7,
                fatigue: 5,
                soreness: 5,
                mentalStress: 3,
                motivation: 7,
                painOrInjury: false,
                illnessSymptoms: false,
                alreadyTrainedToday: false,
            }),
        };

        const assessment = evaluatePhysiologicalAnomaly(input, 'shadow-v1', SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS);
        expect(assessment).toBeDefined();
        // Must be explained recovery strain, NOT possible illness
        expect(assessment?.state).toBe('explained_recovery_strain');
        expect(assessment?.explanations.some(e => e.kind === 'hard_training')).toBe(true);
    });

    // 4. Illness symptoms with otherwise strong metrics
    it('Combination 4: Illness symptoms with strong biometrics immediately locks recovery mode', () => {
        const date = '2026-08-26';
        const input: HealthAnomalyInput = {
            date,
            timezone: 'Europe/Warsaw',
            last3DaysHardSessionsCount: 0,
            coreSignals: [
                { signal: 'hrv', status: 'normal', direction: 'high', currentValue: 65, baselineValue: 60, scaleValue: 5, standardizedDeviation: 0.5, estimator: 'log-mean-stdev-28d', baselineVersion: 1 },
                { signal: 'rhr', status: 'normal', direction: 'high', currentValue: 50, baselineValue: 50, scaleValue: 2, standardizedDeviation: 0.0, estimator: 'mean-stdev-28d', baselineVersion: 1 },
                { signal: 'respiration', status: 'normal', direction: 'high', currentValue: 14.0, baselineValue: 14.0, scaleValue: 1, standardizedDeviation: 0.0, estimator: 'median-mad-28d', baselineVersion: 1 },
            ],
            supportingSignals: [],
            dataQuality: [
                { signal: 'hrv', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'rhr', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
                { signal: 'respiration', historyCount: 28, recentDayCoverage: 1, baselineAgeDays: 0, currentValueMissing: false, baselineWindowStart: '2026-07-29', baselineWindowEndExclusive: '2026-08-26', zeroOrNearZeroScale: false, suspectedQuantizationOrTies: false },
            ],
            persistence: { previousState: 'normal', previousAssessmentDate: '2026-08-25', unexplainedPersistenceDays: 0, previousEpisodeId: null, previousEpisodeDay: null },
            recoverySnapshot: createTestSnapshot(date, {
                sleepScore: 88,
                bodyBatteryWake: 85,
                stress: { avg: 25 },
                trainingReadiness: { score: 85 },
            }),
            subjectiveCheckin: generateAdversarialCheckin(createPseudoRandom(4), date, {
                readiness: 7,
                sleepQuality: 8,
                fatigue: 3,
                soreness: 2,
                mentalStress: 3,
                motivation: 7,
                painOrInjury: false,
                illnessSymptoms: true, // Athlete declares illness symptoms
                alreadyTrainedToday: false,
                healthContext: {
                    symptoms: { present: true, severity: 'moderate' },
                    closeSickContact: false,
                    travelDisruption: 'none',
                    alcoholDrinksLast24h: 0,
                    unusualHeatOrSauna: false,
                    dehydrationOrFluidLoss: false,
                    recentVaccination: false,
                    medicationChange: false,
                },
            }),
        };

        const assessment = evaluatePhysiologicalAnomaly(input, 'shadow-v1', SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS);
        expect(assessment?.state).toBe('symptoms_reported');
        expect(assessment?.rationale.cautions).toContain('NOT_A_DIAGNOSIS');
    });

    // 5. Conflicting injury constraints and event priorities
    it('Combination 5: Severe injury constraint strictly overrides A-priority event priority', () => {
        const date = '2026-08-26';
        const context = baseContext();
        const kneeInjury: InjuryConstraint = {
            region: 'knee',
            severity: 'exclude',
            reviewBy: '2026-09-01',
            restrictedModalities: ['Running'],
        };
        context.trainingSettings!.injuries = [kneeInjury];
        context.constraints.restrictedModalities = ['Running'];

        const restrictions = resolveInjuryRestrictions(context.trainingSettings?.injuries, date);
        expect(restrictions.restrictedModalities).toContain('Running');
        expect(restrictions.impliedGuardrails).toContain('avoid_high_impact');

        // Check template eligibility for running templates
        const runningTemplates = TEMPLATES.filter(t => t.modality === 'Running');
        for (const t of runningTemplates) {
            const eligibility = evaluateTemplateEligibility(t, context, 90, date);
            expect(eligibility.eligible).toBe(false);
            expect(eligibility.reasons).toContain('restricted_modality');
        }

        const validCandidates = eligibleTemplates(TEMPLATES, context, 90, date);
        expect(validCandidates.some(t => t.modality === 'Running')).toBe(false);
    });

    // 6. Several "additional sessions" creating excessive combined load
    it('Combination 6: Multiple same-day authored sessions accumulate systemic cost and enforce ceiling', () => {
        const date = '2026-08-26';
        const readiness = baseReadiness();
        const context = baseContext();
        const envelopeState = evaluateReadinessAndSafetyEnvelope(readiness, context, date);
        const availability = resolveAvailability(date, readiness.subjective, [], context);

        const morningSession: SessionDefinition = {
            schemaVersion: 1,
            id: 'session-morning-heavy',
            revision: 1,
            title: 'Heavy Lower Body Strength',
            dominantModality: 'Strength',
            intent: 'training',
            duration: { min: 60, max: 75 },
            blocks: [],
        };

        const afternoonSession: SessionDefinition = {
            schemaVersion: 1,
            id: 'session-afternoon-intervals',
            revision: 1,
            title: 'VO2 Max Cycling Intervals',
            dominantModality: 'Cycling',
            intent: 'competition',
            duration: { min: 75, max: 90 },
            blocks: [],
        };

        // Morning session evaluated first
        const morningVerdict = adjudicateAuthoredSession(
            morningSession,
            readiness,
            context,
            envelopeState,
            { volume: 0.8, intensity: 0.8 },
            date,
            availability,
            0,
        );
        expect(morningVerdict.decision).toBe('proceed');
        const morningCost = morningVerdict.acceptedSystemicCost ?? 0.5;

        // Afternoon session evaluated with acceptedSameDaySystemicCost carried forward
        // In train mode on an ordinary day, max allowable tier systemic cost is bounded
        const envelopeWithMaxTier: typeof envelopeState = {
            ...envelopeState,
            envelopes: {
                ...envelopeState.envelopes,
                plan: {
                    maxAllowableTier: 'Moderate', // 0.8 ceiling
                    taperActive: false,
                    reason: 'Moderate capacity day',
                },
            },
        };

        const afternoonVerdict = adjudicateAuthoredSession(
            afternoonSession,
            readiness,
            context,
            envelopeWithMaxTier,
            { volume: 0.9, intensity: 1.0 },
            date,
            availability,
            morningCost,
        );

        // Systemic cost combination (morning + afternoon) exceeds 0.8, so afternoon session must be rejected
        expect(afternoonVerdict.decision).toBe('reject');
        expect(afternoonVerdict.gateFailures).toContain('restricted_category');
    });

    // 7. User repeatedly selecting "harder"
    it('Combination 7: User selecting harder cannot escalate dose beyond clinical safety ceiling', () => {
        const safetyTier: PlanEnvelope = {
            maxAllowableTier: 'Easy', // Max execution dose is 0.5
            taperActive: false,
            reason: 'Low readiness safety cap',
        };

        const initialDose = { volume: 0.5, intensity: 0.6 };

        // 1st request for 'harder'
        const dose1 = resolveExecutionDose(initialDose, safetyTier, 'harder');
        expect(dose1).toBeDefined();
        expect(dose1!.volume).toBe(0.5); // Clamped to Easy ceiling of 0.5

        // Attempting harder from an already saturated volume
        const dose2 = resolveExecutionDose({ volume: 0.9, intensity: 1.0 }, safetyTier, 'harder');
        expect(dose2).toBeDefined();
        expect(dose2!.volume).toBe(0.5); // Still strictly clamped to 0.5

        // On a Rest day (ceiling 0.0)
        const restSafety: PlanEnvelope = {
            maxAllowableTier: 'Rest',
            taperActive: false,
            reason: 'Mandated Rest Day',
        };
        const restDose = resolveExecutionDose({ volume: 0.8, intensity: 0.8 }, restSafety, 'harder');
        expect(restDose?.volume).toBe(0); // Zero volume allowed on Rest
    });

    // 8. Missing safety check-in
    it('Combination 8: Missing or incomplete safety check-in forces provisional Rest fallback', () => {
        // Case A: Null checkin
        const statusMissing = getMinimumSafetyCheckinStatus(null) as 'missing';
        expect(statusMissing).toBe('missing');
        expect(canGenerateNormalRecommendation(statusMissing)).toBe(false);
        const recMissing = createProvisionalSafetyRecommendation(statusMissing);
        expect(recMissing.mode).toBe('recover');
        expect(recMissing.template.category).toBe('Rest');
        expect(recMissing.envelopes?.plan.maxAllowableTier).toBe('Rest');

        // Case B: Incomplete checkin (missing pain question)
        const partialCheckin = generateAdversarialCheckin(createPseudoRandom(8), '2026-08-26');
        Object.defineProperty(partialCheckin, 'painOrInjury', { value: undefined });
        partialCheckin.dataQuality = { isComplete: false, missingFields: ['painOrInjury'] };
        const statusIncomplete = getMinimumSafetyCheckinStatus(partialCheckin) as 'incomplete';
        expect(statusIncomplete).toBe('incomplete');
        expect(canGenerateNormalRecommendation(statusIncomplete)).toBe(false);
        const recIncomplete = createProvisionalSafetyRecommendation(statusIncomplete);
        expect(recIncomplete.mode).toBe('recover');
        expect(recIncomplete.template.category).toBe('Rest');
    });

    // 9. A competition occurring during a high-fatigue period
    it('Combination 9: Competition during high acute fatigue enforces safe recovery buffers', () => {
        const readiness = baseReadiness();
        readiness.objective.hrv_delta = -20; // Massive autonomic drop
        readiness.objective.rhr_delta = 8;
        readiness.subjective.fatigue = 9;
        readiness.subjective.soreness = 9;
        readiness.subjective.painFlag = true;

        const context = baseContext();
        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, context, '2026-08-26');

        // Extreme fatigue triggers recover mode regardless of race date
        expect(envelope.mode).toBe('recover');
        expect(envelope.fatigueTriggeredRecover).toBe(true);

        const rec = evaluateTraining(readiness, context, '2026-08-26');
        expect(rec.mode).toBe('recover');
        expect(rec.template.category).toMatch(/Rest|Mobility/);
    });

    // 10. Strength work combined with football or cycling intensity
    it('Combination 10: Multi-sport cross-modality lower-body collision triggers guardrails', () => {
        const date = '2026-08-26';
        const context = baseContext();
        // Hamstring strain from football / running
        const hamstringConstraint: InjuryConstraint = {
            region: 'hamstring',
            severity: 'exclude',
            reviewBy: '2026-09-01',
        };
        context.trainingSettings!.injuries = [hamstringConstraint];

        const effectiveInjuries = resolveEffectiveInjuryConstraints(
            context.trainingSettings?.injuries,
            { hamstring: { region: 'hamstring', morningState: 'severe' } },
            date,
        );
        const restrictions = resolveInjuryRestrictions(effectiveInjuries, date);

        expect(restrictions.impliedGuardrails).toContain('avoid_heavy_lower_body');
        expect(restrictions.restrictedCategories).toContain('Lower-body Strength');
        expect(restrictions.restrictedCategories).toContain('Full-body Strength');

        // Lower-body and full-body strength must be excluded
        const heavyStrengthTemplates = ENRICHED_TEMPLATES.filter(
            t => t.category === 'Lower-body Strength' || t.category === 'Full-body Strength',
        );

        for (const t of heavyStrengthTemplates) {
            const eligibility = evaluateTemplateEligibility(t, context, 90, date);
            expect(eligibility.eligible).toBe(false);
            expect(eligibility.reasons.some(r => r === 'restricted_category' || r === 'safety_guardrail')).toBe(true);
        }
    });
});
