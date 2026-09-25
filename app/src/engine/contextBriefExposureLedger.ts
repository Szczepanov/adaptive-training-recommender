/**
 * Issue #813: read-only exposure ledgers for the planning/diagnostic context brief.
 *
 * Ownership: this module is presentation only. It owns no exposure policy — no cadence,
 * no max-gap, no dose threshold. Completed sessions come from the engine's own
 * `reconcileCompletedTrainingEvents` (the same Garmin + answered-adherence reconciliation
 * that feeds live training history), so modality, stimulus intensity, the #809 cost row,
 * the six-dimensional cost vector and the evidence tier are the engine's values, not a
 * second classification. Capability families without a canonical model (#801–#806 and
 * the tissue-specific families) are reported as `unknown`, never inferred from titles.
 * `overdue` exists in the vocabulary but is never emitted until an authoritative
 * cadence/max-gap policy exists to consume.
 */
import {
    reconcileCompletedTrainingEvents,
    stimulusConfidenceForTier,
} from './completedTraining';
import { resolveInjuryRestrictions } from './injuryPolicy';
import type {
    ActivityOverride,
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
    omittedLowCostSessions: number;
    capabilities: CapabilityEntry[];
    notes: string[];
}

/** Display bound only (issue #813 "compact and bounded"); carries no decision authority. */
export const MAX_STRESSOR_ROWS = 10;

const MECHANICAL_MODALITIES: ReadonlySet<Modality> = new Set<Modality>(['Strength', 'Running', 'Field']);
const AEROBIC_MODALITIES: ReadonlySet<Modality> = new Set<Modality>(['Cycling', 'Running', 'Swimming', 'Cross Training']);
const QUALITY_DOMAINS: ReadonlySet<string> = new Set(['tempo', 'threshold', 'vo2', 'anaerobic', 'race', 'mixed']);

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
    const activityById = new Map(input.activities.map(activity => [activity.activityId, activity]));
    const recommendationByDate = new Map(input.recommendations.map(rec => [rec.date, rec]));
    return events.map(event => {
        const activity = event.linkedActivityId ? activityById.get(event.linkedActivityId) ?? null : null;
        const override = event.linkedActivityId ? overrides[event.linkedActivityId] : undefined;
        const linkedRec = event.exactTemplateMatch && event.linkedRecommendationDate
            ? recommendationByDate.get(event.linkedRecommendationDate) ?? null
            : null;
        return { event, activity, override, category: linkedRec?.category ?? null };
    });
}

/** The #809 stimulus domain, unless an athlete reclassification supersedes the record. */
function domainOf(resolved: ResolvedEvent): string | null {
    if (resolved.override) return null;
    const domain = resolved.activity?.stimulusDomain;
    return domain && domain !== 'unknown' ? domain : null;
}

function costRowOf(event: CompletedTrainingEvent): string {
    return event.costIntensity ?? event.intensity;
}

function isMeaningful(resolved: ResolvedEvent): boolean {
    const { event } = resolved;
    return event.intensity === 'hard' || costRowOf(event) === 'hard' || MECHANICAL_MODALITIES.has(event.modality);
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
        provenance: provenanceOf(event, resolved.override),
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
        label: 'Aerobic endurance',
        confirms: r => AEROBIC_MODALITIES.has(r.event.modality),
        plans: s => AEROBIC_MODALITIES.has(plannedModality(s)),
        suspension: () => null,
    },
    {
        key: 'cycling_quality',
        label: 'Cycling quality (tempo+ / race)',
        confirms: r => r.event.modality === 'Cycling'
            && (r.event.intensity === 'hard' || QUALITY_DOMAINS.has(domainOf(r) ?? '')),
        plans: s => plannedModality(s) === 'Cycling' && s.intensity === 'hard',
        suspension: safety => modalityBlocked(safety, 'Cycling'),
    },
    {
        key: 'strength',
        label: 'Strength',
        confirms: r => r.event.modality === 'Strength',
        plans: s => plannedModality(s) === 'Strength',
        suspension: safety => modalityBlocked(safety, 'Strength'),
    },
    {
        key: 'running',
        label: 'Running familiarity',
        confirms: r => r.event.modality === 'Running',
        plans: s => plannedModality(s) === 'Running',
        suspension: safety => modalityBlocked(safety, 'Running') ?? impactBlocked(safety),
    },
    {
        key: 'field',
        label: 'Field / multidirectional sport',
        confirms: r => r.event.modality === 'Field',
        plans: s => plannedModality(s) === 'Field',
        suspension: safety => modalityBlocked(safety, 'Field') ?? impactBlocked(safety),
    },
];

