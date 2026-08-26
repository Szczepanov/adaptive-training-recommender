import { describe, expect, it } from 'vitest';
import { buildShadowLog, buildShadowLogRow, deriveEngineVerdictFromMode, renderShadowLogCsv, type ShadowLogDayInput } from './shadowLog';
import type { DailyRecommendation, DailyRecoverySnapshot, DailySubjectiveCheckin, DecisionJournalEntry, ShadowVerdict } from './models';
import type { ClosedLoopFeedbackRecord } from '../feedback/feedbackModels';

const DATE = '2026-08-16';
type RecommendationWithVerdict = DailyRecommendation & { engineVerdict?: ShadowVerdict };

function recommendation(overrides: Partial<RecommendationWithVerdict> = {}): RecommendationWithVerdict {
    return {
        userId: 'u1', date: DATE, templateId: 'easy_01', templateTitle: 'Easy Ride',
        category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'r',
        schemaVersion: 3, createdAt: DATE, updatedAt: DATE,
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        ...overrides,
    };
}

function journalEntry(overrides: Partial<DecisionJournalEntry> = {}): DecisionJournalEntry {
    return {
        userId: 'u1', date: DATE, externalVerdict: 'proceed', sawEngineVerdictFirst: false,
        createdAt: DATE, updatedAt: DATE, schemaVersion: 1,
        ...overrides,
    };
}

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1', date: DATE, readiness: 7, sleepQuality: 6, fatigue: 4, soreness: 3, mentalStress: 4, motivation: 6,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: 'a private note that must never appear in the export',
        submittedAt: DATE, dataQuality: { isComplete: true, missingFields: [] }, schemaVersion: 1,
        createdAt: DATE, updatedAt: DATE,
        ...overrides,
    };
}

function feedbackRecord(overrides: Partial<ClosedLoopFeedbackRecord> = {}): ClosedLoopFeedbackRecord {
    return {
        date: DATE,
        recommendationRef: { recommendationId: 'rec-1', revision: 1 },
        decision: {
            date: DATE,
            recommendationRef: { recommendationId: 'rec-1', revision: 1 },
            action: 'scaled_down',
            reasons: ['feeling_fatigued'],
            note: null,
            decidedAt: `${DATE}T07:00:00Z`,
        },
        doseReconciliation: {
            date: DATE, plannedDurationMin: 60, actualDurationMin: 45, plannedWorkKj: null, actualWorkKj: null,
            durationDeltaPct: -25, workDeltaPct: null, completedZoneDistribution: null, holdCompliancePct: null, stepOmissionsCount: 0,
        },
        recoveryTrajectory: null,
        regret: {
            date: DATE, regretClass: 'optimal_choice', athleteDeclaredRegret: 'none', confidence: 'medium',
            rationales: ['no adverse signal observed'], counterfactualAlternative: null,
        },
        utility: { utilityScore: 4, clarityScore: 5, coachingHelpfulness: 'helpful', feedbackNote: null },
        createdAt: `${DATE}T07:01:00Z`,
        updatedAt: `${DATE}T07:02:00Z`,
        ...overrides,
    };
}

function snapshot(overrides: Partial<DailyRecoverySnapshot> = {}): DailyRecoverySnapshot {
    return {
        userId: 'u1', date: DATE,
        source: { garminSyncedAt: DATE, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: 70, sleepDurationSec: 25000, restingHr: 50, hrvOvernightAvg: 60, hrvStatus: null,
            respirationAvg: 14, bodyBatteryWake: 80, bodyBatteryChange: -20, totalSteps: 8000,
            last3DaysHardSessionsCount: 1, yesterdayTraining: null,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 68, sleepScore28dAvg: 65, restingHr7dAvg: 51, restingHr28dAvg: 52,
            hrv7dAvg: 58, hrv28dAvg: 55, respiration7dAvg: 14, respiration28dAvg: 14,
            deltas: {
                sleepScoreVs7d: 2, sleepScoreVs28d: 5, restingHrVs7d: -1, restingHrVs28d: -2,
                hrvVs7d: 2, hrvVs28d: 5, respirationVs7d: 0, respirationVs28d: 0,
            },
        },
        dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
        ...overrides,
    };
}

