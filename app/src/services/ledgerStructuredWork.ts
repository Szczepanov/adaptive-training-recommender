/**
 * Projects a performed occurrence's structured executions into the ledger export's structural
 * occurrence input: entry summary, executed definitions, validated set counts (Phase 2b) and the
 * structured execution ids the builder links session responses through.
 */
import type { OccurrenceInput, SetCountInput } from '../ledger/export/inputs';
import { worstState } from '../ledger/export/ledgerValue';
import type { LedgerState } from '../ledger/export/schema';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionDefinition } from '../sessions/models';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { performedSetCounts, plannedSetCount } from './ledgerSetCounts';

type StructuredWork = Pick<OccurrenceInput, 'executedDefinitions' | 'structuredEntries' | 'structuredExecutionIds' | 'setCounts'>;
type Resolved = { definition: SessionDefinition } | { state: LedgerState };

const absentCount = (state: LedgerState): SetCountInput => ({ value: null, state });

/** The pinned definition (prescription hash, else the source's own definition), or why it is unreadable. */
async function resolvePinned(userId: string, row: NormalizedExecutionRecord): Promise<Resolved> {
    try {
        const result = await resolveSessionDefinition(userId, row.execution.sessionSource, row.execution.prescriptionHash);
        if (result.status === 'AVAILABLE') return { definition: result.data };
        return { state: result.status === 'MISSING' ? 'missing' : result.status === 'INVALID' ? 'invalid' : 'unavailable' };
    } catch {
        return { state: 'unavailable' };
    }
}

function entrySummary(rows: readonly NormalizedExecutionRecord[]): StructuredWork['structuredEntries'] {
    const entries = rows.flatMap(row => row.entries).filter(entry => entry.payload.kind !== 'choice' && !entry.deletedAt);
    const exercises = entries.map(entry => (entry.exerciseRef?.kind === 'catalog' ? entry.exerciseRef.exerciseId : entry.exerciseRef?.name) ?? entry.stepId);
    return { exerciseCount: new Set(exercises.filter(Boolean)).size, setCount: entries.length };
}

export async function projectStructuredWork(
    userId: string,
    sourceRefs: readonly { kind: string; executionId?: string }[],
    executions: ReadonlyMap<string, NormalizedExecutionRecord>,
    executionsReadable: boolean,
): Promise<StructuredWork> {
    const ids = sourceRefs.flatMap(ref => (ref.kind === 'structured_execution' && ref.executionId ? [ref.executionId] : []));
    if (ids.length === 0) return { structuredExecutionIds: [] };
    const linked = ids.map(id => executions.get(id));
    if (!executionsReadable || linked.some(row => row === undefined)) {
        const unavailable = absentCount('unavailable');
        return { structuredExecutionIds: ids, setCounts: { planned: unavailable, work: unavailable, warmup: unavailable } };
    }
    const rows = linked as NormalizedExecutionRecord[];
    const resolved = await Promise.all(rows.map(row => resolvePinned(userId, row)));
    const definitions = resolved.map(item => ('definition' in item ? item.definition : null));
    const failed = resolved.flatMap(item => ('state' in item ? [item.state] : []));
    const counts = performedSetCounts(rows.map((row, i) => ({ entries: row.entries, definition: definitions[i] })));
    return {
        structuredExecutionIds: ids,
        executedDefinitions: rows.map(row => ({ executionId: row.execution.executionId, executedDefinition: row.execution.executedDefinition ?? 'unknown' })),
        structuredEntries: entrySummary(rows),
        setCounts: {
            planned: failed.length ? absentCount(worstState(failed))
                : { value: definitions.reduce((sum, definition) => sum + plannedSetCount(definition!), 0) },
            work: { value: counts.work },
            warmup: { value: counts.warmup },
        },
    };
}
