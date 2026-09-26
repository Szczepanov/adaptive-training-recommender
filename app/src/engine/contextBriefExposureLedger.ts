/**
 * Issue #813: read-only exposure ledgers for the planning/diagnostic context brief.
 *
 * Ownership: this module is presentation only. It owns no exposure policy — no cadence,
 * no max-gap, no dose threshold. Two completed-training sources are read, never re-derived:
 * - `reconcileCompletedTrainingEvents` (Garmin + answered adherence, as `buildTrainingHistorySnapshot`
 *   uses it) supplies modality, stimulus intensity, the #809 cost row, the cost vector and the
 *   evidence tier. Athlete reclassifications are layered on top for display only; overridden
 *   rows also print the engine-recorded classification, because the engine ignores overrides.
 * - Canonical performed-training facts (`getPerformedTrainingFactsInRange`, ADR-0034), which
 *   drive live weekly coverage credit, confirm capabilities with their own provenance —
 *   including in-app structured executions that have no Garmin record or adherence answer.
 *
 * Deferred, not modelled here: capability families owned by #801–#806 and the tissue-specific
 * families are reported `unknown` until those canonical models exist; taper/event-specific
 * suppression is not represented yet; `overdue` is never emitted until an authoritative
 * cadence/max-gap policy exists.
 */
import {
    reconcileCompletedTrainingEvents,
    stimulusConfidenceForTier,
} from './completedTraining';
import { resolveInjuryRestrictions } from './injuryPolicy';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type {
    ActivityOverride,
    ActivityStimulusDomain,
    CompletedTrainingEvent,
    DailyRecommendation,
    EvidenceTier,
    GuardrailKey,
    NormalizedGarminActivity,
    SessionTemplate,
    TrainingSettings,
    UserPreferences,
} from './models';
import { normalizeModality } from './performedTrainingFacts';
import type { StimulusConfidence } from './stimulus';
import { grantsPowerExposureCredit } from '../workouts/powerExposure';

export type CapabilityStatus = 'confirmed' | 'planned' | 'unknown' | 'overdue' | 'deliberately_suspended';
type Modality = SessionTemplate['modality'] | 'Unknown';

/** Future sessions from an authoritative plan (imported external plan). Never completed. */
export interface ExposurePlannedSession {
    date: string;
    modality: string;
    intensity: string;
    title: string;
}

export interface ExposureLedgerInput {
    asOfDate: string;
    lookbackStart: string;
    /** Already sliced to [lookbackStart, asOfDate]. */
    activities: readonly NormalizedGarminActivity[];
    recommendations: readonly DailyRecommendation[];
    activitiesReadable: boolean;
    recommendationsReadable: boolean;
    /** null = the override store could not be read (unknown, not "no overrides"). */
    activityOverrides: Readonly<Record<string, ActivityOverride>> | null;
    /** Canonical performed-training facts for [lookbackStart, asOfDate]; null = unreadable. */
    performedFacts: readonly PerformedExposureFact[] | null;
    /** null = the future plan could not be (fully) read. */
    plannedSessions: readonly ExposurePlannedSession[] | null;
    trainingSettings: TrainingSettings | null;
    preferences: UserPreferences | null;
}

export interface StressorEntry {
    date: string;
    modality: Modality;
    family: string;
    stimulus: string;
    sessionCost: string;
    systemic: string;
    mechanical: string;
    provenance: string;
    confidence: StimulusConfidence;
}

export interface CapabilityEntry {
    key: string;
    label: string;
    status: CapabilityStatus;
    lastConfirmed: string | null;
    lastConfirmedProvenance: string | null;
    nextPlanned: string | null;
    note: string | null;
}

export interface ExposureLedger {
    stressors: StressorEntry[];
    activitiesReadable: boolean;
    omittedLowCostSessions: number;
    capabilities: CapabilityEntry[];
    notes: string[];
}

