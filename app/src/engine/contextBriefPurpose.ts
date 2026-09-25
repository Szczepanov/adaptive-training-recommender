import type { UserGoal } from './models';
import { EVENT_PRESETS, resolveDemandProfile } from './eventPresets';

/* Issue #811: export purposes, shared section titles, and the purpose-dependent handoff
 * renderers (goal specifics, use instructions). Pure: no I/O, no imports from the brief
 * builders, so every brief module can depend on it without a cycle. */

/**
 * `daily` is today + yesterday only — a point reading for the everyday paste-into-chat
 * loop, so it does not re-send retrospective detail (completed-training rows, per-lap
 * telemetry) an external planning agent already saw the day before. `full` is the
 * original two-week lookback, useful when actually designing a new block. Sections that
 * are already fixed-horizon regardless of window (the 7-day recovery timeline, the
 * 28-day subjective baseline, the 7-day commitments handoff) are unaffected by this
 * choice — see contextBriefService.ts's `contextDays`.
 */
export type BriefWindowPreset = 'daily' | 'full' | 'diagnostic';

/**
 * Issue #811: the consumer intent an export serves, independent of its lookback length.
 * - `morning`: current-day closed-loop coaching (`buildMorningCoachBrief`).
 * - `planning`: compact multi-day/block design context, ordered by decision authority.
 * - `diagnostic`: forensic per-activity telemetry and experimental observability.
 * No purpose changes what the engine recommends; the brief is a read-only export.
 */
export type BriefPurpose = 'morning' | 'planning' | 'diagnostic';

const PURPOSE_BY_PRESET: Readonly<Record<BriefWindowPreset, BriefPurpose>> = {
    daily: 'morning',
    full: 'planning',
    diagnostic: 'diagnostic',
};

/** The existing UI preset names stay for compatibility; each maps to exactly one purpose. */
export function briefPurposeFor(preset: BriefWindowPreset): BriefPurpose {
    return PURPOSE_BY_PRESET[preset];
}

/** Section titles shared by both orders; numbering is applied per purpose. Other modules
 * locate sections by title (see `findSectionHeading`), never by number. */
export const SECTION_TITLE = {
    objective: 'Objective recovery (wearable)',
    training: 'Completed training (recorded by the wearable)',
    subjective: 'Subjective reports (self-scored each morning, 1–10)',
    adherence: 'Plan adherence',
    intent: 'Goals & training intent',
    intentFirst: 'Current training intent & goals',
} as const;

