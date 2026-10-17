/**
 * PR 2 (ADR-0034): the provider-agnostic occurrence query the Activities UI reads from
 * instead of `activityService.getActivitiesInRange` directly. Hydrates each canonical
 * occurrence's attached sources (structured execution + prescription + entries via
 * `comparePlannedVsPerformed`; the primary Garmin activity as-is) into a
 * `CompletedWorkoutView`. Read-only -- never writes reconciliation state itself (that
 * remains `reconciliationService.ts`'s job).
 */
import { sessionExecutionService } from '../services/sessionExecutionService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { comparePlannedVsPerformed } from '../sessions/performedComparison';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { NormalizedGarminActivity } from '../engine/models';
import type {
    CompletedWorkoutSourceReads,
    CompletedWorkoutView,
    OutboxSnapshot,
    PerformedRestAvailability,
    ProviderSourceRead,
    ReconciliationSweepStatus,
    StructuredSourceRead,
} from './completedWorkoutView';
import { sourceBadgeFor } from './completedWorkoutView';
import { buildStructuredStepDetails } from './structuredSetDetail';
import { compareActivitiesReadModels, recordActivitiesReadModelComparison } from './activitiesReadModelDiagnostics';
import { isProviderActivityRef, isStructuredExecutionRef, type PerformedTrainingOccurrence, type ProviderActivitySourceRef } from './models';
import { sourceKeyForRef } from './sourceIdentity';
import { performedTrainingOccurrenceRepository } from './repository';
import { hydrateOccurrenceSourcesInRange, type HydratedProviderSource } from './occurrenceSourcesHydration';
import {
    fitIdentityEvidenceOf,
    observeFitWorkoutIdentity,
    type FitIdentityEvidence,
    type SingleSourceFitEvidence,
} from './fitWorkoutIdentityDiagnostics';

interface StructuredHydration {
    structured?: CompletedWorkoutView['structured'];
    read: StructuredSourceRead;
    /** True once the execution document itself was read, whatever happened after. */
    executionRead: boolean;
    /** The execution document's own FIT identity, whenever it carries one. */
    executionFitIdentity?: FitIdentityEvidence;
}

/** A denied read is an authorization defect, not a transient source failure: keep failing the
 * whole window (the pre-WP5 contract) instead of rendering it as one row's "unavailable". */
function isPermissionDenied(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === 'permission-denied';
}

/** Every early return names *why* structured detail is missing (#895 WP5); the legacy
 * `undefined` conflated an absent execution, a failed read and an unresolvable definition. */
async function resolveStructuredDetail(
    userId: string,
    executionId: string,
): Promise<StructuredHydration> {
    const executionState = await sessionExecutionService.getExecution(userId, executionId);
    switch (executionState.status) {
        case 'MISSING': return { read: { status: 'execution_missing' }, executionRead: false };
        case 'INVALID': return { read: { status: 'execution_invalid' }, executionRead: false };
        case 'UNAVAILABLE': return { read: { status: 'execution_unavailable' }, executionRead: false };
        case 'AVAILABLE': break;
    }
    const execution = executionState.data;
    const executionFitIdentity = fitIdentityEvidenceOf(execution);
    const fit = { executionRead: true, ...(executionFitIdentity ? { executionFitIdentity } : {}) };

    const definitionState = await resolveSessionDefinition(userId, execution.sessionSource, execution.prescriptionHash);
    if (definitionState.status !== 'AVAILABLE') {
        return { read: { status: 'definition_unresolved', definition: definitionState.status }, ...fit };
    }

    // Performed rest is enrichment: a failed read still renders the sets, just without
    // actual rest -- and is reported as `unavailable`, never as "not recorded".
    const restEventsRead = sessionExecutionService.getRestEvents(userId, executionId).catch(() => null);
    let entries: Awaited<ReturnType<typeof sessionExecutionService.getEntries>>;
    try {
        entries = await sessionExecutionService.getEntries(userId, executionId);
    } catch (error) {
        if (isPermissionDenied(error)) throw error;
        return { read: { status: 'entries_unavailable' }, ...fit };
    }
    const restEvents = await restEventsRead;
    const performedRest: PerformedRestAvailability = restEvents === null
        ? 'unavailable'
        : restEvents.length > 0 ? 'recorded' : 'not_recorded';
    return {
        read: { status: 'available' },
        structured: {
            title: definitionState.data.title,
            comparison: comparePlannedVsPerformed(definitionState.data, entries),
            steps: buildStructuredStepDetails(definitionState.data, entries, restEvents ?? []),
            performedRest,
        },
        ...fit,
    };
}

