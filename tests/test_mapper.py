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
            activity_id="101",
            date="2026-08-05",
            type="other",
            duration_min=30,
            duration_seconds=1800,
            training_effect_aerobic=1.0,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=10.0,
            intensity_tag="moderate/easy",
        ),
        CanonicalActivity(
            activity_id="102",
            date="2026-08-05",
            type="running",
            duration_min=40,
            duration_seconds=2400,
            training_effect_aerobic=3.8,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=120.0,
            intensity_tag="hard",
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


def test_build_snapshot_populates_today_training_from_same_day_activity():
    """A Garmin activity already synced for target_date_iso itself should populate
    raw.todayTraining, independent of (and with the same shape as) yesterdayTraining."""
    derived = DerivedMetrics()
    activities = [
        # Yesterday's easy session
        CanonicalActivity(
            activity_id="201",
            date="2026-08-05",
            type="cycling",
            duration_min=30,
            duration_seconds=1800,
            training_effect_aerobic=1.5,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=15.0,
            intensity_tag="moderate/easy",
        ),
        # Today's hard interval session (already uploaded by the time sync ran)
        CanonicalActivity(
            activity_id="202",
            date="2026-08-06",
            type="running",
            duration_min=45,
            duration_seconds=2700,
            training_effect_aerobic=4.2,
            training_effect_anaerobic=0.5,
            average_hr=160,
            training_load=140.0,
            intensity_tag="hard",
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

    today = snapshot.raw.todayTraining
    assert today is not None
    assert today.activityCount == 1
    assert today.totalDurationMin == 45
    assert today.hardActivityCount == 1
    assert today.primaryActivity is not None
    assert today.primaryActivity.activityId == "202"
    assert today.primaryActivity.type == "running"
    assert today.primaryActivity.intensityTag == "hard"

    # Today's own hard session must NOT count toward the 3-day *lookback* -- that
    # measures accumulated load going into today, not today's own session.
    assert snapshot.raw.last3DaysHardSessionsCount == 0

    # yesterdayTraining is unaffected by the presence of a same-day activity.
    yesterday = snapshot.raw.yesterdayTraining
    assert yesterday is not None
    assert yesterday.primaryActivity is not None
    assert yesterday.primaryActivity.activityId == "201"

    assert snapshot.source.metricDates.activitiesThrough == "2026-08-06"


def test_build_snapshot_today_training_is_none_when_no_same_day_activity():
    derived = DerivedMetrics()
    activities = [
        CanonicalActivity(
            activity_id="301",
            date="2026-08-05",
            type="running",
            duration_min=40,
            duration_seconds=2400,
            training_effect_aerobic=3.8,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=120.0,
            intensity_tag="hard",
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

    assert snapshot.raw.todayTraining is None


def test_build_snapshot_activity_missing_id_does_not_win_primary_tie_break():
    """An activity missing its Garmin activityId must not be selected as the day's
    primary/displayed activity over a legitimately-identified one on a tie."""
    derived = DerivedMetrics()
    activities = [
        # Identical load/training-effect/duration to the one below, but no activityId.
        CanonicalActivity(
            activity_id=None,
            date="2026-08-05",
            type="cycling",
            duration_min=30,
            duration_seconds=1800,
            training_effect_aerobic=2.0,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=50.0,
            intensity_tag="moderate/easy",
        ),
        CanonicalActivity(
            activity_id="777",
            date="2026-08-05",
            type="running",
            duration_min=30,
            duration_seconds=1800,
            training_effect_aerobic=2.0,
            training_effect_anaerobic=0.0,
            average_hr=None,
            training_load=50.0,
            intensity_tag="moderate/easy",
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
    assert y.primaryActivity is not None
    assert y.primaryActivity.activityId == "777"


def test_build_snapshot_activities_through_iso_override():
    """rebuild() passes an explicit, more conservative activities_through_iso than the
    default (target_date_iso) since it can't verify an archived activities entry's true
    fetch coverage."""
    derived = DerivedMetrics()
    canonical = CanonicalDailyMetrics(date="2026-08-06")

    default_snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=derived,
    )
    assert default_snapshot.source.metricDates.activitiesThrough == "2026-08-06"

    conservative_snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=derived,
        activities_through_iso="2026-08-05",
    )
    assert conservative_snapshot.source.metricDates.activitiesThrough == "2026-08-05"


def test_normalize_activity_maps_canonical_fields():
    activity = CanonicalActivity(
        activity_id="999",
        date="2026-08-05",
        type="running",
        duration_min=40,
        duration_seconds=2400,
        training_effect_aerobic=3.8,
        training_effect_anaerobic=1.2,
        average_hr=150,
        training_load=120.0,
        intensity_tag="hard",
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


def test_normalize_activity_adds_detail_without_schema_version_or_null_fields():
    import json
    from pathlib import Path

    from garmin_sync.canonical import (
        CanonicalActivityDetail,
        CanonicalLapSummary,
        CanonicalZoneBucket,
    )

    activity = CanonicalActivity(
        activity_id="999",
        date="2026-08-05",
        type="cycling",
        duration_min=60,
        duration_seconds=3600,
        training_effect_aerobic=3.4,
        training_effect_anaerobic=0.0,
        average_hr=145,
        training_load=120.0,
        intensity_tag="moderate",
    )
    detail = CanonicalActivityDetail(
        activity_id="999",
        power_zones=[CanonicalZoneBucket(1, 300.0, None)],
        hr_zones=None,
        normalized_power_watts=229.0,
        intensity_factor=0.82,
        variability_index=1.07,
        laps=[CanonicalLapSummary(1, 900.0, 250.0, None)],
    )

    normalized = normalize_activity(activity, sync_run_id="run-abc", detail=detail)

    assert "schemaVersion" not in normalized
    assert normalized["powerInZones"] == [{"zoneNumber": 1, "secondsInZone": 300.0}]
    assert "hrInZones" not in normalized
    assert normalized["normalizedPower"] == 229.0
    assert normalized["laps"] == [
        {"lapIndex": 1, "durationSeconds": 900.0, "averagePowerWatts": 250.0}
    ]
    expected = json.loads(
        (Path(__file__).parent / "fixtures" / "normalized_activity_enriched.json").read_text()
    )
    without_timestamp = {key: value for key, value in normalized.items() if key != "syncedAt"}
    assert without_timestamp == expected


def test_build_snapshot_populates_metric_enrichment_fields():
    from garmin_sync.canonical import (
        CanonicalBodyBattery,
        CanonicalStress,
        CanonicalTrainingReadiness,
        CanonicalTrainingStatus,
    )

    canonical = CanonicalDailyMetrics(
        date="2026-08-06",
        stress=CanonicalStress(avg=43, max=100),
        body_battery=CanonicalBodyBattery(charged=75, drained=84, change=-9),
        training_readiness=CanonicalTrainingReadiness(
            score=59, level="MODERATE", feedback="MOD_HRV_LOW"
        ),
        training_status=CanonicalTrainingStatus(
            status_phrase="STRAINED_1",
            acute_training_load=137,
            acwr_status="LOW",
            vo2max_running=48.0,
            vo2max_running_date="2026-07-17",
            vo2max_cycling=48.0,
            vo2max_cycling_date="2026-07-24",
        ),
    )

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    raw = snapshot.raw
    assert raw.stress is not None and raw.stress.avg == 43 and raw.stress.max == 100
    assert raw.bodyBatteryChange == -9
    assert raw.bodyBatteryCharged == 75
    assert raw.bodyBatteryDrained == 84
    assert raw.trainingReadiness is not None and raw.trainingReadiness.score == 59
    assert raw.trainingStatus is not None
    assert raw.trainingStatus.statusPhrase == "STRAINED_1"
    assert raw.trainingStatus.vo2MaxRunningDate == "2026-07-17"

    dq = snapshot.dataQuality
    assert dq.stressAvailable is True
    assert dq.bodyBatteryDetailAvailable is True
    assert dq.trainingReadinessAvailable is True
    assert dq.trainingStatusAvailable is True

    dates = snapshot.source.metricDates
    assert dates.stress == "2026-08-06"
    assert dates.bodyBattery == "2026-08-06"
    assert dates.trainingReadiness == "2026-08-06"
    assert dates.trainingStatus == "2026-08-06"


def test_build_snapshot_metric_enrichment_fields_absent_when_no_canonical_data():
    """No enrichment data (e.g. archived rebuild of a pre-item-4 date) must degrade to
    None fields and False availability flags, not an error."""
    canonical = CanonicalDailyMetrics(date="2026-08-06")

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    assert snapshot.raw.stress is None
    assert snapshot.raw.trainingReadiness is None
    assert snapshot.raw.trainingStatus is None
    assert snapshot.raw.bodyBatteryChange is None
    assert snapshot.dataQuality.stressAvailable is False
    assert snapshot.source.metricDates.stress is None


def test_build_snapshot_maps_sleep_stages():
    canonical = CanonicalDailyMetrics(
        date="2026-08-23",
        sleep_score=85,
        sleep_duration_seconds=28800,
        deep_sleep_seconds=5400,
        rem_sleep_seconds=6400,
        light_sleep_seconds=15000,
        awake_sleep_seconds=2000,
        restless_moments_count=12,
    )

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-23",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    assert snapshot.raw.deepSleepSec == 5400
    assert snapshot.raw.remSleepSec == 6400
    assert snapshot.raw.lightSleepSec == 15000
    assert snapshot.raw.awakeSleepSec == 2000
    assert snapshot.raw.restlessMomentsCount == 12


def test_build_snapshot_maps_weight_and_body_fat():
    canonical = CanonicalDailyMetrics(
        date="2026-08-23",
        weight_kg=71.2,
        body_fat_pct=13.8,
        weight_date="2026-08-23",
    )

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-23",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    assert snapshot.raw.weightKg == 71.2
    assert snapshot.raw.bodyFatPct == 13.8
    assert snapshot.source.metricDates.weight == "2026-08-23"


def test_build_snapshot_maps_spo2_and_skin_temp():
    from garmin_sync.canonical import CanonicalSpo2

    canonical = CanonicalDailyMetrics(
        date="2026-08-23",
        spo2=CanonicalSpo2(avg_pct=97.0, min_pct=93.0, sleep_avg_pct=96.5),
        skin_temp_deviation_celsius=0.25,
    )

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-23",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    assert snapshot.raw.spo2 is not None
    assert snapshot.raw.spo2.avgPct == 97.0
    assert snapshot.raw.spo2.minPct == 93.0
    assert snapshot.raw.spo2.sleepAvgPct == 96.5
    assert snapshot.raw.skinTempDeviationCelsius == 0.25
    assert snapshot.dataQuality.spo2Available is True
    assert snapshot.dataQuality.skinTempAvailable is True
    assert snapshot.source.metricDates.spo2 == "2026-08-23"
    assert snapshot.source.metricDates.skinTempDeviation == "2026-08-23"


def test_build_snapshot_maps_recovery_time_hours():
    canonical = CanonicalDailyMetrics(
        date="2026-08-23",
        recovery_time_hours=22,
    )

    snapshot = build_snapshot_from_canonical(
        user_id="test_uid",
        target_date_iso="2026-08-23",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=DerivedMetrics(),
    )

    assert snapshot.raw.recoveryTimeHours == 22


def test_normalize_activity_maps_te_and_recovery():
    act = CanonicalActivity(
        activity_id="act-789",
        date="2026-08-23",
        type="running",
        duration_min=50,
        duration_seconds=3000,
        training_effect_aerobic=4.0,
        training_effect_anaerobic=1.5,
        average_hr=160.0,
        training_load=140.0,
        intensity_tag="hard",
        primary_benefit="VO2MAX",
        epoc=150.2,
        recovery_time_hours=36,
        training_effect_label="HIGHLY_IMPACTING_VO2MAX",
    )

    payload = normalize_activity(act, sync_run_id="run-te")
    assert payload["primaryBenefit"] == "VO2MAX"
    assert payload["epoc"] == 150.2
    assert payload["recoveryTimeHours"] == 36
    assert payload["trainingEffectLabel"] == "HIGHLY_IMPACTING_VO2MAX"


def test_normalize_activity_maps_exercise_sets():
    from garmin_sync.canonical import CanonicalActivityDetail, CanonicalExerciseSet

    act = CanonicalActivity(
        activity_id="act-strength-1",
        date="2026-08-23",
        type="strength_training",
        duration_min=45,
        duration_seconds=2700,
        training_effect_aerobic=1.5,
        training_effect_anaerobic=2.5,
        average_hr=125.0,
        training_load=80.0,
        intensity_tag="moderate",
    )
    detail = CanonicalActivityDetail(
        activity_id="act-strength-1",
        exercise_sets=[
            CanonicalExerciseSet(
                set_order=0,
                set_type="active",
                repetition_count=12,
                weight_kg=50.0,
                exercise_category="SQUAT",
                exercise_name="BARBELL_BACK_SQUAT",
                duration_seconds=40.0,
                rest_duration_seconds=90.0,
            )
        ],
    )

    payload = normalize_activity(act, sync_run_id="run-str", detail=detail)
    assert "exerciseSets" in payload
    assert len(payload["exerciseSets"]) == 1
    es = payload["exerciseSets"][0]
    assert es["setOrder"] == 0
    assert es["setType"] == "active"
    assert es["repetitionCount"] == 12
    assert es["weightKg"] == 50.0
    assert es["exerciseCategory"] == "SQUAT"
    assert es["exerciseName"] == "BARBELL_BACK_SQUAT"
    assert es["durationSeconds"] == 40.0
    assert es["restDurationSeconds"] == 90.0
