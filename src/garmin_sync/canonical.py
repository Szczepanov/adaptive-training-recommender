"""Provider-neutral canonical metric vocabulary.

Field names/units are deliberately provider-agnostic (snake_case, explicit units) so a
future non-Garmin adapter can populate these same dataclasses. Today they're exactly
the fields already extracted from Garmin -- nothing invented, nothing added that no
provider actually supplies yet.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Standard multisource metric vocabulary (ADR-0027)
METRIC_SLEEP_SESSION = "sleep_session"
METRIC_SLEEP_DURATION_SECONDS = "sleep_duration_seconds"
METRIC_SLEEP_STAGE_AWAKE_SECONDS = "sleep_stage_awake_seconds"
METRIC_SLEEP_STAGE_LIGHT_SECONDS = "sleep_stage_light_seconds"
METRIC_SLEEP_STAGE_DEEP_SECONDS = "sleep_stage_deep_seconds"
METRIC_SLEEP_STAGE_REM_SECONDS = "sleep_stage_rem_seconds"
METRIC_HRV_RMSSD_MS = "hrv_rmssd_ms"
METRIC_HEART_RATE_BPM = "heart_rate_bpm"
METRIC_DAILY_RESTING_HEART_RATE_BPM = "daily_resting_heart_rate_bpm"
METRIC_SLEEPING_HEART_RATE_BPM = "sleeping_heart_rate_bpm"
METRIC_RESPIRATION_RATE_BRPM = "respiration_rate_brpm"
METRIC_DAILY_RESPIRATION_RATE_BRPM = "daily_respiration_rate_brpm"
METRIC_SLEEP_RESPIRATION_SUMMARY = "sleep_respiration_summary"

# Extended Eight Sleep direct-only vocabulary (ES-EXT): fields the private API's
# sleepQualityScore/sleepRoutineScore/performanceWindows objects already compute
# server-side but eight_sleep_mapper.py did not originally extract. No other provider
# currently supplies these -- unlike the block above, this is deliberately
# source-specific rather than aspirationally provider-neutral, since there is no
# non-Eight-Sleep analogue to normalize toward yet.
METRIC_SLEEP_LATENCY_ASLEEP_SECONDS = "sleep_latency_asleep_seconds"
METRIC_SLEEP_LATENCY_OUT_SECONDS = "sleep_latency_out_seconds"
# METRIC_SLEEP_WASO_SECONDS deliberately absent: sleepQualityScore.waso.current turned out to
# be a small fraction (e.g. 0.0193), not seconds, per a real probe (2026-08-28) -- see
# eight_sleep_mapper.py's comment at the skipped extraction site. Removed rather than kept
# around unused, since a stale metric constant with a plausible-looking name is itself a
# footgun for a future reader who assumes it's populated.
METRIC_SLEEP_DEBT_SECONDS = "sleep_debt_seconds"
METRIC_SLEEP_BASELINE_DURATION_SECONDS = "sleep_baseline_duration_seconds"
METRIC_SNORE_DURATION_SECONDS = "snore_duration_seconds"
METRIC_HEAVY_SNORE_DURATION_SECONDS = "heavy_snore_duration_seconds"
METRIC_SNORE_PERCENT = "snore_percent"
METRIC_HEAVY_SNORE_PERCENT = "heavy_snore_percent"
METRIC_SNORE_MITIGATION_EVENTS_COUNT = "snore_mitigation_events_count"
METRIC_TOSS_AND_TURN_COUNT = "toss_and_turn_count"
METRIC_SOCIAL_JETLAG_SECONDS = "social_jetlag_seconds"
METRIC_CHRONOTYPE_CLASS = "chronotype_class"
METRIC_WAKEUP_TIME_CONSISTENCY = "wakeup_time_consistency"
METRIC_SLEEP_START_TIME_CONSISTENCY = "sleep_start_time_consistency"
METRIC_BEDTIME_CONSISTENCY = "bedtime_consistency"

# performanceWindows.performanceWindowStats: Eight Sleep's own precomputed PERSONAL
# BASELINES (not tonight's reading -- the rolling-history comparison point), confirmed
# present via a real probe (2026-08-28) whenever performanceWindows.isAvailable. Distinct
# from METRIC_SLEEP_BASELINE_DURATION_SECONDS (sourced from sleepQualityScore.sleepDebt,
# a different subsystem) -- kept separate rather than assumed identical.
METRIC_BEDTIME_BASELINE_TIME = "bedtime_baseline_time"
METRIC_SLEEP_START_BASELINE_TIME = "sleep_start_baseline_time"
METRIC_SLEEP_END_BASELINE_TIME = "sleep_end_baseline_time"
METRIC_SLEEP_MIDPOINT_BASELINE_TIME = "sleep_midpoint_baseline_time"
# METRIC_WASO_BASELINE_SECONDS deliberately absent -- same fraction-not-seconds issue as
# METRIC_SLEEP_WASO_SECONDS above (performanceWindowStats.wasoBaseline probed at 0.0616).
METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS = "total_sleep_time_baseline_seconds"
METRIC_DEEP_SLEEP_BASELINE_SECONDS = "deep_sleep_baseline_seconds"

# sleepQualityScore.<metric>.inclusive7DayAverage: Eight Sleep's own rolling 7-day personal
# average per metric -- the single highest-value sub-field of each scored object (over
# .average/.upperRange/.lowerRange/.stdDev, deliberately not extracted here to bound mapper
# complexity; revisit if a concrete use for the fuller range emerges).
METRIC_HRV_7DAY_AVG_MS = "hrv_rmssd_ms_7day_avg"
METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM = "sleep_respiration_rate_7day_avg_brpm"
METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM = "sleeping_heart_rate_bpm_7day_avg"
# METRIC_SLEEP_WASO_7DAY_AVG_SECONDS deliberately absent -- same reason as the two above.
METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS = "sleep_duration_seconds_7day_avg"
METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS = "sleep_stage_deep_seconds_7day_avg"
METRIC_SLEEP_STAGE_REM_7DAY_AVG_SECONDS = "sleep_stage_rem_seconds_7day_avg"
METRIC_SNORE_DURATION_7DAY_AVG_SECONDS = "snore_duration_seconds_7day_avg"
METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS = "heavy_snore_duration_seconds_7day_avg"

# User-applied night tags (e.g. potential illness/travel/alcohol labels, if ever populated
# in the Eight Sleep app) -- structured value like sleep_respiration_summary, only emitted
# when the list is actually non-empty.
METRIC_SLEEP_TAGS = "sleep_tags"

# sessions[].sleepAlgorithmVersion/presenceAlgorithmVersion/hrvAlgorithmVersion: which
# version of Eight Sleep's own detection algorithms produced this night's session. A
# vendor algorithm change can create apparent physiological drift that has nothing to do
# with the athlete -- baselines and anomaly logic need this provenance to avoid silently
# crossing an algorithm-version boundary. Observability-only: string-valued, not consumed
# by the recommendation engine.
METRIC_SLEEP_ALGORITHM_VERSION = "sleep_algorithm_version"
METRIC_PRESENCE_ALGORITHM_VERSION = "presence_algorithm_version"
METRIC_HRV_ALGORITHM_VERSION = "hrv_algorithm_version"

STANDARD_OBSERVATION_METRICS = {
    METRIC_SLEEP_SESSION,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_SECONDS,
    METRIC_SLEEP_STAGE_REM_SECONDS,
    METRIC_HRV_RMSSD_MS,
    METRIC_HEART_RATE_BPM,
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_SLEEPING_HEART_RATE_BPM,
    METRIC_RESPIRATION_RATE_BRPM,
    METRIC_DAILY_RESPIRATION_RATE_BRPM,
    METRIC_SLEEP_RESPIRATION_SUMMARY,
}

EIGHT_SLEEP_EXTENDED_METRICS = {
    METRIC_SLEEP_LATENCY_ASLEEP_SECONDS,
    METRIC_SLEEP_LATENCY_OUT_SECONDS,
    METRIC_SLEEP_DEBT_SECONDS,
    METRIC_SLEEP_BASELINE_DURATION_SECONDS,
    METRIC_SNORE_DURATION_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_SECONDS,
    METRIC_SNORE_PERCENT,
    METRIC_HEAVY_SNORE_PERCENT,
    METRIC_SNORE_MITIGATION_EVENTS_COUNT,
    METRIC_TOSS_AND_TURN_COUNT,
    METRIC_SOCIAL_JETLAG_SECONDS,
    METRIC_CHRONOTYPE_CLASS,
    METRIC_WAKEUP_TIME_CONSISTENCY,
    METRIC_SLEEP_START_TIME_CONSISTENCY,
    METRIC_BEDTIME_CONSISTENCY,
    METRIC_BEDTIME_BASELINE_TIME,
    METRIC_SLEEP_START_BASELINE_TIME,
    METRIC_SLEEP_END_BASELINE_TIME,
    METRIC_SLEEP_MIDPOINT_BASELINE_TIME,
    METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS,
    METRIC_DEEP_SLEEP_BASELINE_SECONDS,
    METRIC_HRV_7DAY_AVG_MS,
    METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM,
    METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM,
    METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS,
    METRIC_SLEEP_STAGE_REM_7DAY_AVG_SECONDS,
    METRIC_SNORE_DURATION_7DAY_AVG_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS,
    METRIC_SLEEP_TAGS,
    METRIC_SLEEP_ALGORITHM_VERSION,
    METRIC_PRESENCE_ALGORITHM_VERSION,
    METRIC_HRV_ALGORITHM_VERSION,
}


# Phase 1 (2026-08-29): explicit decision-authority classification per metric, following
# the reviewed sleep-data-for-training-recommendations analysis (docs/analysis/
# 2026-08-29-sleep-data-training-recommendations-analysis.md). This is metadata only --
# no extraction or persistence behavior changes -- intended as a lint-able reference for
# future engine work, not a runtime gate. Classes:
#   training_authoritative  -- may directly drive today's training prescription
#   planning_authoritative  -- may influence scheduling/sleep-protection planning
#   health_anomaly          -- may contribute to non-diagnostic health-awareness/anomaly logic
#   observability_only      -- data-quality/provenance metadata, no decision role
#   research_only           -- shadow/research data; must not reach any decision logic
#
# `app/src/engine/multisourceFusion.ts`'s DEFAULT_METRIC_ACTIVATION_CONFIG is the only
# place in the engine that references any of these metric names today, and even that
# module has zero callers from `recommendationService.ts` yet (MULTISOURCE_FUSION_POLICY
# defaults to 'off') -- so "training_authoritative" below means "designed/candidate to
# become authoritative once fusion activates", not "currently driving live
# recommendations". Only hrv_rmssd_ms, daily_resting_heart_rate_bpm,
# daily_respiration_rate_brpm and sleep_duration_seconds are even referenced by that
# module's candidate metric list; sleep_stage_deep_seconds/sleep_stage_rem_seconds are
# referenced but explicitly disabled (sleepStages: false, "no real evidence supports
# activation"). Every other metric below is not wired into the engine at all.
DecisionAuthority = str  # Literal["training_authoritative", "planning_authoritative",
# "health_anomaly", "observability_only", "research_only"] -- kept as a plain str alias
# (not typing.Literal) so this stays valid in a module with `from __future__` unused
# elsewhere in this file; the docstring above is the source of truth for valid values.

OBSERVATION_AUTHORITY: dict[str, DecisionAuthority] = {
    # Candidate-authoritative in multisourceFusion.ts's DEFAULT_METRIC_ACTIVATION_CONFIG
    # (hrv/restingHeartRate/respiration/sleepDuration: true) -- see module-docstring caveat
    # above about zero production callers today.
    METRIC_SLEEP_DURATION_SECONDS: "training_authoritative",
    METRIC_HRV_RMSSD_MS: "training_authoritative",
    METRIC_DAILY_RESTING_HEART_RATE_BPM: "training_authoritative",
    METRIC_DAILY_RESPIRATION_RATE_BRPM: "training_authoritative",
    # Respiration, sleeping HR, snoring, and skin-temp-adjacent signals: non-diagnostic
    # health-awareness/anomaly candidates, not readiness inputs.
    METRIC_RESPIRATION_RATE_BRPM: "health_anomaly",
    METRIC_SLEEP_RESPIRATION_SUMMARY: "health_anomaly",
    METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM: "health_anomaly",
    METRIC_SLEEPING_HEART_RATE_BPM: "health_anomaly",
    METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM: "health_anomaly",
    METRIC_HEART_RATE_BPM: "health_anomaly",
    METRIC_SNORE_DURATION_SECONDS: "health_anomaly",
    METRIC_HEAVY_SNORE_DURATION_SECONDS: "health_anomaly",
    METRIC_SNORE_PERCENT: "health_anomaly",
    METRIC_HEAVY_SNORE_PERCENT: "health_anomaly",
    METRIC_SNORE_MITIGATION_EVENTS_COUNT: "health_anomaly",
    METRIC_SNORE_DURATION_7DAY_AVG_SECONDS: "health_anomaly",
    METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS: "health_anomaly",
    # Timing/consistency/debt/jetlag/chronotype: coaching and schedule-protection
    # candidates (sleep-opportunity mechanism), not readiness inputs.
    METRIC_WAKEUP_TIME_CONSISTENCY: "planning_authoritative",
    METRIC_SLEEP_START_TIME_CONSISTENCY: "planning_authoritative",
    METRIC_BEDTIME_CONSISTENCY: "planning_authoritative",
    METRIC_BEDTIME_BASELINE_TIME: "planning_authoritative",
    METRIC_SLEEP_START_BASELINE_TIME: "planning_authoritative",
    METRIC_SLEEP_END_BASELINE_TIME: "planning_authoritative",
    METRIC_SLEEP_MIDPOINT_BASELINE_TIME: "planning_authoritative",
    METRIC_SLEEP_LATENCY_ASLEEP_SECONDS: "planning_authoritative",
    METRIC_SLEEP_LATENCY_OUT_SECONDS: "planning_authoritative",
    METRIC_SLEEP_DEBT_SECONDS: "planning_authoritative",
    METRIC_SLEEP_BASELINE_DURATION_SECONDS: "planning_authoritative",
    METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS: "planning_authoritative",
    METRIC_SOCIAL_JETLAG_SECONDS: "planning_authoritative",
    METRIC_CHRONOTYPE_CLASS: "planning_authoritative",
    # Sleep-stage totals: real, but cross-device correlation on this account's own data
    # was r=0.17 (deep) / r=0.44 (rem) / r=0.73 (light) with no PSG ground truth to
    # arbitrate -- research-only per the reviewed analysis, not a prescription input.
    # sleep_stage_deep/rem_seconds ARE referenced by multisourceFusion.ts's candidate
    # config but explicitly disabled (sleepStages: false).
    METRIC_SLEEP_STAGE_DEEP_SECONDS: "research_only",
    METRIC_SLEEP_STAGE_REM_SECONDS: "research_only",
    METRIC_SLEEP_STAGE_LIGHT_SECONDS: "research_only",
    METRIC_SLEEP_STAGE_AWAKE_SECONDS: "research_only",
    METRIC_DEEP_SLEEP_BASELINE_SECONDS: "research_only",
    METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS: "research_only",
    METRIC_SLEEP_STAGE_REM_7DAY_AVG_SECONDS: "research_only",
    METRIC_HRV_7DAY_AVG_MS: "research_only",
    METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS: "research_only",
    METRIC_TOSS_AND_TURN_COUNT: "research_only",
    # Confirmed to be Garmin Health-Connect workout tags mirrored back into Eight Sleep,
    # not an Eight-Sleep-native sleep-context signal -- excluded from sleep logic entirely
    # (see docs/analysis/2026-08-28-eight-sleep-extended-metrics-analysis.md).
    METRIC_SLEEP_TAGS: "research_only",
    # Structural session anchor (the real decision-relevant value is each observation's
    # own observed_start/observed_end, not this metric specifically).
    METRIC_SLEEP_SESSION: "observability_only",
    # Vendor algorithm-version provenance -- data-quality metadata only.
    METRIC_SLEEP_ALGORITHM_VERSION: "observability_only",
    METRIC_PRESENCE_ALGORITHM_VERSION: "observability_only",
    METRIC_HRV_ALGORITHM_VERSION: "observability_only",
}


@dataclass(frozen=True)
class ObservationSource:
    provider: str
    transport: str
    origin_application: str | None = None
    origin_device: str | None = None
    source_record_id: str | None = None

    def __post_init__(self) -> None:
        if not self.provider or not self.provider.strip():
            raise ValueError("ObservationSource requires a non-empty provider.")
        if not self.transport or not self.transport.strip():
            raise ValueError("ObservationSource requires a non-empty transport.")


@dataclass(frozen=True)
class CanonicalHealthObservation:
    metric: str
    value: float | int | str | dict[str, Any] | None
    unit: str | None
    source: ObservationSource
    observed_start: datetime | None
    observed_end: datetime | None
    logical_date: str
    semantic_version: str = "1.0.0"
    quality: dict[str, float | int | str | bool] | None = None

    def __post_init__(self) -> None:
        if not self.metric or not self.metric.strip():
            raise ValueError("CanonicalHealthObservation requires a non-empty metric name.")
        if not self.logical_date:
            raise ValueError("CanonicalHealthObservation requires a valid YYYY-MM-DD logical_date.")
        try:
            datetime.strptime(self.logical_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(
                f"CanonicalHealthObservation requires a valid YYYY-MM-DD logical_date, got: {self.logical_date!r}"
            ) from exc


@dataclass
class ObservationBatch:
    logical_date: str
    observations: list[CanonicalHealthObservation] = field(default_factory=list)
    source_payload_hash: str = ""
    raw_archive_ref: str | None = None
    schema_version: int = 1
    normalizer_version: int = 1
    revision: int = 1

    def __post_init__(self) -> None:
        if not self.source_payload_hash:
            raise ValueError("ObservationBatch requires a non-empty source_payload_hash.")


@dataclass
class CanonicalStress:
    avg: int | None = None
    max: int | None = None


@dataclass
class CanonicalBodyBattery:
    charged: int | None = None
    drained: int | None = None
    change: int | None = None  # charged - drained


@dataclass
class CanonicalTrainingReadiness:
    score: int | None = None
    level: str | None = None
    feedback: str | None = None


@dataclass
class CanonicalTrainingStatus:
    status_phrase: str | None = None
    acute_training_load: float | None = None
    acwr_status: str | None = None
    vo2max_running: float | None = None
    vo2max_running_date: str | None = None
    vo2max_cycling: float | None = None
    vo2max_cycling_date: str | None = None


@dataclass
class CanonicalHeartRateZones:
    """The DEFAULT sport profile's configured HR zones -- resting_hr_used/max_hr_used
    are Garmin's own computed values (not guessed from an age formula), so this is a
    real personalization input rather than an estimate. zone4_floor is Garmin's own
    threshold/hard boundary for this person, consumed by classify_activity_intensity
    to personalize hard-session classification."""

    resting_hr_used: int | None = None
    max_hr_used: int | None = None
    zone4_floor: int | None = None
    sport: str | None = None


@dataclass
class CanonicalRacePredictions:
    five_km_sec: int | None = None
    ten_km_sec: int | None = None
    half_marathon_sec: int | None = None
    marathon_sec: int | None = None


@dataclass
class CanonicalPerformanceTargets:
    """Current sport-specific performance targets reported by a wearable.

    These are profile settings rather than daily recovery metrics.  They deliberately
    travel separately from ``CanonicalDailyMetrics`` so historical rebuilds cannot
    mistake today's configured FTP/threshold for a past-day observation.
    """

    cycling_ftp_watts: int | None = None
    running_threshold_pace_sec_per_km: int | None = None
    running_lthr_bpm: int | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None
    race_predictions: CanonicalRacePredictions | None = None
    ftp_measured_at: str | None = None
    threshold_measured_at: str | None = None
    lthr_measured_at: str | None = None
    weight_measured_at: str | None = None


@dataclass
class CanonicalSpo2:
    avg_pct: float | None = None
    min_pct: float | None = None
    sleep_avg_pct: float | None = None


@dataclass
class CanonicalGearItem:
    gear_pk: str
    uuid: str | None = None
    custom_make_model: str | None = None
    display_name: str | None = None
    gear_type: str | None = None
    brand: str | None = None
    model: str | None = None
    total_distance_km: float = 0.0
    maximum_distance_km: float | None = None
    date_begin: str | None = None
    date_end: str | None = None
    status: str = "active"


@dataclass
class CanonicalDailyMetrics:
    date: str
    resting_heart_rate_bpm: float | None = None
    resting_heart_rate_date: str | None = None
    hrv_overnight_avg_ms: float | None = None
    hrv_status: str | None = None
    hrv_date: str | None = None
    sleep_score: float | None = None
    sleep_duration_seconds: int | None = None
    sleep_date: str | None = None
    # The actual sleep-session interval (from dailySleepDTO.sleepStart/EndTimestampGMT on
    # whichever sleep record was selected -- target-date or the D-1 fallback). Distinct from
    # `sleep_date` (a logical calendar date): these are the real UTC clock times a co-presence
    # check (e.g. against Eight Sleep) needs to line up two devices' nights. None when Garmin's
    # raw sleep payload didn't include a timing window.
    sleep_session_start: datetime | None = None
    sleep_session_end: datetime | None = None
    deep_sleep_seconds: int | None = None
    rem_sleep_seconds: int | None = None
    light_sleep_seconds: int | None = None
    awake_sleep_seconds: int | None = None
    restless_moments_count: int | None = None
    # dailySleepDTO.awakeCount -- a real per-night awakening count, distinct from
    # restless_moments_count (confirmed null for 73/73 sampled nights, 2026-08-29).
    # Observability-only: not consumed by the recommendation engine.
    awake_count: int | None = None
    respiration_rate_brpm: float | None = None
    body_battery_wake: float | None = None
    body_battery_wake_date: str | None = None
    steps_count: int | None = None
    steps_date: str | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None
    weight_date: str | None = None
    # Metric enrichment (item 4) -- archived + recorded, not yet consumed by the
    # recommendation engine. See CLAUDE.md-adjacent review notes: expose to rules only
    # after measuring real-world availability.
    stress: CanonicalStress | None = None
    body_battery: CanonicalBodyBattery | None = None
    training_readiness: CanonicalTrainingReadiness | None = None
    training_status: CanonicalTrainingStatus | None = None
    heart_rate_zones: CanonicalHeartRateZones | None = None
    spo2: CanonicalSpo2 | None = None
    skin_temp_deviation_celsius: float | None = None
    recovery_time_hours: int | None = None


@dataclass
class CanonicalRunningDynamics:
    ground_contact_time_ms: float | None = None
    ground_contact_balance_left_pct: float | None = None
    vertical_oscillation_cm: float | None = None
    vertical_ratio_pct: float | None = None
    stride_length_m: float | None = None
    avg_running_power_watts: int | None = None
    max_running_power_watts: int | None = None


@dataclass
class CanonicalActivity:
    # None means Garmin didn't supply an activityId for this activity (e.g. an
    # in-progress/pending upload) -- callers must not persist such an activity under a
    # shared placeholder key (see GarminSyncService._archive_activities).
    activity_id: str | None
    date: str
    type: str
    duration_min: int | None
    duration_seconds: int
    training_effect_aerobic: float
    training_effect_anaerobic: float
    average_hr: float | None
    training_load: float | None
    intensity_tag: str
    running_dynamics: CanonicalRunningDynamics | None = None
    primary_benefit: str | None = None
    epoc: float | None = None
    recovery_time_hours: int | None = None
    training_effect_label: str | None = None


@dataclass
class CanonicalZoneBucket:
    zone_number: int
    seconds_in_zone: float
    low_boundary: float | None = None


@dataclass
class CanonicalLapSummary:
    lap_index: int
    duration_seconds: float
    average_power_watts: float | None = None
    average_hr_bpm: float | None = None


@dataclass
class CanonicalExerciseSet:
    set_order: int
    set_type: str = "active"  # "active", "rest", "warmup"
    repetition_count: int | None = None
    weight_kg: float | None = None
    exercise_category: str | None = None
    exercise_name: str | None = None
    duration_seconds: float | None = None
    rest_duration_seconds: float | None = None


@dataclass
class CanonicalActivityDetail:
    activity_id: str
    power_zones: list[CanonicalZoneBucket] | None = None
    hr_zones: list[CanonicalZoneBucket] | None = None
    normalized_power_watts: float | None = None
    intensity_factor: float | None = None
    variability_index: float | None = None
    laps: list[CanonicalLapSummary] | None = None
    exercise_sets: list[CanonicalExerciseSet] | None = None