/** Diary receipts are per-device localStorage; a malformed store throws and must read as
 * unreadable, never as an empty outbox. */
function readOutbox(userId: string, executionId: string): OutboxSnapshot {
    try {
        const receipts = sessionExecutionService.getDiaryReceipts(userId, executionId);
        return {
            status: 'read',
            queued: receipts.filter(receipt => receipt.state === 'queued').length,
            failed: receipts.filter(receipt => receipt.state === 'failed').length,
        };
    } catch {
        return { status: 'unreadable' };
    }
}

function isGarminProvider(provider: string): boolean {
    return provider.toLowerCase() === 'garmin';
}

function providerReadFor(
    providerRefs: readonly ProviderActivitySourceRef[],
    providerSources: readonly HydratedProviderSource[],
    activitiesReadable: boolean,
): ProviderSourceRead {
    if (providerRefs.length === 0) return 'not_linked';
    const garminRefs = providerRefs.filter(ref => isGarminProvider(ref.provider));
    if (garminRefs.length === 0) return 'non_garmin_only';
    if (!activitiesReadable) return 'activities_unreadable';
    const everyGarminRefHydrated = garminRefs.every(ref => providerSources.some(source =>
        isGarminProvider(source.ref.provider) && source.ref.activityId === ref.activityId && source.activity));
    if (providerRefs.length > 1) return everyGarminRefHydrated ? 'multiple_available' : 'multiple_incomplete';
    return everyGarminRefHydrated ? 'available' : 'activity_not_in_read_window';
}

/** Conservative: ambiguous provenance records no candidate ids and marks only the side that
 * was created, so an opposite-kind single-source row within a day of an ambiguous one may be
 * the competing candidate and must not be told "no candidate was found". */
interface AmbiguousProbe {
    performedOccurrenceId: string;
    hasStructured: boolean;
    localDate?: string;
}

/** An ambiguous partner can sit one local day outside the displayed window, where no row is
 * hydrated, so those two edge days are read separately. If that read fails the answer for the
 * rows it could affect is unknown, which is reported as a possible counterpart. */
