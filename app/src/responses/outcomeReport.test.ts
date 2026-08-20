import { describe, expect, it } from 'vitest';
import { buildSessionOutcomeReport, sessionOutcomeReportToCsv } from './outcomeReport';
import type { SessionOutcome } from './outcome';

function outcome(overrides: Partial<SessionOutcome> = {}): SessionOutcome {
    return {
        policyVersion: 'm5.3-outcome-v1',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
        status: 'passed',
        hasFollowUpData: true,
        sourceFacts: { responseIds: ['resp-1'], tissueRegions: ['knee'] },
        override: {},
        ...overrides,
    };
}

describe('buildSessionOutcomeReport', () => {
    it('sorts rows chronologically by date then source id, independent of input order', () => {
        const rows = buildSessionOutcomeReport([
            outcome({ sourceSession: { kind: 'execution', id: 'exec-b', date: '2026-08-19' } }),
            outcome({ sourceSession: { kind: 'execution', id: 'exec-a', date: '2026-08-18' } }),
            outcome({ sourceSession: { kind: 'execution', id: 'exec-c', date: '2026-08-18' } }),
        ]);
        expect(rows.map(row => row.sourceId)).toEqual(['exec-a', 'exec-c', 'exec-b']);
    });

    it('flattens sourceFacts and override into plain string/number report fields', () => {
        const [row] = buildSessionOutcomeReport([outcome({
            sourceFacts: { responseIds: ['resp-1', 'resp-2'], tissueRegions: ['knee', 'hamstring'] },
            override: { reason: 'soreness', note: 'tight quads', completedStepsCount: 4, missingRequiredStepsCount: 1, totalPlannedSteps: 5 },
        })]);
        expect(row.responseCount).toBe(2);
        expect(row.tissueRegions).toBe('knee;hamstring');
        expect(row.overrideReason).toBe('soreness');
        expect(row.note).toBe('tight quads');
        expect(row.completedStepsCount).toBe('4');
        expect(row.missingRequiredStepsCount).toBe('1');
        expect(row.totalPlannedSteps).toBe('5');
    });

    it('renders missing optional fields as empty strings, never "undefined"', () => {
        const [row] = buildSessionOutcomeReport([outcome({ status: 'unknown', override: {} })]);
        expect(row.overrideReason).toBe('');
        expect(row.note).toBe('');
        expect(row.completedStepsCount).toBe('');
    });
});

describe('sessionOutcomeReportToCsv', () => {
    it('emits a header row plus one row per outcome in the given order', () => {
        const rows = buildSessionOutcomeReport([outcome()]);
        const csv = sessionOutcomeReportToCsv(rows);
        const lines = csv.split('\n');
        expect(lines[0]).toBe('date,sourceKind,sourceId,status,hasFollowUpData,responseCount,tissueRegions,overrideReason,note,completedStepsCount,missingRequiredStepsCount,totalPlannedSteps,policyVersion');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('exec-1');
    });

    it('quotes and escapes a field containing a comma, quote or newline', () => {
        const rows = buildSessionOutcomeReport([outcome({ override: { note: 'felt "off", a bit stiff\nnext day' } })]);
        const csv = sessionOutcomeReportToCsv(rows);
        expect(csv).toContain('"felt ""off"", a bit stiff\nnext day"');
    });

    it('quotes a field containing a bare carriage return, not only a newline', () => {
        const rows = buildSessionOutcomeReport([outcome({ override: { note: 'felt off\ra bit stiff' } })]);
        const csv = sessionOutcomeReportToCsv(rows);
        expect(csv).toContain('"felt off\ra bit stiff"');
    });

    it('is deterministic: identical input produces byte-identical output', () => {
        const rows = buildSessionOutcomeReport([outcome(), outcome({ sourceSession: { kind: 'execution', id: 'exec-2', date: '2026-08-19' } })]);
        expect(sessionOutcomeReportToCsv(rows)).toBe(sessionOutcomeReportToCsv(rows));
    });
});
