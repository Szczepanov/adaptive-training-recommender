import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import {
    activity,
    AS_OF,
    constraint,
    FAKE_EMAIL,
    FAKE_USER_ID,
    fullInput,
    fullRecords,
    metricObservation,
    recoverySnapshot,
} from './ledgerExportFixtures.testSupport.ts';
import type { LedgerFlag } from './schema.ts';

const D_MINUS_1 = '2026-11-19';

describe('identity redaction reaches every string leaf (N1)', () => {
    it('redacts an e-mail and the owner uid under neutral keys in legacyEngine', () => {
        const result = buildLedgerExport(fullInput({
            legacyEngine: {
                note: 'mail me at a.b@example.com',
                createdBy: FAKE_USER_ID,
                nested: { list: [`owner ${FAKE_USER_ID}`, 'tempo10'] },
                policyVersion: '1.2.3',
            },
        }));
        expect(result.legacyEngine).toEqual({
            note: 'mail me at [redacted]',
            createdBy: '[redacted]',
            nested: { list: ['owner [redacted]', 'tempo10'] },
            policyVersion: '1.2.3',
        });
        expect(JSON.stringify(result)).not.toContain(FAKE_USER_ID);
    });

    it('redacts an e-mail and the uid in a constraint value', () => {
        const result = buildLedgerExport(fullInput({
            records: {
                constraints: [
                    { ...constraint, key: 'a', value: 'contact jan.k@gmail.com' },
                    { ...constraint, key: 'b', value: `ping ${FAKE_USER_ID}` },
                ],
            },
        }));
        expect(result.userContext.constraints.items.map(item => item.fields.value.value))
            .toEqual(['contact [redacted]', 'ping [redacted]']);
    });

    it('removes e-mails from structural fields too, without touching enums or dates', () => {
        const result = buildLedgerExport(fullInput({
            legacyEngine: { source: 'x@y.org', state: 'measured' },
            records: { recovery: [{ ...recoverySnapshot('2026-11-20'), userId: 'garmin' }] },
        }));
        expect(result.legacyEngine).toEqual({ source: '[redacted]', state: 'measured' });
        expect(result.facts.recovery.items[0].fields.sleepScore).toMatchObject({ source: 'garmin', state: 'measured' });
        expect(result.asOfDate).toBe(AS_OF);
        expect(JSON.stringify(result)).not.toContain(FAKE_EMAIL);
    });
});

describe('morning gives D-1 detail priority (N2)', () => {
    it('keeps D-1 rows when six same-day activities would fill the cap', () => {
        const today = Array.from({ length: 6 }, (_, i) => activity(i + 1, 30, AS_OF));
        const yesterday = [activity(7, 30, D_MINUS_1), activity(8, 30, D_MINUS_1)];
        const result = buildLedgerExport(fullInput({ purpose: 'morning', records: { activities: [...today, ...yesterday] } }));
        const items = result.facts.activities.items;
        expect(items).toHaveLength(6);
        expect(items.filter(item => item.observedOn === D_MINUS_1)).toHaveLength(2);
        expect(items.filter(item => item.observedOn === AS_OF)).toHaveLength(4);
        expect(result.facts.activities).toMatchObject({ truncated: true, totalInWindow: 8 });
        expect(items.map(item => item.observedOn)).toEqual([...items.map(item => item.observedOn)].sort().reverse());
    });
});

describe('superseded assessment revisions (N3)', () => {
    it('keeps only the highest revision per observationKey', () => {
        const rows = [
            { ...metricObservation, revision: 1, value: 240 },
            { ...metricObservation, revision: 2, value: 250 },
            { ...metricObservation, observationKey: 'obs-2', revision: 1, value: 10 },
        ];
        const result = buildLedgerExport(fullInput({ records: { metricObservations: rows } }));
        expect(result.facts.assessments.items.map(item => item.id)).toEqual(['obs-1@2', 'obs-2@1']);
        expect(result.facts.assessments.items[0].fields.value.value).toBe(250);
    });
});

describe('flag evaluations are windowed (N4)', () => {
    const flag = (observedOn: string): LedgerFlag => ({
        id: 'illness_anomaly',
        observedOn,
        evaluatedAt: `${observedOn}T05:00:00Z`,
        definitionVersion: 'anomaly@1',
        active: false,
        state: 'measured',
        inputs: [],
        threshold: 'band',
    });

    it('drops an evaluation outside the window and falls back to not_yet_supported', () => {
        const result = buildLedgerExport(fullInput({ purpose: 'morning', flagEvaluations: [flag('2025-03-01')] }));
        const anomaly = result.flags.filter(candidate => candidate.id === 'illness_anomaly');
        expect(anomaly).toHaveLength(1);
        expect(anomaly[0]).toMatchObject({ state: 'not_yet_supported', observedOn: AS_OF });
    });

    it('keeps in-window evaluations only', () => {
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            flagEvaluations: [flag('2025-03-01'), flag(D_MINUS_1), flag(AS_OF)],
        }));
        expect(result.flags.filter(candidate => candidate.id === 'illness_anomaly').map(candidate => candidate.observedOn))
            .toEqual([D_MINUS_1, AS_OF]);
    });
});

