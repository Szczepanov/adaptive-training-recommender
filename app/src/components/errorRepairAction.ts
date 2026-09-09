import type { DataStateSummary } from '../engine/dataState';
import { SCREEN_LABELS, type Screen } from '../types/navigation';

/** An actionable next step surfaced on a load-error screen: either a specific screen that
 * owns the flagged document (re-saving there re-runs validation), or a forced Garmin
 * resync (re-ingesting overwrites a malformed recovery snapshot). Shared between Home and
 * PlanView, which hit the same decision-input/recovery-snapshot failure modes. */
export type ErrorRepairAction =
    | { kind: 'navigate'; screen: Screen; label: string }
    | { kind: 'resync' };

export interface ErrorRepairState {
    message: string;
    actions: ErrorRepairAction[];
}

type DecisionSourceStates = {
    activeGoals: DataStateSummary;
    preferences: DataStateSummary;
    trainingSettings: DataStateSummary;
};

const DECISION_SOURCES = [
    { key: 'activeGoals', screen: 'goals', label: SCREEN_LABELS.goals },
    { key: 'preferences', screen: 'preferences', label: SCREEN_LABELS.preferences },
    { key: 'trainingSettings', screen: 'constraints', label: SCREEN_LABELS.constraints },
] as const satisfies ReadonlyArray<{
    key: keyof DecisionSourceStates;
    screen: Screen;
    label: string;
}>;

function formatList(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function agreement(items: readonly unknown[]): 'is' | 'are' {
    return items.length === 1 ? 'is' : 'are';
}

/**
 * Aggregate every decision-source failure instead of letting the first array match hide a
 * later INVALID source. A mixed UNAVAILABLE + INVALID state must still expose the repair
 * screen for the invalid document while accurately naming the unavailable input(s).
 */
export function resolveDecisionSourceRepairState(
    sourceStates: DecisionSourceStates | null | undefined,
): ErrorRepairState | null {
    if (!sourceStates) return null;

    const invalid = DECISION_SOURCES.filter(({ key }) => sourceStates[key].status === 'INVALID');
    const unavailable = DECISION_SOURCES.filter(({ key }) => sourceStates[key].status === 'UNAVAILABLE');
    if (invalid.length === 0 && unavailable.length === 0) return null;

    const actions: ErrorRepairAction[] = invalid.map(({ screen, label }) => ({
        kind: 'navigate',
        screen,
        label: `Review ${label}`,
    }));
    const invalidLabels = invalid.map(({ label }) => label);
    const unavailableLabels = unavailable.map(({ label }) => label);

    if (invalid.length > 0 && unavailable.length > 0) {
        return {
            actions,
            message: `Decision inputs need attention: ${formatList(invalidLabels)} ${agreement(invalid)} invalid; ${formatList(unavailableLabels)} ${agreement(unavailable)} temporarily unavailable. Review the invalid input${invalid.length === 1 ? '' : 's'}, then retry.`,
        };
    }

    if (invalid.length > 0) {
        return {
            actions,
            message: `Decision inputs need repair: ${formatList(invalidLabels)} ${agreement(invalid)} invalid. Review the invalid input${invalid.length === 1 ? '' : 's'}, then retry.`,
        };
    }

    return {
        actions,
        message: `Decision inputs are temporarily unavailable: ${formatList(unavailableLabels)}. Retry when ${unavailable.length === 1 ? 'that input can' : 'those inputs can'} be read.`,
    };
}

/**
 * Some required composition inputs cannot be represented as a returned DailyDecisionInput
 * when they fail (notably Training Settings and schedule overlays), so DecisionComposer
 * throws before Home/PlanView can inspect sourceStates. Preserve that fail-closed contract
 * while mapping only the composer's explicit, known error messages to owning repair UI.
 * Unknown exceptions remain generic rather than guessing at a repair surface.
 */
export function resolveDecisionCompositionRepairState(error: unknown): ErrorRepairState | null {
    if (!(error instanceof Error)) return null;

    if (error.message.startsWith('Training settings are invalid.')) {
        return {
            message: `${SCREEN_LABELS.constraints} is invalid. Review and save it again, then retry.`,
            actions: [{ kind: 'navigate', screen: 'constraints', label: `Review ${SCREEN_LABELS.constraints}` }],
        };
    }
    if (error.message.startsWith('Training settings are temporarily unavailable.')) {
        return {
            message: `${SCREEN_LABELS.constraints} is temporarily unavailable. Retry when it can be read.`,
            actions: [],
        };
    }
    if (error.message.startsWith('Schedule overlays are invalid.')) {
        return {
            message: 'Schedule overlays are invalid. Review or remove the affected schedule block in Plan, then retry.',
            actions: [{ kind: 'navigate', screen: 'plan', label: `Review ${SCREEN_LABELS.plan}` }],
        };
    }
    if (error.message.startsWith('Schedule overlays are temporarily unavailable.')) {
        return {
            message: 'Schedule overlays are temporarily unavailable. Retry when they can be read.',
            actions: [],
        };
    }

    return null;
}
