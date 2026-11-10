/**
 * Carried load on distance sets: farmer/suitcase carries and sled work are prescribed by
 * distance, and the athlete must be able to log the weight they carried.
 *
 * Like `RepetitionInputCard.interaction.test.tsx`, hooks are mocked and the component is called
 * directly because jsdom is not installed.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStep } from '../../../sessions/models';

vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
    };
});

import { DistanceInputCard } from './DistanceInputCard';

interface Props {
    children?: ReactNode;
    onSubmit?: (e: unknown) => void;
    'aria-label'?: string;
}

function findElement(node: ReactNode, predicate: (el: ReactElement<Props>) => boolean): ReactElement<Props> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const hit = findElement(child, predicate);
            if (hit) return hit;
        }
        return null;
    }
    if (!isValidElement(node)) return null;
    const element = node as ReactElement<Props>;
    if (predicate(element)) return element;
    return findElement(element.props.children, predicate);
}

const farmerCarry: SessionStep = {
    id: 'carry',
    kind: 'exercise',
    exerciseRef: { kind: 'catalog', exerciseId: 'farmer_carry' },
    dose: { kind: 'distance', sets: 3, meters: 40 },
};
const sprint: SessionStep = {
    id: 'sprint',
    kind: 'exercise',
    exerciseRef: { kind: 'catalog', exerciseId: 'sprint_15m' },
    dose: { kind: 'distance', sets: 4, meters: 15 },
};

function loadField(tree: ReactNode) {
    return findElement(tree, el => el.props['aria-label'] === 'Load in kilograms');
}

describe('DistanceInputCard load', () => {
    it('offers a load field for a carry and logs the suggested load with the distance', () => {
        const onSubmit = vi.fn();
        const tree = DistanceInputCard({ step: farmerCarry, suggestedLoadKg: 48, onSubmit }) as ReactNode;
        expect(loadField(tree)).not.toBeNull();

        findElement(tree, el => el.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });

        expect(onSubmit).toHaveBeenCalledWith({ kind: 'distance', meters: 40, loadKg: 48 });
    });

    it('omits the load when the athlete leaves it empty', () => {
        const onSubmit = vi.fn();
        const tree = DistanceInputCard({ step: farmerCarry, onSubmit }) as ReactNode;
        findElement(tree, el => el.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });
        expect(onSubmit).toHaveBeenCalledWith({ kind: 'distance', meters: 40 });
    });

    it('hides the load field for an unloaded sprint drill', () => {
        const tree = DistanceInputCard({ step: sprint, onSubmit: vi.fn() }) as ReactNode;
        expect(loadField(tree)).toBeNull();
    });
});