describe('deriveEngineVerdictFromMode', () => {
    it('maps the three modes onto their legacy ladder-equivalent ShadowVerdict', () => {
        expect(deriveEngineVerdictFromMode('train')).toBe('proceed');
        expect(deriveEngineVerdictFromMode('modify')).toBe('scale');
        expect(deriveEngineVerdictFromMode('recover')).toBe('defer');
    });
});

describe('buildShadowLogRow', () => {
    it('returns null for a day with none of the four evidence sources', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: null, journalEntry: null, checkin: null, recoverySnapshot: null });
        expect(row).toBeNull();
    });

    it('returns null for a recovery snapshot alone -- not one of the three sources that trigger a row', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: null, journalEntry: null, checkin: null, recoverySnapshot: snapshot() });
        expect(row).toBeNull();
    });

    it('builds a row from a recommendation alone, with everything else visible as a gap', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: recommendation(), journalEntry: null, checkin: null, recoverySnapshot: null });
        expect(row).not.toBeNull();
        expect(row!.engineVerdict).toBe('proceed');
        expect(row!.engineMode).toBe('train');
        expect(row!.externalVerdict).toBeNull();
        expect(row!.agreement).toBeNull();
        expect(row!.subjective).toBeNull();
        expect(row!.objective).toBeNull();
    });

    it('builds a row from a journal entry alone (no recommendation persisted that day)', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: null, journalEntry: journalEntry(), checkin: null, recoverySnapshot: null });
        expect(row).not.toBeNull();
        expect(row!.engineVerdict).toBeNull();
        expect(row!.externalVerdict).toBe('proceed');
        expect(row!.agreement).toBeNull();
    });

    it('builds a row from a check-in alone -- a day the athlete only checked in is itself a finding', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: null, journalEntry: null, checkin: checkin(), recoverySnapshot: null });
        expect(row).not.toBeNull();
        expect(row!.subjective).toEqual({ readiness: 7, sleepQuality: 6, fatigue: 4, soreness: 3, mentalStress: 4, motivation: 6 });
    });

    it('computes agreement when both engine and external verdicts are present', () => {
        const row = buildShadowLogRow({
            date: DATE,
            recommendation: recommendation({ mode: 'recover' }), // legacy fallback -> defer
            journalEntry: journalEntry({ externalVerdict: 'proceed' }),
            checkin: null, recoverySnapshot: null,
        });
        expect(row!.agreement).toBe('engine_more_conservative');
    });

    it('prefers the exact persisted advisory verdict over mode so an event stays incomparable', () => {
        const row = buildShadowLogRow({
            date: DATE,
            recommendation: recommendation({ mode: 'train', engineVerdict: 'advisory' }),
            journalEntry: journalEntry({ externalVerdict: 'proceed' }),
            checkin: null, recoverySnapshot: null,
        });
        expect(row!.engineVerdict).toBe('advisory');
        expect(row!.agreement).toBe('incomparable');
    });

    it('prefers an exact skip verdict over a fallback recovery mode', () => {
        const row = buildShadowLogRow({
            date: DATE,
            recommendation: recommendation({ mode: 'recover', engineVerdict: 'skip' }),
            journalEntry: journalEntry({ externalVerdict: 'defer' }),
            checkin: null, recoverySnapshot: null,
        });
        expect(row!.engineVerdict).toBe('skip');
        expect(row!.agreement).toBe('agree');
    });

    it('carries adherence, policyVersion and externalPlan.contentHash through from the recommendation', () => {
        const row = buildShadowLogRow({
            date: DATE,
            recommendation: recommendation({
                adherence: { respondedAt: DATE, followed: true, actualModality: null, actualDurationMin: 45, skipped: false, notes: null },
                recommendationAudit: {
                    policyVersion: 'v-test',
                    externalPlan: { planId: 'p1', revision: 1, sessionId: 's1', contentHash: 'abc123' },
                } as DailyRecommendation['recommendationAudit'],
            }),
            journalEntry: null, checkin: null, recoverySnapshot: null,
        });
        expect(row!.adherenceFollowed).toBe(true);
        expect(row!.actualDurationMin).toBe(45);
        expect(row!.policyVersion).toBe('v-test');
        expect(row!.externalPlanContentHash).toBe('abc123');
    });

    it('carries the objective 7d/28d deltas through unchanged, and never the raw wearable payload', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: recommendation(), journalEntry: null, checkin: null, recoverySnapshot: snapshot() });
        expect(row!.objective).toEqual({
            sleepScoreVs7d: 2, sleepScoreVs28d: 5, restingHrVs7d: -1, restingHrVs28d: -2,
            hrvVs7d: 2, hrvVs28d: 5, respirationVs7d: 0, respirationVs28d: 0,
        });
        expect(JSON.stringify(row)).not.toContain('sleepScore7dAvg');
        expect(JSON.stringify(row)).not.toContain('totalSteps');
    });

    it('builds a row from a closed-loop feedback record alone (no recommendation/journal/checkin that day)', () => {
        const row = buildShadowLogRow({
            date: DATE, recommendation: null, journalEntry: null, checkin: null, recoverySnapshot: null,
            feedbackRecord: feedbackRecord(),
        });
        expect(row).not.toBeNull();
        expect(row!.athleteDecisionAction).toBe('scaled_down');
        expect(row!.athleteDecisionReasons).toEqual(['feeling_fatigued']);
        expect(row!.regretClass).toBe('optimal_choice');
        expect(row!.regretConfidence).toBe('medium');
        expect(row!.athleteDeclaredRegret).toBe('none');
        expect(row!.utilityScore).toBe(4);
        expect(row!.coachingHelpfulness).toBe('helpful');
    });

    it('leaves the feedback fields null when no feedback record exists for the day', () => {
        const row = buildShadowLogRow({ date: DATE, recommendation: recommendation(), journalEntry: null, checkin: null, recoverySnapshot: null });
        expect(row!.athleteDecisionAction).toBeNull();
        expect(row!.regretClass).toBeNull();
        expect(row!.utilityScore).toBeNull();
    });

    it('carries the journal note through, but never the check-in free-text notes field', () => {
        const row = buildShadowLogRow({
            date: DATE, recommendation: null,
            journalEntry: journalEntry({ externalNote: 'AI said take it easy' }),
            checkin: checkin(), recoverySnapshot: null,
        });
        expect(row!.externalNote).toBe('AI said take it easy');
        expect(JSON.stringify(row)).not.toContain('a private note');
    });
});

