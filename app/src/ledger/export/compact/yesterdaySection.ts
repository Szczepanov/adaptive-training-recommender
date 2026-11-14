import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerValue } from '../schema.ts';

const present = (value: LedgerValue<unknown>) => value.value !== null && value.value !== undefined;

function plannedTitle(ledger: LedgerExport, occurrenceId: string, consumed: Set<string>): string {
    const link = ledger.coachingHistory.plannedToPerformed.items
        .find(row => row.fields.performedOccurrenceRef.value === occurrenceId);
    if (!link) return 'planned: not recorded';
    consumed.add(link.id);
    const { planId, revision, sessionId } = link.fields;
    const placement = ledger.coachingHistory.placements.items
        .find(row => row.fields.planId.value === planId.value && row.fields.revision.value === revision.value
            && row.fields.sessionId.value === sessionId.value);
    const title = placement?.fields.title;
    if (title && present(title)) return `planned: ${text(title.value)}`;
    return `planned: ${text(sessionId.value)} (title: ${text(title?.state ?? 'unavailable')})`;
}

function definitions(value: LedgerValue<unknown>): string | null {
    if (!Array.isArray(value.value)) return null;
    const names = [...new Set(value.value.map(item => (item as { executedDefinition?: string }).executedDefinition).filter(Boolean))];
    return names.length ? names.map(text).join(', ') : null;
}

function occurrenceLine(ledger: LedgerExport, row: LedgerExport['facts']['performedTraining']['items'][number], consumed: Set<string>): string[] {
    const { modality, durationMin, structuredEntries, executedDefinitions } = row.fields;
    const rpe = ledger.facts.sessionResponses.items
        .find(item => item.fields.occurrenceId.value === row.id && present(item.fields.sessionRpe))?.fields.sessionRpe;
    const counts = structuredEntries.value as { exerciseCount?: number; setCount?: number } | null;
    const parts = [
        present(modality) ? text(modality.value) : `modality: ${text(modality.state)}`,
        present(durationMin) ? `${text(durationMin.value)} min` : `durationMin: ${text(durationMin.state)}`,
        counts ? `${text(counts.exerciseCount)} exercises / ${text(counts.setCount)} sets` : `structuredEntries: ${text(structuredEntries.state)}`,
        rpe ? `sRPE ${text(rpe.value)}` : 'sRPE: not recorded',
        definitions(executedDefinitions) ?? `executedDefinition: ${text(executedDefinitions.state)}`,
        plannedTitle(ledger, row.id, consumed),
    ];
    return [parts.join(' · '), ...(counts ? ['detail: copy the session report from History'] : [])];
}

export function yesterdaySection(ledger: LedgerExport, consumed: Set<string>): string[] {
    const date = addDaysToLocalDateString(ledger.asOfDate, -1);
    const performed = ledger.facts.performedTraining;
    const rows = performed.items.filter(row => row.observedOn === date)
        .sort((a, b) => String(a.fields.startedAt.value ?? '').localeCompare(String(b.fields.startedAt.value ?? '')));
    const body = rows.length
        ? rows.flatMap(row => occurrenceLine(ledger, row, consumed))
        : [`performed: none recorded for ${text(date)} (${text(performed.state)})`];
    return [`## Yesterday (${text(date)})`, ...body, ''];
}
