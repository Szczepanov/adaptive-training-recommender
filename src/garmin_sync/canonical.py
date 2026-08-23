"""Provider-neutral canonical metric vocabulary.

Field names/units are deliberately provider-agnostic (snake_case, explicit units) so a
future non-Garmin adapter can populate these same dataclasses. Today they're exactly
the fields already extracted from Garmin -- nothing invented, nothing added that no
provider actually supplies yet.
"""

from dataclasses import dataclass


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
