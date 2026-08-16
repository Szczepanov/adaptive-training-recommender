import type {
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    DecisionJournalEntry,
    ShadowVerdict,
} from './models';
import { classifyAgreement, type AgreementClass } from './shadowAgreement';

/**
 * Phase 9.0.5 export: joins the engine's persisted verdict, the athlete's own decision
 * journal, and same-day telemetry into one row per day. Pure -- `shadowLogService.ts`
 * performs the reads, following the `contextBrief.ts` / `contextBriefService.ts` split
 * exactly. Two consumers read this: the 9.0.8 readout (a human, reading every disagreement
 * row) and Phase 9.5's corpus (sampling real subjective variance). Neither gets a
 * userId, a raw wearable payload, or the check-in's free-text `notes` -- only the
 * athlete's own journal note, which they wrote to be read this way.
 */
export interface ShadowLogRow {
    date: string;
    /** Derived from `daily_recommendations/{date}.mode` -- see `deriveEngineVerdictFromMode`
     *  for what this approximation can and cannot distinguish. Null when no recommendation
     *  was persisted that day. */
    engineVerdict: ShadowVerdict | null;
    engineMode: DailyRecommendation['mode'] | null;
    externalVerdict: ShadowVerdict | null;
    externalNote: string | null;
    sawEngineVerdictFirst: boolean | null;
    actualVerdict: ShadowVerdict | null;
    adherenceFollowed: boolean | null;
    actualDurationMin: number | null;
    /** Null whenever either side is missing -- classifyAgreement is total over the five
     *  ShadowVerdict values, but a day with no engine or no external verdict has nothing
     *  to compare. */
    agreement: AgreementClass | null;
    subjective: {
        readiness: number | null;
        sleepQuality: number | null;
        fatigue: number | null;
        soreness: number | null;
        mentalStress: number | null;
        motivation: number | null;
    } | null;
    objective: {
        sleepScoreVs7d: number | null;
        sleepScoreVs28d: number | null;
        restingHrVs7d: number | null;
        restingHrVs28d: number | null;
        hrvVs7d: number | null;
        hrvVs28d: number | null;
        respirationVs7d: number | null;
        respirationVs28d: number | null;
    } | null;
    policyVersion: string | null;
    externalPlanContentHash: string | null;
}

export interface ShadowLogDayInput {
    date: string;
    recommendation: DailyRecommendation | null;
    journalEntry: DecisionJournalEntry | null;
    checkin: DailySubjectiveCheckin | null;
    recoverySnapshot: DailyRecoverySnapshot | null;
}

/**
 * Mode-based approximation of the day's engine verdict. `daily_recommendations/{date}`
 * retains only the three-value `mode`, not the specific `ExternalSessionDecision` an
 * adjudicated day resolved to -- so this can produce `proceed`/`scale`/`defer` but never
 * `skip` or `advisory`. That is an accepted precision loss (no new persisted field), not a
 * silent one: it means an adjudicated `skip` or `advisory` day reads as its nearest mode
 * instead, which the conservatism ladder in `shadowAgreement.ts` still orders correctly
 * for `skip` (both `defer` and `skip` rank equally) but not for `advisory` (which sits
 * outside the ladder and would misclassify as comparable). Revisit if 9.0.8 needs the
 * distinction.
 */
export function deriveEngineVerdictFromMode(mode: DailyRecommendation['mode']): ShadowVerdict {
    switch (mode) {
        case 'train': return 'proceed';
        case 'modify': return 'scale';
        case 'recover': return 'defer';
    }
}

/** Builds one row, or null when none of the three evidence sources (recommendation,
 *  journal entry, check-in) exist for the day -- the export omits the day entirely rather
 *  than emitting an all-null row for a date nothing touched. A day where exactly one or
 *  two sources exist still gets a row, with the rest visible as null: that gap is itself a
 *  finding (the day the athlete skipped the check-in), not something to silently drop. */
