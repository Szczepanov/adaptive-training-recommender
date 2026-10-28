import type { AuthoredPlanBlock, ExternalPlanPlacement, FixedActivity } from '../engine/models';
import { computeContentHash } from '../engine/externalPlanHash';
import { impliedDate, resolvePlacement, resolveRestDatesByDate } from '../engine/externalPlacement';
import { addDaysToLocalDateString } from '../utils/localDate';
import { isValidDate } from '../engine/validation';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import {
    declaredSessionReplacements,
    validateReplacementsAgainstPrevious,
    type SessionReplacementIssue,
} from '../sessions/externalPlanReplacements';
import type { SessionOccurrence } from '../sessions/models';
import { activeExternalPlanService } from './activeExternalPlanService';
import { externalPlanService } from './externalPlanService';
import { performedSessionIds, previousSessionDates, replacementReadRange, type ReplacementContext } from './externalPlanSupersession';
import { fixedActivityService } from './fixedActivityService';
import { planBlockService } from './planBlockService';
import { sessionOccurrenceService } from './sessionOccurrenceService';

export interface ImportPreflightFinding {
    kind: 'placement' | 'external_plan' | 'fixed_activity' | 'travel_block' | 'authored_occurrence' | 'rest_directive' | 'plan_horizon' | 'intent_blocks' | 'session_replacement';
    date: string;
    detail: string;
    /** Stable identity for findings that callers must deduplicate or match; never parsed from `detail`. */
    code?: 'placement_overlay_unreadable' | 'session_replacement_declared';
}

export type ExternalPlanImportPreflight =
    | { status: 'invalid_date' }
    /** #1172: a declared `replacesSessionId` that activation would reject. Blocks the import. */
    | { status: 'invalid_replacements'; issues: SessionReplacementIssue[] }
    | { status: 'unknown'; unavailableSources: string[]; findings: ImportPreflightFinding[] }
    | { status: 'ready'; findings: ImportPreflightFinding[] };

function valuesOrEmpty<T>(state: { status: string; data?: T[] }): T[] | null {
    if (state.status === 'MISSING') return [];
    if (state.status === 'AVAILABLE') return state.data ?? [];
    return null;
}

