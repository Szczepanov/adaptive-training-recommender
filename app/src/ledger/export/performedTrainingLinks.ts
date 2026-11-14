/**
 * Phase 2b leaves on a performed occurrence: validated set counts and the session responses
 * linked through its structured execution refs. `SessionResponse.occurrenceId` is a planning
 * identity and is never used as a link to `performedOccurrenceId`.
 */
import type { LedgerExportRecords, OccurrenceInput, SetCountInput } from './inputs.ts';
import { fact } from './ledgerValue.ts';
import type { LedgerState, LedgerValue } from './schema.ts';

interface Base {
    source: string;
    observedOn?: string;
}

const noStructuredWork = (row: OccurrenceInput) => row.structuredExecutionIds !== undefined && row.structuredExecutionIds.length === 0;

function countFact(count: SetCountInput | undefined, row: OccurrenceInput, base: Base): LedgerValue<number> {
    const options = { ...base, unit: 'sets' };
    if (count) return fact(count.value, { ...options, absent: count.value === null ? count.state : 'missing' });
    return fact<number>(null, { ...options, absent: noStructuredWork(row) ? 'not_applicable' : 'unavailable' });
}

export function setCountFacts(row: OccurrenceInput, base: Base) {
    return {
        plannedSets: countFact(row.setCounts?.planned, row, base),
        workSets: countFact(row.setCounts?.work, row, base),
        warmupSets: countFact(row.setCounts?.warmup, row, base),
    };
}

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Response ids whose execution source is one of the occurrence's structured executions. */
export function linkedResponseIds(
    row: OccurrenceInput,
    records: LedgerExportRecords,
    responsesState: LedgerState,
    base: Base,
): LedgerValue<string[]> {
    const executionIds = row.structuredExecutionIds;
    if (executionIds === undefined) return fact<string[]>(null, { ...base, absent: 'unavailable' });
    if (executionIds.length === 0) return fact<string[]>(null, { ...base, absent: 'not_applicable' });
    if (responsesState !== 'measured') return fact<string[]>(null, { ...base, absent: responsesState });
    const ids = (records.sessionResponses ?? [])
        .filter(response => response.sourceSession.kind === 'execution' && executionIds.includes(response.sourceSession.id))
        .sort((a, b) => codeUnitCompare(a.date, b.date) || codeUnitCompare(a.responseId, b.responseId))
        .map(response => response.responseId);
    return fact(ids, base);
}
