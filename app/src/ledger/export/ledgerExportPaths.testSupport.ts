/** Resolves a `LEDGER_EXPORT_FIELDS` path; `[]` fans out over array elements (a collection's `items`). */
export function resolvePath(root: unknown, path: string): unknown[] {
    return path.split('.').reduce<unknown[]>((nodes, segment) => {
        const isEach = segment.endsWith('[]');
        const key = isEach ? segment.slice(0, -2) : segment;
        return nodes.flatMap(node => {
            const next = (node as Record<string, unknown> | null)?.[key];
            if (!isEach) return [next];
            // A collection fans out over its `items`; a bare array (sources, flags) over itself.
            const items = Array.isArray(next) ? next : (next as { items?: unknown[] } | undefined)?.items;
            return Array.isArray(items) ? items : [];
        });
    }, [root]);
}

/** Envelope entries that are plain values, not `LedgerValue`s, so they carry no `state`. */
export const ENVELOPE_SCALARS: ReadonlySet<string> = new Set([
    'schemaVersion', 'exportedAt', 'asOfDate', 'window', 'purpose', 'sources', 'legacyEngine',
]);
