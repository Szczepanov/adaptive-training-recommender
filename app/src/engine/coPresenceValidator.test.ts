import { describe, expect, it } from 'vitest';
import { validateCoPresence } from './coPresenceValidator';

describe('coPresenceValidator (ADR-0027)', () => {
    it('returns VERIFIED when Garmin and Eight Sleep RHR are concordant', () => {
        const result = validateCoPresence({
            garminRhr: 44,
            eightSleepRhr: 45,
            athleteRhr28dMedian: 44,
        });

        expect(result.verifiedAthlete).toBe(true);
        expect(result.status).toBe('VERIFIED');
        expect(result.rhrDelta).toBe(1.0);
    });

    it('rejects Eight Sleep as imposter when child sleeps on bed (RHR 82 bpm vs Garmin 43 bpm)', () => {
        const result = validateCoPresence({
            garminRhr: 43,
            eightSleepRhr: 82,
            athleteRhr28dMedian: 44,
            maxRhrDeltaBpm: 8.0,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('IMPOSTER_REJECTED');
        expect(result.rhrDelta).toBe(39.0);
        expect(result.reason).toContain('Likely a family member');
    });

    it('handles watch off-wrist overnight when genuine athlete sleeps on bed', () => {
        const result = validateCoPresence({
            garminRhr: null,
            eightSleepRhr: 45,
            athleteRhr28dMedian: 44,
            maxUnverifiedRhrDeltaBpm: 12.0,
        });

        expect(result.verifiedAthlete).toBe(true);
        expect(result.status).toBe('UNVERIFIED_OFF_WRIST');
    });

    it('rejects watch off-wrist when child sleeps on bed (RHR 75 bpm vs baseline 44 bpm)', () => {
        const result = validateCoPresence({
            garminRhr: null,
            eightSleepRhr: 75,
            athleteRhr28dMedian: 44,
            maxUnverifiedRhrDeltaBpm: 12.0,
        });

        expect(result.verifiedAthlete).toBe(false);
        expect(result.status).toBe('IMPOSTER_REJECTED');
    });

    it('handles sleeping away from pod (travel/hotel) with Garmin authoritative', () => {
        const result = validateCoPresence({
            garminRhr: 44,
            eightSleepRhr: null,
        });

        expect(result.verifiedAthlete).toBe(true);
        expect(result.status).toBe('NO_SECONDARY_DATA');
    });
});
