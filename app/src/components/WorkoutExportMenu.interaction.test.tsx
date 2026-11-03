import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutExportMenu } from './WorkoutExportMenu';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), download: vi.fn(), cursor: 0 }));
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => [mocks.cursor++ === 0 ? true : initial, vi.fn()],
    useCallback: (callback: unknown) => callback,
    useMemo: (compute: () => unknown) => compute(),
    useRef: () => ({ current: null }),
    useEffect: () => {},
}));
vi.mock('../services/garminWorkoutQueueService', () => ({ garminWorkoutQueueService: { queueWorkout: mocks.queue } }));
vi.mock('../utils/workoutJsonExport', async importOriginal => ({
    ...await importOriginal<typeof import('../utils/workoutJsonExport')>(),
    downloadJsonFile: mocks.download,
}));

type ElementProps = { children?: ReactNode; onClick?: () => Promise<void> | void; disabled?: boolean; className?: string };
function walk(node: ReactNode): ReactElement<ElementProps>[] {
    if (!isValidElement<ElementProps>(node)) return [];
    return [node, ...Children.toArray(node.props.children).flatMap(walk)];
}
function render(garminSyncDisabled?: boolean) {
    mocks.cursor = 0;
    return walk(WorkoutExportMenu({ userId: 'u1', date: '2026-11-03', title: 'Ride', modality: 'cycling', garminSyncDisabled }));
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.queue.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('WorkoutExportMenu Garmin-only gate', () => {
    it('disables Garmin sync and refuses a direct handler call while keeping downloads enabled', async () => {
        const buttons = render(true).filter(element => element.type === 'button');
        const sync = buttons.find(element => element.props.className?.includes('primary-action'))!;
        expect(sync.props.disabled).toBe(true);
        await sync.props.onClick!();
        expect(mocks.queue).not.toHaveBeenCalled();

        const downloads = buttons.filter(element => element.props.className === 'workout-export-item');
        expect(downloads).toHaveLength(3); // Zwift, JSON download, JSON copy
        expect(downloads.every(element => !element.props.disabled)).toBe(true);
        await downloads[1].props.onClick!();
        expect(mocks.download).toHaveBeenCalledWith('Ride_2026-11-03', expect.objectContaining({ title: 'Ride' }));
    });

    it.each([undefined, false])('preserves Garmin sync for existing callers (%s)', async disabled => {
        const sync = render(disabled).find(element => element.props.className?.includes('primary-action'))!;
        expect(sync.props.disabled).toBe(false);
        await sync.props.onClick!();
        expect(mocks.queue).toHaveBeenCalledWith('u1', '2026-11-03', expect.objectContaining({ title: 'Ride' }));
    });
});
