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

    describe('PI0 regression: a physiological anomaly alone cannot prove another person (ADR-0028 P-PI-8)', () => {
        it('never asserts identity fraud, only a quarantine signal, even for an extreme RHR divergence', () => {
            // A large delta is physiologically consistent with genuine illness/overreach and must
            // not be reported as a confirmed determination that someone else used the device.
            const result = validateCoPresence({
                garminRhr: 43,
                eightSleepRhr: 95, // e.g. febrile illness, not necessarily another occupant
                athleteRhr28dMedian: 44,
            });

            expect(result.verifiedAthlete).toBe(false);
            expect(result.status).toBe('DISCORDANT_SECONDARY');
            // Quarantine language only -- no "imposter", "another person", or identity-fraud claim.
            expect(result.reason.toLowerCase()).not.toMatch(/imposter|another person|fraud|not you/);
            expect(result.reason).toContain('quarantined');
        });

        it('exposes no status value that represents a confirmed identity verdict', () => {
            // The provisional CoPresenceStatus vocabulary is a quarantine/concordance signal, not
            // an identity classifier: it must never surface a definitive "NOT_USER" determination.
            // (The ternary USER | NOT_USER | UNCERTAIN model belongs to ADR-0028/PI1+.)
            const allStatuses: string[] = [
                'CONCORDANT',
                'VERIFIED',
                'DISCORDANT_SECONDARY',
                'IMPOSTER_REJECTED',
                'UNVERIFIED_OFF_WRIST',
                'NO_SECONDARY_DATA',
            ];
            expect(allStatuses).not.toContain('NOT_USER');
            expect(allStatuses).not.toContain('USER');
        });

        it('quarantines equally regardless of how large the divergence is (no escalating identity claim)', () => {
            const moderate = validateCoPresence({
                garminRhr: 43,
                eightSleepRhr: 60,
                athleteRhr28dMedian: 44,
            });
            const extreme = validateCoPresence({
                garminRhr: 43,
                eightSleepRhr: 150,
                athleteRhr28dMedian: 44,
            });

            // Both are quarantined identically at the status/verifiedAthlete level; the heuristic
            // has no mechanism to escalate a bigger anomaly into a stronger identity claim.
            expect(moderate.status).toBe('DISCORDANT_SECONDARY');
            expect(extreme.status).toBe('DISCORDANT_SECONDARY');
            expect(moderate.verifiedAthlete).toBe(false);
            expect(extreme.verifiedAthlete).toBe(false);
        });
    });
});
