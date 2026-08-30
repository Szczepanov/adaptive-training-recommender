import type { EquipmentKey, SessionTemplate, TrainingSettings, TrainingEnvironment, UserContext } from './models';
import { resolveInjuryRestrictions } from './injuryPolicy';

export type EligibilityReason = 'time_limit' | 'equipment' | 'environment' | 'safety_guardrail' | 'restricted_modality' | 'restricted_category';

/**
 * Plain language for each gate, as a clause that completes "excluded because ...".
 *
 * Lives beside the reasons themselves so the rationale an athlete reads and the sentence a
 * component renders cannot drift into two different explanations of the same exclusion —
 * and so no path prints the raw enum to a person.
 */
export const ELIGIBILITY_REASON_LABEL: Record<EligibilityReason, string> = {
    time_limit: 'you have less time available today than this session needs',
    equipment: 'the equipment this session needs is not available to you',
    environment: 'today\'s environment does not match where this session has to happen',
    safety_guardrail: 'one of your safety guardrails excludes this kind of work',
    restricted_modality: 'this type of training is restricted for you today',
    restricted_category: 'this category of session is restricted for you today',
};

/** Joins gate labels into one readable clause. Unknown codes degrade to a de-underscored
 * form rather than being dropped: a missing explanation must not hide a real exclusion. */
export function describeEligibilityReasons(reasons: readonly string[]): string {
    const described = reasons.map(reason =>
        ELIGIBILITY_REASON_LABEL[reason as EligibilityReason] ?? reason.replaceAll('_', ' '));
    if (described.length === 0) return '';
    if (described.length === 1) return described[0];
    return `${described.slice(0, -1).join(', ')} and ${described[described.length - 1]}`;
}

/**
 * The minimum shape the hard feasibility gates read. `SessionTemplate` satisfies it
 * structurally, so widening these functions from `SessionTemplate` to `GateableSession`
 * changes no existing call site.
 *
 * It exists so a session that is not a catalog template — an imported external session
 * (ADR-0019 D-CANDIDATE) — passes the *same* gates on the same terms, rather than getting
 * a second, parallel feasibility path that could drift from this one.
 */
export interface GateableSession {
    durationMin: number;
    durationMax: number;
    requiredEquipment: readonly EquipmentKey[];
    environment: TrainingEnvironment;
    safetyTags: readonly SessionTemplate['safetyTags'][number][];
    modality: SessionTemplate['modality'];
    category: SessionTemplate['category'];
    systemicCost: number;
}

export interface SessionEligibility<T extends GateableSession = SessionTemplate> {
    template: T;
    eligible: boolean;
    reasons: EligibilityReason[];
}

/** Retained name for the catalog-template case, which is every existing caller. */
export type TemplateEligibility = SessionEligibility<SessionTemplate>;

function isWeekend(date: string): boolean {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
}

export function resolveMaximumSessionMinutes(context: UserContext, checkinMinutes: number, date: string): number {
    const defaults = context.trainingSettings?.defaults;
    const profileLimit = defaults
        ? (isWeekend(date) ? defaults.weekendMaxMinutes : defaults.weekdayMaxMinutes)
        : context.constraints.maxTimeMinutes;
    return profileLimit === null || profileLimit === undefined ? checkinMinutes : Math.min(profileLimit, checkinMinutes);
}

function hasEquipment(settings: TrainingSettings | undefined, context: UserContext, equipment: EquipmentKey): boolean {
    if (settings) return settings.equipment[equipment] ?? false;
    if (equipment === 'free_weights') return context.constraints.hasFreeWeights;
    if (equipment === 'cable_machine') return context.constraints.hasCableMachine;
    if (equipment === 'treadmill') return context.constraints.hasTreadmill;
    if (equipment === 'indoor_bike') return context.constraints.hasIndoorBike;
    return false;
}

