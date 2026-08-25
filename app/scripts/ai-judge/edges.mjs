export const FAMILY_EDGES = {
  objective_recovery: [
    { from: 'judge_obj_neutral', to: 'judge_obj_hrv_1sd', axis: 'HRV down 1 SD (mild adverse)', expectedDirection: 'same', expectedMagnitude: 'small' },
    { from: 'judge_obj_hrv_1sd', to: 'judge_obj_hrv_2sd', axis: 'HRV down 1 SD -> 2 SD (severe adverse)', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_hrv_2sd', to: 'judge_obj_combined_bad', axis: 'HRV down 2 SD -> Combined adverse', expectedDirection: 'less_load', expectedMagnitude: 'large' },
    { from: 'judge_obj_neutral', to: 'judge_obj_rhr_1sd', axis: 'RHR up 1 SD (mild adverse)', expectedDirection: 'same', expectedMagnitude: 'small' },
    { from: 'judge_obj_neutral', to: 'judge_obj_rhr_2sd', axis: 'RHR up 2 SD (severe adverse)', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_poor_sleep', axis: 'Poor sleep score/duration', expectedDirection: 'timing_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_low_battery', axis: 'Low body battery', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
  ],
  subjective_recovery: [
    { from: 'judge_subj_neutral', to: 'judge_subj_fresh', axis: 'High readiness / fresh athlete', expectedDirection: 'more_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_low_readiness', axis: 'Low subjective readiness score', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_fatigue', axis: 'High subjective fatigue', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_soreness', axis: 'High muscle soreness', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_stress', axis: 'High life stress', expectedDirection: 'less_load', expectedMagnitude: 'small' },
    { from: 'judge_subj_neutral', to: 'judge_subj_low_motivation', axis: 'Low motivation alone', expectedDirection: 'same', expectedMagnitude: 'none' },
    { from: 'judge_subj_neutral', to: 'judge_subj_combined_bad', axis: 'Combined adverse subjective report', expectedDirection: 'less_load', expectedMagnitude: 'large' },
  ],
  recent_training: [
    { from: 'judge_load_none', to: 'judge_load_easy_yesterday', axis: 'None -> Easy yesterday', expectedDirection: 'same', expectedMagnitude: 'none' },
    { from: 'judge_load_none', to: 'judge_load_hard_yesterday', axis: 'None -> Hard yesterday', expectedDirection: 'less_load', expectedMagnitude: 'large' },
    { from: 'judge_load_hard_3d', to: 'judge_load_hard_2d', axis: 'Hard 3d ago -> Hard 2d ago', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_load_hard_2d', to: 'judge_load_hard_yesterday', axis: 'Hard 2d ago -> Hard yesterday', expectedDirection: 'less_load', expectedMagnitude: 'large' },
  ],
  event_proximity: [
    { from: 'judge_event_40d', to: 'judge_event_20d', axis: '40d -> 20d (Build progression)', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_event_20d', to: 'judge_event_14d', axis: '20d -> 14d (Peak build)', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_event_14d', to: 'judge_event_7d', axis: '14d -> 7d (Taper entry volume reduction)', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_event_7d', to: 'judge_event_3d', axis: '7d -> 3d (Final taper activation)', expectedDirection: 'less_load', expectedMagnitude: 'large' },
  ],
  preferences_capacity: [
    { from: 'judge_pref_neutral', to: 'judge_pref_conservative', axis: 'Conservative bias active', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_active_recovery', axis: 'Active recovery style preference', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_mixed_recovery', axis: 'Mixed recovery style preference', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_45min', axis: '45 minute weekday time cap', expectedDirection: 'timing_shift', expectedMagnitude: 'large' },
    { from: 'judge_pref_neutral', to: 'judge_pref_90min', axis: '90 minute weekday time cap', expectedDirection: 'timing_shift', expectedMagnitude: 'large' },
  ],
  event_demand: [
    { from: 'judge_demand_crit_A', to: 'judge_demand_crit_B', axis: 'Criterium Priority A vs Priority B', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_demand_crit_A', to: 'judge_demand_gran_A', axis: 'Criterium (Surges) vs Gran Fondo (Durability)', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_demand_gran_A', to: 'judge_demand_gran_B', axis: 'Gran Fondo Priority A vs Priority B', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
  ],
  interactions: [
    { from: 'judge_int_badobj_noload', to: 'judge_int_badobj_hard_yday', axis: 'Poor objective: No load vs Hard yesterday', expectedDirection: 'less_load', expectedMagnitude: 'large' },
    { from: 'judge_int_badsubj_goodobj', to: 'judge_int_goodsubj_badobj', axis: 'Bad subj/Good obj vs Good subj/Bad obj', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_int_race7_fresh', to: 'judge_int_race7_hard_yday', axis: 'Race 7d: Fresh vs Hard yesterday', expectedDirection: 'less_load', expectedMagnitude: 'large' },
  ],
  delivered_dose_variance: [
    { from: 'judge_dose_exact', to: 'judge_dose_surged', axis: 'Exact adherence vs Surged load (105%)', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_dose_exact', to: 'judge_dose_curtailed', axis: 'Exact adherence vs Curtailed workout (2/3 reps)', expectedDirection: 'more_load', expectedMagnitude: 'moderate' },
    { from: 'judge_dose_exact', to: 'judge_dose_skipped', axis: 'Exact adherence vs Skipped workout', expectedDirection: 'more_load', expectedMagnitude: 'large' },
  ],
  concurrent_strength_endurance: [
    { from: 'judge_concurrent_none', to: 'judge_concurrent_heavy_lower', axis: 'No strength vs Heavy lower-body yesterday', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_concurrent_none', to: 'judge_concurrent_heavy_upper', axis: 'No strength vs Heavy upper-body yesterday', expectedDirection: 'same', expectedMagnitude: 'none' },
    { from: 'judge_concurrent_none', to: 'judge_concurrent_power_maintenance', axis: 'No strength vs Power maintenance yesterday', expectedDirection: 'same', expectedMagnitude: 'small' },
  ],
  injury_constraints: [
    { from: 'judge_injury_none', to: 'judge_injury_running_restricted', axis: 'Healthy vs Running restricted', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_injury_none', to: 'judge_injury_lower_body_restricted', axis: 'Healthy vs Avoid heavy lower body', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_injury_lower_body_restricted', to: 'judge_injury_expired', axis: 'Active restriction vs Expired review', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
  ],
  planning_modes_overlays: [
    { from: 'judge_mode_event_directed', to: 'judge_mode_evergreen', axis: 'Event directed vs Evergreen maintenance', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_mode_event_directed', to: 'judge_mode_travel_overlay', axis: 'Event directed vs 3-day travel overlay', expectedDirection: 'specificity_shift', expectedMagnitude: 'large' },
    { from: 'judge_mode_event_directed', to: 'judge_mode_conservative_preference', axis: 'Event directed vs High conservative bias', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
  ],
  temporal_acute_vs_persistent: [
    { from: 'judge_traj_neutral', to: 'judge_traj_acute_adverse_day1', axis: 'Neutral baseline vs Acute 1-day fatigue', expectedDirection: 'timing_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_traj_acute_adverse_day1', to: 'judge_traj_persistent_adverse_3d', axis: 'Acute 1-day fatigue vs Persistent 3-day fatigue', expectedDirection: 'less_load', expectedMagnitude: 'large' },
    { from: 'judge_traj_persistent_adverse_3d', to: 'judge_traj_improving_trend', axis: 'Persistent fatigue vs Improving readiness trend', expectedDirection: 'more_load', expectedMagnitude: 'moderate' },
  ],
  conflicting_tissue_vs_wearable: [
    { from: 'judge_conflict_neutral', to: 'judge_conflict_sore_legs_great_hrv', axis: 'Neutral vs Sore legs with high wearable readiness', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
    { from: 'judge_conflict_neutral', to: 'judge_conflict_fresh_legs_terrible_hrv', axis: 'Neutral vs Fresh legs with systemic wearable collapse', expectedDirection: 'less_load', expectedMagnitude: 'large' },
    { from: 'judge_conflict_fresh_legs_terrible_hrv', to: 'judge_conflict_high_stress_fresh_body', axis: 'Systemic wearable collapse vs High life stress with fresh body', expectedDirection: 'specificity_shift', expectedMagnitude: 'moderate' },
  ],
};

export function getFamilyEdges(familyId) {
  return FAMILY_EDGES[familyId] ?? [];
}
