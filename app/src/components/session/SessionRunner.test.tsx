import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    SessionRunner,
    resolveCompanionPromptCopy,
    resolveEmptyTemplateGuidance,
    resolveRepetitionWeightSuggestion,
    resolveNextDueStep,
    resolveRestPreviewStep,
} from './SessionRunner';
import { useSessionRunner } from '../../hooks/useSessionRunner';
import { formatSessionLoad } from '../../sessions/loadDisplay';
import { DurationInputCard } from './inputs/DurationInputCard';
import { DistanceInputCard } from './inputs/DistanceInputCard';
import { RepetitionInputCard } from './inputs/RepetitionInputCard';
import { GroupProgress } from './GroupProgress';
import type { SessionDefinition, SessionEntry, SessionStep } from '../../sessions/models';

vi.mock('../../hooks/useSessionRunner', () => ({
    useSessionRunner: vi.fn(() => ({
        activeStep: null,
        activeBlock: null,
        activeBlockIndex: 0,
        activeStepIndex: 0,
        definition: null,
        entries: [],
        execution: null,
        isRestoring: false,
    })),
}));

vi.mock('../../hooks/useOverloadHistory', () => ({
    useOverloadHistory: () => ({ history: [], select: vi.fn() }),
}));

vi.mock('../../services/sessionDefinitionService', () => ({
    sessionDefinitionService: {
        getDefinitionRevision: vi.fn(),
        listDefinitionHeaders: vi.fn(),
    },
}));

const repetitionStep = (id: string, sets: number, load?: SessionStep['load']): SessionStep => ({
    id,
    kind: 'exercise',
    title: id,
    exerciseRef: { kind: 'catalog', exerciseId: id },
    dose: { kind: 'repetition', sets, reps: 5 },
    ...(load ? { load } : {}),
});

const repetitionEntry = (stepId: string, index: number): SessionEntry => ({
    id: `${stepId}-${index}`,
    executionId: 'exec-1',
    stepId,
    exerciseRef: { kind: 'catalog', exerciseId: stepId },
    completedAt: `2026-09-01T12:00:0${index}.000Z`,
    createdAt: `2026-09-01T12:00:0${index}.000Z`,
    updatedAt: `2026-09-01T12:00:0${index}.000Z`,
    payload: { kind: 'repetition', setIndex: index, reps: 5 },
});

const definitionWithBlock = (
    executionMode: 'sequential' | 'superset',
    steps: SessionStep[],
): SessionDefinition => ({
    schemaVersion: 1,
    id: 'test-session',
    revision: 1,
    title: 'Test session',
    intent: 'training',
    blocks: [{ id: 'main', role: 'main', executionMode, steps }],
});

