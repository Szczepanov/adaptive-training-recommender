export const FAMILY_EDGES = {
  objective_recovery: [
    { from: 'judge_obj_neutral', to: 'judge_obj_hrv_1sd', axis: 'HRV down 1 SD', expectedDirection: 'same_or_slightly_less_load', expectedMagnitude: 'subtle' },
    { from: 'judge_obj_neutral', to: 'judge_obj_hrv_2sd', axis: 'HRV down 2 SD', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_rhr_1sd', axis: 'RHR up 1 SD', expectedDirection: 'same_or_slightly_less_load', expectedMagnitude: 'subtle' },
    { from: 'judge_obj_neutral', to: 'judge_obj_rhr_2sd', axis: 'RHR up 2 SD', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_poor_sleep', axis: 'Poor sleep score/duration', expectedDirection: 'less_load_or_recovery_timing', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_low_battery', axis: 'Low body battery', expectedDirection: 'less_load_or_active_recovery', expectedMagnitude: 'moderate' },
    { from: 'judge_obj_neutral', to: 'judge_obj_combined_bad', axis: 'Combined adverse recovery metrics', expectedDirection: 'significant_reduction_and_recovery', expectedMagnitude: 'large' },
  ],
  subjective_recovery: [
    { from: 'judge_subj_neutral', to: 'judge_subj_fresh', axis: 'High readiness / fresh athlete', expectedDirection: 'quality_permitted_or_more_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_low_readiness', axis: 'Low subjective readiness score', expectedDirection: 'less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_fatigue', axis: 'High subjective fatigue', expectedDirection: 'less_load_and_recovery', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_soreness', axis: 'High muscle soreness', expectedDirection: 'less_impact_or_less_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_stress', axis: 'High life stress', expectedDirection: 'less_stress_or_conservative_load', expectedMagnitude: 'moderate' },
    { from: 'judge_subj_neutral', to: 'judge_subj_low_motivation', axis: 'Low motivation alone', expectedDirection: 'same_or_mild_shift', expectedMagnitude: 'subtle' },
    { from: 'judge_subj_neutral', to: 'judge_subj_combined_bad', axis: 'Combined adverse subjective report', expectedDirection: 'significant_reduction_and_recovery', expectedMagnitude: 'large' },
  ],
  recent_training: [
    { from: 'judge_load_none', to: 'judge_load_easy_yesterday', axis: 'Easy Z2 completed yesterday', expectedDirection: 'quality_permitted_today', expectedMagnitude: 'subtle_or_none' },
    { from: 'judge_load_none', to: 'judge_load_hard_yesterday', axis: 'Hard cycling completed yesterday', expectedDirection: 'less_load_today_or_recovery', expectedMagnitude: 'large' },
    { from: 'judge_load_hard_yesterday', to: 'judge_load_hard_2d', axis: 'Hard cycling 2 days ago vs yesterday', expectedDirection: 'faster_readiness_return_today', expectedMagnitude: 'moderate' },
    { from: 'judge_load_hard_yesterday', to: 'judge_load_hard_3d', axis: 'Hard cycling 3 days ago vs yesterday', expectedDirection: 'full_readiness_return_today', expectedMagnitude: 'large' },
  ],
  event_proximity: [
    { from: 'judge_event_40d', to: 'judge_event_20d', axis: '40 days out vs 20 days out', expectedDirection: 'specificity_build', expectedMagnitude: 'moderate' },
    { from: 'judge_event_20d', to: 'judge_event_14d', axis: '20 days out vs 14 days out', expectedDirection: 'peak_specificity', expectedMagnitude: 'moderate' },
    { from: 'judge_event_14d', to: 'judge_event_7d', axis: '14 days out vs 7 days out (taper entry)', expectedDirection: 'volume_reduction_maintain_intensity', expectedMagnitude: 'moderate' },
    { from: 'judge_event_7d', to: 'judge_event_3d', axis: '7 days out vs 3 days out (final taper)', expectedDirection: 'low_volume_race_activation', expectedMagnitude: 'large' },
  ],
  preferences_capacity: [
    { from: 'judge_pref_neutral', to: 'judge_pref_conservative', axis: 'Conservative bias active', expectedDirection: 'more_conservative_envelopes', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_active_recovery', axis: 'Active recovery style preference', expectedDirection: 'active_recovery_sessions_selected', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_mixed_recovery', axis: 'Mixed recovery style preference', expectedDirection: 'mixed_recovery_sessions_selected', expectedMagnitude: 'moderate' },
    { from: 'judge_pref_neutral', to: 'judge_pref_45min', axis: '45 minute weekday time cap', expectedDirection: 'shorter_compact_workouts', expectedMagnitude: 'large' },
    { from: 'judge_pref_neutral', to: 'judge_pref_90min', axis: '90 minute weekday time cap', expectedDirection: 'longer_extended_workouts', expectedMagnitude: 'large' },
  ],
  event_demand: [
    { from: 'judge_demand_crit_A', to: 'judge_demand_crit_B', axis: 'Criterium Priority A vs Priority B', expectedDirection: 'less_aggressive_taper_or_peak', expectedMagnitude: 'moderate' },
    { from: 'judge_demand_crit_A', to: 'judge_demand_gran_A', axis: 'Criterium (Surges/VO2) vs Gran Fondo (Durability)', expectedDirection: 'shift_from_surges_to_sustained_durability', expectedMagnitude: 'large' },
    { from: 'judge_demand_gran_A', to: 'judge_demand_gran_B', axis: 'Gran Fondo Priority A vs Priority B', expectedDirection: 'less_aggressive_taper_or_peak', expectedMagnitude: 'moderate' },
  ],
  interactions: [
    { from: 'judge_int_badobj_noload', to: 'judge_int_badobj_hard_yday', axis: 'Poor objective: No load vs Hard yesterday', expectedDirection: 'compounded_fatigue_requires_more_recovery', expectedMagnitude: 'large' },
    { from: 'judge_int_badsubj_goodobj', to: 'judge_int_goodsubj_badobj', axis: 'Poor subjective/Good objective vs Good subjective/Poor objective', expectedDirection: 'objective_fatigue_bounds_load', expectedMagnitude: 'moderate' },
    { from: 'judge_int_race7_fresh', to: 'judge_int_race7_hard_yday', axis: 'Race in 7d: Fresh vs Hard yesterday', expectedDirection: 'emergency_recovery_for_upcoming_taper', expectedMagnitude: 'large' },
  ],
  delivered_dose_variance: [
    { from: 'judge_dose_exact', to: 'judge_dose_surged', axis: 'Exact adherence vs Surged load (105%)', expectedDirection: 'higher_residual_fatigue_damping', expectedMagnitude: 'moderate' },
    { from: 'judge_dose_exact', to: 'judge_dose_curtailed', axis: 'Exact adherence vs Curtailed workout (2/3 reps)', expectedDirection: 'lower_fatigue_more_capacity_today', expectedMagnitude: 'moderate' },
    { from: 'judge_dose_exact', to: 'judge_dose_skipped', axis: 'Exact adherence vs Skipped workout', expectedDirection: 'fresh_state_allows_quality', expectedMagnitude: 'large' },
  ],
  concurrent_strength_endurance: [
    { from: 'judge_concurrent_none', to: 'judge_concurrent_heavy_lower', axis: 'No strength vs Heavy lower-body yesterday', expectedDirection: 'avoid_heavy_cycling_impact_today', expectedMagnitude: 'large' },
    { from: 'judge_concurrent_none', to: 'judge_concurrent_heavy_upper', axis: 'No strength vs Heavy upper-body yesterday', expectedDirection: 'cycling_endurance_safe_today', expectedMagnitude: 'moderate' },
    { from: 'judge_concurrent_none', to: 'judge_concurrent_power_maintenance', axis: 'No strength vs Power maintenance yesterday', expectedDirection: 'lower_residual_neuromuscular_interference', expectedMagnitude: 'moderate' },
  ],
  injury_constraints: [
    { from: 'judge_injury_none', to: 'judge_injury_running_restricted', axis: 'Healthy vs Running restricted', expectedDirection: 'zero_running_cross_train_cycling_or_rest', expectedMagnitude: 'large' },
    { from: 'judge_injury_none', to: 'judge_injury_lower_body_restricted', axis: 'Healthy vs Avoid heavy lower body', expectedDirection: 'zero_heavy_lower_body_sessions', expectedMagnitude: 'large' },
    { from: 'judge_injury_lower_body_restricted', to: 'judge_injury_expired', axis: 'Active restriction vs Expired review', expectedDirection: 'unrestricted_normal_selection_resumed', expectedMagnitude: 'large' },
  ],
  planning_modes_overlays: [
    { from: 'judge_mode_event_directed', to: 'judge_mode_evergreen', axis: 'Event directed vs Evergreen maintenance', expectedDirection: 'continuous_balanced_stimulus_no_taper', expectedMagnitude: 'large' },
    { from: 'judge_mode_event_directed', to: 'judge_mode_travel_overlay', axis: 'Event directed vs 3-day travel overlay', expectedDirection: 'constrained_hotel_friendly_bodyweight_sessions', expectedMagnitude: 'large' },
    { from: 'judge_mode_event_directed', to: 'judge_mode_conservative_preference', axis: 'Event directed vs High conservative bias', expectedDirection: 'more_conservative_envelope_caps', expectedMagnitude: 'moderate' },
  ],
};

export function getFamilyEdges(familyId) {
  return FAMILY_EDGES[familyId] ?? [];
}
