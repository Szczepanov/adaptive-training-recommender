import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerValue } from '../schema.ts';
import { dominantSource, sourceTag } from './compactLines.ts';

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
    const ref = placement?.id ?? `${text(planId.value)}@${text(revision.value)}:${text(sessionId.value)}`;
    const ids = `${text(ref)} → ${text(occurrenceId)}`;
    if (title && present(title)) return `planned: ${text(title.value)} (${ids})`;
    return `planned: ${text(sessionId.value)} (title: ${text(title?.state ?? 'unavailable')}; ${ids})`;
}

/** The real state, or `not recorded` when a measured value is null or empty. */
const absent = (value: LedgerValue<unknown>) => (value.state === 'measured' ? 'not recorded' : text(value.state));

function definitions(value: LedgerValue<unknown>): string | null {
    if (!Array.isArray(value.value)) return null;
    const names = [...new Set(value.value.map(item => (item as { executedDefinition?: string }).executedDefinition).filter(Boolean))];
    return names.length ? names.map(text).join(', ') : null;
}

type Occurrence = LedgerExport['facts']['performedTraining']['items'][number];

/** `<work>/<planned> work sets (+<warmup> warm-up)`, with every absent count named by its state. */
function setsPart({ workSets, plannedSets, warmupSets }: Occurrence['fields']): string {
    if (!present(workSets)) return `work sets: ${absent(workSets)}`;
    const notes = [
        ...(present(plannedSets) ? [] : [`planned: ${absent(plannedSets)}`]),
        ...(present(warmupSets) ? [] : [`warm-up: ${absent(warmupSets)}`]),
    ];
    const ratio = present(plannedSets) ? `${text(workSets.value)}/${text(plannedSets.value)}` : text(workSets.value);
    const warmups = present(warmupSets) ? ` (+${text(warmupSets.value)} warm-up)` : '';
    return `${ratio} work sets${warmups}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

/** sRPE only from responses linked through the structured execution refs (never `occurrenceId`). */
function rpePart(ledger: LedgerExport, linked: LedgerValue<unknown>, group: string | undefined): string {
    if (!Array.isArray(linked.value)) return `sRPE: ${absent(linked)}`;
    const ids = linked.value as string[];
    const rpe = ids.map(id => ledger.facts.sessionResponses.items.find(item => item.id === id)?.fields.sessionRpe)
        .find(value => value !== undefined && present(value));
    return rpe ? `sRPE ${text(rpe.value)}${sourceTag(rpe, group)}` : 'sRPE: not recorded';
}

function occurrenceLine(ledger: LedgerExport, row: Occurrence, consumed: Set<string>, group: string | undefined): string[] {
    const { modality, durationMin, executedDefinitions, workSets, linkedResponseIds } = row.fields;
    const parts = [
        present(modality) ? text(modality.value) : `modality: ${absent(modality)}`,
        present(durationMin) ? `${text(durationMin.value)} min` : `durationMin: ${absent(durationMin)}`,
        setsPart(row.fields),
        rpePart(ledger, linkedResponseIds, group),
        definitions(executedDefinitions) ?? `executedDefinition: ${absent(executedDefinitions)}`,
        plannedTitle(ledger, row.id, consumed),
    ];
    return [parts.join(' · '), ...(present(workSets) ? ['detail: copy the session report from History'] : [])];
}

export function yesterdaySection(ledger: LedgerExport, consumed: Set<string>): string[] {
    const date = addDaysToLocalDateString(ledger.asOfDate, -1);
    const performed = ledger.facts.performedTraining;
    const rows = performed.items.filter(row => row.observedOn === date)
        .sort((a, b) => String(a.fields.startedAt.value ?? '').localeCompare(String(b.fields.startedAt.value ?? '')));
    const group = dominantSource(performed.items.flatMap(row => Object.entries(row.fields)));
    const body = rows.length
        ? rows.flatMap(row => occurrenceLine(ledger, row, consumed, group))
        : [`performed: none recorded for ${text(date)} (${text(performed.state)})`];
    return [`## Yesterday (${text(date)})`, ...body, ''];
}