describe('SessionRunner session picker', () => {
    it('collapses creation to one New session entry instead of parallel actions (#495)', () => {
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).toContain('Start a Structured Session');
        expect(html).toContain('New session');
        // Fixture/template libraries stay behind the chooser, not top-level.
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Import session JSON');
        expect(html).not.toContain('Build session');
    });

    it('describes only the authoring actions that the current caller actually exposes', () => {
        expect(resolveEmptyTemplateGuidance(true, true)).toBe(
            'No saved templates yet — start from a reviewed fixture, import JSON, or build one manually.',
        );
        expect(resolveEmptyTemplateGuidance(true, false)).toBe(
            'No saved templates yet — start from a reviewed fixture or import JSON.',
        );
        expect(resolveEmptyTemplateGuidance(false, true)).toBe(
            'No saved templates yet — start from a reviewed fixture or build one manually.',
        );
        expect(resolveEmptyTemplateGuidance(false, false)).toBe(
            'No saved templates yet — start from a reviewed fixture, or import or build one from the Sessions screen.',
        );
    });

    it('keeps save-as-template out of the active-run top bar (#495)', () => {
        const step = repetitionStep('squat', 3);
        const definition = definitionWithBlock('sequential', [step]);
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: step,
            activeBlock: definition.blocks[0],
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition,
            entries: [],
            execution: { state: 'in_progress' },
            isRestoring: false,
            elapsedSeconds: 0,
            isRestRunning: false,
            syncStatus: 'synced',
            canUndo: false,
            sessionEnded: false,
            ineligibleOptionIds: new Set<string>(),
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).toContain('⏱️');
        expect(html).not.toContain('Save Template');
        expect(html).not.toContain('save-template-header-btn');
    });

    it('keeps set logging before long history during rest and names each history action', () => {
        const step = repetitionStep('squat', 10);
        const definition = definitionWithBlock('sequential', [step]);
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: step,
            activeBlock: definition.blocks[0],
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition,
            entries: Array.from({ length: 8 }, (_, index) => repetitionEntry(step.id, index + 1)),
            execution: { state: 'in_progress' },
            isRestoring: false,
            elapsedSeconds: 0,
            isRestRunning: true,
            restSecondsRemaining: 30,
            syncStatus: 'synced',
            canUndo: false,
            sessionEnded: false,
            ineligibleOptionIds: new Set<string>(),
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html.indexOf('Skip Rest')).toBeLessThan(html.indexOf('aria-label="Log repetition set"'));
        expect(html.indexOf('aria-label="Log repetition set"')).toBeLessThan(html.indexOf('Performed for this step'));
        expect(html).toContain('aria-label="Edit set 1"');
        expect(html).toContain('aria-label="Remove set 1"');
        expect(html).toContain('aria-label="Remove set 8"');
    });

    it('shows the active exercise and Log before authored manual navigation', () => {
        const step = repetitionStep('squat', 1);
        const definition = definitionWithBlock('sequential', [step, repetitionStep('row', 1)]);
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: step, activeBlock: definition.blocks[0], activeBlockIndex: 0, activeStepIndex: 0,
            definition, entries: [], execution: { state: 'in_progress' }, isRestoring: false,
            elapsedSeconds: 0, isRestRunning: false, syncStatus: 'synced', canUndo: false,
            sessionEnded: false, ineligibleOptionIds: new Set<string>(),
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);
        expect(html.indexOf('class="active-step-panel"')).toBeLessThan(html.indexOf('aria-label="Workout steps"'));
        expect(html.indexOf('aria-label="Log repetition set"')).toBeLessThan(html.indexOf('aria-label="Workout steps"'));
        expect(html).toContain('class="step-nav-pill active');
        expect(html).toContain('row</button>');
    });

    it('tints the running header for locked assessments (#496)', () => {
        const step = repetitionStep('squat', 3);
        const definition = definitionWithBlock('sequential', [step]);
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: step,
            activeBlock: definition.blocks[0],
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition,
            entries: [],
            execution: { state: 'in_progress' },
            isRestoring: false,
            elapsedSeconds: 0,
            isRestRunning: false,
            syncStatus: 'synced',
            canUndo: false,
            sessionEnded: false,
            ineligibleOptionIds: new Set<string>(),
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" mode="assessment" />);

        expect(html).toContain('runner-mode-assessment');
        expect(html).toContain('Locked assessment');
    });

    it('leaves the running header untinted for normal sessions (#496)', () => {
        const step = repetitionStep('squat', 3);
        const definition = definitionWithBlock('sequential', [step]);
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: step,
            activeBlock: definition.blocks[0],
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition,
            entries: [],
            execution: { state: 'in_progress' },
            isRestoring: false,
            elapsedSeconds: 0,
            isRestRunning: false,
            syncStatus: 'synced',
            canUndo: false,
            sessionEnded: false,
            ineligibleOptionIds: new Set<string>(),
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).not.toContain('runner-mode-assessment');
        expect(html).not.toContain('Locked assessment');
    });

    it('offers a Home recovery action when the stored prescription cannot be restored (#493)', () => {
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: null,
            activeBlock: null,
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition: null,
            entries: [],
            execution: { state: 'in_progress' },
            isRestoring: false,
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" onClose={() => {}} />);

        expect(html).toContain('Active session needs its stored prescription');
        expect(html).toContain('Back to Home');
        expect(html).toContain('Return Home, then reopen the session that started it');
        expect(html).not.toContain('Back to Sessions');
    });

    it('keeps explicit recovery guidance in isolated harnesses without a close handler (#493)', () => {
        vi.mocked(useSessionRunner).mockReturnValueOnce({
            activeStep: null,
            activeBlock: null,
            activeBlockIndex: 0,
            activeStepIndex: 0,
            definition: null,
            entries: [],
            execution: { state: 'in_progress' },
            isRestoring: false,
        } as unknown as ReturnType<typeof useSessionRunner>);
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).toContain('Active session needs its stored prescription');
        expect(html).toContain('Return Home, then reopen the session that started it');
    });
});

describe('resolveCompanionPromptCopy', () => {
    it('labels a single companion as a follow-up, not the next workout block (#494)', () => {
        const copy = resolveCompanionPromptCopy('Full-body maintenance', 1);

        expect(copy.heading).toBe('Follow-up companion available');
        expect(copy.subheading).toContain('follow-up');
        expect(copy.subheading).toContain('not your next workout block');
    });

    it('keeps the follow-up framing for multiple companions (#494)', () => {
        const copy = resolveCompanionPromptCopy('Full-body maintenance', 2);

        expect(copy.heading).toBe('Follow-up companions available');
        expect(copy.subheading).toContain('2 separately executable follow-up companions');
        expect(copy.subheading).toContain('not your next workout block');
    });
});