/** Display bound only (issue #813 "compact and bounded"); carries no decision authority. */
export const MAX_STRESSOR_ROWS = 10;
/** Matches the brief's upcoming-plan horizon (`UPCOMING_CONTEXT_DAYS`); display only. */
export const PLANNED_HORIZON_DAYS = 7;

const MECHANICAL_MODALITIES: ReadonlySet<Modality> = new Set<Modality>(['Strength', 'Running', 'Field']);
const AEROBIC_MODALITIES: ReadonlySet<Modality> = new Set<Modality>(['Cycling', 'Running', 'Swimming', 'Cross Training']);
const QUALITY_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set<ActivityStimulusDomain>(['tempo', 'threshold', 'vo2', 'anaerobic', 'race', 'mixed']);

const TIER_PROVENANCE: Record<EvidenceTier, string> = {
    exactPrescribedMatch: 'prescribed session confirmed followed',
    completedStructuredWorkout: 'structured workout log',
    authoredExternal: 'imported plan session',
    measuredEffort: 'Garmin measured effort',
    garminTrainingEffect: 'Garmin Training Effect',
    durationIntensity: 'Garmin duration/intensity tag',
    athleteClassification: 'athlete-reported',
    genericModalityFallback: 'unclassified wearable record',
};

function fmt(value: number): string {
    return value.toFixed(1);
}

function tierOf(event: CompletedTrainingEvent): EvidenceTier {
    return event.evidenceTier ?? 'genericModalityFallback';
}

function provenanceOf(event: CompletedTrainingEvent, override: ActivityOverride | undefined): string {
    const tier = tierOf(event);
    const confidence = stimulusConfidenceForTier(tier);
    const sources = event.sources.join('+');
    if (override) {
        return `athlete reclassified ${override.originalType}/${override.originalIntensityTag || '—'} → `
            + `${override.overriddenModality}/${override.overriddenIntensity} (${sources}; display only — `
            + 'the engine\'s training history still uses the recorded classification)';
    }
    return `${TIER_PROVENANCE[tier]} (${sources}; ${confidence})`;
}

interface ResolvedEvent {
    event: CompletedTrainingEvent;
    /** The engine's own reconciliation of this record (no overrides applied). */
    engineEvent: CompletedTrainingEvent | null;
    activity: NormalizedGarminActivity | null;
    override: ActivityOverride | undefined;
    category: SessionTemplate['category'] | null;
}

function resolveEvents(input: ExposureLedgerInput): ResolvedEvent[] {
    const overrides = input.activityOverrides ?? {};
    const events = reconcileCompletedTrainingEvents(
        [...input.activities],
        [...input.recommendations],
        { activityOverrides: overrides },
    ).filter(event => event.date >= input.lookbackStart && event.date <= input.asOfDate);
    const engineById = new Map(reconcileCompletedTrainingEvents([...input.activities], [...input.recommendations])
        .map(event => [event.id, event]));
    const activityById = new Map(input.activities.map(activity => [activity.activityId, activity]));
    const recommendationByDate = new Map(input.recommendations.map(rec => [rec.date, rec]));
    return events.map(event => {
        const activity = event.linkedActivityId ? activityById.get(event.linkedActivityId) ?? null : null;
        const override = event.linkedActivityId ? overrides[event.linkedActivityId] : undefined;
        const linkedRec = event.exactTemplateMatch && event.linkedRecommendationDate
            ? recommendationByDate.get(event.linkedRecommendationDate) ?? null
            : null;
        return { event, engineEvent: engineById.get(event.id) ?? null, activity, override, category: linkedRec?.category ?? null };
    });
}

/** The #809 stimulus domain, unless an athlete reclassification supersedes the record. */
function domainOf(resolved: ResolvedEvent): ActivityStimulusDomain | null {
    if (resolved.override) return null;
    const domain = resolved.activity?.stimulusDomain;
    return domain && domain !== 'unknown' ? domain : null;
}

function costRowOf(event: CompletedTrainingEvent): string {
    return event.costIntensity ?? event.intensity;
}