export async function preflightExternalPlanImport(
    userId: string,
    plan: AnyExternalTrainingPlan,
    effectiveFrom: string,
    today: string,
    previousPlan?: AnyExternalTrainingPlan | null,
): Promise<ExternalPlanImportPreflight> {
    if (!isValidDate(effectiveFrom) || effectiveFrom < today) return { status: 'invalid_date' };

    const lastPlanDate = addDaysToLocalDateString(plan.startDate, plan.weekCount * 7 - 1);
    const firstReviewDate = effectiveFrom > plan.startDate ? effectiveFrom : plan.startDate;
    if (firstReviewDate > lastPlanDate) return { status: 'invalid_date' };
    const identicalRetry = !!previousPlan && previousPlan.planId === plan.planId && previousPlan.revision === plan.revision
        && await computeContentHash(previousPlan) === await computeContentHash(plan);
    const replacementIssues = identicalRetry ? [] : validateReplacementsAgainstPrevious(plan, previousPlan ?? null);
    if (replacementIssues.length > 0) return { status: 'invalid_replacements', issues: replacementIssues };
    // #1172: replacement checks resolve the previous revision, which may span other dates.
    const replacing = previousPlan && !identicalRetry && declaredSessionReplacements(plan).length > 0 ? previousPlan : null;
    const readRange = replacing ? replacementReadRange(plan, replacing) : { start: plan.startDate, end: lastPlanDate };
    const [fixedState, blockState, occurrenceState] = await Promise.all([
        fixedActivityService.getActivitiesInRangeState(userId, readRange.start, readRange.end),
        planBlockService.getBlocksInRangeState(userId, plan.startDate, lastPlanDate),
        sessionOccurrenceService.getOccurrencesInRangeState(userId, readRange.start, readRange.end),
    ]);
    const fixedActivities = valuesOrEmpty(fixedState);
    const blocks = valuesOrEmpty(blockState);
    const occurrences = occurrenceState.status === 'MISSING' ? []
        : occurrenceState.status === 'AVAILABLE' ? occurrenceState.data : null;
    const unavailableSources = [
        fixedActivities === null && 'fixed activities',
        blocks === null && 'travel / plan blocks',
        occurrences === null && 'authored session occurrences',
    ].filter((item): item is string => Boolean(item));
    if (unavailableSources.length > 0) return { status: 'unknown', unavailableSources, findings: [] };

    const fixed = fixedActivities as FixedActivity[];
    const activeFixed = fixed.filter(item => !item.isCompleted);
    const activeBlocks = (blocks as AuthoredPlanBlock[]).filter(block => block.endDate >= firstReviewDate);
    const resolved = resolvePlacement(plan, null, { fixedActivities: activeFixed });
    const resolvedById = new Map(resolved.map(item => [item.session.id, item]));
    const findings: ImportPreflightFinding[] = [];
    if (previousPlan) {
        if (previousPlan.startDate !== plan.startDate || previousPlan.weekCount !== plan.weekCount) {
            const previousEnd = addDaysToLocalDateString(previousPlan.startDate, previousPlan.weekCount * 7 - 1);
            findings.push({ kind: 'plan_horizon', date: firstReviewDate, detail: `The plan horizon changes from ${previousPlan.startDate}–${previousEnd} to ${plan.startDate}–${lastPlanDate}; relative session and rest dates resolve against the new horizon.` });
        }
        if (JSON.stringify((previousPlan as { restDays?: unknown[] }).restDays ?? []) !== JSON.stringify((plan as { restDays?: unknown[] }).restDays ?? [])) {
            findings.push({ kind: 'rest_directive', date: firstReviewDate, detail: 'The imported revision changes the plan’s authored rest-day directives.' });
        }
        if (JSON.stringify((previousPlan as { intentBlocks?: unknown[] }).intentBlocks ?? []) !== JSON.stringify((plan as { intentBlocks?: unknown[] }).intentBlocks ?? [])) {
            findings.push({ kind: 'intent_blocks', date: firstReviewDate, detail: 'The imported revision changes authored objective intent blocks or their review/progression terms.' });
        }
    }

    for (const session of plan.sessions) {
        const authoredDate = impliedDate(plan, session);
        if (authoredDate > lastPlanDate) continue;
        const placement = resolvedById.get(session.id);
        if (!placement || placement.status === 'dropped') {
            if (authoredDate >= effectiveFrom) findings.push({ kind: 'placement', date: authoredDate, detail: `${session.title} will be dropped by the existing placement rules.` });
            continue;
        }
        if (placement.date >= effectiveFrom && placement.date <= lastPlanDate && placement.date !== authoredDate) {
            findings.push({ kind: 'placement', date: placement.date, detail: `${session.title} resolves from ${authoredDate} to ${placement.date} under the existing placement rules.` });
        }
        if (placement.date < effectiveFrom || placement.date > lastPlanDate) continue;
        const fixedOnDate = activeFixed.filter(item => item.date === placement.date);
        for (const activity of fixedOnDate) {
            findings.push({ kind: 'fixed_activity', date: placement.date, detail: `${session.title} shares a date with fixed activity “${activity.title}”.` });
        }
        for (const block of activeBlocks) {
            if (placement.date >= block.startDate && placement.date <= block.endDate) {
                findings.push({ kind: 'travel_block', date: placement.date, detail: `${session.title} falls inside travel block ${block.id} (${block.startDate}–${block.endDate}).` });
            }
        }
        const existingOccurrences = (occurrences ?? []).filter(occurrence => occurrence.date === placement.date
            && occurrence.state !== 'superseded' && occurrence.state !== 'skipped'
        );
        for (const occurrence of existingOccurrences) {
            findings.push({ kind: 'authored_occurrence', date: placement.date, detail: `${session.title} overlaps existing authored occurrence ${occurrence.occurrenceId}.` });
        }
    }

    for (const date of resolveRestDatesByDate(plan).keys()) {
        if (date < effectiveFrom || date > lastPlanDate) continue;
        for (const activity of activeFixed.filter(item => item.date === date)) {
            findings.push({ kind: 'fixed_activity', date, detail: `Authored rest shares a date with fixed activity “${activity.title}”.` });
        }
        for (const block of activeBlocks) {
            if (date >= block.startDate && date <= block.endDate) findings.push({ kind: 'travel_block', date, detail: `Authored rest falls inside travel block ${block.id} (${block.startDate}–${block.endDate}).` });
        }
        for (const occurrence of occurrences ?? []) {
            if (occurrence.date === date && occurrence.state !== 'superseded' && occurrence.state !== 'skipped') {
                findings.push({ kind: 'authored_occurrence', date, detail: `Authored rest overlaps existing authored occurrence ${occurrence.occurrenceId}.` });
            }
        }
    }

    const activeDates: string[] = [];
    for (let date = firstReviewDate; date <= lastPlanDate; date = addDaysToLocalDateString(date, 1)) activeDates.push(date);
    // #1172: an unreadable placement overlay must not block importing a corrected revision.
    const activeStates = await activeExternalPlanService.getActivePlanStatesInRange(userId, firstReviewDate, lastPlanDate, activeFixed,
        { degradeInvalidPlacement: true });
    const missingAuthority = activeStates.some(state => state.status !== 'AVAILABLE' && state.status !== 'MISSING');
    if (missingAuthority) return { status: 'unknown', unavailableSources: ['active external-plan authority'], findings };

    for (let index = 0; index < activeDates.length; index += 1) {
        const state = activeStates[index];
        if (state.status !== 'AVAILABLE') continue;
        if (state.data.plan.planId !== plan.planId) {
            findings.push({ kind: 'external_plan', date: activeDates[index], detail: `${state.data.plan.title} (${state.data.plan.planId}) currently resolves as the external-plan authority on this date.` });
        }
        if (state.data.plan.planId === plan.planId
            && state.data.placement?.assignments.some(item => item.status === 'moved' || item.status === 'dropped')
            && !findings.some(item => item.kind === 'placement' && item.detail.includes('existing confirmed placement overlay'))) {
            findings.push({ kind: 'placement', date: activeDates[index], detail: 'Importing this revision resets an existing confirmed placement overlay.' });
        }
        if (state.data.plan.planId === plan.planId && state.data.placementOverlayInvalid
            && !findings.some(item => item.code === 'placement_overlay_unreadable')) {
            findings.push({ kind: 'placement', code: 'placement_overlay_unreadable', date: activeDates[index],
                detail: 'Existing placement moves for this plan could not be read. This revision does not restore them.' });
        }
    }

    const replacements = replacing
        ? await replacementFindings(userId, plan, replacing, effectiveFrom, { fixedActivities: activeFixed, occurrences: occurrences as SessionOccurrence[] })
        : { findings: [] };
    if ('unavailable' in replacements) return { status: 'unknown', unavailableSources: [replacements.unavailable], findings };
    if ('issues' in replacements) return { status: 'invalid_replacements', issues: replacements.issues };
    return { status: 'ready', findings: [...findings, ...replacements.findings] };
}

