import { describe, expect, it } from 'vitest';
import { SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS } from './subjectiveDriftComparison';
import { REFERENCE_SUBJECTIVE_BASELINE_POLICY } from '../subjectiveBaseline';

describe('Phase 9.6a sensitivity contract', () => {
    it('uses unique configuration ids so report rows remain attributable', () => {
        const ids = SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS.map(config => config.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('does not claim contribution-cap sensitivity before the canonical 9.3 helper accepts a cap parameter', () => {
        // subjectiveDriftStrain currently uses rules.ts STRAIN_Z_CAP directly. Allowing a
        // sensitivity config to alter SubjectiveBaselinePolicy.contributionCap here would
        // create a report label that does not affect the measured candidate at all. Keep
        // every 9.6a config on the canonical reference cap until 9.6b threads the cap into
        // the real helper rather than copying its arithmetic in simulation code.
        for (const config of SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS) {
            expect(config.baselinePolicy.contributionCap).toBe(REFERENCE_SUBJECTIVE_BASELINE_POLICY.contributionCap);
        }
    });
});
