import type { SessionTemplate, TrainingSettings, UserContext } from './models';

export type EligibilityReason = 'time_limit' | 'equipment' | 'environment' | 'safety_guardrail';

export interface TemplateEligibility {
    template: SessionTemplate;
    eligible: boolean;
    reasons: EligibilityReason[];
}

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

function hasEquipment(settings: TrainingSettings | undefined, context: UserContext, equipment: SessionTemplate['requiredEquipment'][number]): boolean {
    if (settings) return settings.equipment[equipment];
    if (equipment === 'free_weights') return context.constraints.hasFreeWeights;
    if (equipment === 'cable_machine') return context.constraints.hasCableMachine;
    if (equipment === 'treadmill') return context.constraints.hasTreadmill;
    if (equipment === 'indoor_bike') return context.constraints.hasIndoorBike;
    return false;
}

/** Applies all hard feasibility gates. Preferences must be applied only after this function. */
export function evaluateTemplateEligibility(
    template: SessionTemplate,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): TemplateEligibility {
    const reasons: EligibilityReason[] = [];
    if (template.durationMin > resolveMaximumSessionMinutes(context, checkinMinutes, date)) reasons.push('time_limit');
    if (!template.requiredEquipment.every(item => hasEquipment(context.trainingSettings, context, item))) reasons.push('equipment');

    const settings = context.trainingSettings;
    if (settings && settings.defaults.environment !== 'either' && template.environment !== 'either' && template.environment !== settings.defaults.environment) {
        reasons.push('environment');
    }
    if (settings && template.safetyTags.some(tag => settings.guardrails[tag])) reasons.push('safety_guardrail');
    return { template, eligible: reasons.length === 0, reasons };
}

export function eligibleTemplates(
    templates: SessionTemplate[],
    context: UserContext,
    checkinMinutes: number,
    date: string,
): SessionTemplate[] {
    return templates.filter(template => evaluateTemplateEligibility(template, context, checkinMinutes, date).eligible);
}
