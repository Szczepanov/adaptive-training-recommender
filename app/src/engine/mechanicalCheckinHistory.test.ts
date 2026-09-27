import { describe, expect, it, vi } from 'vitest';
import {
    mechanicalCheckinRange,
    resolveMechanicalCheckinHistory,
    toMechanicalCheckinRecords,
    type MechanicalCheckinHistoryProvider,
} from './mechanicalCheckinHistory';
import type { DailySubjectiveCheckin } from './models';

vi.mock('./firestoreMechanicalCheckinHistory', () => ({
    firestoreMechanicalCheckinHistoryProvider: {
        getCheckins: vi.fn().mockResolvedValue([]),
    },
}));

const DATE = '2026-09-20';

function checkin(date: string, submittedAt = `${date}T07:00:00.000Z`): DailySubjectiveCheckin {
    return {
        userId: 'athlete', date, readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, mentalStress: 2, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt,
    } as DailySubjectiveCheckin;
}

describe('mechanical check-in history (#804 orchestration)', () => {
    it('covers the 14-day continuity window through today inclusive', () => {
        expect(mechanicalCheckinRange(DATE)).toEqual({
            startDateInclusive: '2026-09-06',
            endDateExclusive: '2026-09-21',
        });
    });

    it('keeps one in-range record per date, latest submission wins, sorted ascending', () => {
        const records = toMechanicalCheckinRecords([
            checkin('2026-09-20'),
            checkin('2026-09-05'),
            checkin('2026-09-21'),
            checkin('2026-09-10', '2026-09-10T07:00:00.000Z'),
            { ...checkin('2026-09-10', '2026-09-10T09:00:00.000Z'), soreness: 6 },
            checkin('2026-09-06'),
        ], DATE);

        expect(records.map(record => record.date)).toEqual(['2026-09-06', '2026-09-10', '2026-09-20']);
        expect(records[1].checkin.soreness).toBe(6);
    });

    it('reads the range through an injected provider', async () => {
        const provider: MechanicalCheckinHistoryProvider = {
            getCheckins: vi.fn().mockResolvedValue([checkin('2026-09-19')]),
        };

        const records = await resolveMechanicalCheckinHistory('athlete', DATE, provider);

        expect(provider.getCheckins).toHaveBeenCalledWith('athlete', '2026-09-06', '2026-09-21');
        expect(records).toEqual([{ date: '2026-09-19', checkin: checkin('2026-09-19') }]);
    });

    it('falls back to the lazily imported Firestore provider', async () => {
        const { firestoreMechanicalCheckinHistoryProvider } = await import('./firestoreMechanicalCheckinHistory');
        vi.mocked(firestoreMechanicalCheckinHistoryProvider.getCheckins).mockResolvedValueOnce([checkin('2026-09-18')]);

        const records = await resolveMechanicalCheckinHistory('athlete', DATE);

        expect(firestoreMechanicalCheckinHistoryProvider.getCheckins).toHaveBeenCalledWith('athlete', '2026-09-06', '2026-09-21');
        expect(records.map(record => record.date)).toEqual(['2026-09-18']);
    });

    it('fails closed to no records when the read fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const provider: MechanicalCheckinHistoryProvider = {
            getCheckins: vi.fn().mockRejectedValue(new Error('offline')),
        };

        await expect(resolveMechanicalCheckinHistory('athlete', DATE, provider)).resolves.toEqual([]);
        warn.mockRestore();
    });
});
