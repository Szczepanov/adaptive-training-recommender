/**
 * Identity hygiene (I6). The export is assembled from an allow-list of fields, so identity
 * keys cannot arrive as keys. This module is the second line of defence for the two places
 * they can still travel: the opaque `legacyEngine` input (keys are stripped) and athlete
 * free text (e-mail addresses and the record owner's own identifiers are redacted).
 */
const IDENTITY_KEY = /^(user_?id|uid|e-?mail|account_?id|garmin_?user_?id|garmin_?account_?id|provider_?account_?id|owner_?id)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const REDACTED = '[redacted]';

export function stripIdentity(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripIdentity);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !IDENTITY_KEY.test(key))
            .map(([key, nested]) => [key, stripIdentity(nested)]),
    );
}

/** String values stored under identity keys anywhere in the inputs (user ids, account ids, e-mails). */
export function collectIdentityValues(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach(item => collectIdentityValues(item, found));
    else if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            if (IDENTITY_KEY.test(key) && typeof nested === 'string' && nested.length > 0) found.add(nested);
            else collectIdentityValues(nested, found);
        }
    }
    return found;
}

function redactString(text: string, identities: readonly string[]): string {
    return identities.reduce((acc, identity) => acc.split(identity).join(REDACTED), text.replace(EMAIL, REDACTED));
}

/** Returns a copy of `value` with every e-mail address and known identifier replaced. */
export function redactIdentity<T>(value: T, identities: ReadonlySet<string>): T {
    const longestFirst = [...identities].filter(identity => identity.length >= 6).sort((a, b) => b.length - a.length);
    const walk = (node: unknown): unknown => {
        if (typeof node === 'string') return redactString(node, longestFirst);
        if (Array.isArray(node)) return node.map(walk);
        if (node === null || typeof node !== 'object') return node;
        return Object.fromEntries(Object.entries(node).map(([key, nested]) => [key, walk(nested)]));
    };
    return walk(value) as T;
}
