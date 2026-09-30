/**
 * Pure RFC 4180-compliant CSV field escaping and row formatting utilities.
 */

const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@＝＋－＠]/u;

/**
 * Neutralize formula-leading untrusted text before it crosses a spreadsheet-facing CSV boundary.
 * Keep this separate from RFC 4180 syntax escaping so numeric evidence remains numeric.
 */
export function spreadsheetSafeText(value: string): string {
    const firstCharacter = value[0];
    const startsWithControlCharacter = firstCharacter === '\t'
        || firstCharacter === '\r'
        || firstCharacter === '\n'
        || firstCharacter === '\0';
    return startsWithControlCharacter || SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvField(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

export function formatCsvRow(fields: readonly (string | number | boolean | null | undefined)[]): string {
    return fields.map(csvField).join(',');
}