describe('formatSessionLoad', () => {
    it('keeps an explicit ramp instruction visible without inferring kilograms', () => {
        expect(formatSessionLoad({ kind: 'descriptive', display: 'Empty bar, then light rehearsal load' })).toBe('Empty bar, then light rehearsal load');
        expect(formatSessionLoad({ kind: 'percent_one_rm', percent: 40 })).toBe('40% 1RM');
    });
});

describe('resolveRepetitionWeightSuggestion', () => {
    it('does not replace an explicit authored load with unrelated overload-history kilograms', () => {
        expect(resolveRepetitionWeightSuggestion(repetitionStep('squat', 2, { kind: 'bodyweight' }), undefined, 120)).toBeUndefined();
        expect(resolveRepetitionWeightSuggestion(repetitionStep('clean', 2, { kind: 'descriptive', display: 'Empty bar, then light rehearsal load' }), undefined, 90)).toBeUndefined();
        expect(resolveRepetitionWeightSuggestion(repetitionStep('bench', 2, { kind: 'percent_one_rm', percent: 40 }), undefined, 100)).toBeUndefined();
    });

    it('uses an exact authored mass, and then preserves the athlete-entered load for the next set', () => {
        const step = repetitionStep('row', 3, { kind: 'mass', kg: 20 });
        expect(resolveRepetitionWeightSuggestion(step, undefined, 50)).toBe(20);
        expect(resolveRepetitionWeightSuggestion(step, 22.5, 50)).toBe(22.5);
    });

    it('retains historical suggestions only when the prescription has no explicit load', () => {
        expect(resolveRepetitionWeightSuggestion(repetitionStep('deadlift', 3), undefined, 140)).toBe(140);
    });
});

describe('resolveRestPreviewStep', () => {
    it('keeps the preview on the current sequential exercise while prescribed sets remain', () => {
        const first = repetitionStep('front-squat', 3);
        const second = repetitionStep('bench', 2);
        const definition = definitionWithBlock('sequential', [first, second]);

        expect(resolveRestPreviewStep(definition, [repetitionEntry(first.id, 1)], 0, 0)?.id).toBe(first.id);
    });

    it('advances to the next sequential exercise once the current exercise is complete', () => {
        const first = repetitionStep('front-squat', 3);
        const second = repetitionStep('bench', 2);
        const definition = definitionWithBlock('sequential', [first, second]);
        const entries = [1, 2, 3].map(index => repetitionEntry(first.id, index));

        expect(resolveRestPreviewStep(definition, entries, 0, 0)?.id).toBe(second.id);
    });

    it('uses persisted rotation progress instead of authored list order for a superset', () => {
        const first = repetitionStep('press', 3);
        const second = repetitionStep('row', 3);
        const definition = definitionWithBlock('superset', [first, second]);
        const entries = [repetitionEntry(first.id, 1), repetitionEntry(second.id, 1)];

        expect(resolveRestPreviewStep(definition, entries, 0, 0)?.id).toBe(first.id);
    });

    it('does not count a warm-up set toward the current exercise\'s prescribed sets', () => {
        const first = repetitionStep('front-squat', 3);
        const second = repetitionStep('bench', 2);
        const definition = definitionWithBlock('sequential', [first, second]);
        const warmup = repetitionEntry(first.id, 0);
        const entries = [
            { ...warmup, payload: { kind: 'repetition' as const, setIndex: 0, reps: 5, isWarmup: true } },
            repetitionEntry(first.id, 1),
            repetitionEntry(first.id, 2),
        ];

        expect(resolveRestPreviewStep(definition, entries, 0, 0)?.id).toBe(first.id);
    });
});