/** Applies all hard feasibility gates. Preferences must be applied only after this function. */
export function evaluateTemplateEligibility<T extends GateableSession>(
    template: T,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): SessionEligibility<T> {
    const reasons: EligibilityReason[] = [];
    if (template.durationMin > resolveMaximumSessionMinutes(context, checkinMinutes, date)) reasons.push('time_limit');
    if (!template.requiredEquipment.every(item => hasEquipment(context.trainingSettings, context, item))) reasons.push('equipment');

    const settings = context.trainingSettings;
    if (settings && settings.defaults.environment !== 'either' && template.environment !== 'either' && template.environment !== settings.defaults.environment) {
        reasons.push('environment');
    }

    const injuries = context.trainingSettings?.injuries
        ?? (context.constraints as { injuries?: import('./models').InjuryConstraint[] })?.injuries
        ?? (context as { injuries?: import('./models').InjuryConstraint[] })?.injuries
        ?? [];
    const activeInjuries = resolveInjuryRestrictions(injuries, date);
    const restrictedModalities = [
        ...(context.constraints.restrictedModalities ?? []),
        ...activeInjuries.restrictedModalities,
    ];
    if (restrictedModalities.includes(template.modality)) reasons.push('restricted_modality');

    const implied = [
        ...(context.constraints.impliedGuardrails ?? []),
        ...activeInjuries.impliedGuardrails,
    ];
    const directGuardrails = (context as { guardrails?: Record<string, boolean> }).guardrails;
    const guardrailTriggered = template.safetyTags.some(tag => (settings?.guardrails[tag] ?? false) || (directGuardrails?.[tag] ?? false) || implied.includes(tag));
    if (guardrailTriggered) reasons.push('safety_guardrail');

    // Category-level injury restriction (e.g. an excluded elbow/shoulder blocks the whole
    // Upper-body Strength category, not just templates tagged avoid_overhead_pressing --
    // some templates in a restricted category carry no matching safetyTag at all). Checked
    // here, not just in rules.ts's today/tomorrow path, so planner.ts's 7-day forecast
    // (which also goes through eligibleTemplates()) enforces it too.
    const restrictedCategories = [
        ...(context.constraints.restrictedCategories ?? []),
        ...activeInjuries.restrictedCategories,
    ];
    if (restrictedCategories.includes(template.category)) reasons.push('restricted_category');

    return { template, eligible: reasons.length === 0, reasons };
}

function isSessionTemplate(template: GateableSession): template is SessionTemplate {
    const candidate = template as Partial<SessionTemplate>;
    return typeof candidate.id === 'string'
        && typeof candidate.title === 'string'
        && typeof candidate.description === 'string';
}

/**
 * Eligibility is intentionally based on the authored minimum duration: wide-range sessions
 * remain valid when their minimum fits the day. Downstream recommendation logic, however,
 * needs a concrete dose whose *maximum* also respects the same hard cap. Attach a cap-safe
 * easier variation to eligible catalog templates so every ranking path has one available.
 *
 * Prefer the author's easier variation when it can start inside the cap. If its upper bound
 * is still too large, narrow only that bound and scale its volume ratio proportionally. If
 * no authored easier variation can start inside the cap, derive a duration-only variation
 * from the base template. The template itself is not mutated and its authored range remains
 * available for provenance/audit.
 */
function withCapSafeDose<T extends GateableSession>(template: T, maxMinutes: number): T {
    if (!isSessionTemplate(template) || template.durationMax <= maxMinutes) return template;

    const authored = template.easierDose;
    const source = authored && authored.durationMin <= maxMinutes
        ? authored
        : {
            label: `${template.durationMin}-${template.durationMax} min`,
            durationMin: template.durationMin,
            durationMax: template.durationMax,
            doseRatio: 1,
            prescriptionSummary: template.description,
        };
    const cappedDurationMax = Math.min(source.durationMax, maxMinutes);
    const ratioScale = source.durationMax > 0 ? cappedDurationMax / source.durationMax : 1;
    const cappedDose = source.durationMax <= maxMinutes
        ? source
        : {
            ...source,
            label: `${source.label} (max ${maxMinutes} min)`,
            durationMax: cappedDurationMax,
            doseRatio: source.doseRatio * ratioScale,
            prescriptionSummary: `${source.prescriptionSummary} Keep total duration at or below ${maxMinutes} minutes.`,
        };

    return { ...template, easierDose: cappedDose } as T;
}

export function eligibleTemplates<T extends GateableSession>(
    templates: readonly T[],
    context: UserContext,
    checkinMinutes: number,
    date: string,
): T[] {
    const maxMinutes = resolveMaximumSessionMinutes(context, checkinMinutes, date);
    return templates
        .filter(template => evaluateTemplateEligibility(template, context, checkinMinutes, date).eligible)
        .map(template => withCapSafeDose(template, maxMinutes));
}
