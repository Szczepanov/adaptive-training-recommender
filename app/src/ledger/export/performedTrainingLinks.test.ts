import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { fullInput, fullRecords, occurrence, sessionResponse } from './ledgerExportFixtures.testSupport.ts';
import type { OccurrenceInput } from './inputs.ts';

function build(occ: Partial<OccurrenceInput>, records = fullRecords()) {
    const input = fullInput({ records: { ...records, performedOccurrences: [{ ...occurrence, ...occ }] } });
    return buildLedgerExport(input).facts.performedTraining.items[0].fields;
}

describe('validated set counts on performed training', () => {
    it('exports planned, work and warm-up counts as separate state-bearing leaves', () => {
        const fields = build({ setCounts: { planned: { value: 15 }, work: { value: 12 }, warmup: { value: 3 } } });
        expect(fields.plannedSets).toMatchObject({ value: 15, unit: 'sets', state: 'measured', source: 'adaptive' });
        expect(fields.workSets).toMatchObject({ value: 12, unit: 'sets', state: 'measured' });
        expect(fields.warmupSets).toMatchObject({ value: 3, unit: 'sets', state: 'measured' });
    });

    it('keeps a zero count measured and a missing denominator absent, never 0', () => {
        const fields = build({ setCounts: { planned: { value: null, state: 'invalid' }, work: { value: 0 }, warmup: { value: 0 } } });
        expect(fields.plannedSets).toMatchObject({ value: null, state: 'invalid' });
        expect(fields.workSets).toMatchObject({ value: 0, state: 'measured' });
        expect(fields.warmupSets).toMatchObject({ value: 0, state: 'measured' });
    });

    it('reports unsupplied counts as unavailable, and not applicable without structured work', () => {
        const unknown = build({ setCounts: undefined });
        expect(unknown.plannedSets).toMatchObject({ value: null, state: 'unavailable' });
        expect(unknown.workSets).toMatchObject({ value: null, state: 'unavailable' });
        const providerOnly = build({ structuredExecutionIds: [], setCounts: undefined });
        expect(providerOnly.workSets).toMatchObject({ value: null, state: 'not_applicable' });
        expect(providerOnly.linkedResponseIds).toMatchObject({ value: null, state: 'not_applicable' });
    });
});

describe('session responses linked through structured source refs', () => {
    it('links a response whose execution source matches a structured execution of the occurrence', () => {
        const fields = build({ structuredExecutionIds: ['exec-1'] });
        expect(fields.linkedResponseIds).toMatchObject({ value: ['resp-1'], state: 'measured' });
    });

    it('never links through the planning occurrenceId', () => {
        const records = fullRecords();
        records.sessionResponses = [{ ...sessionResponse, sourceSession: { kind: 'execution', id: 'exec-other', date: '2026-11-19' } }];
        // `occurrenceId` still equals the performed occurrence id; it must not create a link.
        expect(records.sessionResponses[0].occurrenceId).toBe(occurrence.performedOccurrenceId);
        const fields = build({ structuredExecutionIds: ['exec-1'] }, records);
        expect(fields.linkedResponseIds).toMatchObject({ value: [], state: 'measured' });
    });

    it('ignores a response sourced from a non-execution session with the same id', () => {
        const records = fullRecords();
        records.sessionResponses = [{ ...sessionResponse, sourceSession: { kind: 'strength', id: 'exec-1', date: '2026-11-19' } }];
        expect(build({ structuredExecutionIds: ['exec-1'] }, records).linkedResponseIds.value).toEqual([]);
    });

    it('orders several linked responses by date then id', () => {
        const records = fullRecords();
        records.sessionResponses = [
            { ...sessionResponse, responseId: 'resp-b', date: '2026-11-20' },
            { ...sessionResponse, responseId: 'resp-c' },
            { ...sessionResponse, responseId: 'resp-a' },
        ];
        expect(build({ structuredExecutionIds: ['exec-1'] }, records).linkedResponseIds.value).toEqual(['resp-a', 'resp-c', 'resp-b']);
    });

    it('withholds links when responses were not read, and when execution refs are unknown', () => {
        const records = fullRecords();
        delete records.sessionResponses;
        expect(build({ structuredExecutionIds: ['exec-1'] }, records).linkedResponseIds).toMatchObject({ value: null, state: 'unavailable' });
        expect(build({ structuredExecutionIds: undefined }).linkedResponseIds).toMatchObject({ value: null, state: 'unavailable' });
    });
});
