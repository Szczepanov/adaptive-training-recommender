import json
from pathlib import Path
from garmin_sync.canonical import CanonicalActivity, CanonicalDailyMetrics
from garmin_sync.garmin_provider import canonicalize_activities, canonicalize_from_raw
from garmin_sync.mapper import build_snapshot_from_canonical, normalize_activity
from garmin_sync.models import DerivedMetrics

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_build_snapshot_from_canonical_using_real_fixture_shapes():
    """End-to-end regression test: real Garmin fixtures -> canonicalize -> build snapshot,
    asserting the exact same field values the pre-canonical-layer
    map_garmin_payload_to_snapshot test asserted, to guarantee the refactor didn't
    change output."""
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)
    with open(FIXTURES_DIR / "activities.json") as f:
        activities = json.load(f)

    stats_fallback = {"totalSteps": 8420, "restingHeartRate": 51}

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=stats_fallback,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )
    canonical_activities = canonicalize_activities(activities)

    derived = DerivedMetrics(restingHr7dAvg=53.0, restingHr28dAvg=54.0)

    snapshot = build_snapshot_from_canonical(
        user_id="test_firebase_uid_123",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=canonical_activities,
        derived_metrics=derived,
        timezone_name="Europe/Warsaw",
    )

    assert snapshot.userId == "test_firebase_uid_123"
    assert snapshot.date == "2026-08-06"
    assert snapshot.raw.sleepScore == 82
    assert snapshot.raw.restingHr == 52
    assert snapshot.raw.hrvOvernightAvg == 68
    assert snapshot.raw.last3DaysHardSessionsCount == 1
    assert snapshot.raw.yesterdayTraining is not None
    assert snapshot.raw.yesterdayTraining.primaryActivity is not None
    assert snapshot.raw.yesterdayTraining.primaryActivity.intensityTag == "hard"
    assert snapshot.source.sourceSchemaVersion == 3
    assert snapshot.source.timezone == "Europe/Warsaw"
    assert snapshot.source.metricDates.sleep == "2026-08-06"
    assert snapshot.source.metricDates.steps == "2026-08-05"  # D-1 steps semantics


def test_build_snapshot_deterministic_yesterday_activity_selection():
    derived = DerivedMetrics()
    activities = [
        CanonicalActivity(
            activity_id="101", date="2026-08-05", type="other",
            duration_min=30, duration_seconds=1800,
            training_effect_aerobic=1.0, training_effect_anaerobic=0.0,
            average_hr=None, training_load=10.0, intensity_tag="moderate/easy",
        ),
        CanonicalActivity(
            activity_id="102", date="2026-08-05", type="running",
            duration_min=40, duration_seconds=2400,
            training_effect_aerobic=3.8, training_effect_anaerobic=0.0,
            average_hr=None, training_load=120.0, intensity_tag="hard",
        ),
    ]
    canonical = CanonicalDailyMetrics(date="2026-08-06")

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=activities,
        derived_metrics=derived,
    )

    y = snapshot.raw.yesterdayTraining
    assert y is not None
    assert y.activityCount == 2
    assert y.totalDurationMin == 70  # (1800 + 2400) / 60
    assert y.hardActivityCount == 1
    assert y.primaryActivity is not None
    assert y.primaryActivity.activityId == "102"  # higher activityTrainingLoad wins
    assert y.primaryActivity.type == "running"
    assert y.primaryActivity.intensityTag == "hard"


def test_normalize_activity_maps_canonical_fields():
    activity = CanonicalActivity(
        activity_id="999", date="2026-08-05", type="running",
        duration_min=40, duration_seconds=2400,
        training_effect_aerobic=3.8, training_effect_anaerobic=1.2,
        average_hr=150, training_load=120.0, intensity_tag="hard",
    )

    normalized = normalize_activity(activity, sync_run_id="run-abc")

    assert normalized["activityId"] == "999"
    assert normalized["date"] == "2026-08-05"
    assert normalized["type"] == "running"
    assert normalized["durationMin"] == 40
    assert normalized["trainingEffectAerobic"] == 3.8
    assert normalized["trainingEffectAnaerobic"] == 1.2
    assert normalized["averageHr"] == 150
    assert normalized["activityTrainingLoad"] == 120.0
    assert normalized["intensityTag"] == "hard"
    assert normalized["syncRunId"] == "run-abc"
    assert "syncedAt" in normalized
