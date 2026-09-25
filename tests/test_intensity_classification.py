"""Issue #809: stimulus intensity is decoupled from accumulated Training Effect (dose)."""

from garmin_sync.garmin_provider import _canonicalize_activity, qualifies_for_activity_detail
from garmin_sync.intensity_classification import (
    INTENSITY_CLASSIFICATION_VERSION,
    ActivityIntensityEvidence,
    classify_activity,
)
from garmin_sync.mapper import normalize_activity

_COST_RANK = {"low": 0, "moderate": 1, "high": 2, "very_high": 3}


def _evidence(**overrides: object) -> ActivityIntensityEvidence:
    base: dict[str, object] = {
        "activity_type": "road_biking",
        "duration_seconds": 120 * 60,
        "training_effect_aerobic": 3.0,
        "training_effect_anaerobic": 0.4,
        "average_hr": 118.0,
    }
    base.update(overrides)
    return ActivityIntensityEvidence(**base)  # type: ignore[arg-type]


def test_long_endurance_ride_with_te3_is_not_high_intensity() -> None:
    result = classify_activity(
        _evidence(
            intensity_factor=0.59,
            power_zone_seconds=[2400, 4200, 500, 100, 0, 0, 0],
            hr_zone_seconds=[6500, 600, 100, 0, 0],
        )
    )
    assert result.intensity_tag == "easy"
    assert result.stimulus_domain == "endurance"
    assert result.intensity_evidence == "powerIntensityFactor"
    assert result.session_cost == "high"
    assert not result.is_hard


def test_cycling_vo2_and_threshold_remain_hard_and_costly() -> None:
    vo2 = classify_activity(
        _evidence(
            duration_seconds=75 * 60,
            training_effect_aerobic=4.1,
            training_effect_anaerobic=2.5,
            average_hr=160.0,
            intensity_factor=0.86,
            power_zone_seconds=[900, 1200, 600, 700, 600, 400, 100],
        )
    )
    assert vo2.intensity_tag == "hard"
    assert vo2.stimulus_domain == "vo2"
    assert vo2.session_cost == "very_high"

    threshold = classify_activity(_evidence(duration_seconds=60 * 60, intensity_factor=0.95))
    assert threshold.intensity_tag == "hard"
    assert threshold.stimulus_domain == "threshold"


def test_race_is_high_intensity_and_at_least_high_cost() -> None:
    result = classify_activity(
        _evidence(training_effect_aerobic=2.5, intensity_factor=0.7, is_race=True)
    )
    assert (result.intensity_tag, result.stimulus_domain, result.intensity_evidence) == (
        "hard",
        "race",
        "race",
    )
    assert result.session_cost == "high"


def test_long_z2_ride_costs_more_than_short_easy_ride_without_becoming_hard() -> None:
    long_ride = classify_activity(_evidence(intensity_factor=0.62))
    short_ride = classify_activity(
        _evidence(duration_seconds=40 * 60, training_effect_aerobic=1.6, intensity_factor=0.6)
    )
    assert long_ride.intensity_tag == short_ride.intensity_tag == "easy"
    assert _COST_RANK[long_ride.session_cost] > _COST_RANK[short_ride.session_cost]


def test_duration_drives_cost_when_training_effect_absent() -> None:
    long_ride = classify_activity(
        _evidence(
            training_effect_aerobic=0.0, training_effect_anaerobic=0.0, duration_seconds=160 * 60
        )
    )
    short_ride = classify_activity(
        _evidence(
            training_effect_aerobic=0.0, training_effect_anaerobic=0.0, duration_seconds=30 * 60
        )
    )
    assert (long_ride.session_cost, short_ride.session_cost) == ("very_high", "low")


def test_anaerobic_intervals_with_modest_aerobic_te_stay_hard() -> None:
    result = classify_activity(
        _evidence(
            duration_seconds=45 * 60,
            training_effect_aerobic=2.1,
            training_effect_anaerobic=3.4,
            intensity_factor=0.7,
        )
    )
    assert result.intensity_tag == "hard"
    assert result.stimulus_domain == "anaerobic"


def test_running_hr_zones_classify_easy_and_threshold_runs() -> None:
    easy_run = classify_activity(
        _evidence(
            activity_type="running",
            duration_seconds=100 * 60,
            average_hr=140.0,
            hr_zone_seconds=[1200, 4200, 500, 100, 0],
        )
    )
    assert (easy_run.intensity_tag, easy_run.stimulus_domain) == ("easy", "endurance")
    assert easy_run.intensity_evidence == "hrZoneDistribution"

    tempo_run = classify_activity(
        _evidence(
            activity_type="running",
            duration_seconds=50 * 60,
            training_effect_aerobic=3.5,
            hr_zone_seconds=[300, 600, 900, 1200, 0],
        )
    )
    assert (tempo_run.intensity_tag, tempo_run.stimulus_domain) == ("hard", "threshold")


def test_strength_never_uses_hr_zones_and_falls_back_to_training_effect() -> None:
    result = classify_activity(
        _evidence(
            activity_type="strength_training",
            duration_seconds=50 * 60,
            training_effect_aerobic=1.2,
            training_effect_anaerobic=2.0,
            average_hr=110.0,
            hr_zone_seconds=[3000, 0, 0, 0, 0],
        )
    )
    assert result.stimulus_domain == "strength"
    assert result.intensity_evidence == "trainingEffectFallback"
    assert result.intensity_tag == "moderate"


def test_missing_detail_falls_back_to_legacy_rule() -> None:
    result = classify_activity(_evidence())
    assert result.intensity_evidence == "trainingEffectFallback"
    assert result.intensity_tag == "hard"
    assert result.stimulus_domain == "unknown"


def test_sparse_zone_data_is_not_trusted() -> None:
    result = classify_activity(_evidence(activity_type="running", hr_zone_seconds=[60, 0, 0, 0, 0]))
    assert result.intensity_evidence == "trainingEffectFallback"


def test_classification_is_deterministic() -> None:
    evidence = _evidence(intensity_factor=0.59, power_zone_seconds=[2400, 4200, 500, 100, 0, 0, 0])
    assert classify_activity(evidence) == classify_activity(evidence)


def test_provider_boundary_extracts_summary_evidence_and_persists_provenance() -> None:
    raw = {
        "activityId": 42,
        "startTimeLocal": "2026-09-20 08:00:00",
        "startTimeGMT": "2026-09-20 06:00:00",
        "duration": 7200.0,
        "aerobicTrainingEffect": 3.0,
        "anaerobicTrainingEffect": 0.3,
        "averageHR": 117,
        "intensityFactor": 0.59,
        "activityType": {"typeKey": "road_biking"},
        **{f"powerTimeInZone_{i}": v for i, v in enumerate([2400, 4200, 500, 100, 0, 0, 0], 1)},
        **{f"hrTimeInZone_{i}": v for i, v in enumerate([6500, 600, 100, 0, 0], 1)},
    }
    activity = _canonicalize_activity(raw, zone4_floor=150)
    assert activity.intensity_tag == "easy"
    assert activity.session_cost == "high"
    # A costly aerobic ride still qualifies for telemetry detail.
    assert qualifies_for_activity_detail(activity)

    payload = normalize_activity(activity, "run-1")
    assert payload["intensityTag"] == "easy"
    assert payload["stimulusDomain"] == "endurance"
    assert payload["sessionCost"] == "high"
    assert payload["intensityEvidence"] == "powerIntensityFactor"
    assert payload["intensityClassificationVersion"] == INTENSITY_CLASSIFICATION_VERSION