function isMeaningful(resolved: ResolvedEvent): boolean {
    const { event } = resolved;
    const domain = domainOf(resolved);
    return event.intensity === 'hard' || costRowOf(event) === 'hard' || MECHANICAL_MODALITIES.has(event.modality)
        || (domain !== null && QUALITY_DOMAINS.has(domain));
}

function familyOf(resolved: ResolvedEvent): string {
    const { event, category } = resolved;
    const domain = domainOf(resolved);
    const modality = event.modality === 'Unknown' ? 'unclassified session' : event.modality.toLowerCase();
    if (event.modality === 'Strength') {
        return category
            ? `strength — ${category} (prescribed template)`
            : 'strength — musculoskeletal load confirmed; exact lower-body dose unknown';
    }
    if (event.modality === 'Running') return 'running — impact exposure';
    if (event.modality === 'Field') return 'field sport — multidirectional/impact exposure (COD dose not modelled)';
    if (domain === 'race') return `${modality} race`;
    if (event.intensity === 'hard' || (domain !== null && QUALITY_DOMAINS.has(domain))) return `${modality} quality`;
    return `${modality} high-dose aerobic — not a high-intensity stimulus`;
}

function stressorOf(resolved: ResolvedEvent): StressorEntry {
    const { event, activity } = resolved;
    const domain = domainOf(resolved);
    const cost = event.estimatedCost;
    const measuredCost = !resolved.override && activity?.sessionCost && activity.sessionCost !== 'unknown'
        ? `${activity.sessionCost.replace('_', ' ')} session cost`
        : `session cost not measured (engine cost row: ${costRowOf(event)})`;
    return {
        date: event.date,
        modality: event.modality,
        family: familyOf(resolved),
        stimulus: `${event.intensity} stimulus${domain ? ` (${domain})` : ''}`,
        sessionCost: measuredCost,
        systemic: `systemic ${fmt(cost.systemic)} · cardiovascular ${fmt(cost.cardiovascular)}`,
        mechanical: `lower-body ${fmt(cost.lowerBody)} · impact ${fmt(cost.impactTissue)} · neuromuscular ${fmt(cost.neuromuscular)}`,
        provenance: resolved.override && resolved.engineEvent
            ? `${provenanceOf(event, resolved.override)}; engine records ${resolved.engineEvent.modality}/${resolved.engineEvent.intensity}, `
                + `cost row ${costRowOf(resolved.engineEvent)}`
            : provenanceOf(event, resolved.override),
        confidence: stimulusConfidenceForTier(tierOf(event)),
    };
}

interface SafetyState {
    known: boolean;
    guardrails: ReadonlySet<GuardrailKey>;
    blockedModalities: ReadonlySet<string>;
}

function resolveSafety(input: ExposureLedgerInput): SafetyState {
    const settings = input.trainingSettings;
    if (!settings) return { known: false, guardrails: new Set(), blockedModalities: new Set() };
    // Same sources renderConstraints prints (settings guardrails + unexpired injuries via the
    // engine's resolver + hard modality exclusions), so the ledger never disagrees with §1.
    const restrictions = resolveInjuryRestrictions(settings.injuries, input.asOfDate);
    const guardrails = new Set<GuardrailKey>([
        ...(Object.entries(settings.guardrails) as [GuardrailKey, boolean][]).filter(([, on]) => on).map(([key]) => key),
        ...restrictions.impliedGuardrails,
    ]);
    const blocked = new Set<string>([...restrictions.restrictedModalities, ...(input.preferences?.unavailableModalities ?? [])]);
    return { known: true, guardrails, blockedModalities: blocked };
}

interface CapabilitySpec {
    key: string;
    label: string;
    confirms: (resolved: ResolvedEvent) => boolean;
    /** Canonical facts carry modality but no stimulus intensity, so quality cannot use them. */
    confirmsFact: (fact: PerformedExposureFact) => boolean;
    plans: (session: ExposurePlannedSession) => boolean;
    suspension: (safety: SafetyState) => string | null;
}

