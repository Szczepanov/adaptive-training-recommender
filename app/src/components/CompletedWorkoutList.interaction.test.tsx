/**
 * #895 acceptance criterion 12 (UI half): the real `onClick` props on the manual link and
 * unlink buttons forward the right occurrence/source identifiers to the callbacks.
 *
 * `@testing-library/react` and jsdom are not installed (and must not be added here), so
 * this renders without a DOM: `useState` is the only hook in the tree and is mocked, then
 * the function-component element tree is expanded by hand and the `onClick` handlers on
 * the rendered `<button>` elements are invoked directly. It proves click wiring only, not
 * a browser click against the emulator.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { completeReads } from '../training-occurrence/workoutSourceDiagnostics.fixtures';

vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual, useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()] };
});

import { CompletedWorkoutList } from './CompletedWorkoutList';

interface RenderedButton { text: string; onClick: () => void }

function textOf(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
    return '';
}

function collectButtons(node: ReactNode, out: RenderedButton[] = []): RenderedButton[] {
    if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
    if (Array.isArray(node)) {
        node.forEach(child => collectButtons(child, out));
        return out;
    }
    if (!isValidElement(node)) return out;
    const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
    if (typeof element.type === 'function') {
        const component = element.type as (props: unknown) => ReactNode;
        return collectButtons(component(element.props), out);
    }
    if (element.type === 'button' && element.props.onClick) {
        out.push({ text: textOf(element.props.children).trim(), onClick: element.props.onClick });
    }
    return collectButtons(element.props.children, out);
}

const structuredOnly: CompletedWorkoutView = {
    performedOccurrenceId: 'pto-1',
    sourceKeys: ['structured_execution:exec-1'],
    localDate: '2026-08-26',
    modality: 'strength',
    startedAt: '2026-08-26T06:52:00.000Z',
    endedAt: '2026-08-26T07:32:00.000Z',
    sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
    reconciliation: { state: 'single_source' },
    structured: {
        title: 'Heavy Squat Day',
        comparison: {
            definitionId: 'w-1', revision: 1, title: 'Heavy Squat Day',
            totalPlannedSteps: 0, completedStepsCount: 0, missingRequiredStepsCount: 0,
            stepComparisons: [],
            summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        },
        steps: [],
        performedRest: 'recorded',
    },
    garminExerciseSetsAreDiagnosticOnly: true,
    sourceReads: { ...completeReads, provider: 'not_linked' },
};

const matched: CompletedWorkoutView = {
    ...structuredOnly,
    performedOccurrenceId: 'pto-matched',
    sourceKeys: ['structured_execution:exec-1', 'provider_activity:garmin:act-1'],
    sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] },
    reconciliation: { state: 'matched', matcherVersion: 'matcher-v1', confidence: 0.9 },
    sourceReads: completeReads,
    garmin: {
        activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40,
        trainingEffectAerobic: 2.1, trainingEffectAnaerobic: 1.0, averageHr: 120, maxHr: 158,
        activityTrainingLoad: 90, intensityTag: 'moderate', exerciseSets: [],
    },
};

const garminOnly: CompletedWorkoutView = {
    ...matched,
    performedOccurrenceId: 'pto-garmin',
    sourceKeys: ['provider_activity:garmin:act-1'],
    structured: undefined,
    sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
    reconciliation: { state: 'ambiguous' },
    garminExerciseSetsAreDiagnosticOnly: false,
};

describe('CompletedWorkoutList click wiring (#895 criterion 12)', () => {
    it('clicking "Unlink Garmin source" calls onUnlinkSource with the occurrence id and Garmin source key', () => {
        const onUnlinkSource = vi.fn();
        const buttons = collectButtons(<CompletedWorkoutList workouts={[matched]} onUnlinkSource={onUnlinkSource} />);
        const unlink = buttons.filter(b => b.text === 'Unlink Garmin source');
        expect(unlink).toHaveLength(1);
        expect(onUnlinkSource).not.toHaveBeenCalled();
        unlink[0].onClick();
        expect(onUnlinkSource).toHaveBeenCalledTimes(1);
        expect(onUnlinkSource).toHaveBeenCalledWith('pto-matched', 'provider_activity:garmin:act-1');
    });

    it('clicking "Link Garmin ..." calls onLinkSources with (structured id, provider occurrence id)', () => {
        const onLinkSources = vi.fn();
        const buttons = collectButtons(<CompletedWorkoutList workouts={[structuredOnly, garminOnly]} onLinkSources={onLinkSources} />);
        const link = buttons.filter(b => b.text.startsWith('Link Garmin'));
        expect(link).toHaveLength(1);
        expect(onLinkSources).not.toHaveBeenCalled();
        link[0].onClick();
        expect(onLinkSources).toHaveBeenCalledTimes(1);
        expect(onLinkSources).toHaveBeenCalledWith('pto-1', 'pto-garmin');
    });

    it('renders no link or unlink control when the handlers are omitted', () => {
        const buttons = collectButtons(<CompletedWorkoutList workouts={[structuredOnly, matched, garminOnly]} />);
        expect(buttons.some(b => b.text.startsWith('Link Garmin'))).toBe(false);
        expect(buttons.some(b => b.text === 'Unlink Garmin source')).toBe(false);
    });
});
