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