/** Reads the previous revision's own overlay; null when it has none. */
async function readPreviousOverlay(userId: string, previousPlan: AnyExternalTrainingPlan):
    Promise<{ overlay: ExternalPlanPlacement | null } | { unreadable: true } | { unavailable: string }> {
    const state = await externalPlanService.getPlacementState(userId, previousPlan.planId, previousPlan.revision);
    if (state.status === 'AVAILABLE') return { overlay: state.data };
    if (state.status === 'MISSING') return { overlay: null };
    // Another owner stays fail-closed, as for the active plan; other corruption gets a recovery path.
    if (state.status === 'INVALID' && !state.issues.some(issue => issue.code === 'owner-mismatch')) return { unreadable: true };
    return { unavailable: 'earlier revision’s saved moves' };
}

/**
 * #1172: one acknowledgement finding per declared replacement, dated where the plan view shows
 * the earlier session (`previousSessionDates`). Import applies the same checks: a started or
 * completed session cannot be replaced, and an unreadable previous overlay blocks the import.
 */
async function replacementFindings(userId: string, plan: AnyExternalTrainingPlan, previousPlan: AnyExternalTrainingPlan,
    effectiveFrom: string, context: ReplacementContext):
    Promise<{ findings: ImportPreflightFinding[] } | { issues: SessionReplacementIssue[] } | { unavailable: string }> {
    const declarations = declaredSessionReplacements(plan);
    const read = await readPreviousOverlay(userId, previousPlan);
    if ('unavailable' in read) return read;
    if ('unreadable' in read) {
        const first = declarations[0];
        return { issues: [{ code: 'replaced-placement-unreadable', field: `sessions[${first.index}].replacesSessionId`,
            sessionId: first.sessionId, replacesSessionId: first.replacesSessionId }] };
    }
    const performed = performedSessionIds(previousPlan, read.overlay, context.occurrences);
    const completed = declarations.filter(item => performed.has(item.replacesSessionId));
    if (completed.length > 0) {
        return { issues: completed.map(item => ({ code: 'replaced-session-completed' as const,
            field: `sessions[${item.index}].replacesSessionId`, sessionId: item.sessionId, replacesSessionId: item.replacesSessionId })) };
    }
    const dates = previousSessionDates(previousPlan, read.overlay, context.fixedActivities);
    const beforeBoundary = declarations.filter(item => {
        const date = dates.get(item.replacesSessionId);
        return date !== undefined && date < effectiveFrom;
    });
    if (beforeBoundary.length > 0) {
        return { issues: beforeBoundary.map(item => ({ code: 'replaced-session-before-effective-date' as const,
            field: `sessions[${item.index}].replacesSessionId`, sessionId: item.sessionId, replacesSessionId: item.replacesSessionId })) };
    }
    const titleOf = (sessions: AnyExternalTrainingPlan['sessions'], id: string) => sessions.find(item => item.id === id)?.title ?? id;
    return { findings: declarations.map(item => {
        const oldTitle = titleOf(previousPlan.sessions, item.replacesSessionId);
        return {
            kind: 'session_replacement' as const,
            code: 'session_replacement_declared' as const,
            date: dates.get(item.replacesSessionId) ?? previousPlan.startDate,
            detail: `${titleOf(plan.sessions, item.sessionId)} replaces ${oldTitle} from revision ${previousPlan.revision}. ${oldTitle} stays on its date and is marked as replaced.`,
        };
    }) };
}
