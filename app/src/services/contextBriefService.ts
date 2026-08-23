import type {
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    ExternalPlanSession as LegacyExternalPlanSession,
} from '../engine/models';
import {
    briefWindowDaysFor,
    briefWindowStart,
    buildContextBrief,
    defaultBriefWindowDays,
    SUBJECTIVE_BASELINE_DAYS,
    type BriefWindowPreset,
    type ContextBriefInput,
} from '../engine/contextBrief';
import { injectActivityTelemetryIntoContextBrief } from '../engine/contextBriefActivityTelemetry';
import {
    enhanceContextBriefForPlanning,
    RECOVERY_TIMELINE_DAYS,
    UPCOMING_CONTEXT_DAYS,
    type UpcomingExternalPlanSession,
} from '../engine/contextBriefPlanningHandoff';
import { externalSessionDisplayPrescription } from '../engine/externalSessionProfiles';
import { resolvePlanningContext } from '../engine/planningMode';
import { evaluatePeriodizationPhase, goalToUserEvent } from '../engine/periodization';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';
import { isV2Session, type AnyExternalPlanSession } from '../sessions/externalPlanV2';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { activeExternalPlanService, placedSessionForDate } from './activeExternalPlanService';
import { activityService } from './activityService';
import { checkinService } from './checkinService';
import { fixedActivityService } from './fixedActivityService';
import { goalService } from './goalService';
import { planBlockService } from './planBlockService';
import { preferencesService } from './preferencesService';
import { recommendationService } from './recommendationService';
import { recoverySnapshotService } from './recoverySnapshotService';
import { trainingIntentProfileService } from './trainingIntentProfileService';
import { trainingSettingsService } from './trainingSettingsService';

export interface ContextBriefResult {
    /** The rendered markdown, ready to paste into an external planner. */
    text: string;
    startDate: string;
    asOfDate: string;
    windowDays: number;
    /** The named window this result was built for, so the UI can reflect the active
     * choice without re-deriving it from windowDays (which `build`'s caller could in
     * principle pass as an arbitrary number outside either preset). */
    preset: BriefWindowPreset;
    /** Sources that could not be read. The brief still renders; it says what is missing
     * rather than presenting a partial window as complete. */
    unavailableSources: string[];
}

/**
 * `resolvePlanningContext` still accepts the v1 external-session type, while placement may
 * return either external-plan schema. Planning-mode authority only needs the presence and
 * shared envelope of a session placed on this date. `externalSessionDisplayPrescription`
 * is the repository's canonical v1/v2 display adapter, so the compatibility facade keeps
 * truthful authored display content rather than inventing a prescription. The returned
 * context's externalSession is deliberately not consumed by this brief.
 */
function planningAuthoritySession(session: AnyExternalPlanSession): LegacyExternalPlanSession {
    if (!isV2Session(session)) return session;
    return {
        id: session.id,
        title: session.title,
        priority: session.priority,
        placement: session.placement,
        gating: session.gating,
        ...(session.objectives ? { objectives: [...session.objectives] } : {}),
        prescription: externalSessionDisplayPrescription(session),
        ...(session.scaling ? { scaling: session.scaling } : {}),
        ...(session.isEvent !== undefined ? { isEvent: session.isEvent } : {}),
    };
}

/** Assembles the context brief from the user-scoped stores. Read-only: it persists
 * nothing and mutates nothing, so it is safe to call at any point in the day. */
