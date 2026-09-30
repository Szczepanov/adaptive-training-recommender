import type {
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    ExternalPlanSession as LegacyExternalPlanSession,
} from '../engine/models';
import {
    briefPurposeFor,
    briefWindowDaysFor,
    briefWindowStart,
    buildContextBrief,
    defaultBriefWindowDays,
    SUBJECTIVE_BASELINE_DAYS,
    type BodyCompositionBriefInput,
    type BriefPurpose,
    type BriefWindowPreset,
    type ContextBriefInput,
} from '../engine/contextBrief';
import { METRIC_DISPLAY_LABELS, type AnthropometryEntry } from '../anthropometry/models';
import {
    computeBodyMassTrend,
    computeCircumferenceTrends,
    computeProviderCompositionSummary,
    reduceDailyManualBodyMass,
    reduceDailyProviderBodyMass,
    type ProviderCompositionRecord,
    type RawProviderWeightRecord,
} from '../anthropometry/trends';
import { injectActivityTelemetryIntoContextBrief } from '../engine/contextBriefActivityTelemetry';
import { getTrainingResponseEvidenceInRange } from '../training-occurrence/trainingResponseEvidence';
import { SENSOR_OBSERVATION_HORIZON_DAYS } from '../engine/contextBriefSensorEvidence';
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
import { activeExternalPlanService, externalRestContextForDate, placedSessionForDate } from './activeExternalPlanService';
import type { BriefRestDirective } from '../engine/briefPlanAuthority';
import { activityOverrideService } from './activityOverrideService';
import { getPerformedTrainingFactsInRange } from '../training-occurrence/performedTrainingFactsService';
import { performedTrainingOccurrenceRepository } from '../training-occurrence/repository';
import { projectPlannedExecutionStatus, type PlannedExecutionStatus } from '../training-occurrence/plannedExecutionStatus';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { sessionExecutionService } from './sessionExecutionService';
import { externalPlanService } from './externalPlanService';
import { computeContentHash } from '../engine/externalPlanHash';
import { impliedDate, resolveRestDatesByDate } from '../engine/externalPlacement';
import { isExternalPlanOccurrence } from '../sessions/models';
import {
    assertRenderedBriefContract,
    CONTEXT_BRIEF_CONTRACT_VERSION,
} from '../engine/contextBriefContract';
import type { PerformedExposureFact } from '../engine/performedTrainingFacts';
import type { CapabilityMaintenanceResult } from '../engine/capabilityMaintenance';
import { activityService } from './activityService';
import { anthropometryService } from './anthropometryService';
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
    /** Issue #811: the consumer intent the preset maps to (morning / planning / diagnostic). */
    purpose: BriefPurpose;
    /** Issue #894: versioned contract identity rendered into `text`. */
    contractVersion: string;
    /** Sources that could not be read. The brief still renders; it says what is missing
     * rather than presenting a partial window as complete. */
    unavailableSources: string[];
}

function lastNCalendarDates(endDateInclusive: string, days: number): string[] {
    return Array.from({ length: days }, (_, i) => addDaysToLocalDateString(endDateInclusive, -(days - 1 - i)));
}

/**
 * Summarizes anthropometry entries and the provider-sourced weight/body-fat fields already
 * present on `snapshots` into the plain, pre-computed shape `buildContextBrief` renders.
 * Trend math is reused from `anthropometry/trends.ts` rather than duplicated here — that
 * reuse is only safe in this file because it lives outside `engine/`, which ADR-0039
 * D-BC-AUTH bars from importing anthropometry at all.
 */