const plannedModality = (session: ExposurePlannedSession): Modality => normalizeModality(session.modality);
const modalityBlocked = (safety: SafetyState, modality: string): string | null =>
    safety.blockedModalities.has(modality) ? `${modality} restricted/unavailable` : null;
const impactBlocked = (safety: SafetyState): string | null =>
    safety.guardrails.has('avoid_high_impact') ? 'high-impact work blocked by an active safety limit' : null;

const CAPABILITIES: readonly CapabilitySpec[] = [
    {
        key: 'aerobic_endurance',
        confirmsFact: f => AEROBIC_MODALITIES.has(f.modality),
        label: 'Aerobic endurance',
        confirms: r => AEROBIC_MODALITIES.has(r.event.modality),
        plans: s => AEROBIC_MODALITIES.has(plannedModality(s)),
        suspension: () => null,
    },
    {
        key: 'cycling_quality',
        confirmsFact: () => false,
        label: 'Cycling quality (tempo+ / race)',
        confirms: r => r.event.modality === 'Cycling'
            && (r.event.intensity === 'hard' || QUALITY_DOMAINS.has(domainOf(r) ?? 'unknown')),
        plans: s => plannedModality(s) === 'Cycling' && s.intensity === 'hard',
        suspension: safety => modalityBlocked(safety, 'Cycling'),
    },
    {
        key: 'strength',
        confirmsFact: f => f.modality === 'Strength',
        label: 'Strength',
        confirms: r => r.event.modality === 'Strength',
        plans: s => plannedModality(s) === 'Strength',
        suspension: safety => modalityBlocked(safety, 'Strength'),
    },
    {
        // Issue #802: only an exact authored power identity at a non-modified dose counts.
        // Garmin records and imported-plan titles cannot prove power content, so they never
        // confirm or plan it; strength/VO2/threshold history leaves power `unknown`.
        key: 'neuromuscular_power',
        confirmsFact: f => grantsPowerExposureCredit({ workoutId: f.workoutId, isReadinessModifiedDose: f.isReadinessModifiedDose }),
        label: 'Neuromuscular power',
        confirms: () => false,
        plans: () => false,
        suspension: safety => modalityBlocked(safety, 'Strength'),
    },
    {
        key: 'running',
        confirmsFact: f => f.modality === 'Running',
        label: 'Running familiarity',
        confirms: r => r.event.modality === 'Running',
        plans: s => plannedModality(s) === 'Running',
        suspension: safety => modalityBlocked(safety, 'Running') ?? impactBlocked(safety),
    },
    {
        key: 'field',
        confirmsFact: f => f.modality === 'Field',
        label: 'Field / multidirectional sport',
        confirms: r => r.event.modality === 'Field',
        plans: s => plannedModality(s) === 'Field',
        suspension: safety => modalityBlocked(safety, 'Field') ?? impactBlocked(safety),
    },
];

/** Families without a canonical exposure model yet. Reported, never inferred. */
const UNMODELLED: ReadonlyArray<{ key: string; label: string; source: string; impact: boolean }> = [
    { key: 'unilateral_lower_body', label: 'Unilateral lower-body', source: '#803', impact: false },
    { key: 'impact_jump', label: 'Impact / jump-land', source: '#804', impact: true },
    { key: 'cod_lateral', label: 'COD / lateral', source: '#805', impact: true },
    { key: 'long_aerobic_anchor', label: 'Long aerobic anchor', source: '#806', impact: false },
    { key: 'hamstring_calf_grip', label: 'Hamstring knee-flexion / calf-soleus / grip-carry', source: 'no issue yet', impact: false },
];

function factProvenance(fact: PerformedExposureFact): string {
    return `canonical performed occurrence (${fact.sourceKinds.join('+')}; ${fact.confidence}`
        + `${fact.category ? `; ${fact.category}` : ''})`;
}