export class ContextBriefService {
    async build(
        userId: string,
        asOfDate?: string,
        windowDays: number = defaultBriefWindowDays(),
        preset: BriefWindowPreset = windowDays <= briefWindowDaysFor('daily') ? 'daily' : 'full',
    ): Promise<ContextBriefResult> {
        const targetDate = asOfDate ?? getLocalDateString();
        const startDate = briefWindowStart(targetDate, windowDays);
        // Strictly longer than the window, so there is always prior history to compare
        // against even when the caller asks for a long window.
        const baselineDays = Math.max(SUBJECTIVE_BASELINE_DAYS, windowDays * 2);
        const baselineStart = briefWindowStart(targetDate, baselineDays);
        // Snapshots and activities are fetched over at least RECOVERY_TIMELINE_DAYS, not
        // merely windowDays: enhanceContextBriefForPlanning's fixed 7-day recovery
        // timeline reads from these same arrays regardless of the requested retrospective
        // window, and a short `daily` window must not starve it of real data it would
        // otherwise render as unrecorded. buildContextBrief still slices everything down
        // to `startDate`/windowDays itself via its own `inWindow`, so widening the fetch
        // here does not widen what the retrospective sections show.
        const contextDays = Math.max(windowDays, RECOVERY_TIMELINE_DAYS);
        const contextStart = briefWindowStart(targetDate, contextDays);
        // Activity and recommendation range queries are end-exclusive; the brief window
        // is inclusive of targetDate, so the fetch reaches one day further.
        const throughExclusive = addDaysToLocalDateString(targetDate, 1);
        const upcomingEndDate = addDaysToLocalDateString(targetDate, UPCOMING_CONTEXT_DAYS - 1);
        const upcomingDates = Array.from(
            { length: UPCOMING_CONTEXT_DAYS },
            (_, offset) => addDaysToLocalDateString(targetDate, offset),
        );
        // External-plan placement spreads flexible sessions within their whole plan week.
        // A fixed activity just before or after the 7-day handoff horizon can therefore
        // change which date a session resolves onto inside the horizon. Six calendar days
        // of padding on both sides fully covers every Monday-Sunday plan week intersecting
        // the handoff, without requiring timezone-sensitive weekday arithmetic here.
        const placementOccupancyStart = addDaysToLocalDateString(targetDate, -6);
        const placementOccupancyEnd = addDaysToLocalDateString(upcomingEndDate, 6);
        const unavailableSources: string[] = [];

        const snapshotDates = Array.from(
            { length: contextDays },
            (_, offset) => addDaysToLocalDateString(contextStart, offset),
        );

        const [
            snapshotResults,
            checkinResult,
            activityResult,
            recommendationResult,
            settingsResult,
            preferencesResult,
            intentResult,
            goalsResult,
            fixedActivityResult,
            planBlockResult,
        ] = await Promise.allSettled([
            // getRecoverySnapshotByDate collapses UNAVAILABLE and MISSING to null, so a
            // read outage would be indistinguishable from "no data that day" and the
            // brief would silently under-report the window. Read the state instead.
            Promise.all(snapshotDates.map(date => recoverySnapshotService.getRecoverySnapshotState(userId, date))),
            // Activity, recommendation, and check-in range queries are end-exclusive;
            // the brief window is inclusive of targetDate, so the fetch reaches throughExclusive.
            checkinService.getCheckinsInRange(userId, baselineStart, throughExclusive),
            // Widened to contextStart (see contextDays above) so the recovery timeline
            // always has real activity flags; recommendations stay at windowDays since
            // only the render-window adherence section and the current-day row use them.
            activityService.getActivitiesInRange(userId, contextStart, throughExclusive),
            recommendationService.getRecommendationsInRange(userId, startDate, throughExclusive),
            // peek, not get: the brief is read-only and must not create a settings
            // profile as a side effect of being looked at (DataView presents it as
            // "generating it changes nothing").
            trainingSettingsService.peekTrainingSettingsState(userId),
            preferencesService.getPreferencesState(userId),
            trainingIntentProfileService.getProfileState(userId),
            goalService.getActiveGoalsState(userId),
            // Fixed activities are fetched slightly wider than the visible handoff so
            // imported-plan placement has the full occupancy of every intersecting week.
            fixedActivityService.getActivitiesInRangeState(userId, placementOccupancyStart, placementOccupancyEnd),
            // Plan blocks are range-overlays (currently explicit travel) and the service
            // returns any block intersecting this visible horizon, including one that began earlier.
            planBlockService.getBlocksInRangeState(userId, targetDate, upcomingEndDate),
        ] as const);

        const snapshots: DailyRecoverySnapshot[] = [];
        if (snapshotResults.status === 'fulfilled') {
            let unreadableDays = 0;
            for (const state of snapshotResults.value) {
                if (state.status === 'AVAILABLE') snapshots.push(state.data);
                // MISSING is a genuine "no data that day" and is not a failure to report.
                else if (state.status !== 'MISSING') unreadableDays += 1;
            }
            if (unreadableDays > 0) unavailableSources.push(`recovery snapshots (${unreadableDays} day(s) unreadable)`);
        } else {
            unavailableSources.push('recovery snapshots');
        }

        // getCheckinsInRange predates the DataState-based history readers and returns raw
        // Firestore documents cast as DailySubjectiveCheckin. Re-parse them here so one
        // malformed historical record cannot silently turn a safety flag or readiness
        // score into neutral input in a brief that may be handed to an external planner.
        const checkins: DailySubjectiveCheckin[] = [];
        if (checkinResult.status === 'fulfilled') {
            let invalidCheckins = 0;
            checkinResult.value.forEach((rawCheckin, index) => {
                const rawDate = typeof rawCheckin?.date === 'string' ? rawCheckin.date : `invalid-${index}`;
                const parsed = parseSubjectiveCheckin(
                    rawCheckin,
                    `users/${userId}/daily_subjective_checkins/${rawDate}`,
                    userId,
                    rawDate,
                );
                if (parsed.status === 'AVAILABLE') checkins.push(parsed.data);
                else invalidCheckins += 1;
            });
            if (invalidCheckins > 0) {
                unavailableSources.push(`subjective check-ins (${invalidCheckins} invalid record(s) omitted)`);
            }
        } else {
            unavailableSources.push('subjective check-ins');
        }

        const activities = activityResult.status === 'fulfilled' && activityResult.value.status === 'AVAILABLE'
            ? activityResult.value.data
            : [];
        if (activityResult.status !== 'fulfilled' || activityResult.value.status !== 'AVAILABLE') {
            unavailableSources.push('recorded activities');
        }

        const recommendations = recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE'
            ? recommendationResult.value.data
            : [];
        if (recommendationResult.status !== 'fulfilled' || recommendationResult.value.status !== 'AVAILABLE') {
            unavailableSources.push('recommendations and adherence');
        }

        const trainingSettings = settingsResult.status === 'fulfilled' && settingsResult.value.status === 'AVAILABLE'
            ? settingsResult.value.data
            : null;
        if (!trainingSettings) unavailableSources.push('training settings');

        const preferences = preferencesResult.status === 'fulfilled' && preferencesResult.value.status === 'AVAILABLE'
            ? preferencesResult.value.data
            : null;
        // Preferences own `unavailableModalities`, a hard exclusion the brief prints under
        // "a session that violates any of these cannot be executed". Losing them silently
        // would let that heading make a promise the content no longer keeps. An absent
        // document (MISSING) genuinely means nothing is configured; a failed read does not.
        if (preferencesResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(preferencesResult.value.status)) {
            unavailableSources.push('preferences (modality exclusions may be missing)');
        }

        const intentProfile = intentResult.status === 'fulfilled' && intentResult.value.status === 'AVAILABLE'
            ? intentResult.value.data
            : null;
        if (intentResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(intentResult.value.status)) {
            unavailableSources.push('training intent profile');
        }

        const goals = goalsResult.status === 'fulfilled' && goalsResult.value.status === 'AVAILABLE'
            ? goalsResult.value.data
            : [];
        if (goalsResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(goalsResult.value.status)) {
            unavailableSources.push('active goals');
        }

        const fixedActivitiesReadable = fixedActivityResult.status === 'fulfilled'
            && ['AVAILABLE', 'MISSING'].includes(fixedActivityResult.value.status);
        const placementFixedActivities = fixedActivityResult.status === 'fulfilled' && fixedActivityResult.value.status === 'AVAILABLE'
            ? fixedActivityResult.value.data.filter(activity => !activity.isCompleted)
            : [];
        const upcomingFixedActivities = placementFixedActivities.filter(activity =>
            activity.date >= targetDate && activity.date <= upcomingEndDate);
        if (!fixedActivitiesReadable) {
            unavailableSources.push('future fixed activities');
        }

        const upcomingPlanBlocks = planBlockResult.status === 'fulfilled' && planBlockResult.value.status === 'AVAILABLE'
            ? planBlockResult.value.data
            : [];
        if (planBlockResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(planBlockResult.value.status)) {
            unavailableSources.push('plan blocks / travel overlays');
        }

        const upcomingExternalSessions: UpcomingExternalPlanSession[] = [];
        let currentExternalSession: AnyExternalPlanSession | null = null;
        // Whether "no session placed today" can be asserted as a confirmed fact. Starts
        // false whenever occupancy itself is unreadable (the else branch below), and is
        // also cleared if today's own plan-state read specifically fails, so a resolved
        // `externalFallback: true` downstream is never presented as certain when the day
        // that mattered most could not actually be read.
        let externalScheduleTodayConfirmed = fixedActivitiesReadable;
        if (fixedActivitiesReadable) {
            // Resolve the active plan independently for each future date so plan revision
            // effective-from boundaries and overlapping re-imports are respected. Use the
            // padded occupancy set above, not only visible future commitments, because an
            // earlier/later fixed day in the same plan week can move a flexible session.
            const activePlanResults = await Promise.allSettled(
                upcomingDates.map(date => activeExternalPlanService.getActivePlanState(userId, date, placementFixedActivities)),
            );
            let unreadablePlanDays = 0;
            for (let index = 0; index < activePlanResults.length; index++) {
                const date = upcomingDates[index];
                const settled = activePlanResults[index];
                if (settled.status === 'rejected') {
                    unreadablePlanDays += 1;
                    if (date === targetDate) externalScheduleTodayConfirmed = false;
                    continue;
                }
                const state = settled.value;
                if (state.status === 'MISSING') continue;
                if (state.status !== 'AVAILABLE') {
                    unreadablePlanDays += 1;
                    if (date === targetDate) externalScheduleTodayConfirmed = false;
                    continue;
                }
                if (date === targetDate) {
                    currentExternalSession = placedSessionForDate(state.data, date)?.session ?? null;
                }
                for (const placed of state.data.placed.filter(item =>
                    item.date === date && (item.status === 'planned' || item.status === 'moved'))) {
                    upcomingExternalSessions.push({
                        date,
                        planId: state.data.header.planId,
                        planTitle: state.data.header.title,
                        revision: state.data.header.revision,
                        sessionId: placed.session.id,
                        title: placed.session.title,
                        priority: placed.session.priority,
                        modality: placed.session.gating.modality,
                        intensity: placed.session.gating.intensity,
                        durationMin: placed.session.gating.durationMin,
                        durationMax: placed.session.gating.durationMax,
                        flexibility: placed.session.placement.flexibility,
                        status: placed.status === 'moved' ? 'moved' : 'planned',
                        moved: placed.moved,
                        isEvent: placed.session.isEvent === true,
                        prescription: externalSessionDisplayPrescription(placed.session),
                    });
                }
            }
            if (unreadablePlanDays > 0) {
                unavailableSources.push(`external plan schedule (${unreadablePlanDays} day(s) unreadable)`);
            }
        } else {
            // Placement depends on fixed-activity occupancy; showing a schedule resolved
            // against an unknown occupancy set would be confidently wrong.
            unavailableSources.push('external plan schedule (fixed-activity occupancy unavailable)');
        }

        // ADR-0017: planningMode.ts is the sole authority for the effective mode. The
        // persisted profile is athlete intent; effective mode also depends on whether an
        // eligible event/session actually governs this date.
        const events = goals.map(goalToUserEvent).filter((event): event is NonNullable<typeof event> => event !== null);
        const periodization = evaluatePeriodizationPhase(events, targetDate);
        const planningContext = resolvePlanningContext(
            intentProfile,
            periodization,
            targetDate,
            currentExternalSession ? planningAuthoritySession(currentExternalSession) : null,
        );
        // resolvePlanningContext treats a null externalSession as "confirmed nothing is
        // placed today" and reports externalFallback accordingly. That is only true when
        // today's own plan-state read actually succeeded; when it didn't,
        // externalScheduleTodayConfirmed is false and the fallback claim is unconfirmed,
        // not negative.
        const externalFallbackUncertain = planningContext.externalFallback && !externalScheduleTodayConfirmed;

        const input: ContextBriefInput = {
            asOfDate: targetDate,
            windowDays,
            subjectiveBaselineDays: baselineDays,
            snapshots,
            checkins,
            activities,
            recommendations,
            trainingSettings,
            preferences,
            intentProfile,
            goals,
        };
        // `activities` was fetched over contextDays (>= windowDays) to feed the fixed
        // 7-day recovery timeline below; the detailed telemetry appendix must not inherit
        // that wider range or a `daily` export would silently regain the per-lap detail
        // W1 exists to drop. Slice explicitly back down to the render window.
        const windowActivities = activities.filter(activity => activity.date >= startDate && activity.date <= targetDate);
        const retrospectiveText = injectActivityTelemetryIntoContextBrief(buildContextBrief(input), windowActivities);
        const text = enhanceContextBriefForPlanning(retrospectiveText, {
            asOfDate: targetDate,
            snapshots,
            checkins,
            activities,
            recommendations,
            trainingSettings,
            preferences,
            effectivePlanningMode: planningContext.mode,
            externalFallback: planningContext.externalFallback,
            externalFallbackUncertain,
            eventStrategy: planningContext.eventStrategy,
            goals,
            upcomingFixedActivities,
            upcomingPlanBlocks,
            upcomingExternalSessions,
            unavailableSources,
        });

        return {
            text,
            startDate,
            asOfDate: targetDate,
            windowDays,
            preset,
            unavailableSources,
        };
    }
}

export const contextBriefService = new ContextBriefService();