export function buildBodyCompositionBriefInput(
    targetDate: string,
    entries: readonly AnthropometryEntry[],
    snapshots: readonly DailyRecoverySnapshot[],
): BodyCompositionBriefInput {
    // Dated by `source.metricDates.weight` (the Garmin-reported weigh-in date), not by the
    // snapshot's own `date`: Garmin can echo the same weigh-in onto several consecutive
    // daily snapshots when no fresh reading exists. Keying on the snapshot date would let
    // one stale reading masquerade as several distinct recorded days, falsely satisfying
    // the 4-of-7 coverage floor `computeBodyMassTrend`/`computeProviderCompositionSummary`
    // require and producing a fabricated week-over-week trend. An entry with no recorded
    // metric date carries no provenance and is omitted rather than defaulted to the
    // snapshot date, which would silently reintroduce the same failure mode. Weight and
    // body-fat % come from the same weigh-in, so they share one date field.
    const providerWeightRecords: RawProviderWeightRecord[] = snapshots
        .filter(s => typeof s.raw.weightKg === 'number' && s.raw.weightKg > 0 && s.source.metricDates?.weight)
        .map(s => ({ date: s.source.metricDates!.weight as string, weightKg: s.raw.weightKg as number }));
    const providerCompositionRecords: ProviderCompositionRecord[] = snapshots
        .filter(s => typeof s.raw.bodyFatPct === 'number' && s.raw.bodyFatPct > 0 && s.source.metricDates?.weight)
        .map(s => ({ date: s.source.metricDates!.weight as string, bodyFatPct: s.raw.bodyFatPct }));

    const manualPoints = reduceDailyManualBodyMass(entries);
    const providerPoints = reduceDailyProviderBodyMass(providerWeightRecords);
    const current7dDates = lastNCalendarDates(targetDate, 7);
    const prior7dDates = lastNCalendarDates(addDaysToLocalDateString(targetDate, -7), 7);
    const trendDates = new Set([...prior7dDates, ...current7dDates]);
    const providerHasTrendData = Array.from(providerPoints.keys()).some(date => trendDates.has(date));
    const manualHasTrendData = Array.from(manualPoints.keys()).some(date => trendDates.has(date));

    // Keep a single source for the whole trend: provider wins when it has usable data in
    // the 14-day comparison horizon, otherwise current manual data is the fallback. A
    // provider point that is only a stale carry-forward must not suppress a fresh manual
    // series. If neither source has current-horizon data, retain provider-first historical
    // fallback so the latest dated observation remains deterministic without splicing.
    const effectiveSource: 'provider' | 'manual' | null = providerHasTrendData
        ? 'provider'
        : manualHasTrendData
            ? 'manual'
            : providerPoints.size > 0
                ? 'provider'
                : manualPoints.size > 0 ? 'manual' : null;

    let bodyMass: BodyCompositionBriefInput['bodyMass'] = null;
    if (effectiveSource) {
        const points = effectiveSource === 'provider' ? providerPoints : manualPoints;
        const trend = computeBodyMassTrend(effectiveSource, current7dDates, prior7dDates, points);
        bodyMass = {
            source: effectiveSource,
            latestKg: trend.latestPoint?.weightKg ?? null,
            latestDate: trend.latestPoint?.date ?? null,
            current7dMeanKg: trend.current7d.meanWeightKg,
            prior7dMeanKg: trend.prior7d.meanWeightKg,
            weekOverWeekKg: trend.weekOverWeekAbsoluteKg,
            weekOverWeekPercent: trend.weekOverWeekPercent,
        };
    }

    const circumferences = Array.from(computeCircumferenceTrends(entries).values())
        .filter(trend => trend.latestPoint !== null)
        .sort((a, b) => a.metricId.localeCompare(b.metricId) || a.laterality.localeCompare(b.laterality))
        .map(trend => {
            const latest = trend.latestPoint!;
            const label = METRIC_DISPLAY_LABELS[trend.metricId] ?? trend.metricId;
            return {
                label: trend.laterality === 'unspecified' ? label : `${label} (${trend.laterality})`,
                latestCm: latest.value,
                latestDate: latest.date,
                deltaCm: trend.deltaCm,
                repeatabilityWarning: latest.repeatabilityWarning,
            };
        });

    const providerComposition = computeProviderCompositionSummary(providerCompositionRecords, current7dDates);
    const bodyFatPct: BodyCompositionBriefInput['bodyFatPct'] = providerComposition.latestBodyFatPct !== null
        ? {
            latestPct: providerComposition.latestBodyFatPct,
            latestDate: providerComposition.latestDate,
            mean7dPct: providerComposition.mean7d,
            recordedDays7d: providerComposition.recordedDays7d,
        }
        : null;

    return { bodyMass, circumferences, bodyFatPct };
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
        capabilityMaintenance?: CapabilityMaintenanceResult | null,
    ): Promise<ContextBriefResult> {
        const targetDate = asOfDate ?? getLocalDateString();
        // Purpose selects the output contract. Planning and diagnostic deliberately share
        // identical reads; the morning path skips planning-only ledgers and additionally
        // resolves D-1 imported authority for its closed-loop adherence debrief.
        const purpose = briefPurposeFor(preset);
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
        // Issue #816: activities reach back over the sensor-evidence horizon too, so the
        // observed-telemetry block's 28-day/stale labels describe data actually fetched.
        // Every other consumer slices activities to its own window (buildContextBrief
        // `filterRange`, the telemetry appendix `windowActivities`, the dated handoff views).
        const activityStart = [contextStart, briefWindowStart(targetDate, SENSOR_OBSERVATION_HORIZON_DAYS)].sort()[0];
        // Provider-local activity dates may fall one calendar day either side of the
        // canonical Warsaw occurrence date. Widen this one existing read so response
        // evidence can hydrate boundary occurrences without issuing another Garmin query.
        const activityFetchStart = addDaysToLocalDateString(activityStart, -1);
        // Activity and recommendation range queries are end-exclusive; the brief window
        // is inclusive of targetDate, so the fetch reaches one day further.
        const throughExclusive = addDaysToLocalDateString(targetDate, 1);
        const activityThroughExclusive = addDaysToLocalDateString(throughExclusive, 1);
        const upcomingEndDate = addDaysToLocalDateString(targetDate, UPCOMING_CONTEXT_DAYS - 1);
        const upcomingDates = Array.from(
            { length: UPCOMING_CONTEXT_DAYS },
            (_, offset) => addDaysToLocalDateString(targetDate, offset),
        );
        // Morning closed-loop debrief needs yesterday's imported authority as well as
        // D0..D+6 future placement. Planning/diagnostic keep their existing read set.
        const yesterdayPlanDate = addDaysToLocalDateString(targetDate, -1);
        const externalPlanDates = purpose === 'morning'
            ? [yesterdayPlanDate, ...upcomingDates]
            : upcomingDates;
        // External-plan placement spreads flexible sessions within their whole plan week.
        // A fixed activity just before or after the 7-day handoff horizon can therefore
        // change which date a session resolves onto inside the horizon. Six calendar days
        // of padding on both sides fully covers every Monday-Sunday plan week intersecting
        // the handoff, without requiring timezone-sensitive weekday arithmetic here.
        const placementOccupancyStart = addDaysToLocalDateString(targetDate, -6);
        const placementOccupancyEnd = addDaysToLocalDateString(upcomingEndDate, 6);
        const unavailableSources: string[] = [];

        // Wider than baselineDays: tape measurements and manual body-mass entries are
        // typically logged weekly or less often, not daily, so a "previous reading" delta
        // needs real lookback rather than the subjective baseline's 28-day floor.
        const ANTHROPOMETRY_LOOKBACK_DAYS = 60;
        const anthropometryStart = briefWindowStart(targetDate, ANTHROPOMETRY_LOOKBACK_DAYS);

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
            anthropometryResult,
            bodyCompositionSnapshotResult,
            overrideResult,
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
            activityService.getActivitiesInRange(userId, activityFetchStart, activityThroughExclusive),
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
            // Zero recommendation authority (ADR-0039 D-BC-AUTH): fetched here for the
            // service-computed summary handed to the brief, never for engine decisions.
            anthropometryService.getEntriesInRange(userId, anthropometryStart, targetDate),
            // A separate, wider range query rather than reusing `snapshots`: that array is
            // bounded by `contextDays` (as little as RECOVERY_TIMELINE_DAYS = 7 for the
            // `daily` preset), but a provider weigh-in can be as sparse as manual tape
            // measurements, which is exactly why anthropometry entries get the full
            // ANTHROPOMETRY_LOOKBACK_DAYS. Reusing the short array would make a real
            // provider reading 8-60 days old invisible to body composition and silently
            // fall back to manual data (or omit the reading entirely).
            recoverySnapshotService.getRecoverySnapshotsInRangeState(userId, anthropometryStart, throughExclusive),
            // Issue #813: exposure-ledger inputs, bounded to the render window and not read at
            // all for the morning brief, which does not render the ledgers.
            purpose === 'morning' ? Promise.resolve(null) : activityOverrideService.getOverridesSinceState(userId, startDate),
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
        const unreadableCheckinDates: string[] = [];
        let undatedUnreadableCheckins = 0;
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
                else {
                    invalidCheckins += 1;
                    if (typeof rawCheckin?.date === 'string') unreadableCheckinDates.push(rawDate);
                    else undatedUnreadableCheckins += 1;
                }
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

        const recommendationsReadable = recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE';
        const recommendations = recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE'
            ? recommendationResult.value.data
            : [];
        if (!recommendationsReadable) {
            unavailableSources.push('recommendations and feedback');
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

        const bodyCompositionSnapshots = bodyCompositionSnapshotResult.status === 'fulfilled'
            && bodyCompositionSnapshotResult.value.status === 'AVAILABLE'
            ? bodyCompositionSnapshotResult.value.data
            : [];
        const bodyCompositionSnapshotsReadable = bodyCompositionSnapshotResult.status === 'fulfilled'
            && ['AVAILABLE', 'MISSING'].includes(bodyCompositionSnapshotResult.value.status);
        const bodyComposition = buildBodyCompositionBriefInput(
            targetDate,
            anthropometryResult.status === 'fulfilled' ? anthropometryResult.value : [],
            bodyCompositionSnapshots,
        );
        if (anthropometryResult.status !== 'fulfilled' || !bodyCompositionSnapshotsReadable) {
            unavailableSources.push('body measurements');
        }

        const upcomingExternalSessions: UpcomingExternalPlanSession[] = [];
        let currentExternalSession: AnyExternalPlanSession | null = null;
        let yesterdayExternalSession: UpcomingExternalPlanSession | null = null;
        let restDirectiveToday: BriefRestDirective | null = null;
        let restDirectiveYesterday: BriefRestDirective | null = null;
        // Whether "no session placed today" can be asserted as a confirmed fact. Starts
        // false whenever occupancy itself is unreadable (the else branch below), and is
        // also cleared if today's own plan-state read specifically fails, so a resolved
        // `externalFallback: true` downstream is never presented as certain when the day
        // that mattered most could not actually be read.
        let externalScheduleTodayConfirmed = fixedActivitiesReadable;
        let planScheduleFullyRead = fixedActivitiesReadable;
        if (fixedActivitiesReadable) {
            // Resolve the active plan independently for each future date so plan revision
            // effective-from boundaries and overlapping re-imports are respected. Use the
            // padded occupancy set above, not only visible future commitments, because an
            // earlier/later fixed day in the same plan week can move a flexible session.
            const activePlanResults = await Promise.allSettled(
                externalPlanDates.map(date => activeExternalPlanService.getActivePlanState(userId, date, placementFixedActivities)),
            );
            let unreadablePlanDays = 0;
            for (let index = 0; index < activePlanResults.length; index++) {
                const date = externalPlanDates[index];
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
                if (date === yesterdayPlanDate && purpose === 'morning') {
                    const primary = placedSessionForDate(state.data, date);
                    if (primary) {
                        yesterdayExternalSession = {
                            date,
                            planId: state.data.header.planId,
                            planTitle: state.data.header.title,
                            revision: state.data.header.revision,
                            sessionId: primary.session.id,
                            title: primary.session.title,
                            priority: primary.session.priority,
                            modality: primary.session.gating.modality,
                            intensity: primary.session.gating.intensity,
                            durationMin: primary.session.gating.durationMin,
                            durationMax: primary.session.gating.durationMax,
                            flexibility: primary.session.placement.flexibility,
                            status: primary.status === 'moved' ? 'moved' : 'planned',
                            moved: primary.moved,
                            isEvent: primary.session.isEvent === true,
                            prescription: externalSessionDisplayPrescription(primary.session),
                        };
                    }
                    const rest = externalRestContextForDate(state.data, date);
                    restDirectiveYesterday = rest
                        ? { planId: rest.planId, revision: rest.revision, restDirectiveId: rest.directive.id }
                        : null;
                }
                if (date === targetDate) {
                    currentExternalSession = placedSessionForDate(state.data, date)?.session ?? null;
                    const rest = externalRestContextForDate(state.data, date);
                    restDirectiveToday = rest
                        ? { planId: rest.planId, revision: rest.revision, restDirectiveId: rest.directive.id }
                        : null;
                }
                if (date < targetDate) continue;
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
                planScheduleFullyRead = false;
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

        // Issue #813: canonical performed facts (ADR-0034) drive live coverage credit, including
        // in-app structured executions with no Garmin record. Hydration reuses the activities
        // already read above. Readability is carried separately (`activitiesReadable`): the
        // facts service itself cannot tell an unreadable activity read from none.
        let performedFacts: PerformedExposureFact[] | null = null;
        if (purpose !== 'morning') {
            try {
                performedFacts = (await getPerformedTrainingFactsInRange(userId, startDate, throughExclusive, {
                    preloadedActivities: activities.filter(activity => activity.date >= startDate && activity.date <= targetDate),
                })).exposures;
            } catch (error) {
                console.warn('Context brief: performed-training facts unreadable', error);
                unavailableSources.push('canonical performed-training facts');
            }
        }

        let plannedExecutionStatuses: readonly PlannedExecutionStatus[] | null | undefined;
        if (purpose === 'planning') {
            const retrospectiveDates = Array.from({ length: windowDays }, (_, offset) =>
                addDaysToLocalDateString(startDate, offset));
            const [occurrenceResult, executionResult, performedResult, authoredPlanResults] = await Promise.allSettled([
                sessionOccurrenceService.getOccurrencesInRangeState(userId, startDate, targetDate),
                sessionExecutionService.getExecutionsInRange(userId, startDate, throughExclusive),
                performedTrainingOccurrenceRepository.queryActiveInDateWindow(userId, startDate, targetDate),
                fixedActivitiesReadable
                    ? Promise.all(retrospectiveDates.map(date => activeExternalPlanService.getActivePlanState(userId, date, placementFixedActivities)))
                    : Promise.resolve([]),
            ]);
            const executionsReadable = executionResult.status === 'fulfilled' && executionResult.value.invalidRecords === 0;
            const performedReadable = performedResult.status === 'fulfilled';
            const authoredPlansReadable = fixedActivitiesReadable && authoredPlanResults.status === 'fulfilled'
                && authoredPlanResults.value.every(state => state.status === 'AVAILABLE' || state.status === 'MISSING');
            if (occurrenceResult.status !== 'fulfilled' || occurrenceResult.value.status !== 'AVAILABLE'
                || !executionsReadable || !performedReadable || !recommendationsReadable || !authoredPlansReadable) {
                plannedExecutionStatuses = null;
                unavailableSources.push('external-plan execution round-trip inputs');
            } else {
                const occurrences = occurrenceResult.value.data;
                const executions = executionResult.value.executions;
                const performedOccurrences = performedResult.value;
                const authoredPlans = authoredPlanResults.value;
                const candidates = new Map<string, {
                    date: string;
                    source: { planId: string; revision: number; sessionId: string; contentHash: string };
                    occurrenceId?: string;
                    placementConfirmedMoved?: boolean;
                }>();
                const keyFor = (date: string, source: { planId: string; revision: number; sessionId: string; contentHash: string }, occurrenceId?: string) =>
                    `${date}|${source.planId}|${source.revision}|${source.sessionId}|${source.contentHash}|${occurrenceId ?? ''}`;
                for (const occurrence of occurrences) {
                    if (!isExternalPlanOccurrence(occurrence)) continue;
                    candidates.set(keyFor(occurrence.date, occurrence.externalPlanRef, occurrence.occurrenceId), {
                        date: occurrence.date, source: occurrence.externalPlanRef, occurrenceId: occurrence.occurrenceId,
                    });
                }
                const activeRestStatuses: PlannedExecutionStatus[] = [];
                for (let index = 0; index < authoredPlans.length; index += 1) {
                    const date = retrospectiveDates[index];
                    const state = authoredPlans[index];
                    if (state.status !== 'AVAILABLE') {
                        if (performedOccurrences.some(item => item.status === 'active' && item.localDate === date)) {
                            activeRestStatuses.push(projectPlannedExecutionStatus({
                                date, authored: { kind: 'none' }, occurrencesReadable: true, executionsReadable: true,
                                performedReadable: true, occurrences, recommendations, executions, performedOccurrences,
                            }));
                        }
                        continue;
                    }
                    const active = state.data;
                    for (const placed of active.placed.filter(item => item.date === date)) {
                        const source = {
                            planId: active.plan.planId, revision: active.plan.revision,
                            sessionId: placed.session.id, contentHash: active.header.contentHash,
                        };
                        const exactOccurrences = occurrences.filter(item => isExternalPlanOccurrence(item)
                            && item.date === date && item.externalPlanRef.planId === source.planId
                            && item.externalPlanRef.revision === source.revision && item.externalPlanRef.sessionId === source.sessionId
                            && item.externalPlanRef.contentHash === source.contentHash);
                        for (const occurrence of exactOccurrences.length > 0 ? exactOccurrences : [undefined]) {
                            const candidateKey = keyFor(date, source, occurrence?.occurrenceId);
                            candidates.set(candidateKey, {
                                date, source, ...(occurrence ? { occurrenceId: occurrence.occurrenceId } : {}),
                            });
                        }
                    }
                    const rest = externalRestContextForDate(active, date);
                    if (rest) activeRestStatuses.push(projectPlannedExecutionStatus({
                        date,
                        authored: { kind: 'rest', planId: rest.planId, revision: rest.revision, restDirectiveId: rest.directive.id },
                        occurrencesReadable: true, executionsReadable: true, performedReadable: true,
                        occurrences, recommendations, executions, performedOccurrences,
                    }));
                    else if (!active.placed.some(item => item.date === date)
                        && performedOccurrences.some(item => item.status === 'active' && item.localDate === date)) {
                        activeRestStatuses.push(projectPlannedExecutionStatus({
                            date, authored: { kind: 'none' }, occurrencesReadable: true, executionsReadable: true,
                            performedReadable: true, occurrences, recommendations, executions, performedOccurrences,
                        }));
                    }
                }
                for (const recommendation of recommendations) {
                    const source = recommendation.recommendationAudit?.externalPlan;
                    if (!source) continue;
                    const occurrenceId = recommendation.recommendationAudit?.primarySession?.occurrenceId;
                    const hasOccurrence = [...candidates.values()].some(candidate => candidate.date === recommendation.date
                        && candidate.source.planId === source.planId && candidate.source.revision === source.revision
                        && candidate.source.sessionId === source.sessionId && candidate.source.contentHash === source.contentHash);
                    if (!occurrenceId && hasOccurrence) continue;
                    const key = keyFor(recommendation.date, source, occurrenceId);
                    candidates.set(key, {
                        date: recommendation.date, source,
                        ...(occurrenceId ? { occurrenceId } : {}),
                    });
                }
                const revisionKeys = [...new Set([...candidates.values()].map(item => `${item.source.planId}:${item.source.revision}`))];
                const revisions = await Promise.all(revisionKeys.map(async key => {
                    const [planId, revision] = key.split(':');
                    return [key, await externalPlanService.getRevisionState(userId, planId, Number(revision))] as const;
                }));
                const revisionMap = new Map(revisions);
                const placements = await Promise.all(revisionKeys.map(async key => {
                    const [planId, revision] = key.split(':');
                    return [key, await externalPlanService.getPlacementState(userId, planId, Number(revision))] as const;
                }));
                const placementMap = new Map(placements);
                const sessionStatuses = await Promise.all([...candidates.values()].map(async candidate => {
                    const revisionKey = `${candidate.source.planId}:${candidate.source.revision}`;
                    const revisionState = revisionMap.get(`${candidate.source.planId}:${candidate.source.revision}`);
                    const revisionPlan = revisionState?.status === 'AVAILABLE' ? revisionState.data : undefined;
                    const session = revisionPlan
                        ? revisionPlan.sessions.find(item => item.id === candidate.source.sessionId)
                        : undefined;
                    const revisionHash = revisionPlan
                        ? await computeContentHash(revisionPlan)
                        : undefined;
                    const revisionMatchesSource = revisionHash === candidate.source.contentHash;
                    const authoredDate = revisionPlan && revisionMatchesSource && session
                        ? impliedDate(revisionPlan, session)
                        : undefined;
                    const placementState = placementMap.get(revisionKey);
                    const placementAssignment = placementState?.status === 'AVAILABLE'
                        ? placementState.data.assignments.find(item => item.sessionId === candidate.source.sessionId && item.date === candidate.date)
                        : undefined;
                    return projectPlannedExecutionStatus({
                        date: candidate.date,
                        authored: revisionMatchesSource && session
                            ? { kind: 'session', source: candidate.source }
                            : { kind: 'unknown', reason: 'immutable plan revision could not be verified' },
                        ...(authoredDate ? { authoredDate } : {}),
                        ...(candidate.occurrenceId ? { occurrenceId: candidate.occurrenceId } : {}),
                        ...(candidate.placementConfirmedMoved || placementAssignment?.status === 'moved' ? { placementConfirmedMoved: true } : {}),
                        occurrencesReadable: true,
                        executionsReadable: true,
                        performedReadable: true,
                        occurrences,
                        recommendations,
                        executions,
                        performedOccurrences,
                    });
                }));
                const restKeys = new Set(activeRestStatuses.flatMap(status => status.authored.kind === 'rest'
                    ? [`${status.date}|${status.authored.planId}|${status.authored.revision}|${status.authored.restDirectiveId}`]
                    : []));
                const restStatuses: PlannedExecutionStatus[] = [];
                for (const recommendation of recommendations) {
                    const rest = recommendation.recommendationAudit?.externalRest;
                    if (!rest) continue;
                    const key = `${recommendation.date}|${rest.planId}|${rest.revision}|${rest.restDirectiveId}`;
                    const revisionState = await externalPlanService.getRevisionState(userId, rest.planId, rest.revision);
                    const revisionPlan = revisionState.status === 'AVAILABLE' ? revisionState.data : undefined;
                    const hashMatches = revisionPlan && await computeContentHash(revisionPlan) === rest.contentHash;
                    const directive = hashMatches ? resolveRestDatesByDate(revisionPlan).get(recommendation.date) : undefined;
                    if (restKeys.has(key)) continue;
                    if (rest.date === recommendation.date && directive?.id === rest.restDirectiveId) {
                        restKeys.add(key);
                        restStatuses.push(projectPlannedExecutionStatus({
                        date: recommendation.date,
                        authored: {
                            kind: 'rest', planId: rest.planId, revision: rest.revision,
                            restDirectiveId: rest.restDirectiveId,
                        },
                        occurrencesReadable: true,
                        executionsReadable: true,
                        performedReadable: true,
                        occurrences,
                        recommendations,
                        executions,
                        performedOccurrences,
                        }));
                    } else {
                        restStatuses.push(projectPlannedExecutionStatus({
                            date: recommendation.date,
                            authored: { kind: 'unknown', reason: 'rest provenance did not match the immutable plan revision' },
                            occurrencesReadable: true, executionsReadable: true, performedReadable: true,
                            occurrences, recommendations, executions, performedOccurrences,
                        }));
                    }
                }
                plannedExecutionStatuses = [...sessionStatuses, ...activeRestStatuses, ...restStatuses];
            }
        }

        const generatedAt = new Date().toISOString();
        const input: ContextBriefInput = {
            asOfDate: targetDate,
            windowDays,
            subjectiveBaselineDays: baselineDays,
            snapshots,
            checkins,
            activities,
            recommendations,
            recommendationsReadable,
            trainingSettings,
            preferences,
            intentProfile,
            goals,
            bodyComposition,
            purpose,
            generatedAt,
            plannedExecutionStatuses,
            effectivePlanningMode: planningContext.mode,
            isExternalPlanAuthority: planningContext.mode === 'externally_planned' || planningContext.externalFallback,
            exposureLedger: {
                activitiesReadable: activityResult.status === 'fulfilled' && activityResult.value.status === 'AVAILABLE',
                recommendationsReadable: recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE',
                activityOverrides: overrideResult.status === 'fulfilled' && overrideResult.value?.status === 'AVAILABLE'
                    ? overrideResult.value.data
                    : null,
                // Readability is carried separately: the facts service itself turns an
                // unreadable activity read into [], so `activitiesReadable` stays authoritative.
                performedFacts,
                // Planned status is only as complete as the plan reads that produced it.
                plannedSessions: planScheduleFullyRead
                    ? upcomingExternalSessions.map(session => ({
                        date: session.date, modality: session.modality, intensity: session.intensity, title: session.title,
                    }))
                    : null,
                capabilityMaintenance,
            },
        };
        const responseEvidence = purpose === 'morning' ? null : await getTrainingResponseEvidenceInRange(
            userId,
            activityStart,
            throughExclusive,
            activities,
            activityResult.status === 'fulfilled' && activityResult.value.status === 'AVAILABLE'
                ? 'available'
                : 'unavailable',
        );
        if (responseEvidence?.occurrenceRead === 'unavailable') {
            unavailableSources.push('canonical response occurrence evidence');
        }
        // `activities` was fetched over contextDays (>= windowDays) to feed the fixed
        // 7-day recovery timeline below; the detailed telemetry appendix must not inherit
        // that wider range or a `daily` export would silently regain the per-lap detail
        // W1 exists to drop. Slice explicitly back down to the render window.
        const windowActivities = activities.filter(activity => activity.date >= startDate && activity.date <= targetDate);
        const retrospectiveText = injectActivityTelemetryIntoContextBrief(
            buildContextBrief(input),
            windowActivities,
            purpose !== 'diagnostic',
            // Issue #814: comparable prior sessions are searched in the full fetched
            // activity range (activityStart, at least the 28-day sensor horizon), and
            // next-day linkage uses the fetched check-ins. A failed read is passed as null
            // and invalid records by date, so neither reads as "no check-in". The morning
            // export is rebuilt by buildMorningCoachBrief and never shows this text, so
            // the features are not derived for it.
            purpose === 'morning' ? undefined : {
                history: activities.filter(activity => activity.date >= activityStart && activity.date < throughExclusive),
                historyStart: activityStart,
                checkins: checkinResult.status === 'fulfilled'
                    ? { records: checkins, unreadableDates: unreadableCheckinDates, undatedUnreadable: undatedUnreadableCheckins }
                    : null,
                asOfDate: targetDate,
                windowStart: startDate,
                windowEnd: targetDate,
                evidence: responseEvidence?.evidence,
                diagnostic: purpose === 'diagnostic',
            },
        );
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
            recommendationsReadable: recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE',
            restDirectiveToday,
            yesterdayExternalSession,
            restDirectiveYesterday,
            unavailableSources,
            preset,
            purpose,
            generatedAt,
        });

        assertRenderedBriefContract(text, {
            purpose,
            asOfDate: targetDate,
            generatedAt,
        });

        return {
            text,
            startDate,
            asOfDate: targetDate,
            windowDays,
            preset,
            purpose,
            contractVersion: CONTEXT_BRIEF_CONTRACT_VERSION,
            unavailableSources,
        };
    }
}

export const contextBriefService = new ContextBriefService();