async function readEdgeAmbiguities(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<{ probes: AmbiguousProbe[]; failed: boolean }> {
    const dayBefore = addDaysToLocalDateString(fromDateInclusive, -1);
    try {
        const [before, after] = await Promise.all([
            performedTrainingOccurrenceRepository.queryActiveInDateWindow(userId, dayBefore, dayBefore),
            performedTrainingOccurrenceRepository.queryActiveInDateWindow(userId, toDateExclusive, toDateExclusive),
        ]);
        return {
            probes: [...before, ...after]
                .filter(occurrence => occurrence.reconciliation.state === 'ambiguous')
                .map(occurrence => ({
                    performedOccurrenceId: occurrence.performedOccurrenceId,
                    hasStructured: sourceBadgeFor(occurrence).hasStructured,
                    localDate: occurrence.localDate,
                })),
            failed: false,
        };
    } catch {
        return { probes: [], failed: true };
    }
}

function withAmbiguousCounterparts(
    views: readonly CompletedWorkoutView[],
    edge: { probes: readonly AmbiguousProbe[]; failed: boolean },
    window: { fromDateInclusive: string; toDateExclusive: string },
): CompletedWorkoutView[] {
    const probes: AmbiguousProbe[] = [
        ...views.filter(view => view.reconciliation.state === 'ambiguous').map(view => ({
            performedOccurrenceId: view.performedOccurrenceId,
            hasStructured: view.sourceBadge.hasStructured,
            localDate: view.localDate,
        })),
        ...edge.probes,
    ];
    const withinOneDay = (a: string | undefined, b: string | undefined): boolean =>
        a === undefined || b === undefined
        || (a >= addDaysToLocalDateString(b, -1) && a <= addDaysToLocalDateString(b, 1));
    const lastDay = addDaysToLocalDateString(window.toDateExclusive, -1);
    // Only a row on the first or last displayed day can have an unseen partner outside the window.
    const touchesEdge = (date: string | undefined): boolean =>
        date === undefined || date <= window.fromDateInclusive || date >= lastDay;
    return views.map(view => {
        if (view.reconciliation.state !== 'single_source') return view;
        const counterpart = (edge.failed && touchesEdge(view.localDate)) || probes.some(other =>
            other.performedOccurrenceId !== view.performedOccurrenceId
            && other.hasStructured !== view.sourceBadge.hasStructured
            && withinOneDay(view.localDate, other.localDate));
        return counterpart ? { ...view, sourceReads: { ...view.sourceReads, ambiguousCounterpart: true } } : view;
    });
}

async function hydrateOccurrence(
    userId: string,
    occurrence: PerformedTrainingOccurrence,
    providerSources: readonly HydratedProviderSource[],
    context: { activitiesReadable: boolean; reconciliationSweep: ReconciliationSweepStatus },
): Promise<CompletedWorkoutView> {
    const structuredRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
    // The domain is provider-neutral and may contain multiple provider sources, but the
    // v1 DTO has a specifically-Garmin telemetry slot. Never treat the first arbitrary
    // provider source as Garmin merely because it happens to precede a Garmin ref.
    // isProviderActivityRef is an explicit type predicate (see models.ts) rather than an
    // inline `ref.kind === '...'` check, so the narrowing survives `.find`/`.filter`
    // across TypeScript toolchains that don't infer it from an arrow-function body.
    const providerRefs = occurrence.sourceRefs.filter(isProviderActivityRef);
    const garminRef = providerRefs.find(ref => ref.provider.toLowerCase() === 'garmin');

    const structuredHydration: StructuredHydration = structuredRef
        ? await resolveStructuredDetail(userId, structuredRef.executionId)
        : { read: { status: 'not_linked' }, executionRead: false };
    const garmin = garminRef
        ? providerSources.find(source => source.ref.provider.toLowerCase() === 'garmin'
            && source.ref.activityId === garminRef.activityId)?.activity
        : undefined;
    const sourceReads: CompletedWorkoutSourceReads = {
        structured: structuredHydration.read,
        provider: providerReadFor(providerRefs, providerSources, context.activitiesReadable),
        outbox: structuredRef ? readOutbox(userId, structuredRef.executionId) : { status: 'not_linked' },
        reconciliationSweep: context.reconciliationSweep,
        ambiguousCounterpart: false,
    };
    // `garmin` is the hydrated document for the Garmin ref only. A lone non-Garmin provider
    // has no document read here, so only its source-link copy can count, never its absence.
    const providerDocumentRead = providerRefs.length === 1 && garmin !== undefined;
    const garminFitIdentity = providerDocumentRead ? fitIdentityEvidenceOf(garmin) : undefined;
    const singleSourceFitEvidence = singleSourceFitEvidenceFor(
        occurrence,
        structuredHydration.executionFitIdentity ?? (structuredRef ? fitIdentityEvidenceOf(structuredRef) : undefined),
        garminFitIdentity ?? (providerRefs.length === 1 ? fitIdentityEvidenceOf(providerRefs[0]) : undefined),
    );

    return {
        performedOccurrenceId: occurrence.performedOccurrenceId,
        sourceKeys: occurrence.sourceRefs.map(sourceKeyForRef),
        localDate: occurrence.localDate,
        modality: occurrence.modality,
        startedAt: occurrence.startedAt,
        endedAt: occurrence.endedAt,
        sourceBadge: sourceBadgeFor(occurrence),
        reconciliation: occurrence.reconciliation,
        structured: structuredHydration.structured,
        garmin,
        garminExerciseSetsAreDiagnosticOnly: !!structuredRef,
        sourceReads,
        fitWorkoutIdentity: observeFitWorkoutIdentity({
            sourceRefs: occurrence.sourceRefs,
            ...(structuredHydration.executionFitIdentity ? { executionDocument: structuredHydration.executionFitIdentity } : {}),
            executionDocumentRead: structuredHydration.executionRead,
            ...(garminFitIdentity ? { providerDocument: garminFitIdentity } : {}),
            providerDocumentRead,
        }),
        ...(singleSourceFitEvidence ? { singleSourceFitEvidence } : {}),
    };
}

/** Only a row with exactly one source has a side to pair (ADR-0051 D7 unlinked-pair count). */
function singleSourceFitEvidenceFor(
    occurrence: PerformedTrainingOccurrence,
    execution: FitIdentityEvidence | undefined,
    recording: FitIdentityEvidence | undefined,
): SingleSourceFitEvidence | undefined {
    if (occurrence.sourceRefs.length !== 1) return undefined;
    const [ref] = occurrence.sourceRefs;
    const side = isStructuredExecutionRef(ref) ? 'structured' : 'provider';
    const evidence = side === 'structured' ? execution : recording;
    return evidence ? { side, ...(occurrence.localDate ? { localDate: occurrence.localDate } : {}), evidence } : undefined;
}

/** The provider-activity fetch window hydration actually needs: one local day wider on
 * either side of the caller's exact range, because a correctly-linked Garmin source can
 * carry an adjacent provider-local date across midnight/travel/timezone boundaries while
 * the canonical occurrence keeps the structured/Warsaw display date. Exported so a caller
 * that also needs Activities for something else (e.g. `historyShadowService.ts`'s live
 * pipeline comparison) can fetch one snapshot covering this same window and pass it into
 * `getCompletedWorkoutsInRange` via `preloadedActivities`, instead of both sides reading
 * Activities independently and risking a diff computed across two different snapshots. */
export function hydrationWindowFor(fromDateInclusive: string, toDateExclusive: string): { from: string; to: string } {
    return {
        from: addDaysToLocalDateString(fromDateInclusive, -1),
        to: addDaysToLocalDateString(toDateExclusive, 1),
    };
}

/** `toDateExclusive`-style range, matching `activityService.getActivitiesInRange` and
 * `repository.queryActiveInDateWindow`'s (inclusive) convention. The canonical occurrence
 * window remains exact; provider hydration reads the wider `hydrationWindowFor` window
 * (activity identity, not that widened date, selects the telemetry attached to each
 * canonical row).
 *
 * `preloadedActivities`, when provided, MUST already cover `hydrationWindowFor(fromDateInclusive,
 * toDateExclusive)` -- passing it skips this function's own Activities fetch entirely, so
 * a caller that needs the same Activities data for another purpose can fetch it once and
 * have both reads observe the identical snapshot. */
export async function getCompletedWorkoutsInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
    preloadedActivities?: readonly NormalizedGarminActivity[],
    options: {
        /** The window sweep outcome the caller observed. Omitted means no sweep ran, so no
         * source was freshly evaluated and "no candidate" cannot be asserted (#895 WP5). */
        reconciliationSweep?: ReconciliationSweepStatus;
    } = {},
): Promise<CompletedWorkoutView[]> {
    const sourceHydration = await hydrateOccurrenceSourcesInRange(userId, fromDateInclusive, toDateExclusive, {
        preloadedActivities,
        activityDatePaddingDays: 1,
    });
    const context = {
        activitiesReadable: sourceHydration.activitiesReadable,
        reconciliationSweep: options.reconciliationSweep ?? 'not_run',
    } as const;
    const [hydrated, edgeAmbiguities] = await Promise.all([
        Promise.all(sourceHydration.rows.map(({ occurrence, providerSources }) =>
            hydrateOccurrence(userId, occurrence, providerSources, context))),
        readEdgeAmbiguities(userId, fromDateInclusive, toDateExclusive),
    ]);
    const views = withAmbiguousCounterparts(hydrated, edgeAmbiguities, { fromDateInclusive, toDateExclusive });
    const sortedViews = views.sort((a, b) => (b.startedAt ?? b.localDate ?? '').localeCompare(a.startedAt ?? a.localDate ?? ''));

    // Own the dual-read comparison where both inputs are guaranteed to be available. The
    // previous UI-level best-effort log could be skipped permanently when this canonical
    // request resolved before the separate raw-activity request. Filter the widened
    // hydration payload back to the caller's exact range so diagnostic counts remain
    // apples-to-apples with the current Activities read model.
    if (sourceHydration.activitiesReadable) {
        const currentRangeActivities = sourceHydration.activities.filter(
            activity => activity.date >= fromDateInclusive && activity.date < toDateExclusive,
        );
        recordActivitiesReadModelComparison(
            userId,
            compareActivitiesReadModels(currentRangeActivities, sortedViews),
        );
    }

    return sortedViews;
}
