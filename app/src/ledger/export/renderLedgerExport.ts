import type {
    ActivityCollection, ContextRecord, LedgerCollection, LedgerExport, LedgerRecord, LedgerValue,
} from './schema.ts';

/** Keep each supplied value on one Markdown line, including text nested inside JSON. */
function text(value: unknown): string {
    const raw = value === null || value === undefined
        ? 'Not recorded'
        : typeof value === 'string' && value !== '' ? value : JSON.stringify(value);
    return raw
        .replace(/[\p{Cc}\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .replace(/[&<>|\\`[\]*]/g, char => `&#${char.charCodeAt(0)};`)
        .replace(/(?<!\w)_|_(?!\w)/g, '&#95;');
}

function values(entries: [string, LedgerValue<unknown>][]): string[] {
    return [
        '| Field | Value | Unit | Source | State | Observed on |',
        '| --- | --- | --- | --- | --- | --- |',
        ...entries.map(([name, value]) => `| ${text(name)} | ${text(value.value)} | ${text(value.unit ?? 'Not specified')} | ${text(value.source)} | ${text(value.state)} | ${text(value.observedOn)} |`),
        '',
    ];
}

function record(row: LedgerRecord): string[] {
    const entries = Object.entries(row.fields);
    if ('since' in row && 'revisions' in row) {
        const context = row as ContextRecord;
        entries.push(['since', context.since], ['revisions', context.revisions]);
    }
    return [
        `#### ${text(row.id)}`,
        '',
        `observedOn: ${text(row.observedOn)}`,
        '',
        ...values(entries),
    ];
}

function collection(name: string, rows: LedgerCollection<LedgerRecord>): string[] {
    const lines = [
        `### ${text(name)}`,
        '',
        `state: ${text(rows.state)}; source: ${text(rows.source)}; droppedUndated: ${rows.droppedUndated}`,
        '',
    ];
    if ('truncated' in rows) {
        const activities = rows as ActivityCollection<LedgerRecord>;
        lines.push(`truncated: ${activities.truncated}; totalInWindow: ${activities.totalInWindow}; exported: ${rows.items.length}`, '');
    }
    if (!rows.items.length) lines.push('No rows exported; interpret using the collection state above.', '');
    for (const row of rows.items) lines.push(...record(row));
    return lines;
}

/** Pure presentation of recorded ledger data; no inference, IO or engine authority. */
export function renderLedgerExport(ledger: LedgerExport): string {
    const lines = [
        '# Ledger export',
        '',
        `schemaVersion: ${text(ledger.schemaVersion)}`,
        `exportedAt: ${text(ledger.exportedAt)}`,
        `asOfDate (Europe/Warsaw): ${text(ledger.asOfDate)}`,
        `purpose: ${text(ledger.purpose)}`,
        `window: ${text(ledger.window.startDate)} to ${text(ledger.window.endDate)} (${ledger.window.days} days)`,
        '',
        '## Sources',
        '',
        ...ledger.sources.map(source => `- ${text(source.source)}; state: ${text(source.state)}; readAt: ${text(source.readAt)}; newestObservedOn: ${text(source.newestObservedOn)}`),
        '',
        '## 1. Facts',
        '',
    ];
    for (const [name, rows] of Object.entries(ledger.facts)) lines.push(...collection(name, rows));

    lines.push('## 2. Derived', '');
    if (!ledger.derived.length) lines.push('No derived metrics exported.', '');
    for (const metric of ledger.derived) {
        lines.push(
            `### ${text(metric.id)}`, '',
            `definition: ${text(metric.definition)}`, '',
            `window: ${text(metric.window)}`, '',
            `inputs: ${text(metric.inputs)}`, '',
            ...values([['value', metric.value], ...Object.entries(metric.metrics ?? {})]),
        );
    }

    lines.push('## 3. Flags', '');
    if (!ledger.flags.length) lines.push('No flag evaluations exported.', '');
    for (const flag of ledger.flags) {
        lines.push(
            `### ${text(flag.id)}`, '',
            `observedOn: ${text(flag.observedOn)}; evaluatedAt: ${text(flag.evaluatedAt)}`, '',
            `definitionVersion: ${text(flag.definitionVersion)}; sessionRef: ${text(flag.sessionRef)}`, '',
            `active: ${text(flag.active)}; state: ${text(flag.state)}; reasonCode: ${text(flag.reasonCode)}`, '',
            `threshold: ${text(flag.threshold)}; baselineWindow: ${text(flag.baselineWindow)}`, '',
            ...values(flag.inputs.map(input => [input.name, input.value])),
        );
    }

    lines.push('## 4. User context', '');
    for (const [name, context] of Object.entries(ledger.userContext)) {
        if ('items' in context) lines.push(...collection(name, context));
        else if ('fields' in context) lines.push(`### ${text(name)}`, '', ...record(context));
        else lines.push(`### ${text(name)}`, '', ...values([[name, context]]));
    }

    lines.push('## 5. Coaching history', '');
    for (const [name, rows] of Object.entries(ledger.coachingHistory)) lines.push(...collection(name, rows));

    if (ledger.legacyEngine !== null) {
        lines.push('## Legacy engine (opt-in opinions)', '', text(ledger.legacyEngine), '');
    }
    return lines.join('\n');
}
