import type { OutcomeEvaluationSnapshot, OutcomeMetricBinding } from './evaluationSpec';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(record)
                .filter(key => record[key] !== undefined)
                .sort()
                .map(key => [key, canonicalize(record[key])]),
        );
    }
    return value;
}

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
}

export function canonicalEvaluationContent(snapshot: OutcomeEvaluationSnapshot): string {
    const revision = snapshot.revision;
    const bindings = [...snapshot.bindings].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return JSON.stringify(canonicalize({
        id: revision.id,
        revision: revision.revision,
        title: revision.title,
        startDate: revision.startDate,
        endDate: revision.endDate,
        sourceRef: revision.sourceRef,
        bindings,
    }));
}

export async function hashEvaluationContent(snapshot: OutcomeEvaluationSnapshot): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalEvaluationContent(snapshot));
    return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export function sortOutcomeBindings(bindings: readonly OutcomeMetricBinding[]): OutcomeMetricBinding[] {
    return [...bindings].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
