/**
 * Identity hygiene (I6). The export is assembled from an allow-list of fields, so identity
 * keys cannot arrive as keys. This module is the second line of defence for the two places
 * they can still travel: the opaque `legacyEngine` input (identity-bearing keys are stripped)
 * and athlete free text (e-mail addresses and the record owner's own identifiers are
 * redacted, whole tokens only). Envelope, `state`, `source`, `unit`, date and id fields are
 * never rewritten.
 */
const IDENTITY_KEY = /(user|owner|account|profile|athlete|subject)_?(id|uid|pk)$|^uid$|e-?mail/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const REDACTED = '[redacted]';
const MIN_IDENTITY_LENGTH = 4;

/** Field keys whose values are athlete- or author-written text. */
export const FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
    'notes', 'note', 'techniqueNote', 'summary', 'description', 'title', 'label', 'reason',
    'invalidReason', 'authorRationale', 'targetOutcome', 'displayName',
]);

/** Structural keys of a `LedgerValue`/`LedgerRecord`; never rewritten even inside free text. */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set(['state', 'source', 'unit', 'observedOn', 'id']);

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

/** Returns a copy of the export with identities redacted in free-text leaves only. */
export function redactFreeText<T extends object>(output: T, identities: ReadonlySet<string>): T {
    const tokens = tokenPattern(identities);
    const redact = (text: string): string => {
        const withoutEmail = text.replace(EMAIL, REDACTED);
        return tokens ? withoutEmail.replace(tokens, REDACTED) : withoutEmail;
    };
    const walk = (node: unknown, freeText: boolean): unknown => {
        if (typeof node === 'string') return freeText ? redact(node) : node;
        if (Array.isArray(node)) return node.map(item => walk(item, freeText));
        if (node === null || typeof node !== 'object') return node;
        return Object.fromEntries(Object.entries(node).map(([key, nested]) => {
            if (key === 'legacyEngine' || STRUCTURAL_KEYS.has(key)) return [key, nested];
            return [key, walk(nested, freeText || FREE_TEXT_KEYS.has(key))];
        }));
    };
    return walk(output, false) as T;
}