/** Index of the `\n## <n>. <titlePrefix>` heading, whatever its number, or -1. */
export function findSectionHeading(text: string, titlePrefix: string): number {
    const pattern = /\n## \d+\. /g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        if (text.startsWith(titlePrefix, match.index + match[0].length)) return match.index;
    }
    return -1;
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** Details shared by both goal renderers. `compact` (planning, issue #811) drops only the
 * 0–1 event demand vector and preset id: target, timing and description stay. */
function goalDetails(goal: UserGoal, compact: boolean): string[] {
    const details: string[] = [];
    if (goal.targetOutcome) details.push(`success: ${compactText(goal.targetOutcome)}`);
    if (goal.targetMetric && goal.targetValue !== null && goal.targetValue !== undefined) {
        details.push(`target: ${goal.targetMetric} ${goal.targetValue}${goal.targetUnit ? ` ${goal.targetUnit}` : ''}`);
    }
    if (goal.eventCategory) {
        const preset = EVENT_PRESETS[goal.eventCategory].find(item => item.id === goal.eventPreset)
            ?? EVENT_PRESETS[goal.eventCategory][0];
        if (compact) {
            details.push(`event: ${preset.label}`);
        } else {
            const demand = resolveDemandProfile(goal.eventCategory, goal.eventPreset);
            details.push(`event: ${preset.label} (${goal.eventCategory}, preset ${preset.id})`);
            details.push(
                `demand 0–1: endurance ${demand.aerobicEndurance} · threshold ${demand.thresholdPower} · `
                + `VO2 ${demand.vo2MaxPower} · repeated surges ${demand.repeatedSurges} · sprint ${demand.sprintPower} · `
                + `fatigue resistance ${demand.fatigueResistance} · neuromuscular ${demand.neuromuscular}`,
            );
        }
    }
    if (goal.timing) {
        const timing = goal.timing.confirmedDate
            ? `confirmed ${goal.timing.confirmedDate}`
            : `window ${goal.timing.earliestDate}–${goal.timing.latestDate}, planning date ${goal.timing.planningDate}`;
        details.push(`timing: ${timing}`);
    }
    if (goal.description) details.push(`description: ${compactText(goal.description)}`);
    return details;
}

function goalLines(goals: readonly UserGoal[], compact: boolean): string[] {
    return goals
        .filter(item => item.status === 'active')
        .map(goal => ({ goal, details: goalDetails(goal, compact) }))
        .filter(({ details }) => details.length > 0)
        .map(({ goal, details }) => `- **${goal.title}** — ${details.join(' · ')}`);
}

/** Planning-mode goal digest (issue #811). */
export function renderCompactGoalSpecifics(goals: readonly UserGoal[]): string {
    const lines = goalLines(goals, true);
    if (lines.length === 0) return '';
    return [
        '### Longer-term goals (compact)',
        '',
        'Event demand profiles are omitted in the planning export; ask for them only if the question needs them.',
        ...lines,
    ].join('\n');
}

export function renderGoalSpecifics(goals: readonly UserGoal[]): string {
    const lines = goalLines(goals, false);
    if (lines.length === 0) return '';
    return ['### Goal specifics relevant to planning', '', ...lines].join('\n');
}

/** `purpose` decides which observability the instructions may reference: the planning
 * export omits the respiration candidate and median/MAD fields, so it must not tell the
 * reader to use them. */
export function renderUseInstructions(purpose: BriefPurpose): string {
    const observabilityLine = purpose === 'planning'
        ? '- Secondary device composites (body battery, stress, training readiness) are correlated context, not independent additive evidence. Candidate median/MAD baselines are deliberately absent from this planning export; do not infer them.'
        : '- Treat respiration robust statistics and the observation-only median/MAD fields as context for pattern recognition, not independent additive penalties.';
    return [
        '## 8. How to use this handoff',
        '',
        '- Treat the brief as **state/context**, not as a request to automatically create a plan. Answer the user\'s actual question first.',
        '- For **today**, current illness/pain/tissue response and current-day availability outrank favorable wearable metrics. A green wearable day does not justify overriding a local warning signal.',
        '- **Day 1 of a new block is not a blank slate.** Cross-check it against the most recent rows in the completed-training table before finalizing it — a session scheduled for today or tomorrow that duplicates one already completed the day of or immediately before the brief\'s date needs an explicit adjustment (lower end of the range, different modality, or rest), not a repeat of the same slot.',
        '- For **future days**, preserve the intended purpose and hard/easy spacing of key sessions. Do not pre-emptively downgrade a future quality day merely because the preceding planned work may create normal fatigue; reassess that day when current data exists.',
        '- Favorable recovery metrics may support proceeding with the intended dose, but are not a reason by themselves to add volume or intensity beyond the plan.',
        observabilityLine,
        '- For **today**, follow the *Resolved planning authority* block in section 0. It already reconciles the app recommendation with the imported plan; do not re-decide between them, merge them, or invent a compromise dose. If it says UNRESOLVED or UNKNOWN, say so and ask the athlete instead of choosing.',
        '- Respect fixed activities, travel scaling blocks and imported-plan sessions above. Imported sessions on later dates keep their authored authority on those dates. If a change is warranted, explain which constraint or new evidence justifies it.',
        '- Honor recorded sensor capabilities. If a sensor is unknown or unavailable, do not make the session depend solely on that sensor; provide an executable RPE/HR/feel alternative as appropriate.',
        '- Prefer dated/current records when information conflicts. Explicitly call out missing or stale data instead of assuming normality.',
        '',
        '### If the user asks for an importable schedule',
        '',
        'Use this exact day-block format so it remains compatible with 1-click plan import:',
        '```markdown',
        '### Day YYYY-MM-DD: <Session Name>',
        '- Modality: <Cycling | Running | Strength | Mobility | Field | Cross Training>',
        '- Duration: <minutes> min',
        '- Intensity: <easy | moderate | hard>',
        '- Objectives: <zone2 aerobic | threshold quality | surge repeatability | vo2 max | strength maintenance | strength development | race specific endurance> (or omit if recovery)',
        '- Description: <Interval structure, target power/HR zones, or workout instructions>',
        '```',
    ].join('\n');
}
