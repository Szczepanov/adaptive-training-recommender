/** Keep each supplied value on one Markdown line, including text nested inside JSON. */
export function text(value: unknown): string {
    const raw = value === null || value === undefined
        ? 'Not recorded'
        : typeof value === 'string' && value !== '' ? value : JSON.stringify(value);
    return raw
        .replace(/[\p{Cc}\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .replace(/[&<>|\\`[\]*]/g, char => `&#${char.charCodeAt(0)};`)
        .replace(/(?<!\w)_|_(?!\w)/g, '&#95;');
}
