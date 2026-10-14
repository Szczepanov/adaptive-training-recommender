import { describe, expect, it } from 'vitest';
import { HISTORICAL_POLICY_VERSIONS, POLICY_VERSION, isHistoricalPolicyVersion } from './policy';

describe('isHistoricalPolicyVersion', () => {
    it('records the current transition and the previous live policies exactly once', () => {
        expect(POLICY_VERSION).toBe('2026-10-policy-owned-event-horizons-v1');
        expect(HISTORICAL_POLICY_VERSIONS[0]).toBe('2026-10-perf-map-initialization-v1');
        expect(HISTORICAL_POLICY_VERSIONS[1]).toBe('2026-10-perf-coverage-map-lookup-v1');
        expect(HISTORICAL_POLICY_VERSIONS[2]).toBe('2026-10-hyrox-goal-generic-guidance-v1');
        expect(HISTORICAL_POLICY_VERSIONS[3]).toBe('2026-09-forecast-authority-segments-v1');
        expect(HISTORICAL_POLICY_VERSIONS[4]).toBe('2026-09-performed-stimulus-recency-v1');
        expect(HISTORICAL_POLICY_VERSIONS[5]).toBe('2026-09-external-plan-authority-hardening-v1');
        expect(HISTORICAL_POLICY_VERSIONS[6]).toBe('2026-09-date-scoped-event-plan-authority-v1');
        expect(HISTORICAL_POLICY_VERSIONS[7]).toBe('2026-09-external-plan-activation-history-v1');
        expect(HISTORICAL_POLICY_VERSIONS[8]).toBe('2026-09-date-scoped-mechanical-spacing-v1');
        expect(HISTORICAL_POLICY_VERSIONS[9]).toBe('2026-09-static-registry-lookup-indexes-v1');
        expect(HISTORICAL_POLICY_VERSIONS[10]).toBe('2026-09-periodic-athletic-capability-maintenance-v4');
        expect(HISTORICAL_POLICY_VERSIONS[11]).toBe('2026-09-periodic-athletic-capability-maintenance-v3');
        expect(HISTORICAL_POLICY_VERSIONS[12]).toBe('2026-09-periodic-athletic-capability-maintenance-v2');
        expect(HISTORICAL_POLICY_VERSIONS[13]).toBe('2026-09-periodic-athletic-capability-maintenance-v1');
        expect(HISTORICAL_POLICY_VERSIONS[14]).toBe('2026-09-mechanical-progression-live-wiring-v1');
        expect(HISTORICAL_POLICY_VERSIONS[15]).toBe('2026-09-longitudinal-mechanical-impact-exposure-v1');
        expect(HISTORICAL_POLICY_VERSIONS[16]).toBe('2026-09-weekly-aerobic-dose-envelope-v1');
        expect(HISTORICAL_POLICY_VERSIONS[17]).toBe('2026-09-hybrid-strength-unilateral-composition-v1');
        expect(HISTORICAL_POLICY_VERSIONS[18]).toBe('2026-09-neuromuscular-power-maintenance-v1');
        expect(HISTORICAL_POLICY_VERSIONS[19]).toBe('2026-09-olympic-triathlon-plan-taper-budget-v1');
        expect(HISTORICAL_POLICY_VERSIONS[20]).toBe('2026-09-evergreen-quality-transactional-substitution-v1');
        expect(HISTORICAL_POLICY_VERSIONS[21]).toBe('2026-09-cycling-build-strength-support-v1');
        expect(HISTORICAL_POLICY_VERSIONS[22]).toBe('2026-09-established-easy-run-aerobic-coverage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[23]).toBe('2026-09-garmin-cycling-typekey-modality-v1');
        expect(HISTORICAL_POLICY_VERSIONS[24]).toBe('2026-09-evergreen-cycling-quality-spare-capacity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[25]).toBe('2026-09-evergreen-cycling-quality-and-garmin-stimulus-cost-split-v1');
        expect(HISTORICAL_POLICY_VERSIONS[26]).toBe('2026-09-garmin-stimulus-cost-split-v1');
        expect(HISTORICAL_POLICY_VERSIONS[27]).toBe('2026-09-perf-engine-and-ui-lookup-optimizations-v1');
        expect(HISTORICAL_POLICY_VERSIONS[28]).toBe('2026-09-pre-compute-map-for-static-array-lookup-v1');
        expect(HISTORICAL_POLICY_VERSIONS[29]).toBe('2026-09-weekly-allocation-date-diversity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[30]).toBe('2026-09-evergreen-cycling-quality-set-v1');
        expect(HISTORICAL_POLICY_VERSIONS[31]).toBe('2026-09-athlete-relative-aerobic-floor-v1');
        expect(HISTORICAL_POLICY_VERSIONS[32]).toBe('2026-09-modify-tier-aerobic-coverage-specificity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[33]).toBe('2026-09-strength-full-body-reentry-catalog-v1');
        expect(HISTORICAL_POLICY_VERSIONS[34]).toBe('2026-09-strength-deferral-forecast-credit-aging-v1');
        expect(HISTORICAL_POLICY_VERSIONS[35]).toBe('2026-09-time-cap-easy-endurance-truncation-v1');
        expect(HISTORICAL_POLICY_VERSIONS[36]).toBe('2026-09-physical-work-knowledge-lineage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[37]).toBe('2026-09-dsupport-incumbent-proof-order-v1');
        expect(HISTORICAL_POLICY_VERSIONS[38]).toBe('2026-09-performance-goal-workout-coverage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[39]).toBe('2026-09-symptom-compatible-strength-weekly-support-v1');
        expect(HISTORICAL_POLICY_VERSIONS[40]).toBe('2026-09-event-demand-taper-window-v1');
        expect(HISTORICAL_POLICY_VERSIONS[41]).toBe('2026-09-post-rest-reentry-and-preferred-modality-strength-fallback-v1');
        expect(HISTORICAL_POLICY_VERSIONS[42]).toBe('2026-09-post-rest-reentry-readiness-decay-v1');
        expect(HISTORICAL_POLICY_VERSIONS[43]).toBe('2026-09-preferred-modality-strength-fallback-v1');
        expect(HISTORICAL_POLICY_VERSIONS[44]).toBe('2026-09-rolling-load-budget-v3');
        expect(HISTORICAL_POLICY_VERSIONS[45]).toBe('2026-09-rolling-load-budget-v2');
        expect(HISTORICAL_POLICY_VERSIONS[46]).toBe('2026-09-rolling-load-budget-v1');
        expect(HISTORICAL_POLICY_VERSIONS[47]).toBe('2026-09-health-hard-endurance-event-priority-c-merge-v1');
        expect(HISTORICAL_POLICY_VERSIONS[48]).toBe('2026-09-event-priority-c-monotonicity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[49]).toBe('2026-09-health-adherence-hard-endurance-ceiling-v1');
        expect(HISTORICAL_POLICY_VERSIONS[50]).toBe('2026-09-effective-dose-ranking-consistency-v1');
        expect(HISTORICAL_POLICY_VERSIONS[51]).toBe('2026-09-gran-fondo-durability-anchor-spacing-v1');
        expect(HISTORICAL_POLICY_VERSIONS[52]).toBe('2026-09-hard-load-density-race-week-sequencing-v1');
        expect(HISTORICAL_POLICY_VERSIONS[53]).toBe('2026-09-indexed-lookup-parity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[54]).toBe('2026-09-overlay-fallback-conservative-monotonicity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[55]).toBe('2026-09-symptom-compatible-strength-safety-v1');
        expect(HISTORICAL_POLICY_VERSIONS[56]).toBe('2026-09-health-adherence-modality-intensity-v2');
        expect(HISTORICAL_POLICY_VERSIONS[57]).toBe('2026-09-health-adherence-modality-intensity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[58]).toBe('2026-09-triathlon-taper-recovery-reentry-capacity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[59]).toBe('2026-09-performance-goal-demand-projection-v1');
        expect(HISTORICAL_POLICY_VERSIONS[60]).toBe('2026-09-catalog-session-note-dedup-v1');
        expect(HISTORICAL_POLICY_VERSIONS[61]).toBe('2026-09-progression-confirmed-selection-coverage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[62]).toBe('2026-09-onboarding-duration-fallback-v1');
        expect(HISTORICAL_POLICY_VERSIONS[63]).toBe('2026-09-bolt-workout-for-template-cache-v1');
        expect(HISTORICAL_POLICY_VERSIONS[64]).toBe('2026-09-o1-rest-template-lookup-v1');
        expect(HISTORICAL_POLICY_VERSIONS[65]).toBe('2026-09-progression-confirmed-selection-wiring-v2');
        expect(HISTORICAL_POLICY_VERSIONS[66]).toBe('2026-09-progression-confirmed-selection-wiring-v1');
        expect(HISTORICAL_POLICY_VERSIONS[67]).toBe('2026-09-fixed-activity-dedup-identity-unification-v1');
        expect(HISTORICAL_POLICY_VERSIONS[68]).toBe('2026-09-h4-d-ledger-planner-admission-v2');
        expect(HISTORICAL_POLICY_VERSIONS[69]).toBe('2026-09-h4-d-ledger-planner-admission-v1');
        expect(HISTORICAL_POLICY_VERSIONS[70]).toBe('2026-09-h4-intraday-bundle-member-launch-v1');
        expect(HISTORICAL_POLICY_VERSIONS[71]).toBe('2026-09-simulation-sequence-occupational-context-v2');
        expect(HISTORICAL_POLICY_VERSIONS[72]).toBe('2026-09-simulation-sequence-occupational-context-v1');
        expect(HISTORICAL_POLICY_VERSIONS[73]).toBe('2026-09-recommender-recovery-calibration-v1');
        expect(HISTORICAL_POLICY_VERSIONS[74]).toBe('2026-09-sequencing-ranking-diagnostics-v1');
        expect(HISTORICAL_POLICY_VERSIONS[75]).toBe('2026-09-adr-0038-recovery-identity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[76]).toBe('2026-09-week-ahead-effective-dose-projection-v1');
        expect(HISTORICAL_POLICY_VERSIONS[77]).toBe('2026-09-h4-intraday-reassessment-v1');
        expect(HISTORICAL_POLICY_VERSIONS[78]).toBe('2026-09-h4-intraday-bundle-placement-v1');
        expect(HISTORICAL_POLICY_VERSIONS[79]).toBe('2026-09-schedule-overlays-v2');
        expect(HISTORICAL_POLICY_VERSIONS[80]).toBe('2026-09-schedule-overlays-v1');
        expect(HISTORICAL_POLICY_VERSIONS[81]).toBe('2026-09-fixed-activity-cost-dedup-v1');
        expect(HISTORICAL_POLICY_VERSIONS[82]).toBe('2026-09-unlogged-physical-work-v1');
        expect(HISTORICAL_POLICY_VERSIONS[83]).toBe('2026-09-authored-rest-day-v1');
        expect(HISTORICAL_POLICY_VERSIONS[84]).toBe('2026-09-outdoor-easy-cycling-anchor-authority-v1');
        expect(HISTORICAL_POLICY_VERSIONS[85]).toBe('2026-09-outdoor-easy-cycling-v1');
        expect(HISTORICAL_POLICY_VERSIONS[86]).toBe('2026-09-wearable-free-subjective-mode-v1');
        expect(HISTORICAL_POLICY_VERSIONS[87]).toBe('2026-09-persona-judge-safety-and-modality-v1');
        expect(HISTORICAL_POLICY_VERSIONS[88]).toBe('2026-09-post-event-and-adverse-recovery-v1');
        expect(HISTORICAL_POLICY_VERSIONS[89]).toBe('2026-09-canonical-coverage-credit-v1');
        expect(HISTORICAL_POLICY_VERSIONS[90]).toBe('2026-09-canonical-strength-spacing-v1');
        expect(HISTORICAL_POLICY_VERSIONS[91]).toBe('2026-09-skr3-taper-resolution-v1');
        expect(HISTORICAL_POLICY_VERSIONS[92]).toBe('2026-09-safety-policy-remediation-sep-c4');
        expect(HISTORICAL_POLICY_VERSIONS[93]).toBe('2026-09-structured-strength-warmups-v1');
        expect(HISTORICAL_POLICY_VERSIONS[94]).toBe('2026-09-safety-policy-remediation-sep-c3');
        expect(HISTORICAL_POLICY_VERSIONS[95]).toBe('2026-09-safety-policy-remediation-sep-c2');
        expect(HISTORICAL_POLICY_VERSIONS[96]).toBe('2026-09-safety-policy-remediation-sep-c1');
        expect(HISTORICAL_POLICY_VERSIONS[97]).toBe('2026-09-catalogue-lookup-indexes-v1');
        expect(HISTORICAL_POLICY_VERSIONS[98]).toBe('2026-08-acute-fatigue-floors-v1');
        expect(HISTORICAL_POLICY_VERSIONS[99]).toBe('2026-08-adverse-recovery-and-taper-v1');
        expect(HISTORICAL_POLICY_VERSIONS[100]).toBe('2026-08-skr1-persisted-knowledge-lineage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[101]).toBe('2026-08-taper-scoping-and-knowledge-lineage-merge-v1');
        expect(HISTORICAL_POLICY_VERSIONS[102]).toBe('2026-08-sports-knowledge-lineage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[103]).toBe('2026-08-taper-aerobic-modality-scoping-v1');
        expect(HISTORICAL_POLICY_VERSIONS[104]).toBe('2026-08-triathlon-objective-identity-v1');
        expect(HISTORICAL_POLICY_VERSIONS[105]).toBe('2026-08-multisport-bodyweight-strength-v1');
        expect(HISTORICAL_POLICY_VERSIONS[106]).toBe('2026-08-multisport-and-walking-merge-v1');
        expect(HISTORICAL_POLICY_VERSIONS[107]).toBe('2026-08-evergreen-bodyweight-strength-v1');
        expect(HISTORICAL_POLICY_VERSIONS[108]).toBe('2026-08-evergreen-established-history-and-walking-v1');
        expect(HISTORICAL_POLICY_VERSIONS[109]).toBe('2026-08-multisport-running-triathlon-v1');
        expect(HISTORICAL_POLICY_VERSIONS[110]).toBe('2026-08-evergreen-priority-time-cap-v2');
        expect(HISTORICAL_POLICY_VERSIONS[111]).toBe('2026-08-evergreen-priority-time-cap-v1');
        expect(HISTORICAL_POLICY_VERSIONS[112]).toBe('2026-08-safety-adversarial-hardening-v1');
        expect(HISTORICAL_POLICY_VERSIONS[113]).toBe('2026-08-external-double-day-placement-v1');
        expect(HISTORICAL_POLICY_VERSIONS[114]).toBe('2026-08-algorithmic-optimization-v1');
        expect(HISTORICAL_POLICY_VERSIONS[115]).toBe('2026-08-modify-tier-auto-dose-v1');
        expect(HISTORICAL_POLICY_VERSIONS[116]).toBe('2026-08-acute-trajectory-demand-v3');
        expect(HISTORICAL_POLICY_VERSIONS[117]).toBe('2026-08-acute-trajectory-demand-v2');
        expect(HISTORICAL_POLICY_VERSIONS[118]).toBe('2026-08-acute-trajectory-demand-v1');
        expect(HISTORICAL_POLICY_VERSIONS[119]).toBe('2026-08-respiration-strain-v1');
        expect(HISTORICAL_POLICY_VERSIONS[120]).toBe('2026-08-external-plan-v2-v2');
        expect(HISTORICAL_POLICY_VERSIONS[121]).toBe('2026-08-external-plan-v2-v1');
        expect(HISTORICAL_POLICY_VERSIONS[122]).toBe('2026-08-authored-session-authority-v3');
        expect(HISTORICAL_POLICY_VERSIONS[123]).toBe('2026-08-authored-session-authority-v2');
        expect(HISTORICAL_POLICY_VERSIONS[124]).toBe('2026-08-authored-session-authority-v1');
        expect(HISTORICAL_POLICY_VERSIONS[125]).toBe('2026-08-session-adjustment-cost-tiering-v2');
        expect(HISTORICAL_POLICY_VERSIONS[126]).toBe('2026-08-session-adjustment-cost-tiering-v1');
        expect(HISTORICAL_POLICY_VERSIONS[127]).toBe('2026-08-acute-step-surge-fatigue-v1');
        expect(HISTORICAL_POLICY_VERSIONS[128]).toBe('2026-08-external-plan-provenance-v1');
        expect(HISTORICAL_POLICY_VERSIONS[129]).toBe('2026-08-externally-planned-mode-v1');
        expect(HISTORICAL_POLICY_VERSIONS[130]).toBe('2026-08-session-packing-tiebreaker-v1');
        expect(HISTORICAL_POLICY_VERSIONS[131]).toBe('2026-08-planning-overlays-v1');
        expect(HISTORICAL_POLICY_VERSIONS[132]).toBe('2026-08-evergreen-packing-v1');
        expect(HISTORICAL_POLICY_VERSIONS[133]).toBe('2026-08-training-intent-safety-v1');
        expect(HISTORICAL_POLICY_VERSIONS[134]).toBe('2026-08-training-intent-modes-v1');
        expect(HISTORICAL_POLICY_VERSIONS[135]).toBe('2026-08-weekly-role-reservations-v1');
        expect(HISTORICAL_POLICY_VERSIONS[136]).toBe('2026-08-authored-travel-blocks-v1');
        expect(HISTORICAL_POLICY_VERSIONS[137]).toBe('2026-08-weekly-coverage-v3');
        expect(HISTORICAL_POLICY_VERSIONS[138]).toBe('2026-08-weekly-coverage-v2');
        expect(HISTORICAL_POLICY_VERSIONS[139]).toBe('2026-08-weekly-coverage-v1');
        expect(HISTORICAL_POLICY_VERSIONS[140]).toBe('2026-08-single-ranking-path-v1');
        expect(HISTORICAL_POLICY_VERSIONS[141]).toBe('2026-08-objective-credit-v2-v2');
        expect(HISTORICAL_POLICY_VERSIONS[142]).toBe('2026-08-phase5-sequence-planning-v1');
        expect(HISTORICAL_POLICY_VERSIONS[143]).toBe('2026-08-phase6-correctness-carryovers-v1');
        expect(HISTORICAL_POLICY_VERSIONS[144]).toBe('2026-09-prospective-decision-context-canonical-facts-v1');
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-10-perf-map-initialization-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-10-perf-coverage-map-lookup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-10-hyrox-goal-generic-guidance-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-forecast-authority-segments-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-performed-stimulus-recency-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-external-plan-authority-hardening-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-date-scoped-event-plan-authority-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-external-plan-activation-history-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-date-scoped-mechanical-spacing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-static-registry-lookup-indexes-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-periodic-athletic-capability-maintenance-v4',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-periodic-athletic-capability-maintenance-v3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-periodic-athletic-capability-maintenance-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-periodic-athletic-capability-maintenance-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-mechanical-progression-live-wiring-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-longitudinal-mechanical-impact-exposure-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-weekly-aerobic-dose-envelope-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-hybrid-strength-unilateral-composition-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-neuromuscular-power-maintenance-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-olympic-triathlon-plan-taper-budget-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-evergreen-quality-transactional-substitution-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-cycling-build-strength-support-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-established-easy-run-aerobic-coverage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-garmin-cycling-typekey-modality-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-evergreen-cycling-quality-spare-capacity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-evergreen-cycling-quality-and-garmin-stimulus-cost-split-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-garmin-stimulus-cost-split-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-perf-engine-and-ui-lookup-optimizations-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-pre-compute-map-for-static-array-lookup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-weekly-allocation-date-diversity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-evergreen-cycling-quality-set-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-athlete-relative-aerobic-floor-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-modify-tier-aerobic-coverage-specificity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-strength-full-body-reentry-catalog-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-strength-deferral-forecast-credit-aging-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-time-cap-easy-endurance-truncation-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-physical-work-knowledge-lineage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-dsupport-incumbent-proof-order-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-performance-goal-workout-coverage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-symptom-compatible-strength-weekly-support-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-event-demand-taper-window-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-post-rest-reentry-and-preferred-modality-strength-fallback-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-post-rest-reentry-readiness-decay-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-preferred-modality-strength-fallback-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-rolling-load-budget-v3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-rolling-load-budget-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-rolling-load-budget-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-hard-endurance-event-priority-c-merge-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-event-priority-c-monotonicity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-hard-endurance-ceiling-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-effective-dose-ranking-consistency-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-gran-fondo-durability-anchor-spacing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-hard-load-density-race-week-sequencing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-indexed-lookup-parity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-overlay-fallback-conservative-monotonicity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-symptom-compatible-strength-safety-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-modality-intensity-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-modality-intensity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-triathlon-taper-recovery-reentry-capacity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-performance-goal-demand-projection-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-catalog-session-note-dedup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-progression-confirmed-selection-coverage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-onboarding-duration-fallback-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-bolt-workout-for-template-cache-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-o1-rest-template-lookup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-progression-confirmed-selection-wiring-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-progression-confirmed-selection-wiring-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-fixed-activity-dedup-identity-unification-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-d-ledger-planner-admission-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-d-ledger-planner-admission-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-intraday-bundle-member-launch-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-simulation-sequence-occupational-context-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-simulation-sequence-occupational-context-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-recommender-recovery-calibration-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-sequencing-ranking-diagnostics-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-adr-0038-recovery-identity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-week-ahead-effective-dose-projection-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-intraday-reassessment-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-intraday-bundle-placement-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-schedule-overlays-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-schedule-overlays-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-fixed-activity-cost-dedup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-unlogged-physical-work-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-authored-rest-day-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-outdoor-easy-cycling-anchor-authority-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-outdoor-easy-cycling-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-wearable-free-subjective-mode-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-persona-judge-safety-and-modality-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-post-event-and-adverse-recovery-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-canonical-coverage-credit-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-canonical-strength-spacing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-skr3-taper-resolution-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-safety-policy-remediation-sep-c4',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-structured-strength-warmups-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-safety-policy-remediation-sep-c3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-safety-policy-remediation-sep-c2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-safety-policy-remediation-sep-c1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-catalogue-lookup-indexes-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-acute-fatigue-floors-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-adverse-recovery-and-taper-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-skr1-persisted-knowledge-lineage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-taper-scoping-and-knowledge-lineage-merge-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-sports-knowledge-lineage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-taper-aerobic-modality-scoping-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-triathlon-objective-identity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-multisport-bodyweight-strength-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-multisport-and-walking-merge-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-evergreen-bodyweight-strength-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-evergreen-established-history-and-walking-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-multisport-running-triathlon-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-evergreen-priority-time-cap-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-evergreen-priority-time-cap-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-safety-adversarial-hardening-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-external-double-day-placement-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-algorithmic-optimization-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-modify-tier-auto-dose-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-acute-trajectory-demand-v3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-acute-trajectory-demand-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-acute-trajectory-demand-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-respiration-strain-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-external-plan-v2-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-external-plan-v2-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-authored-session-authority-v3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-authored-session-authority-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-authored-session-authority-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-session-adjustment-cost-tiering-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-session-adjustment-cost-tiering-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-acute-step-surge-fatigue-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-external-plan-provenance-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-externally-planned-mode-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-session-packing-tiebreaker-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-planning-overlays-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-evergreen-packing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-training-intent-safety-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-training-intent-modes-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-weekly-role-reservations-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-authored-travel-blocks-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-weekly-coverage-v3',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-weekly-coverage-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-weekly-coverage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-single-ranking-path-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-objective-credit-v2-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-phase5-sequence-planning-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-08-phase6-correctness-carryovers-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-prospective-decision-context-canonical-facts-v1',
            ),
        ).toHaveLength(1);
    });

    it('returns true for all known historical versions', () => {
        for (const version of HISTORICAL_POLICY_VERSIONS) {
            expect(isHistoricalPolicyVersion(version)).toBe(true);
        }
    });

    it('returns false for the current policy version', () => {
        expect(isHistoricalPolicyVersion(POLICY_VERSION)).toBe(false);
    });

    it('returns false for unknown arbitrary versions', () => {
        expect(isHistoricalPolicyVersion('1999-01-unknown-version-v1')).toBe(false);
        expect(isHistoricalPolicyVersion('')).toBe(false);
    });
});
