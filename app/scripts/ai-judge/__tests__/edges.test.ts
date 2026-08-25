import { describe, expect, it } from 'vitest';
import { FAMILY_EDGES, getFamilyEdges } from '../edges.mjs';

describe('edges module', () => {
  const expectedFamilies = [
    'objective_recovery',
    'subjective_recovery',
    'recent_training',
    'event_proximity',
    'preferences_capacity',
    'event_demand',
    'interactions',
    'delivered_dose_variance',
    'concurrent_strength_endurance',
    'injury_constraints',
    'planning_modes_overlays',
  ];

  const expectedEdgeIdsByFamily = {
    objective_recovery: ['judge_obj_neutral->judge_obj_hrv_1sd', 'judge_obj_hrv_1sd->judge_obj_hrv_2sd', 'judge_obj_hrv_2sd->judge_obj_combined_bad', 'judge_obj_neutral->judge_obj_rhr_1sd', 'judge_obj_neutral->judge_obj_rhr_2sd', 'judge_obj_neutral->judge_obj_poor_sleep', 'judge_obj_neutral->judge_obj_low_battery'],
    subjective_recovery: ['judge_subj_neutral->judge_subj_fresh', 'judge_subj_neutral->judge_subj_low_readiness', 'judge_subj_neutral->judge_subj_fatigue', 'judge_subj_neutral->judge_subj_soreness', 'judge_subj_neutral->judge_subj_stress', 'judge_subj_neutral->judge_subj_low_motivation', 'judge_subj_neutral->judge_subj_combined_bad'],
    recent_training: ['judge_load_none->judge_load_easy_yesterday', 'judge_load_none->judge_load_hard_yesterday', 'judge_load_hard_3d->judge_load_hard_2d', 'judge_load_hard_2d->judge_load_hard_yesterday'],
    event_proximity: ['judge_event_40d->judge_event_20d', 'judge_event_20d->judge_event_14d', 'judge_event_14d->judge_event_7d', 'judge_event_7d->judge_event_3d'],
    preferences_capacity: ['judge_pref_neutral->judge_pref_conservative', 'judge_pref_neutral->judge_pref_active_recovery', 'judge_pref_neutral->judge_pref_mixed_recovery', 'judge_pref_neutral->judge_pref_45min', 'judge_pref_neutral->judge_pref_90min'],
    event_demand: ['judge_demand_crit_A->judge_demand_crit_B', 'judge_demand_crit_A->judge_demand_gran_A', 'judge_demand_gran_A->judge_demand_gran_B'],
    interactions: ['judge_int_badobj_noload->judge_int_badobj_hard_yday', 'judge_int_badsubj_goodobj->judge_int_goodsubj_badobj', 'judge_int_race7_fresh->judge_int_race7_hard_yday'],
    delivered_dose_variance: ['judge_dose_exact->judge_dose_surged', 'judge_dose_exact->judge_dose_curtailed', 'judge_dose_exact->judge_dose_skipped'],
    concurrent_strength_endurance: ['judge_concurrent_none->judge_concurrent_heavy_lower', 'judge_concurrent_none->judge_concurrent_heavy_upper', 'judge_concurrent_none->judge_concurrent_power_maintenance'],
    injury_constraints: ['judge_injury_none->judge_injury_running_restricted', 'judge_injury_none->judge_injury_lower_body_restricted', 'judge_injury_lower_body_restricted->judge_injury_expired'],
    planning_modes_overlays: ['judge_mode_event_directed->judge_mode_evergreen', 'judge_mode_event_directed->judge_mode_travel_overlay', 'judge_mode_event_directed->judge_mode_conservative_preference'],
  };

  it('matches the complete corpus-facing family-edge contract', () => {
    expect(Object.keys(FAMILY_EDGES).sort()).toEqual([...expectedFamilies].sort());

    for (const familyId of expectedFamilies) {
      const edges = getFamilyEdges(familyId);
      const edgeIds = edges.map((edge) => `${edge.from}->${edge.to}`);
      expect(edgeIds).toEqual(expectedEdgeIdsByFamily[familyId]);

      const validCaseIds = new Set(
        expectedEdgeIdsByFamily[familyId].flatMap((edgeId) => edgeId.split('->'))
      );
      for (const edge of edges) {
        expect(validCaseIds).toContain(edge.from);
        expect(validCaseIds).toContain(edge.to);
        expect(edge.from).not.toBe(edge.to); // No self-loops
        expect(edge.axis).toBeDefined();
        expect(edge.expectedDirection).toBeDefined();
      }
    }

    expect(Object.values(expectedEdgeIdsByFamily).flat()).toHaveLength(45);
  });

  it('returns empty array for unknown family', () => {
    expect(getFamilyEdges('unknown_family')).toEqual([]);
  });
});
