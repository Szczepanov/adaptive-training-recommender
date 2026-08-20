import type { SessionDefinition, ExecutionPrescription } from './models';

/**
 * Stable recursive ordering so identical objects hash identically regardless of key insertion order.
 */
export function canonicalizeSessionData(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalizeSessionData);
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(obj)
                .sort()
                .filter(k => obj[k] !== undefined) // omit undefined values for canonical stability
                .map(key => [key, canonicalizeSessionData(obj[key])]),
        );
    }
    return value;
}

export function canonicalSessionDefinitionJson(definition: SessionDefinition): string {
    // Definition identity and placement are not executable content.  A revision is
    // addressed separately by SessionSourceRef, while this digest is the exact content
    // binding used by occurrences and prescriptions (ADR-0023 D-MSNAP).
    const content = pickDefined(definition, [
        'schemaVersion', 'title', 'summary', 'intent', 'modalities', 'dominantModality',
        'duration', 'sessionTargets', 'prohibitedAdditions', 'importWarnings', 'blocks',
    ]);
    return JSON.stringify(canonicalizeSessionData(content));
}

export function canonicalExecutionPrescriptionJson(prescription: ExecutionPrescription): string {
    // A digest cannot include itself; createdAt is provenance rather than execution
    // content, so it must not turn the same prescription into a new snapshot.
    // `displayMetadata` is omitted (via pickDefined) on older prescriptions that predate
    // it, so this stays backward-compatible: their hash is unaffected by its addition.
    const content = pickDefined(prescription, ['schemaVersion', 'sessionSource', 'definitionHash', 'blocks', 'displayMetadata']);
    return JSON.stringify(canonicalizeSessionData(content));
}

function pickDefined(value: object, keys: readonly string[]): Record<string, unknown> {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(keys
        .filter(key => record[key] !== undefined)
        .map(key => [key, record[key]]));
}

export async function hashSessionDefinition(definition: SessionDefinition): Promise<string> {
    const canonical = canonicalSessionDefinitionJson(definition);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function hashExecutionPrescription(prescription: ExecutionPrescription): Promise<string> {
    const canonical = canonicalExecutionPrescriptionJson(prescription);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}