/** Families without a canonical exposure model yet. Reported, never inferred. */
const UNMODELLED: ReadonlyArray<{ key: string; label: string; source: string; impact: boolean }> = [
    { key: 'neuromuscular_power', label: 'Neuromuscular power', source: '#802', impact: false },
    { key: 'unilateral_lower_body', label: 'Unilateral lower-body', source: '#803', impact: false },
    { key: 'impact_jump', label: 'Impact / jump-land', source: '#804', impact: true },
    { key: 'cod_lateral', label: 'COD / lateral', source: '#805', impact: true },
    { key: 'long_aerobic_anchor', label: 'Long aerobic anchor', source: '#806', impact: false },
    { key: 'hamstring_calf_grip', label: 'Hamstring knee-flexion / calf-soleus / grip-carry', source: 'no issue yet', impact: false },
];

function capabilityEntry(spec: CapabilitySpec, events: readonly ResolvedEvent[], input: ExposureLedgerInput, safety: SafetyState): CapabilityEntry {
    const confirmed = input.activitiesReadable ? events.filter(spec.confirms) : [];
    const last = confirmed.length > 0 ? confirmed[confirmed.length - 1] : null;
    const planned = (input.plannedSessions ?? [])
        .filter(session => session.date >= input.asOfDate && spec.plans(session))
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const suspension = spec.suspension(safety);
    const notes: string[] = [];
    if (spec.key === 'strength' && safety.guardrails.has('avoid_heavy_lower_body')) {
        notes.push('heavy lower-body loading suspended by an active safety limit');
    }
    if (!input.activitiesReadable) notes.push('activity history unreadable');
    let status: CapabilityStatus;
    if (suspension) status = 'deliberately_suspended';
    else if (last) status = 'confirmed';
    else if (planned) status = 'planned';
    else status = 'unknown';
    if (suspension) notes.unshift(suspension);
    return {
        key: spec.key,
        label: spec.label,
        status,
        lastConfirmed: last?.event.date ?? null,
        lastConfirmedProvenance: last ? provenanceOf(last.event, last.override) : null,
        nextPlanned: planned?.date ?? null,
        note: notes.length > 0 ? notes.join('; ') : null,
    };
}

export function deriveExposureLedger(input: ExposureLedgerInput): ExposureLedger {
    const events = input.activitiesReadable || input.recommendationsReadable ? resolveEvents(input) : [];
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
    if (input.activityOverrides === null) notes.push('Athlete reclassifications were unreadable: rows show the recorded classification.');
    if (input.plannedSessions === null) notes.push('The future plan was not fully readable: `planned` may be incomplete.');
    if (!safety.known) notes.push('Training settings unavailable: safety suspensions are unknown, not absent.');
    return {
        stressors: meaningful.map(stressorOf),
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
        'Completed sessions only (Garmin records and answered adherence, reconciled exactly as the engine\'s training history is). '
            + 'Listed when the stimulus is high-intensity, the session cost is high, or the modality loads tissue mechanically. '
            + 'Cost vector = engine-estimated 0–1 cost, systemic vs mechanical.',
    ];
    if (ledger.stressors.length === 0) {
        lines.push('- None recorded in this window.');
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
        'Read-only status. `confirmed` = completed in this window; `planned` = imported future session only (never counted as done); '
            + '`unknown` = not observed in this window or no canonical model; `deliberately_suspended` = blocked by a current safety limit, not neglect. '
            + 'No authoritative cadence/max-gap policy is wired in, so nothing is reported `overdue`.',
    );
    for (const entry of ledger.capabilities) lines.push(formatCapability(entry));
    for (const note of ledger.notes) lines.push(`- Note: ${note}`);
    return lines;
}
