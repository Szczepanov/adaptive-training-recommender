/**
 * Identity hygiene (I6). The export is assembled from an allow-list of fields, so identity
 * keys cannot arrive as keys. This module is the second line of defence for the two places
 * they can still travel: the opaque `legacyEngine` input (identity-bearing keys are stripped)
 * and every other string leaf (e-mail addresses and the record owner's own identifiers are
 * redacted, whole tokens only). Structural fields keep their enum/date/id values.
 */
const IDENTITY_KEY = /(user|owner|account|profile|athlete|subject)_?(id|uid|pk)$|^uid$|e-?mail/i;
// An alphabetic top-level domain is required, so versions like `plan@6.1` are not e-mails.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const REDACTED = '[redacted]';
const MIN_IDENTITY_LENGTH = 4;

/**
 * Keys whose string values are enums, dates, hashes or ids. E-mail addresses are still removed
 * from them, but identity tokens are not matched, so a user id such as "garmin" or "measured"
 * can never corrupt `source`, `state` or a date.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
    'state', 'source', 'unit', 'observedOn', 'id', 'schemaVersion', 'exportedAt', 'asOfDate', 'purpose',
    'startDate', 'endDate', 'readAt', 'newestObservedOn', 'evaluatedAt', 'definitionVersion', 'contentHash',
]);

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

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole tokens only: an identity inside a longer word, number or date is left alone. */
function tokenPattern(identities: ReadonlySet<string>): RegExp | null {
    const usable = [...identities].filter(identity => identity.length >= MIN_IDENTITY_LENGTH)
        .sort((a, b) => b.length - a.length).map(escapeRegExp);
    return usable.length === 0 ? null : new RegExp(`(?<![\\w-])(?:${usable.join('|')})(?![\\w-])`, 'g');
}

/**
 * Returns a copy of the export with identities redacted in every string leaf, `legacyEngine`
 * included. E-mails go from all leaves; identity tokens (whole tokens only) from all
 * non-structural ones.
 */
export function redactLeaves<T extends object>(output: T, identities: ReadonlySet<string>): T {
    const tokens = tokenPattern(identities);
    const redactString = (text: string, structural: boolean): string => {
        const withoutEmail = text.replace(EMAIL, REDACTED);
        return tokens && !structural ? withoutEmail.replace(tokens, REDACTED) : withoutEmail;
    };
    const walk = (node: unknown, structural: boolean): unknown => {
        if (typeof node === 'string') return redactString(node, structural);
        if (Array.isArray(node)) return node.map(item => walk(item, structural));
        if (node === null || typeof node !== 'object') return node;
        return Object.fromEntries(Object.entries(node)
            .map(([key, nested]) => [key, walk(nested, STRUCTURAL_KEYS.has(key))]));
    };
    return walk(output, false) as T;
}
