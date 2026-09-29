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
});
