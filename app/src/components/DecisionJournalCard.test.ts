import { describe, expect, it, vi } from 'vitest';
import { exportDecisionJournalEvidenceOnce } from '../utils/decisionJournalEvidenceExport';
import type { ShadowLogResult } from '../services/shadowLogService';

const RESULT: ShadowLogResult = {
    rows: [], startDate: '2026-07-06', endDate: '2026-08-16', unavailableSources: [],
    sourceQuality: { subjectiveCheckins: { status: 'MISSING', issueCount: 0 } },
};

function deferred<T>() {
    let resolve: (value: T) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve: resolve!, reject: reject! };
}

describe('DecisionJournalCard shadow evidence export action', () => {
    it('sets loading, disables a duplicate click, and reports success after one 42-day export', async () => {
        const pending = deferred<ShadowLogResult>();
        const build = vi.fn(() => pending.promise);
        const download = vi.fn();
        const setExporting = vi.fn();
        const setStatus = vi.fn();
        const lock = { current: false };

        const first = exportDecisionJournalEvidenceOnce({
            lock, userId: 'u1', date: '2026-08-16', build, download, setExporting, setStatus,
        });
        const duplicate = await exportDecisionJournalEvidenceOnce({
            lock, userId: 'u1', date: '2026-08-16', build, download, setExporting, setStatus,
        });

        expect(setExporting).toHaveBeenCalledWith(true);
        expect(duplicate).toBe(false);
        expect(build).toHaveBeenCalledTimes(1);
        expect(build).toHaveBeenCalledWith('u1', '2026-07-06', '2026-08-16');

        pending.resolve(RESULT);
        await expect(first).resolves.toBe(true);
        expect(download).toHaveBeenCalledWith(RESULT);
        expect(setStatus).toHaveBeenLastCalledWith('Downloaded the private evidence CSV and aggregate readout manifest.');
        expect(setExporting).toHaveBeenLastCalledWith(false);
        expect(lock.current).toBe(false);
    });

    it('clears loading and reports an error when the evidence read fails', async () => {
        const setExporting = vi.fn();
        const setStatus = vi.fn();
        const download = vi.fn();
        const lock = { current: false };

        await expect(exportDecisionJournalEvidenceOnce({
            lock, userId: 'u1', date: '2026-08-16', build: vi.fn().mockRejectedValue(new Error('offline')),
            download, setExporting, setStatus,
        })).resolves.toBe(false);

        expect(download).not.toHaveBeenCalled();
        expect(setStatus).toHaveBeenLastCalledWith('Could not export the shadow evidence. Retry when the data connection is available.');
        expect(setExporting).toHaveBeenLastCalledWith(false);
        expect(lock.current).toBe(false);
    });
});