describe('buildShadowLog', () => {
    it('drops empty days and preserves the order of days with evidence', () => {
        const days: ShadowLogDayInput[] = [
            { date: '2026-08-14', recommendation: recommendation({ date: '2026-08-14' }), journalEntry: null, checkin: null, recoverySnapshot: null },
            { date: '2026-08-15', recommendation: null, journalEntry: null, checkin: null, recoverySnapshot: null },
            { date: '2026-08-16', recommendation: null, journalEntry: journalEntry(), checkin: null, recoverySnapshot: null },
        ];
        const rows = buildShadowLog(days);
        expect(rows.map(r => r.date)).toEqual(['2026-08-14', '2026-08-16']);
    });
});

describe('renderShadowLogCsv', () => {
    it('renders a header row and one data row per input, with gaps as empty cells', () => {
        const rows = buildShadowLog([
            { date: DATE, recommendation: recommendation(), journalEntry: journalEntry({ externalNote: 'took it easy, race, "quotes"' }), checkin: null, recoverySnapshot: null },
        ]);
        const csv = renderShadowLogCsv(rows);
        const lines = csv.split('\n');
        expect(lines[0]).toBe(
            'date,engineVerdict,engineMode,externalVerdict,externalNote,sawEngineVerdictFirst,actualVerdict,adherenceFollowed,'
            + 'actualDurationMin,agreement,readiness,sleepQuality,fatigue,soreness,mentalStress,motivation,'
            + 'sleepScoreVs7d,sleepScoreVs28d,restingHrVs7d,restingHrVs28d,hrvVs7d,hrvVs28d,respirationVs7d,respirationVs28d,'
            + 'policyVersion,externalPlanContentHash,athleteDecisionAction,athleteDecisionReasons,regretClass,'
            + 'regretConfidence,athleteDeclaredRegret,utilityScore,coachingHelpfulness',
        );
        expect(lines[1]).toContain(DATE);
        expect(lines[1]).toContain('"took it easy, race, ""quotes"""');
    });

    it('round-trips an empty row set to just the header', () => {
        expect(renderShadowLogCsv([]).split('\n')).toHaveLength(1);
    });
});
