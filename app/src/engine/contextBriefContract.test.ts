import { describe, expect, it } from 'vitest';
import { buildContextBrief, SUBJECTIVE_BASELINE_DAYS, type ContextBriefInput } from './contextBrief';
import { buildMorningCoachBrief, type ContextBriefPlanningHandoffInput } from './contextBriefPlanningHandoff';
import {
    assertRenderedBriefContract,
    CONTEXT_BRIEF_CONTRACT_VERSION,
    parseBriefContractField,
    stripBriefContractEphemeral,
} from './contextBriefContract';
import { SENSOR_OBSERVATION_HORIZON_DAYS } from './contextBriefSensorEvidence';
import { POLICY_VERSION } from './policy';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type { DailySubjectiveCheckin, NormalizedGarminActivity } from './models';

const AS_OF = '2026-09-10';

function baseInput(overrides: Partial<ContextBriefInput> = {}): ContextBriefInput {
    return {
        asOfDate: AS_OF,
        windowDays: 14,
        snapshots: [],
        checkins: [],
        activities: [],
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        intentProfile: null,
        recommendationsReadable: true,
        ...overrides,
    };
}

function morningInput(overrides: Partial<ContextBriefPlanningHandoffInput> = {}): ContextBriefPlanningHandoffInput {
    return {
        asOfDate: AS_OF,
        snapshots: [],
        checkins: [],
        activities: [],
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        effectivePlanningMode: 'evergreen',
        externalFallback: false,
        externalFallbackUncertain: false,
        eventStrategy: null,
        goals: [],
        upcomingFixedActivities: [],
        upcomingPlanBlocks: [],
        upcomingExternalSessions: [],
        recommendationsReadable: true,
        restDirectiveToday: null,
        unavailableSources: [],
        purpose: 'morning',
        ...overrides,
    };
}

