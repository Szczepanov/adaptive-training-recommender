import type { DailyRecommendation } from './models';

/* Issue #815: the brief's former "Plan adherence" section conflated two concepts.
 *
 * 1. Recommendation feedback — did the athlete answer the app's adherence prompt? This is
 *    what `DailyRecommendation.adherence` records, and all this module reports.
 * 2. Plan execution — what performed-training evidence says happened relative to the
 *    authoritative planned occurrence (app recommendation or imported/external plan).
 *
 * (2) is not reported: ADR-0034's canonical reconciliation (`training-occurrence/`)
 * reconciles performed sources with each other, and its planned-vs-performed history
 * diff and FIT workout-identity scoring (TO4/TO5, tracked in #646) are shadow-only. A
 * read-only export must not grant that evidence authority, so it states the gap rather
 * than inferring execution from feedback or from the absence of a synced activity.
 * Pure: no I/O. Display-only; zero recommendation authority. */

type Adherence = DailyRecommendation['adherence'];

/** An explicit athlete skip; `followed` may be null or false alongside it. */
function isSkip(a: Adherence): boolean {
    return a.skipped === true;
}

function isAnswered(a: Adherence): boolean {
    return a.followed !== null || isSkip(a);
}

function noteSuffix(a: Adherence): string {
    const note = a.notes?.trim();
    return note ? ` — "${note}"` : '';
}

function describeDifferent(a: Adherence): string {
    const duration = a.actualDurationMin ? ` for ${a.actualDurationMin} min` : '';
    return `${a.actualModality ?? 'something else'}${duration}`;
}

/** Stated in both the section and the handoff so no reader can take a missing answer
 * (or a missing synced activity) as a skip. The "plan execution" note applies when
 * feedback is absent because the read failed, making the truth unknown; when no
 * recommendations are recorded, the absence is confirmed. */
export const EXECUTION_NOT_RECONCILED_NOTE =
    'Plan execution reconciliation: unavailable (canonical planned-vs-performed reconciliation is shadow-only; ADR-0034 TO4/TO5, #646). '
    + 'Observed execution is not reconciled against planned sessions in this export: '
    + 'an unanswered prompt is not a skip, and a missing activity is not proof of non-execution '
    + '(sync may be incomplete) — compare against the completed-training section yourself.';

export interface RecommendationFeedbackOptions {
    /** True when the recommendation read succeeded; false when it failed. Defaults to true. */
    recommendationsReadable?: boolean;
    /** True when an imported/external plan is the active planning authority. Defaults to false. */
    isExternalPlanAuthority?: boolean;
}

export function renderRecommendationFeedback(
    recommendations: readonly DailyRecommendation[],
    heading: string,
    optionsOrReadable: boolean | RecommendationFeedbackOptions = true,
    maybeIsExternalPlanAuthority: boolean = false,
): string[] {
    const options: RecommendationFeedbackOptions = typeof optionsOrReadable === 'boolean'
        ? { recommendationsReadable: optionsOrReadable, isExternalPlanAuthority: maybeIsExternalPlanAuthority }
        : optionsOrReadable;
    const recommendationsReadable = options.recommendationsReadable ?? true;
    const isExternalPlanAuthority = options.isExternalPlanAuthority ?? false;

    const lines: string[] = [
        heading,
        '',
        'Athlete answers to the app\'s adherence prompt for **app recommendations only** — feedback '
        + 'completion, not execution. Imported/external-plan sessions are not counted here.',
    ];
    if (isExternalPlanAuthority) {
        lines.push(
            '',
            'Planning authority note: An imported/external plan is the active planning authority for this athlete. '
            + 'The feedback below reflects responses to in-app recommendation prompts only, not compliance with the external plan.',
        );
    }
    lines.push('');
    if (recommendations.length === 0) {
        if (!recommendationsReadable) {
            lines.push('Recommendation feedback unavailable (read failed) — unknown, not none.', '', EXECUTION_NOT_RECONCILED_NOTE);
        } else {
            lines.push('No app recommendations recorded in this window.', '', EXECUTION_NOT_RECONCILED_NOTE);
        }
        return lines;
    }
    const answered = recommendations.filter(r => isAnswered(r.adherence));
    const followed = recommendations.filter(r => r.adherence.followed === true && !isSkip(r.adherence));
    const different = recommendations.filter(r => r.adherence.followed === false && !isSkip(r.adherence));
    const skipped = recommendations.filter(r => isSkip(r.adherence));
    const unanswered = recommendations.length - answered.length;

    lines.push(`Feedback completion: ${answered.length}/${recommendations.length} prompts answered · ${unanswered} unanswered (unknown, not skipped).`);
    lines.push(`- Athlete reported followed as prescribed: ${followed.length}`);
    lines.push(`- Athlete reported doing something different: ${different.length}`);
    lines.push(`- Athlete reported skipping: ${skipped.length}`);

    const deviations = [...different, ...skipped].sort((a, b) => a.date.localeCompare(b.date));
    if (deviations.length > 0) {
        lines.push('', 'Reported deviations:');
        for (const rec of deviations) {
            const what = isSkip(rec.adherence) ? 'reported skipped' : `reported doing ${describeDifferent(rec.adherence)}`;
            lines.push(`- ${rec.date}: prescribed ${rec.templateTitle} (${rec.mode}), ${what}${noteSuffix(rec.adherence)}`);
        }
    }
    lines.push('', EXECUTION_NOT_RECONCILED_NOTE);
    return lines;
}

/** One handoff line for yesterday's app recommendation. `null` means no app
 * recommendation was recorded — distinct from an unanswered prompt. When
 * `recommendationsReadable` is false, the absence is unknown rather than confirmed. */
export function renderRecommendationFeedbackLine(
    recommendation: DailyRecommendation | null,
    recommendationsReadable: boolean = true,
    isExternalPlanAuthority: boolean = false,
): string {
    const label = '- Recommendation feedback (athlete response, not execution)';
    if (!recommendation) {
        if (!recommendationsReadable) {
            return `${label}: unavailable (read failed) — unknown, not none.`;
        }
        if (isExternalPlanAuthority) {
            return `${label}: no app recommendation recorded for yesterday (external plan governs).`;
        }
        return `${label}: no app recommendation recorded for yesterday.`;
    }
    const a = recommendation.adherence;
    const note = noteSuffix(a);
    if (isSkip(a)) return `${label}: reported skipped${note}`;
    if (a.followed === true) return `${label}: reported followed as prescribed${note}`;
    if (a.followed === false) return `${label}: reported doing ${describeDifferent(a)} instead${note}`;
    return `${label}: not answered yet — unknown, not a skip.`;
}