describe('planned-to-performed ids (N5)', () => {
    it('keeps two links for the same session on different revisions distinct', () => {
        const result = buildLedgerExport(fullInput({
            records: {
                plannedToPerformed: [
                    { planId: 'plan-1', revision: 1, sessionId: 's1', date: D_MINUS_1, performedOccurrenceId: 'occ-1' },
                    { planId: 'plan-1', revision: 2, sessionId: 's1', date: D_MINUS_1, performedOccurrenceId: 'occ-2' },
                ],
            },
        }));
        const items = result.coachingHistory.plannedToPerformed.items;
        expect(items.map(item => item.id)).toEqual(['plan-1@1:s1:occ-1', 'plan-1@2:s1:occ-2']);
        expect(items.map(item => item.fields.revision.value)).toEqual([1, 2]);
    });
});

describe('goal performance target allow-list (N6)', () => {
    const base = fullRecords().goals![0];

    it('exports only the known target fields', () => {
        const target = {
            kind: 'performance_metric' as const,
            metricId: 'estimated_1rm_kg',
            subjectRef: { kind: 'exercise' as const, exerciseId: 'back_squat', createdBy: FAKE_USER_ID },
            targetValue: 140,
            ownerNote: 'mail x@y.org',
        };
        const result = buildLedgerExport(fullInput({ records: { goals: [{ ...base, performanceTarget: target }] } }));
        expect(result.userContext.goals.items[0].fields.performanceTarget.value).toEqual({
            kind: 'performance_metric',
            metricId: 'estimated_1rm_kg',
            subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
            targetValue: 140,
        });
    });

    it('runs the target through identity redaction', () => {
        const target = {
            kind: 'performance_metric' as const,
            metricId: 'ftp',
            subjectRef: { kind: 'performance_test' as const, performanceTestId: FAKE_USER_ID },
            targetValue: 300,
        };
        const records = { goals: [{ ...base, performanceTarget: target }], constraints: [constraint] };
        const result = buildLedgerExport(fullInput({ records }));
        expect(JSON.stringify(result)).not.toContain(FAKE_USER_ID);
    });
});

describe('availability row remainder (M8)', () => {
    it('exports the fixed-activity minute budget and the window environment and equipment', () => {
        const result = buildLedgerExport(fullInput({
            records: {
                fixedActivities: [{ id: 'fx', title: 'Travel day', date: '2026-11-26', durationMin: 30, fixed: true, availabilityOverride: 20 }],
                scheduleWindows: [{ id: 'w', date: '2026-11-21', startLocal: '06:00', endLocal: '07:00', environment: 'indoor', equipment: ['indoor_bike'] }],
            },
        }));
        const fixed = result.userContext.availability.items.find(item => item.id === 'fixed-fx')!;
        const window = result.userContext.availability.items.find(item => item.id === 'window-w')!;
        expect(fixed.fields.availabilityOverrideMin).toMatchObject({ value: 20, state: 'measured', unit: 'min' });
        expect(fixed.fields.availabilityContextOverride.state).toBe('not_applicable');
        expect(window.fields.environment.value).toBe('indoor');
        expect(window.fields.equipment.value).toEqual(['indoor_bike']);
        expect(window.fields.availabilityOverrideMin.state).toBe('not_applicable');
    });
});

describe('final review fixes', () => {
    it('keeps dotted versions that look like user@host intact (P1)', () => {
        const result = buildLedgerExport(fullInput({
            flagEvaluations: [{
                id: 'illness_anomaly',
                observedOn: AS_OF,
                evaluatedAt: `${AS_OF}T05:00:00Z`,
                definitionVersion: 'healthAnomaly@2.1.0',
                active: false,
                state: 'measured',
                inputs: [],
                threshold: 'band',
            }],
            records: {
                planRevisions: [{
                    planId: 'plan-9',
                    revision: 1,
                    contentHash: 'h',
                    importedAt: '2026-11-10T08:00:00Z',
                    schema: 'adaptive-training-recommender/external-plan@6.1',
                }],
            },
        }));
        expect(result.flags.find(flag => flag.id === 'illness_anomaly')!.definitionVersion).toBe('healthAnomaly@2.1.0');
        expect(result.coachingHistory.planRevisions.items[0].fields.schema.value)
            .toBe('adaptive-training-recommender/external-plan@6.1');
    });

    it('still redacts real e-mail addresses (P1)', () => {
        const result = buildLedgerExport(fullInput({ legacyEngine: { a: 'a.b@example.com', b: 'x@mail.co.uk.' } }));
        expect(result.legacyEngine).toEqual({ a: '[redacted]', b: '[redacted].' });
    });

    it('reports a performance target without a subject as invalid instead of throwing (P2)', () => {
        const base = fullRecords().goals![0];
        const malformed = { kind: 'performance_metric', metricId: 'ftp', targetValue: 300 } as unknown as NonNullable<typeof base.performanceTarget>;
        const result = buildLedgerExport(fullInput({ records: { goals: [{ ...base, performanceTarget: malformed }] } }));
        expect(result.userContext.goals.items[0].fields.performanceTarget).toMatchObject({ value: null, state: 'invalid' });
    });

    it('keeps two occurrences answering the same session distinct (N5 residual)', () => {
        const link = { planId: 'plan-1', revision: 2, sessionId: 's1', date: D_MINUS_1 };
        const result = buildLedgerExport(fullInput({
            records: {
                plannedToPerformed: [
                    { ...link, performedOccurrenceId: 'occ-1' },
                    { ...link, performedOccurrenceId: 'occ-2' },
                ],
            },
        }));
        expect(result.coachingHistory.plannedToPerformed.items.map(item => item.id))
            .toEqual(['plan-1@2:s1:occ-1', 'plan-1@2:s1:occ-2']);
    });
});
