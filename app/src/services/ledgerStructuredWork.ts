/**
 * Projects a performed occurrence's structured executions into the ledger export's structural
 * occurrence input: entry summary, executed definitions, validated set counts (Phase 2b) and the
 * structured execution ids the builder links session responses through.
 */
import type { OccurrenceInput, SetCountInput } from '../ledger/export/inputs';
import type { LedgerState } from '../ledger/export/schema';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionDefinition } from '../sessions/models';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { performedSetCounts, plannedSetCount } from './ledgerSetCounts';

type StructuredWork = Pick<OccurrenceInput, 'executedDefinitions' | 'structuredEntries' | 'structuredExecutionIds' | 'setCounts'>;
type Resolved = { definition: SessionDefinition } | { state: LedgerState };

const absentCount = (state: LedgerState): SetCountInput => ({ value: null, state });

/** The pinned definition (prescription hash, else the source's own definition), or why it is unreadable. */
export async function resolvePinned(userId: string, row: NormalizedExecutionRecord): Promise<Resolved> {
    // A reduced run without its pinned prescription would fall back to the authored definition,
    // which is not what was prescribed.
    if (row.execution.executedDefinition === 'reduced' && !row.execution.prescriptionHash) return { state: 'unavailable' };
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

/**
 * One prescription is one denominator. Several structured runs on one occurrence (an abandoned
 * run and a re-run) are unresolved, as in `canonicalBroadHistory.ts`, so planned is unavailable
 * rather than a sum of prescriptions; their performed sets still add up.
 */
function plannedFor(resolved: readonly Resolved[]): SetCountInput {
    if (resolved.length !== 1) return absentCount('unavailable');
    const [only] = resolved;
    return 'definition' in only ? { value: plannedSetCount(only.definition) } : absentCount(only.state);
}

/** One pinned-definition read per execution, shared by set counts and choice overrides. */
export function pinnedResolver(userId: string): (row: NormalizedExecutionRecord) => Promise<Resolved> {
    const cache = new Map<string, Promise<Resolved>>();
    return row => {
        const key = row.execution.executionId;
        const cached = cache.get(key);
        if (cached) return cached;
        const pending = resolvePinned(userId, row);
        cache.set(key, pending);
        return pending;
    };
}

export async function projectStructuredWork(
    userId: string,
    sourceRefs: readonly { kind: string; executionId?: string }[],
    executions: ReadonlyMap<string, NormalizedExecutionRecord>,
    executionsReadable: boolean,
    resolve: (row: NormalizedExecutionRecord) => Promise<Resolved> = row => resolvePinned(userId, row),
): Promise<StructuredWork> {
    const ids = sourceRefs.flatMap(ref => (ref.kind === 'structured_execution' && ref.executionId ? [ref.executionId] : []));
    if (ids.length === 0) return { structuredExecutionIds: [] };
    const linked = ids.map(id => executions.get(id));
    if (!executionsReadable || linked.some(row => row === undefined)) {
        const unavailable = absentCount('unavailable');
        return { structuredExecutionIds: ids, setCounts: { planned: unavailable, work: unavailable, warmup: unavailable } };
    }
    const rows = linked as NormalizedExecutionRecord[];
    const resolved = await Promise.all(rows.map(resolve));
    const definitions = resolved.map(item => ('definition' in item ? item.definition : null));
    const counts = performedSetCounts(rows.map((row, i) => ({ entries: row.entries, definition: definitions[i] })));
    return {
        structuredExecutionIds: ids,
        executedDefinitions: rows.map(row => ({ executionId: row.execution.executionId, executedDefinition: row.execution.executedDefinition ?? 'unknown' })),
        structuredEntries: entrySummary(rows),
        setCounts: {
            planned: plannedFor(resolved),
            work: { value: counts.work },
            warmup: { value: counts.warmup },
        },
    };
}
