/**
 * Pure RFC 4180-compliant CSV field escaping and row formatting utilities.
 */

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
