import type { DEvalC1Result } from './dEvalC1.ts';
import type { DEvalC2MetricEvaluation, DEvalC2Result } from './dEvalC2.ts';
import type { DEvalC3Result } from './dEvalC3.ts';
import type { DEvalCriterionStatus, DEvalOverallVerdict } from './dEvalCriteria.ts';

export interface DEvalC4MarkdownSummary {
    status: DEvalCriterionStatus;
    rollbackState: 'unused' | 'safety' | 'non_safety';
    reason: string | null;
    rollbackAtDate: string | null;
}

export interface DEvalMarkdownInput {
    blockStartDate: string;
    blockEndDate: string;
    blockDays: number;
    asOfDate: string;
    criteriaCommit?: string | null;
    phase2Commit?: string | null;
    rollbackSettingState?: string | null;
    c1: DEvalC1Result;
    c2: DEvalC2Result;
    c3: DEvalC3Result;
    c4: DEvalC4MarkdownSummary;
    overall: DEvalOverallVerdict;
    knownLimits: readonly string[];
}

function escapeCell(text: string): string {
    return text.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function formatPercent(ratio: number | null): string {
    if (ratio === null || !Number.isFinite(ratio)) return 'n/a';
    return `${(ratio * 100).toFixed(1)}%`;
}

function formatC1Evidence(c1: DEvalC1Result): string {
    const b = c1.block;
    const baselineDesc = c1.baseline.comparable && c1.baseline.summary
        ? `comparable (${formatPercent(c1.baseline.summary.adherenceRate)}, eligible=${c1.baseline.summary.eligible})`
        : c1.baseline.provided
            ? `not comparable (${c1.baseline.reason}; fallback 75%)`
            : 'none (fallback 75%)';
    return escapeCell(
        `planned=${b.planned}, completed=${b.completed}, moved=${b.moved}, partial=${b.partial}, `
        + `reduced=${b.reduced} (completed=${b.reducedCompleted}, partial=${b.reducedPartial}, `
        + `abandoned=${b.reducedAbandoned}, unknown=${b.reducedUnknown}), `
        + `flag_skip=${b.flag_skip}, missed=${b.missed}, unknown=${b.unknown}, unplanned=${b.unplanned}; `
        + `adherence=${formatPercent(b.adherenceRate)} (eligible=${b.eligible}, threshold=${formatPercent(c1.threshold)}); `
        + `baseline=${baselineDesc}`,
    );
}

function formatMetricSummary(metric: DEvalC2MetricEvaluation): string {
    const before = metric.before ? `${metric.before.date}=${metric.before.value} ${metric.before.unit}` : 'missing';
    const after = metric.after ? `${metric.after.date}=${metric.after.value} ${metric.after.unit}` : 'missing';
    const noise = metric.reliability ? `${metric.reliability.value} (${metric.reliability.statistic})` : 'none';
    return `${metric.metricId}: status=${metric.status}, before=(${before}), after=(due=${metric.dueDate}, ${after}), noise=${noise}, comparability=${metric.comparability}`;
}

function formatC2Evidence(c2: DEvalC2Result): string {
    if (c2.protocols.length === 0) {
        return escapeCell(`no goal-bound protocols declared (${c2.reasons.join(', ') || 'none'})`);
    }
    return escapeCell(
        c2.protocols
            .map(protocol => `${protocol.protocolId} (${protocol.retestIntervalDays}d): ${protocol.status} [${protocol.metrics.map(formatMetricSummary).join('; ')}]`)
            .join(' | '),
    );
}

function formatC3Evidence(c3: DEvalC3Result): string {
    const flaggedDays = c3.flaggedHardDays.length > 0 ? c3.flaggedHardDays.join(', ') : 'none';
    const adverse = c3.adverseOutcomes.length > 0
        ? c3.adverseOutcomes.map(item => `${item.date} ${item.source}:${item.reason}`).join('; ')
        : 'none';
    const blindDates = c3.blindFlagDates.length > 0 ? c3.blindFlagDates.join(', ') : 'none';
    const incomplete = c3.incompleteFollowUps.length > 0 ? c3.incompleteFollowUps.join(', ') : 'none';
    return escapeCell(
        `flagged hard days=${c3.flaggedHardDays.length} (${flaggedDays}), `
        + `adverse outcomes=${c3.adverseOutcomes.length} (${adverse}); `
        + `blind flag-input dates=${c3.blindFlagDates.length} (${blindDates}); `
        + `final follow-up window closed at=${c3.lastFollowUpWindowClosedAt ?? 'n/a'}; `
        + `incomplete follow-ups=${incomplete}`,
    );
}

function formatC4Evidence(c4: DEvalC4MarkdownSummary): string {
    const used = c4.rollbackState === 'unused' ? 'no' : `yes (${c4.rollbackState})`;
    const at = c4.rollbackAtDate ? ` at ${c4.rollbackAtDate}` : '';
    return escapeCell(`rollback used=${used}${at}; reason=${c4.reason ?? 'none'}`);
}

function formatOverallVerdict(result: DEvalMarkdownInput): string {
    switch (result.overall) {
        case 'GO':
            return 'GO';
        case 'NO_GO':
            return 'NO-GO';
        case 'EXTEND':
            return 'EXTEND';
        case 'PENDING': {
            const dueText = result.c2.pendingDueDates.length > 0
                ? result.c2.pendingDueDates.join(', ')
                : 'unscheduled';
            return `PENDING (C2 after-attempts due ${dueText})`;
        }
    }
}

/** Formats an evaluated D-EVAL block readout using the §7 result template. */
export function renderDEvalResultMarkdown(result: DEvalMarkdownInput): string {
    const criteriaCommit = result.criteriaCommit ?? 'unrecorded';
    const phase2Commit = result.phase2Commit ?? 'unrecorded';
    const rollbackState = result.rollbackSettingState ?? (result.c4.rollbackState === 'unused' ? 'off' : `used (${result.c4.rollbackState})`);
    const knownLimits = result.knownLimits.length > 0 ? result.knownLimits.join('; ') : 'none';

    return [
        `# ADR-0052 D-EVAL result: ${result.blockStartDate} – ${result.blockEndDate}`,
        `- Criteria document: docs/analysis/2026-10-25-adr-0052-d-eval-criteria.md at ${criteriaCommit}`,
        `- Phase 2 commit / rollback setting state during block: ${phase2Commit} / ${rollbackState}`,
        '| # | Result (pass / fail / inconclusive) | Evidence (counts, values, sources) |',
        '|---|---|---|',
        `| C1 | ${result.c1.status} | ${formatC1Evidence(result.c1)} |`,
        `| C2 | ${result.c2.status} | ${formatC2Evidence(result.c2)} |`,
        `| C3 | ${result.c3.status} | ${formatC3Evidence(result.c3)} |`,
        `| C4 | ${result.c4.status} | ${formatC4Evidence(result.c4)} |`,
        `- Known limits: ${knownLimits}`,
        `- **Overall: ${formatOverallVerdict(result)}**`,
    ].join('\n');
}
