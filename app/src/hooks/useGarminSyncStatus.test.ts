import { describe, it, expect } from 'vitest';
import { useGarminSyncStatus } from './useGarminSyncStatus';

// This repo has no interactive component/hook-render test harness (no
// @testing-library/react, no jsdom environment configured) -- useEffect never runs
// under react-dom/server, so the subscriptions this hook installs can't be meaningfully
// exercised here (see GarminSyncNowButton.test.tsx for the same constraint). The status
// resolution this hook is built around is a pure function for exactly that reason --
// see garminSyncStatusResolver.test.ts for its real behavioral coverage (status/isBusy
// transitions, unified GET/POST timestamp aggregation, error precedence).
describe('useGarminSyncStatus', () => {
    it('exports useGarminSyncStatus function', () => {
        expect(typeof useGarminSyncStatus).toBe('function');
    });
});
