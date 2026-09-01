import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    SessionRunner,
    resolveRepetitionWeightSuggestion,
    resolveRestPreviewStep,
} from './SessionRunner';
import { formatSessionLoad } from '../../sessions/loadDisplay';
import type { SessionDefinition, SessionEntry, SessionStep } from '../../sessions/models';

vi.mock('../../hooks/useSessionRunner', () => ({
    useSessionRunner: () => ({
        activeStep: null,
        activeBlock: null,
        activeBlockIndex: 0,
        activeStepIndex: 0,
        definition: null,
        entries: [],
        execution: null,
        isRestoring: false,
    }),
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
    it('offers a preview before starting every reviewed session', () => {
        const html = renderToStaticMarkup(<SessionRunner userId="user-1" />);

        expect(html).toContain('Start a Structured Session');
        expect(html).toContain('Preview');
        expect(html).toContain('Start Session →');
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
});
