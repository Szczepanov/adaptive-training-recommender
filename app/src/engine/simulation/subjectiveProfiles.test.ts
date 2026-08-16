import { describe, expect, it } from 'vitest';
import {
    SUBJECTIVE_PROFILE_KINDS,
    subjectiveProfileDay,
    subjectiveProfileReadiness,
    subjectiveProfileSeries,
    type SubjectiveProfileDayValues,
    type SubjectiveProfileKind,
} from './subjectiveProfiles';
import { evaluateReadinessAndSafetyEnvelope } from '../rules';
import type { UserContext } from '../models';

const DAYS = 28; // matches the 28-day baseline window the rest of Phase 9 uses

function minimalContext(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: false, maxTimeMinutes: 90 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}

/** Population stdev (not sample), matching D-SUBJSD's wording in ADR-0020. Local to this
 *  test rather than imported from a production module -- `computeSubjectiveBaseline`
 *  (Phase 9.1) does not exist yet, gated on ADR-0020 acceptance. */
function populationStdev(values: number[]): number {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function seriesOf(kind: SubjectiveProfileKind, metric: keyof SubjectiveProfileDayValues, days = DAYS): number[] {
    return subjectiveProfileSeries(kind, days).map(day => day[metric]);
}

function average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('SUBJECTIVE_PROFILE_KINDS', () => {
    it('has exactly the five profiles the plan table specifies', () => {
        expect([...SUBJECTIVE_PROFILE_KINDS].sort()).toEqual(
            ['chronically_sore', 'habitual_high', 'habitual_low', 'noisy_stationary', 'slow_drifter'].sort(),
        );
    });
});

describe('subjectiveProfileDay', () => {
    it('is a pure function of (kind, dayIndex) -- same inputs, same outputs', () => {
        for (const kind of SUBJECTIVE_PROFILE_KINDS) {
            expect(subjectiveProfileDay(kind, 5)).toEqual(subjectiveProfileDay(kind, 5));
        }
    });

    it('keeps every metric within the 1-10 scale across a long series', () => {
        for (const kind of SUBJECTIVE_PROFILE_KINDS) {
            for (const day of subjectiveProfileSeries(kind, 60)) {
                for (const value of Object.values(day)) {
                    expect(value, `${kind} metric out of range`).toBeGreaterThanOrEqual(1);
                    expect(value).toBeLessThanOrEqual(10);
                }
            }
        }
    });
});

describe('subjectiveProfileSeries: each profile has non-zero variance (9.5 done-when)', () => {
    it.each(SUBJECTIVE_PROFILE_KINDS)('%s produces non-zero readiness stdev over 28 days', kind => {
        const stdev = populationStdev(seriesOf(kind, 'readiness'));
        expect(stdev).toBeGreaterThan(0);
    });
});

describe('habitual_low -- flat, chronically low', () => {
    it('stays near readiness 3 / fatigue 7 with low day-to-day variance', () => {
        const readiness = seriesOf('habitual_low', 'readiness');
        const fatigue = seriesOf('habitual_low', 'fatigue');
        expect(average(readiness)).toBeCloseTo(3, 0);
        expect(average(fatigue)).toBeCloseTo(7, 0);
        expect(populationStdev(readiness)).toBeLessThan(1);
    });

    it('is already at modify every day via the existing absolute floor -- D-SUBJFLOOR made mechanical', () => {
        const context = minimalContext();
        for (let day = 0; day < DAYS; day++) {
            const { mode } = evaluateReadinessAndSafetyEnvelope(subjectiveProfileReadiness('habitual_low', day), context);
            expect(mode, `day ${day}`).not.toBe('train');
        }
    });
});

describe('habitual_high -- flat, consistently high', () => {
    it('stays near readiness 8 / fatigue 2 with low day-to-day variance', () => {
        const readiness = seriesOf('habitual_high', 'readiness');
        const fatigue = seriesOf('habitual_high', 'fatigue');
        expect(average(readiness)).toBeCloseTo(8, 0);
        expect(average(fatigue)).toBeCloseTo(2, 0);
        expect(populationStdev(readiness)).toBeLessThan(1);
    });

    it('stays at train every day -- the absolute floor is far away', () => {
        const context = minimalContext();
        for (let day = 0; day < DAYS; day++) {
            const { mode } = evaluateReadinessAndSafetyEnvelope(subjectiveProfileReadiness('habitual_high', day), context);
            expect(mode, `day ${day}`).toBe('train');
        }
    });
});

describe('slow_drifter -- readiness 8 -> 6 over three weeks', () => {
    it('has a first-week average clearly above its fourth-week average', () => {
        const readiness = seriesOf('slow_drifter', 'readiness');
        const firstWeek = average(readiness.slice(0, 7));
        const fourthWeek = average(readiness.slice(21, 28));
        expect(firstWeek).toBeGreaterThan(7.5);
        expect(fourthWeek).toBeLessThan(6.5);
        expect(firstWeek - fourthWeek).toBeGreaterThan(1);
    });

    it('holds at the decayed level rather than continuing to decline or recovering', () => {
        const readiness = seriesOf('slow_drifter', 'readiness', 35);
        const week4 = average(readiness.slice(21, 28));
        const week5 = average(readiness.slice(28, 35));
        expect(Math.abs(week4 - week5)).toBeLessThan(0.5);
    });

    it('never crosses an absolute threshold -- the whole point of the fixture', () => {
        const context = minimalContext();
        for (let day = 0; day < DAYS; day++) {
            const { mode } = evaluateReadinessAndSafetyEnvelope(subjectiveProfileReadiness('slow_drifter', day), context);
            expect(mode, `day ${day}`).toBe('train');
        }
    });
});

describe('noisy_stationary -- stable mean, +/-2 day-to-day swing', () => {
    it('has a mean near 6 with real (not flat) day-to-day variance', () => {
        const readiness = seriesOf('noisy_stationary', 'readiness');
        expect(average(readiness)).toBeCloseTo(6, 0);
        expect(populationStdev(readiness)).toBeGreaterThan(0.5);
    });

    it('never crosses an absolute threshold -- noise is not drift', () => {
        const context = minimalContext();
        for (let day = 0; day < DAYS; day++) {
            const { mode } = evaluateReadinessAndSafetyEnvelope(subjectiveProfileReadiness('noisy_stationary', day), context);
            expect(mode, `day ${day}`).toBe('train');
        }
    });
});

describe('chronically_sore -- soreness baseline 7, stable', () => {
    it('holds soreness near 7 with low day-to-day variance while other metrics stay near-neutral', () => {
        const soreness = seriesOf('chronically_sore', 'soreness');
        const readiness = seriesOf('chronically_sore', 'readiness');
        expect(average(soreness)).toBeCloseTo(7, 0);
        expect(populationStdev(soreness)).toBeLessThan(1);
        expect(average(readiness)).toBeCloseTo(6, 0);
    });

    it('never reads as normal/train -- the safety case the profile exists for', () => {
        const context = minimalContext();
        for (let day = 0; day < DAYS; day++) {
            const { mode } = evaluateReadinessAndSafetyEnvelope(subjectiveProfileReadiness('chronically_sore', day), context);
            expect(mode, `day ${day}`).not.toBe('train');
        }
    });
});