describe('context brief contract identity (#894)', () => {
    it('exposes an explicit contract version and purpose on planning and diagnostic', () => {
        for (const purpose of ['planning', 'diagnostic'] as const) {
            const text = buildContextBrief(baseInput({ purpose }));
            expect(parseBriefContractField(text, 'Contract version')).toBe(CONTEXT_BRIEF_CONTRACT_VERSION);
            expect(parseBriefContractField(text, 'Purpose')).toBe(purpose);
        }
    });

    it('exposes contract identity on the morning brief', () => {
        const text = buildMorningCoachBrief(morningInput());
        expect(parseBriefContractField(text, 'Contract version')).toBe(CONTEXT_BRIEF_CONTRACT_VERSION);
        expect(parseBriefContractField(text, 'Purpose')).toBe('morning');
    });

    it('shows canonical D-1 identity once, retaining incomplete structured work', () => {
        const yesterday = '2026-09-09';
        const facts: PerformedExposureFact[] = [
            { performedOccurrenceId: 'a', localDate: yesterday, modality: 'Strength', durationMin: 35,
                sourceKinds: ['structured_execution', 'provider_activity'], confidence: 'exact', evidenceTier: 'completedStructuredWorkout' },
            { performedOccurrenceId: 'b', localDate: yesterday, modality: 'Cycling',
                startedAt: `${yesterday}T15:00:00+02:00`, executionState: 'abandoned', sourceKinds: ['structured_execution'], confidence: 'exact', evidenceTier: 'completedStructuredWorkout' },
        ];
        const text = buildMorningCoachBrief(morningInput({ performedFacts: facts, activitiesReadable: true }));
        expect(text).toContain('Recorded training (canonical): Strength · 35 min · structured + Garmin · identity exact');
        expect(text).toContain('Recorded training (canonical): Cycling · duration unrecorded · structured · identity exact · execution abandoned · started, completion unrecorded');
        expect(text.match(/Recorded training \(canonical\):/g)).toHaveLength(2);
        expect(text).toContain('Adherence Delta: insufficient evidence — structured execution abandoned; completed dose is unknown.');
        expect(text).not.toContain('Adherence Delta: insufficient evidence — canonical provider linkage is absent or ambiguous.');
    });

    it('links Garmin evidence to one canonical D-1 session and isolates an unmatched activity', () => {
        const date = '2026-09-09';
        const linked: NormalizedGarminActivity = {
            activityId: 'linked', date, type: 'cycling', durationMin: 40, intensityTag: 'hard',
            intensityClassificationVersion: 2, sessionCost: 'high', activityTrainingLoad: 70,
            trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 150,
        };
        const unmatched = { ...linked, activityId: 'unmatched', activityTrainingLoad: 80 };
        const fact: PerformedExposureFact = {
            performedOccurrenceId: 'occ-1', localDate: date, modality: 'Cycling', durationMin: 40,
            sourceKinds: ['structured_execution', 'provider_activity'], providerActivityIds: ['linked'],
            confidence: 'exact', evidenceTier: 'completedStructuredWorkout', executionState: 'completed',
        };
        const restDirectiveYesterday = { planId: 'rest-plan', revision: 2, restDirectiveId: 'rest' };
        const complete = buildMorningCoachBrief(morningInput({
            activities: [linked], performedFacts: [fact], activitiesReadable: true, restDirectiveYesterday,
        }));
        expect(complete).toContain('1 linked provider row(s), observational evidence');
        expect(complete).toContain('Adherence Delta: **UNPLANNED_STRAIN**');
        expect(complete).toContain('(+70 load, IF unavailable)');
        const mixed = buildMorningCoachBrief(morningInput({
            activities: [linked, unmatched], performedFacts: [fact], activitiesReadable: true, restDirectiveYesterday,
        }));
        expect(mixed).toContain('Unmatched Garmin row: 2026-09-09');
        expect(mixed).toContain('Adherence Delta: insufficient evidence — unmatched Garmin rows');
        expect(mixed).not.toContain('Adherence Delta: **UNPLANNED_STRAIN**');
        const structuredOnly = buildMorningCoachBrief(morningInput({
            activities: [unmatched],
            performedFacts: [{ ...fact, providerActivityIds: [], sourceKinds: ['structured_execution'] }],
            activitiesReadable: true, restDirectiveYesterday,
        }));
        expect(structuredOnly).toContain('Unmatched Garmin row: 2026-09-09');
        expect(structuredOnly).toContain('Adherence Delta: insufficient evidence — canonical session has no linked provider intensity evidence.');
        const duplicate = buildMorningCoachBrief(morningInput({
            activities: [linked],
            performedFacts: [fact, { ...fact, performedOccurrenceId: 'occ-2' }],
            activitiesReadable: true, restDirectiveYesterday,
        }));
        expect(duplicate).toContain('Adherence Delta: insufficient evidence — one provider row is linked to multiple canonical sessions.');
        expect(duplicate).not.toContain('1 linked provider row(s), observational evidence');
        expect(duplicate).toContain('Unmatched Garmin row: 2026-09-09');
    });

    it('does not move a provider-local D-1 row from its canonical D0 occurrence', () => {
        const providerRow: NormalizedGarminActivity = {
            activityId: 'warsaw-boundary', date: '2026-09-09', type: 'cycling', durationMin: 45,
            intensityTag: 'hard', activityTrainingLoad: 80, trainingEffectAerobic: 3,
            trainingEffectAnaerobic: 0, averageHr: 150,
        };
        const todayFact: PerformedExposureFact = {
            performedOccurrenceId: 'canonical-D0', localDate: AS_OF, modality: 'Cycling',
            durationMin: 45, confidence: 'exact', sourceKinds: ['provider_activity'],
            providerActivityIds: [providerRow.activityId], evidenceTier: 'genericModalityFallback',
        };
        const text = buildMorningCoachBrief(morningInput({
            activities: [providerRow], performedFacts: [todayFact], activitiesReadable: true,
            restDirectiveYesterday: { planId: 'rest-plan', revision: 2, restDirectiveId: 'rest' },
        }));
        expect(text).toContain('Provider-local D-1 row(s) assigned to another canonical date: 1; excluded from D-1 training and adherence. warsaw-boundary.');
        expect(text).toContain('Recorded training: No recorded sessions in this window.');
        expect(text).toContain('Adherence Delta: **ON_PLAN**');
        expect(text).not.toContain('Recorded training: Cycling');
        expect(text).not.toContain('Unmatched Garmin row:');
    });

    it('keeps subjective-only coaching usable without claiming wearable recovery', () => {
        const checkin = {
            date: AS_OF, readiness: 7, fatigue: 4, soreness: 2, sleepQuality: 6,
            motivation: 8, mentalStress: 3,
        } as DailySubjectiveCheckin;
        const text = buildMorningCoachBrief(morningInput({ checkins: [checkin], snapshots: [] }));
        expect(text).toContain('Subjective scores (1–10): Readiness 7');
        expect(text).toContain('Wearable caution: No wearable data in this window.');
        expect(text).toContain('Pattern: INSUFFICIENT');
    });

    it('states planning horizons as independently machine-readable fields', () => {
        const text = buildContextBrief(baseInput({ purpose: 'planning' }));
        expect(parseBriefContractField(text, 'As-of date')).toContain(AS_OF);
        expect(parseBriefContractField(text, 'As-of date')).toContain('Europe/Warsaw');
        expect(parseBriefContractField(text, 'Retrospective detail window')).toContain('14 days');
        expect(parseBriefContractField(text, 'Subjective baseline window')).toContain(`${SUBJECTIVE_BASELINE_DAYS} days`);
        expect(parseBriefContractField(text, 'Recovery timeline')).toBe('7 days');
        expect(parseBriefContractField(text, 'Sensor evidence horizon')).toBe(`${SENSOR_OBSERVATION_HORIZON_DAYS} days`);
        expect(parseBriefContractField(text, 'Engine policy version')).toBe(POLICY_VERSION);
    });

    it('reports only horizons actually used by the morning renderer', () => {
        const text = buildMorningCoachBrief(morningInput());
        expect(parseBriefContractField(text, 'Retrospective detail window')).toContain('2 days');
        expect(parseBriefContractField(text, 'Recovery timeline')).toBe('7 days');
        expect(parseBriefContractField(text, 'Subjective baseline window')).toBe('not used by this export');
        expect(parseBriefContractField(text, 'Sensor evidence horizon')).toBe('not used by this export');
    });

    it('is deterministic for identical inputs ignoring the generation timestamp', () => {
        const first = buildContextBrief(baseInput({ purpose: 'planning', generatedAt: '2026-09-10T06:00:00.000Z' }));
        const second = buildContextBrief(baseInput({ purpose: 'planning', generatedAt: '2026-09-10T07:30:00.000Z' }));
        expect(first).not.toBe(second);
        expect(stripBriefContractEphemeral(first)).toBe(stripBriefContractEphemeral(second));
        expect(parseBriefContractField(first, 'Generated at')).toBe('2026-09-10T06:00:00.000Z');
        expect(parseBriefContractField(second, 'Generated at')).toBe('2026-09-10T07:30:00.000Z');
    });

    it('omits the generation line when the pure builder gets no timestamp', () => {
        const text = buildContextBrief(baseInput({ purpose: 'diagnostic' }));
        expect(parseBriefContractField(text, 'Generated at')).toBeNull();
    });

    it('fails closed when a service-level export loses required identity metadata', () => {
        const generatedAt = '2026-09-10T06:00:00.000Z';
        const text = buildContextBrief(baseInput({ purpose: 'planning', generatedAt }));
        expect(() => assertRenderedBriefContract(text, {
            purpose: 'planning',
            asOfDate: AS_OF,
            generatedAt,
        })).not.toThrow();

        const withoutTimestamp = stripBriefContractEphemeral(text);
        expect(() => assertRenderedBriefContract(withoutTimestamp, {
            purpose: 'planning',
            asOfDate: AS_OF,
            generatedAt,
        })).toThrow(/generation timestamp mismatch/);
    });

    it('requires source state and currency when the service enforces v3', () => {
        const generatedAt = '2026-09-10T06:00:00.000Z';
        const text = buildContextBrief(baseInput({ purpose: 'planning', generatedAt }));
        expect(() => assertRenderedBriefContract(text, {
            purpose: 'planning', asOfDate: AS_OF, generatedAt, requireSourceState: true,
        })).toThrow(/source state and currency missing/);
    });
});
