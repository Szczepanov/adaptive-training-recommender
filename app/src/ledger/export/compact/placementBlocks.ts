import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerValue } from '../schema.ts';
import { missingLine, sourceTag, type FieldEntry } from './compactLines.ts';

type Placement = LedgerExport['coachingHistory']['placements']['items'][number];

const isMissing = (value: LedgerValue<unknown>) => value.value === null || value.value === undefined;

function header(row: Placement, group?: string): string {
    const { title, priority, status } = row.fields;
    const parts = [
        text(row.observedOn),
        isMissing(title) ? '' : `${text(title.value)}${sourceTag(title, group)}`,
        isMissing(priority) ? '' : `[${text(priority.value)}]`,
        isMissing(status) ? `(status: ${text(status.state)})` : `(${text(status.value)})`,
        text(row.id),
    ];
    return parts.filter(Boolean).join(' ');
}

function historyLine(history: LedgerValue<unknown>): string[] {
    if (!Array.isArray(history.value)) return [];
    const last = history.value[history.value.length - 1] as { changedOn?: string } | undefined;
    return [`history: ${history.value.length} recorded change${history.value.length === 1 ? '' : 's'}${last?.changedOn ? `, latest ${text(last.changedOn)}` : ''}`];
}

/**
 * One placement: `<date> <title> [<priority>] (<status>)`, then summary, one note per step note and
 * fallback when present. Unreadable authored content is one `content: <state>` line; other absent
 * leaves stay visible in a `missing:` line, never as an empty value.
 */
export function placementBlock(row: Placement, group?: string): string[] {
    const { title, summary, stepNotes, fallback, statusHistory, priority } = row.fields;
    if (isMissing(title) && (title.state === 'unavailable' || title.state === 'invalid')) {
        const history = missingLine([['statusHistory', statusHistory]]);
        return [header(row, group), `content: ${text(title.state)}`, ...historyLine(statusHistory), ...(history ? [history] : [])];
    }
    const notes = Array.isArray(stepNotes.value) ? stepNotes.value : [];
    const leaves: FieldEntry[] = [['title', title], ['priority', priority], ['summary', summary], ['stepNotes', stepNotes], ['fallback', fallback], ['statusHistory', statusHistory]];
    const absent = leaves.filter(([, value]) => isMissing(value));
    const missing = missingLine(absent);
    return [
        header(row, group),
        ...(isMissing(summary) ? [] : [`summary: ${text(summary.value)}${sourceTag(summary, group)}`]),
        ...notes.map(note => `note: ${text(note)}${sourceTag(stepNotes, group)}`),
        ...(isMissing(fallback) ? [] : [`fallback: ${text(fallback.value)}${sourceTag(fallback, group)}`]),
        ...historyLine(statusHistory),
        ...(missing ? [missing] : []),
    ];
}