/** Structured/logged sessions the Garmin/adherence path cannot see (no provider record). */
function factOnlyStressors(input: ExposureLedgerInput, events: readonly ResolvedEvent[]): StressorEntry[] {
    return (input.performedFacts ?? [])
        .filter(fact => fact.localDate >= input.lookbackStart && fact.localDate <= input.asOfDate)
        .filter(fact => !fact.sourceKinds.includes('provider_activity') && MECHANICAL_MODALITIES.has(fact.modality))
        .filter(fact => !events.some(r => r.event.date === fact.localDate && r.event.modality === fact.modality))
        .map(fact => ({
            date: fact.localDate,
            modality: fact.modality,
            family: fact.modality === 'Strength'
                ? `strength — ${fact.category ?? 'musculoskeletal load confirmed; exact lower-body dose unknown'}`
                : `${fact.modality.toLowerCase()} — mechanical exposure`,
            stimulus: 'stimulus intensity not carried by the canonical fact',
            sessionCost: 'session cost not estimated here',
            systemic: 'systemic —',
            mechanical: 'mechanical —',
            provenance: factProvenance(fact),
            confidence: fact.confidence === 'exact' ? 'exact' : fact.confidence === 'unknown' ? 'unknown' : 'inferred',
        }));
}

function capabilityEntry(spec: CapabilitySpec, events: readonly ResolvedEvent[], input: ExposureLedgerInput, safety: SafetyState): CapabilityEntry {
    const confirmedEvents = events.filter(spec.confirms);
    const lastEvent = confirmedEvents.length > 0 ? confirmedEvents[confirmedEvents.length - 1] : null;
    const lastFact = (input.performedFacts ?? [])
        .filter(fact => fact.localDate >= input.lookbackStart && fact.localDate <= input.asOfDate && spec.confirmsFact(fact))
        .sort((a, b) => a.localDate.localeCompare(b.localDate))
        .at(-1) ?? null;
    // Canonical facts win a same-day tie: they own live coverage credit and carry exact
    // structured-execution provenance the Garmin/adherence path cannot see.
    const useFact = lastFact !== null && (lastEvent === null || lastFact.localDate >= lastEvent.event.date);
    const lastDate = useFact ? lastFact.localDate : lastEvent?.event.date ?? null;
    const lastProvenance = useFact ? factProvenance(lastFact) : lastEvent ? provenanceOf(lastEvent.event, lastEvent.override) : null;
    const planned = (input.plannedSessions ?? [])
        .filter(session => session.date >= input.asOfDate && spec.plans(session))
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const suspension = spec.suspension(safety);
    const notes: string[] = [];
    if (spec.key === 'strength' && safety.guardrails.has('avoid_heavy_lower_body')) {
        notes.push('heavy lower-body loading suspended by an active safety limit');
    }
    if (spec.key === 'neuromuscular_power' && impactBlocked(safety)) {
        notes.push('impact (plyometric) power suspended by an active safety limit; non-impact power identities remain eligible');
    }
    if (!input.activitiesReadable && !lastDate) notes.push('activity history unreadable');
    let status: CapabilityStatus;
    if (suspension) status = 'deliberately_suspended';
    else if (lastDate) status = 'confirmed';
    else if (planned) status = 'planned';
    else status = 'unknown';
    if (suspension) notes.unshift(suspension);
    return {
        key: spec.key,
        label: spec.label,
        status,
        lastConfirmed: lastDate,
        lastConfirmedProvenance: lastProvenance,
        nextPlanned: planned?.date ?? null,
        note: notes.length > 0 ? notes.join('; ') : null,
    };
}