export function buildShadowLogRow(input: ShadowLogDayInput): ShadowLogRow | null {
    const { date, recommendation, journalEntry, checkin, recoverySnapshot } = input;
    if (!recommendation && !journalEntry && !checkin) return null;

    const engineVerdict = recommendation ? deriveEngineVerdictFromMode(recommendation.mode) : null;
    const externalVerdict = journalEntry?.externalVerdict ?? null;
    const agreement = engineVerdict !== null && externalVerdict !== null
        ? classifyAgreement(engineVerdict, externalVerdict)
        : null;

    return {
        date,
        engineVerdict,
        engineMode: recommendation?.mode ?? null,
        externalVerdict,
        externalNote: journalEntry?.externalNote ?? null,
        sawEngineVerdictFirst: journalEntry?.sawEngineVerdictFirst ?? null,
        actualVerdict: journalEntry?.actualVerdict ?? null,
        adherenceFollowed: recommendation?.adherence.followed ?? null,
        actualDurationMin: recommendation?.adherence.actualDurationMin ?? null,
        agreement,
        subjective: checkin ? {
            readiness: checkin.readiness,
            sleepQuality: checkin.sleepQuality,
            fatigue: checkin.fatigue,
            soreness: checkin.soreness,
            mentalStress: checkin.mentalStress,
            motivation: checkin.motivation,
        } : null,
        objective: recoverySnapshot ? {
            sleepScoreVs7d: recoverySnapshot.derived.deltas.sleepScoreVs7d,
            sleepScoreVs28d: recoverySnapshot.derived.deltas.sleepScoreVs28d,
            restingHrVs7d: recoverySnapshot.derived.deltas.restingHrVs7d,
            restingHrVs28d: recoverySnapshot.derived.deltas.restingHrVs28d,
            hrvVs7d: recoverySnapshot.derived.deltas.hrvVs7d,
            hrvVs28d: recoverySnapshot.derived.deltas.hrvVs28d,
            respirationVs7d: recoverySnapshot.derived.deltas.respirationVs7d,
            respirationVs28d: recoverySnapshot.derived.deltas.respirationVs28d,
        } : null,
        policyVersion: recommendation?.recommendationAudit?.policyVersion ?? null,
        externalPlanContentHash: recommendation?.recommendationAudit?.externalPlan?.contentHash ?? null,
    };
}

/** `days` in any order; the output preserves that order (callers pass dates ascending by
 *  convention, same as `ContextBriefInput.snapshots`). */
export function buildShadowLog(days: readonly ShadowLogDayInput[]): ShadowLogRow[] {
    const rows: ShadowLogRow[] = [];
    for (const day of days) {
        const row = buildShadowLogRow(day);
        if (row) rows.push(row);
    }
    return rows;
}

const CSV_COLUMNS: Array<{ header: string; read: (row: ShadowLogRow) => string | number | boolean | null }> = [
    { header: 'date', read: r => r.date },
    { header: 'engineVerdict', read: r => r.engineVerdict },
    { header: 'engineMode', read: r => r.engineMode },
    { header: 'externalVerdict', read: r => r.externalVerdict },
    { header: 'externalNote', read: r => r.externalNote },
    { header: 'sawEngineVerdictFirst', read: r => r.sawEngineVerdictFirst },
    { header: 'actualVerdict', read: r => r.actualVerdict },
    { header: 'adherenceFollowed', read: r => r.adherenceFollowed },
    { header: 'actualDurationMin', read: r => r.actualDurationMin },
    { header: 'agreement', read: r => r.agreement },
    { header: 'readiness', read: r => r.subjective?.readiness ?? null },
    { header: 'sleepQuality', read: r => r.subjective?.sleepQuality ?? null },
    { header: 'fatigue', read: r => r.subjective?.fatigue ?? null },
    { header: 'soreness', read: r => r.subjective?.soreness ?? null },
    { header: 'mentalStress', read: r => r.subjective?.mentalStress ?? null },
    { header: 'motivation', read: r => r.subjective?.motivation ?? null },
    { header: 'sleepScoreVs7d', read: r => r.objective?.sleepScoreVs7d ?? null },
    { header: 'sleepScoreVs28d', read: r => r.objective?.sleepScoreVs28d ?? null },
    { header: 'restingHrVs7d', read: r => r.objective?.restingHrVs7d ?? null },
    { header: 'restingHrVs28d', read: r => r.objective?.restingHrVs28d ?? null },
    { header: 'hrvVs7d', read: r => r.objective?.hrvVs7d ?? null },
    { header: 'hrvVs28d', read: r => r.objective?.hrvVs28d ?? null },
    { header: 'respirationVs7d', read: r => r.objective?.respirationVs7d ?? null },
    { header: 'respirationVs28d', read: r => r.objective?.respirationVs28d ?? null },
    { header: 'policyVersion', read: r => r.policyVersion },
    { header: 'externalPlanContentHash', read: r => r.externalPlanContentHash },
];

function csvCell(value: string | number | boolean | null): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The 9.0.8 human readout's export format -- one row per day, gaps visible as empty
 *  cells rather than dropped columns, so a reviewer sees exactly what 9.0.7's acceptance
 *  gates require checking (coverage, anchoring split, disagreement rows) without a second
 *  tool. Phase 9.5's corpus consumes `buildShadowLog`'s rows directly instead of this
 *  text form. */
export function renderShadowLogCsv(rows: readonly ShadowLogRow[]): string {
    const header = CSV_COLUMNS.map(column => column.header).join(',');
    const lines = rows.map(row => CSV_COLUMNS.map(column => csvCell(column.read(row))).join(','));
    return [header, ...lines].join('\n');
}
