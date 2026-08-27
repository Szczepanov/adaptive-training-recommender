import { describe, expect, it } from 'vitest';
import { validateCoPresence } from './coPresenceValidator';

describe('coPresenceValidator (ADR-0027 D-MS-IDENTITY, D-MS-PREBASE)', () => {
    it('returns CONCORDANT when Garmin and Eight Sleep RHR and timing are concordant', () => {
        const result = validateCoPresence({
            garminRhr: 44,
            eightSleepRhr: 45,
            athleteRhr28dMedian: 44,
            garminSleepInterval: { startIso: '2026-08-27T22:30:00Z', endIso: '2026-08-28T06:30:00Z' },
            eightSleepInterval: { startIso: '2026-08-27T22:45:00Z', endIso: '2026-08-28T06:20:00Z' },
        });

        expect(result.verifiedAthlete).toBe(true);
        expect(result.status).toBe('CONCORDANT');
        expect(result.rhrDelta).toBe(1.0);
        expect(result.timingOverlapMinutes).toBe(455);
    });

    it('quarantines secondary record when sleep timing mismatch occurs (<60 min overlap)', () => {
        const result = validateCoPresence({
            garminRhr: 44,
            eightSleepRhr: 45,
            athleteRhr28dMedian: 44,
            garminSleepInterval: { startIso: '2026-08-27T23:00:00Z', endIso: '2026-08-28T07:00:00Z' },
            eightSleepInterval: { startIso: '2026-08-27T14:00:00Z', endIso: '2026-08-27T14:45:00Z' }, // Nap during day
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('DISCORDANT_SECONDARY');
        expect(result.reason).toContain('Sleep timing mismatch');
    });

    it('quarantines secondary record when cross-sensor physiological divergence occurs (RHR 82 bpm vs Garmin 43 bpm)', () => {
        const result = validateCoPresence({
            garminRhr: 43,
            eightSleepRhr: 82,
            athleteRhr28dMedian: 44,
            maxRhrDeltaBpm: 10.0,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('DISCORDANT_SECONDARY');
        expect(result.rhrDelta).toBe(39.0);
        expect(result.reason).toContain('physiological divergence');
    });

    it('quarantines off-wrist night from baseline mutation (D-MS-PREBASE) even if plausible', () => {
        const result = validateCoPresence({
            garminRhr: null,
            eightSleepRhr: 45,
            athleteRhr28dMedian: 44,
            maxUnverifiedRhrDeltaBpm: 14.0,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('UNVERIFIED_OFF_WRIST');
        expect(result.reason).toContain('quarantined from baseline mutation');
    });

    it('quarantines watch off-wrist when mattress RHR diverges from baseline (RHR 75 bpm vs baseline 44 bpm)', () => {
        const result = validateCoPresence({
            garminRhr: null,
            eightSleepRhr: 75,
            athleteRhr28dMedian: 44,
            maxUnverifiedRhrDeltaBpm: 14.0,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('DISCORDANT_SECONDARY');
    });

    it('handles sleeping away from pod (travel/hotel) with Garmin sole authority', () => {
        const result = validateCoPresence({
            garminRhr: 44,
            eightSleepRhr: null,
        });

        expect(result.verifiedAthlete).toBe(true);
        expect(result.status).toBe('NO_SECONDARY_DATA');
    });

    it('returns unverified when watch is off-wrist and no historical baseline exists', () => {
        const result = validateCoPresence({
            garminRhr: null,
            eightSleepRhr: 45,
            athleteRhr28dMedian: null,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('UNVERIFIED_OFF_WRIST');
        expect(result.reason).toContain('cannot be verified without Garmin RHR or a historical baseline');
    });
});
