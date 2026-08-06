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
    respiration_rate_brpm: float | None = None
    body_battery_wake: float | None = None
    body_battery_wake_date: str | None = None
    steps_count: int | None = None
    steps_date: str | None = None
    # Metric enrichment (item 4) -- archived + recorded, not yet consumed by the
    # recommendation engine. See CLAUDE.md-adjacent review notes: expose to rules only
    # after measuring real-world availability.
    stress: CanonicalStress | None = None
    body_battery: CanonicalBodyBattery | None = None
    training_readiness: CanonicalTrainingReadiness | None = None
    training_status: CanonicalTrainingStatus | None = None


@dataclass
class CanonicalActivity:
    activity_id: str
    date: str
    type: str
    duration_min: int | None
    duration_seconds: int
    training_effect_aerobic: float
    training_effect_anaerobic: float
    average_hr: float | None
    training_load: float | None
    intensity_tag: str
