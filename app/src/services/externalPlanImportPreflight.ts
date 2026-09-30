import type { AuthoredPlanBlock, FixedActivity } from '../engine/models';
import { impliedDate, resolvePlacement, resolveRestDatesByDate } from '../engine/externalPlacement';
import { addDaysToLocalDateString } from '../utils/localDate';
import { isValidDate } from '../engine/validation';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import { activeExternalPlanService } from './activeExternalPlanService';
import { fixedActivityService } from './fixedActivityService';
import { planBlockService } from './planBlockService';
import { sessionOccurrenceService } from './sessionOccurrenceService';

export interface ImportPreflightFinding {
    kind: 'placement' | 'external_plan' | 'fixed_activity' | 'travel_block' | 'authored_occurrence' | 'rest_directive' | 'plan_horizon' | 'intent_blocks';
    date: string;
    detail: string;
}

export type ExternalPlanImportPreflight =
    | { status: 'invalid_date' }
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
    const [fixedState, blockState, occurrenceState] = await Promise.all([
        fixedActivityService.getActivitiesInRangeState(userId, plan.startDate, lastPlanDate),
        planBlockService.getBlocksInRangeState(userId, plan.startDate, lastPlanDate),
        sessionOccurrenceService.getOccurrencesInRangeState(userId, plan.startDate, lastPlanDate),
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
    const activeStates = await activeExternalPlanService.getActivePlanStatesInRange(userId, firstReviewDate, lastPlanDate, activeFixed);
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
    }

    return { status: 'ready', findings };
}