describe('resolveNextDueStep', () => {
    it('waits for the final sequential set, then chooses the next step and finally completion', () => {
        const first = repetitionStep('press', 2);
        const second = repetitionStep('row', 1);
        const definition = definitionWithBlock('sequential', [first, second]);
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1)], 0, 0)).toEqual({ blockIndex: 0, stepIndex: 0 });
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1), repetitionEntry('press', 2)], 0, 0)).toEqual({ blockIndex: 0, stepIndex: 1 });
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1), repetitionEntry('press', 2), repetitionEntry('row', 1)], 0, 1)).toBeNull();
    });

    it('keeps a rotating group balanced and moves to the next block when complete', () => {
        const definition: SessionDefinition = {
            ...definitionWithBlock('superset', [repetitionStep('press', 1), repetitionStep('row', 1)]),
            blocks: [
                definitionWithBlock('superset', [repetitionStep('press', 1), repetitionStep('row', 1)]).blocks[0],
                { id: 'cooldown', role: 'cooldown', executionMode: 'sequential', steps: [repetitionStep('stretch', 1)] },
            ],
        };
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1)], 0, 0)).toEqual({ blockIndex: 0, stepIndex: 1 });
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1), repetitionEntry('row', 1)], 0, 1)).toEqual({ blockIndex: 1, stepIndex: 0 });
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1), repetitionEntry('row', 1), repetitionEntry('stretch', 1)], 1, 0)).toBeNull();
    });

    it('wraps to earlier required work after logging a manually selected final step', () => {
        const definition = definitionWithBlock('sequential', [repetitionStep('press', 1), repetitionStep('row', 1)]);
        expect(resolveNextDueStep(definition, [repetitionEntry('row', 1)], 0, 1)).toEqual({ blockIndex: 0, stepIndex: 0 });
        expect(resolveNextDueStep(definition, [repetitionEntry('row', 1), repetitionEntry('press', 1)], 0, 0)).toBeNull();
    });

    it('skips optional steps in a completed rotating group', () => {
        const group = definitionWithBlock('superset', [repetitionStep('press', 1), repetitionStep('row', 1)]).blocks[0];
        group.steps.push({ ...repetitionStep('bonus', 1), optional: true });
        const definition: SessionDefinition = {
            ...definitionWithBlock('superset', group.steps),
            blocks: [group, { id: 'cooldown', role: 'cooldown', executionMode: 'sequential', steps: [repetitionStep('stretch', 1)] }],
        };
        expect(resolveNextDueStep(definition, [repetitionEntry('press', 1), repetitionEntry('row', 1)], 0, 1))
            .toEqual({ blockIndex: 1, stepIndex: 0 });
    });

    it('waits for both sides of a final hold before returning completion', () => {
        const holdStep: SessionStep = { id: 'hold', kind: 'exercise', laterality: 'per_side', dose: { kind: 'duration', sets: 1, seconds: 30 } };
        const definition = definitionWithBlock('sequential', [holdStep]);
        const left: SessionEntry = { ...repetitionEntry('hold', 1), side: 'left', payload: { kind: 'duration', seconds: 30 } };
        const right: SessionEntry = { ...repetitionEntry('hold', 2), side: 'right', payload: { kind: 'duration', seconds: 30 } };
        expect(resolveRestPreviewStep(definition, [left], 0, 0)).toEqual(holdStep);
        expect(resolveNextDueStep(definition, [left], 0, 0)).toEqual({ blockIndex: 0, stepIndex: 0 });
        expect(resolveNextDueStep(definition, [left, right], 0, 0)).toBeNull();
    });
});

describe('logging controls', () => {
    it('uses Log visibly and specific accessible names for repetition and distance', () => {
        const repetition = renderToStaticMarkup(<RepetitionInputCard step={repetitionStep('press', 1)} onSubmit={() => {}} />);
        const distanceStep: SessionStep = { id: 'run', kind: 'exercise', dose: { kind: 'distance', sets: 1, meters: 100 } };
        const distance = renderToStaticMarkup(<DistanceInputCard step={distanceStep} onSubmit={() => {}} />);
        expect(repetition).toContain('aria-label="Log repetition set">Log</button>');
        expect(distance).toContain('aria-label="Log distance split">Log</button>');
    });

    it('offers each side its own hold timer and log action with the missing side selected', () => {
        const step: SessionStep = { id: 'hold', kind: 'exercise', laterality: 'per_side', dose: { kind: 'duration', sets: 1, seconds: 30 } };
        const left = renderToStaticMarkup(<DurationInputCard step={step} nextSide="left" onSubmit={() => {}} />);
        const right = renderToStaticMarkup(<DurationInputCard step={step} nextSide="right" onSubmit={() => {}} />);
        expect(left).toContain('aria-label="Start left hold timer"');
        expect(left).toContain('aria-label="Log left hold">Log</button>');
        expect(right).toContain('aria-label="Start right hold timer"');
        expect(right).toContain('aria-label="Log right hold">Log</button>');
        expect(right).toContain('Left side');
        expect(right).toContain('Right side');
    });
});

describe('visible group progress', () => {
    it('shows one completed set for two paired side entries', () => {
        const hold: SessionStep = { id: 'hold', kind: 'exercise', title: 'Hold', laterality: 'per_side', dose: { kind: 'duration', sets: 2, seconds: 30 } };
        const block = { ...definitionWithBlock('superset', [hold, repetitionStep('row', 2)]).blocks[0] };
        const left: SessionEntry = { ...repetitionEntry('hold', 1), side: 'left', payload: { kind: 'duration', seconds: 30 } };
        const right: SessionEntry = { ...repetitionEntry('hold', 2), side: 'right', payload: { kind: 'duration', seconds: 30 } };
        const html = renderToStaticMarkup(<GroupProgress block={block} entries={[left, right]} activeStepIndex={0} onSelectStep={() => {}} />);
        expect(html).toContain('Current: Hold (Set 2 of 2)');
        expect(html).not.toContain('Set 3 of 2');
    });
});