export function deriveExposureLedger(input: ExposureLedgerInput): ExposureLedger {
    const events = resolveEvents(input);
    const meaningful = events.filter(isMeaningful);
    const safety = resolveSafety(input);
    const capabilities = CAPABILITIES.map(spec => capabilityEntry(spec, events, input, safety));
    for (const family of UNMODELLED) {
        const blocked = family.impact ? impactBlocked(safety) : null;
        capabilities.push({
            key: family.key,
            label: family.label,
            status: blocked ? 'deliberately_suspended' : 'unknown',
            lastConfirmed: null,
            lastConfirmedProvenance: null,
            nextPlanned: null,
            note: blocked ?? `no canonical exposure model yet (${family.source})`,
        });
    }
    const notes: string[] = [];
    if (!input.activitiesReadable) notes.push('Recorded activities were unreadable: completed exposures are unknown, not absent.');
    if (!input.recommendationsReadable) notes.push('Recommendation adherence was unreadable: exact prescribed-session confirmation is unavailable.');
    if (input.performedFacts === null) notes.push('Canonical performed-training facts were unreadable: in-app structured sessions may be missing.');
    if (input.activityOverrides === null) notes.push('Athlete reclassifications were unreadable: rows show the recorded classification.');
    if (input.plannedSessions === null) notes.push('The future plan was not fully readable: `planned` may be incomplete.');
    if (!safety.known) notes.push('Training settings unavailable: safety suspensions are unknown, not absent.');
    return {
        stressors: [...meaningful.map(stressorOf), ...factOnlyStressors(input, events)]
            .sort((a, b) => a.date.localeCompare(b.date)),
        activitiesReadable: input.activitiesReadable,
        omittedLowCostSessions: events.length - meaningful.length,
        capabilities,
        notes,
    };
}

function formatCapability(entry: CapabilityEntry): string {
    const parts = [`${entry.label}: ${entry.status}`];
    if (entry.lastConfirmed) parts.push(`last confirmed ${entry.lastConfirmed} — ${entry.lastConfirmedProvenance}`);
    if (entry.nextPlanned) parts.push(`next planned ${entry.nextPlanned}`);
    if (entry.note) parts.push(entry.note);
    return `- ${parts.join(' · ')}`;
}

export function renderExposureLedger(ledger: ExposureLedger, lookbackStart: string, asOfDate: string): string[] {
    const lines: string[] = [
        '',
        `### Recent meaningful stressors (${lookbackStart} → ${asOfDate})`,
        '',
        'Completed sessions only: Garmin records and answered adherence reconciled as the engine\'s training history does '
            + '(except rows marked athlete-reclassified, which also show the engine-recorded classification), plus canonical '
            + 'performed occurrences such as in-app structured sessions. '
            + 'Listed when the stimulus is high-intensity, the session cost is high, or the modality loads tissue mechanically. '
            + 'Cost vector = engine-estimated 0–1 cost, systemic vs mechanical.',
    ];
    if (ledger.stressors.length === 0) {
        lines.push(ledger.activitiesReadable
            ? '- None recorded in this window.'
            : '- Completed stressors unknown (activities unreadable).');
    } else {
        const shown = ledger.stressors.slice(-MAX_STRESSOR_ROWS);
        for (const s of shown) {
            lines.push(`- ${s.date}: ${s.family} — ${s.stimulus} · ${s.sessionCost} · ${s.systemic} | ${s.mechanical} · ${s.provenance}`);
        }
        const hidden = ledger.stressors.length - shown.length;
        if (hidden > 0) lines.push(`- (${hidden} earlier stressor(s) omitted for brevity)`);
    }
    if (ledger.omittedLowCostSessions > 0) {
        lines.push(`- ${ledger.omittedLowCostSessions} lower-cost, non-impact session(s) omitted (see the table above).`);
    }
    lines.push(
        '',
        '### Physical-capability exposure',
        '',
        `Read-only status. \`confirmed\` = completed in this window; \`planned\` = imported plan session in the next ${PLANNED_HORIZON_DAYS} days only (never counted as done); `
            + '`unknown` = not observed in this window or no canonical model; `deliberately_suspended` = blocked by a current safety limit, not neglect. '
            + 'No authoritative cadence/max-gap policy is wired in, so nothing is reported `overdue`. '
            + 'Not yet represented: taper/event-specific suppression, and the #803–#806 capability models. Neuromuscular power (#802) is confirmed only by an exact authored power identity.',
    );
    for (const entry of ledger.capabilities) lines.push(formatCapability(entry));
    for (const note of ledger.notes) lines.push(`- Note: ${note}`);
    return lines;
}
