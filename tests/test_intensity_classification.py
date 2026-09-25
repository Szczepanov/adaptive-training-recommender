"""Issue #809: stimulus intensity is decoupled from accumulated Training Effect (dose)."""

from pathlib import Path

from garmin_sync import intensity_classification as ic
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


def test_cost_is_unknown_without_training_effect_instead_of_duration_guess() -> None:
    long_strength = classify_activity(
        _evidence(
            activity_type="strength_training",
            training_effect_aerobic=0.0,
            training_effect_anaerobic=0.0,
            average_hr=None,
            duration_seconds=95 * 60,
        )
    )
    assert long_strength.session_cost == "unknown"
    assert long_strength.intensity_tag == "easy"


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


def test_policy_alignment_with_registered_knowledge_claim() -> None:
    """ADR-0033: the classifier constants match the registered claim
    policy.load_intensity.garmin_stimulus_cost_classification_v1. Changing a value here
    requires updating the claim statement in app/src/knowledge/sportsKnowledge.ts."""
    assert (ic.IF_ENDURANCE_MIN, ic.IF_TEMPO_MIN, ic.IF_THRESHOLD_MIN, ic.IF_VO2_MIN) == (
        0.56,
        0.76,
        0.91,
        1.06,
    )
    assert (ic.POWER_HIGH_ZONE_HARD_SHARE, ic.POWER_HIGH_ZONE_START) == (0.10, 5)
    assert (ic.HR_Z5_HARD_SHARE, ic.HR_Z4_PLUS_HARD_SHARE, ic.HR_Z3_PLUS_MODERATE_SHARE) == (
        0.10,
        0.30,
        0.30,
    )
    assert ic.MIN_ZONE_COVERAGE == 0.5
    assert ic.ANAEROBIC_HARD_MIN_TRAINING_EFFECT == 3.0
    assert (ic.COST_MODERATE_MIN_TE, ic.COST_HIGH_MIN_TE, ic.COST_VERY_HIGH_MIN_TE) == (
        2.0,
        3.0,
        4.0,
    )
    assert (ic.HARD_SESSION_MIN_TRAINING_EFFECT, ic.HARD_SESSION_MIN_AVERAGE_HR) == (3.0, 145)

    source = (
        Path(__file__).resolve().parents[1] / "app" / "src" / "knowledge" / "sportsKnowledge.ts"
    ).read_text(encoding="utf-8")
    claim_start = source.index("id: KNOWLEDGE_CLAIM_IDS.garminStimulusCostClassification")
    statement = source[claim_start : source.index("claimType", claim_start)]
    for fragment in (
        "anaerobic Training Effect >=3.0",
        "<0.56 recovery, <0.76 endurance, <0.91 tempo, <1.06 threshold",
        ">=10% power time in zone 5+",
        "zone 5 >=10% or zones 4-5 >=30% hard, zones 3-5 >=30% moderate",
        ">=50% of the session",
        "<2 low, <3 moderate, <4 high",
    ):
        assert fragment in statement, fragment


def test_snapshot_summaries_carry_cost_counts_and_classification_version() -> None:
    from garmin_sync.mapper import _build_training_summary

    long_easy = _canonicalize_activity(
        {
            "activityId": 7,
            "startTimeLocal": "2026-09-20 08:00:00",
            "duration": 4 * 3600.0,
            "aerobicTrainingEffect": 4.3,
            "anaerobicTrainingEffect": 0.2,
            "averageHR": 120,
            "intensityFactor": 0.62,
            "activityType": {"typeKey": "road_biking"},
        }
    )
    summary = _build_training_summary([long_easy], "2026-09-20")
    assert summary is not None
    assert summary.hardActivityCount == 0
    assert summary.highCostActivityCount == 1
    assert summary.intensityClassificationVersion == INTENSITY_CLASSIFICATION_VERSION
    assert summary.primaryActivity is not None
    assert summary.primaryActivity.sessionCost == "very_high"


def test_raw_metrics_stamp_three_day_window_classification_version() -> None:
    from dataclasses import replace

    from garmin_sync.canonical import CanonicalDailyMetrics
    from garmin_sync.mapper import _build_raw_metrics

    base = {
        "startTimeLocal": "2026-09-19 08:00:00",
        "duration": 3600.0,
        "aerobicTrainingEffect": 3.2,
        "averageHR": 120,
        "activityType": {"typeKey": "running"},
    }
    classified = _canonicalize_activity({**base, "activityId": 1})
    legacy = replace(
        _canonicalize_activity({**base, "activityId": 2}), intensity_classification_version=None
    )

    def raw(acts: list) -> object:
        return _build_raw_metrics(
            CanonicalDailyMetrics(date="2026-09-21"), acts, "2026-09-21", "2026-09-20", "2026-09-18"
        )

    stamped = raw([classified])
    assert stamped.last3DaysIntensityClassificationVersion == INTENSITY_CLASSIFICATION_VERSION
    assert stamped.last3DaysHighCostSessionsCount == 1
    assert raw([classified, legacy]).last3DaysIntensityClassificationVersion is None
    assert raw([]).last3DaysIntensityClassificationVersion is None
