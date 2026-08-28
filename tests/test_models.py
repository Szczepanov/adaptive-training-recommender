from typing import Any

from garmin_sync.models import (
    DailyRecoverySnapshot,
    DataQuality,
    DerivedDeltas,
    DerivedMetrics,
    HealthObservationDayBundle,
    HealthObservationDTO,
    HeartRateZonesSummary,
    MetricDates,
    PrimaryActivity,
    RawMetrics,
    SourceMetadata,
    Spo2Summary,
    StressSummary,
    TrainingReadinessSummary,
    TrainingStatusSummary,
    YesterdayTraining,
)


def test_metric_dates_serialization() -> None:
    md = MetricDates(
        sleep="2023-10-25",
        hrv="2023-10-25",
        restingHr="2023-10-25",
        bodyBatteryWake="2023-10-25",
        steps="2023-10-25",
        activitiesThrough="2023-10-25",
        stress="2023-10-25",
        bodyBattery="2023-10-25",
        trainingReadiness="2023-10-25",
        trainingStatus="2023-10-25",
        weight="2023-10-25",
        spo2="2023-10-25",
        skinTempDeviation="2023-10-25",
    )
    d: dict[str, Any] = md.to_dict()
    assert d["sleep"] == "2023-10-25"
    assert d["hrv"] == "2023-10-25"
    assert d["restingHr"] == "2023-10-25"
    assert d["bodyBatteryWake"] == "2023-10-25"
    assert d["steps"] == "2023-10-25"
    assert d["activitiesThrough"] == "2023-10-25"
    assert d["stress"] == "2023-10-25"
    assert d["bodyBattery"] == "2023-10-25"
    assert d["trainingReadiness"] == "2023-10-25"
    assert d["trainingStatus"] == "2023-10-25"
    assert d["weight"] == "2023-10-25"
    assert d["spo2"] == "2023-10-25"
    assert d["skinTempDeviation"] == "2023-10-25"


def test_metric_dates_empty_serialization() -> None:
    md = MetricDates()
    d: dict[str, Any] = md.to_dict()
    assert d["sleep"] is None
    assert d["hrv"] is None
    assert d["restingHr"] is None
    assert d["bodyBatteryWake"] is None
    assert d["steps"] is None
    assert d["activitiesThrough"] is None
    assert d["stress"] is None
    assert d["bodyBattery"] is None
    assert d["trainingReadiness"] is None
    assert d["trainingStatus"] is None
    assert d["weight"] is None
    assert d["spo2"] is None
    assert d["skinTempDeviation"] is None


def test_source_metadata_serialization() -> None:
    md = MetricDates(sleep="2023-10-25")
    sm = SourceMetadata(
        garminSyncedAt="2023-10-25T12:00:00Z",
        sourceSchemaVersion=1,
        timezone="Europe/Warsaw",
        metricDates=md,
        garminconnectVersion="0.3.8",
    )
    d = sm.to_dict()
    assert d["garminSyncedAt"] == "2023-10-25T12:00:00Z"
    assert d["sourceSchemaVersion"] == 1
    assert d["timezone"] == "Europe/Warsaw"
    assert d["metricDates"]["sleep"] == "2023-10-25"
    assert d["garminconnectVersion"] == "0.3.8"


def test_primary_activity_serialization() -> None:
    pa = PrimaryActivity(
        activityId=123, type="running", durationMin=30, trainingEffect=3.5, intensityTag="hard"
    )
    d = pa.to_dict()
    assert d["activityId"] == 123
    assert d["type"] == "running"
    assert d["durationMin"] == 30
    assert d["trainingEffect"] == 3.5
    assert d["intensityTag"] == "hard"


def test_yesterday_training_serialization() -> None:
    pa = PrimaryActivity(
        activityId=123, type="running", durationMin=30, trainingEffect=3.5, intensityTag="hard"
    )
    yt = YesterdayTraining(
        activityCount=1, totalDurationMin=30, hardActivityCount=1, primaryActivity=pa
    )
    d = yt.to_dict()
    assert d["activityCount"] == 1
    assert d["totalDurationMin"] == 30
    assert d["hardActivityCount"] == 1
    assert d["primaryActivity"]["activityId"] == 123


def test_stress_summary_serialization() -> None:
    ss = StressSummary(avg=45, max=90)
    d = ss.to_dict()
    assert d["avg"] == 45
    assert d["max"] == 90


def test_training_readiness_serialization() -> None:
    tr = TrainingReadinessSummary(score=75, level="high", feedback="good")
    d = tr.to_dict()
    assert d["score"] == 75
    assert d["level"] == "high"
    assert d["feedback"] == "good"


def test_training_status_serialization() -> None:
    ts = TrainingStatusSummary(
        statusPhrase="productive",
        acuteTrainingLoad=500.0,
        acwrStatus="optimal",
        vo2MaxRunning=55.0,
        vo2MaxRunningDate="2023-10-25",
        vo2MaxCycling=50.0,
        vo2MaxCyclingDate="2023-10-25",
    )
    d = ts.to_dict()
    assert d["statusPhrase"] == "productive"
    assert d["acuteTrainingLoad"] == 500.0
    assert d["vo2MaxRunning"] == 55.0


def test_heart_rate_zones_serialization() -> None:
    hz = HeartRateZonesSummary(restingHrUsed=50, maxHrUsed=190, zone4Floor=160, sport="running")
    d = hz.to_dict()
    assert d["restingHrUsed"] == 50
    assert d["maxHrUsed"] == 190
    assert d["zone4Floor"] == 160
    assert d["sport"] == "running"


def test_spo2_summary_serialization() -> None:
    ss = Spo2Summary(avgPct=96.0, minPct=92.0, sleepAvgPct=95.0)
    d = ss.to_dict()
    assert d["avgPct"] == 96.0
    assert d["minPct"] == 92.0
    assert d["sleepAvgPct"] == 95.0


def test_raw_metrics_serialization() -> None:
    yt = YesterdayTraining(activityCount=0, totalDurationMin=0, hardActivityCount=0)
    ss = StressSummary(avg=25)
    tr = TrainingReadinessSummary(score=80)
    ts = TrainingStatusSummary(statusPhrase="productive")
    hz = HeartRateZonesSummary(sport="running")
    spo2 = Spo2Summary(avgPct=98.0)

    rm = RawMetrics(
        sleepScore=85,
        sleepDurationSec=28800,
        deepSleepSec=7200,
        remSleepSec=9000,
        lightSleepSec=12600,
        awakeSleepSec=720,
        restlessMomentsCount=5,
        restingHr=50,
        hrvOvernightAvg=65.0,
        hrvStatus="balanced",
        respirationAvg=14.5,
        bodyBatteryWake=95,
        bodyBatteryChange=-50,
        totalSteps=10000,
        last3DaysHardSessionsCount=1,
        yesterdayTraining=yt,
        todayTraining=yt,
        bodyBatteryCharged=100,
        bodyBatteryDrained=50,
        stress=ss,
        trainingReadiness=tr,
        trainingStatus=ts,
        heartRateZones=hz,
        weightKg=75.0,
        bodyFatPct=15.0,
        spo2=spo2,
        skinTempDeviationCelsius=0.1,
        recoveryTimeHours=12,
    )
    d = rm.to_dict()
    assert d["sleepScore"] == 85
    assert d["restingHr"] == 50
    assert d["yesterdayTraining"]["activityCount"] == 0
    assert d["stress"]["avg"] == 25
    assert d["trainingReadiness"]["score"] == 80
    assert d["trainingStatus"]["statusPhrase"] == "productive"
    assert d["heartRateZones"]["sport"] == "running"
    assert d["spo2"]["avgPct"] == 98.0


def test_derived_deltas_serialization() -> None:
    dd = DerivedDeltas(
        sleepScoreVs7d=5.0,
        sleepScoreVs28d=2.0,
        restingHrVs7d=-1.0,
        restingHrVs28d=-2.0,
        hrvVs7d=1.5,
        hrvVs28d=3.0,
        respirationVs7d=0.1,
        respirationVs28d=-0.2,
        stepsVs7d=1000.0,
        stepsVs28d=500.0,
        sleepScoreVs7dMedian=4.0,
        sleepScoreVs28dMedian=1.0,
        restingHrVs7dMedian=-0.5,
        restingHrVs28dMedian=-1.5,
        hrvVs7dMedian=1.0,
        hrvVs28dMedian=2.5,
        stepsVs7dMedian=800.0,
        stepsVs28dMedian=400.0,
        bodyBatteryWakeVs7dMedian=2.0,
        bodyBatteryWakeVs28dMedian=5.0,
        stressAvgVs7dMedian=-2.0,
        stressAvgVs28dMedian=-5.0,
        stressMaxVs7dMedian=0.0,
        stressMaxVs28dMedian=-10.0,
        trainingReadinessScoreVs7dMedian=5.0,
        trainingReadinessScoreVs28dMedian=10.0,
    )
    d = dd.to_dict()
    assert d["sleepScoreVs7d"] == 5.0
    assert d["restingHrVs7d"] == -1.0
    assert d["trainingReadinessScoreVs28dMedian"] == 10.0


def test_derived_metrics_serialization() -> None:
    dd = DerivedDeltas(sleepScoreVs7d=5.0)
    dm = DerivedMetrics(
        baselineComputationVersion=5,
        sleepScore7dAvg=80.0,
        sleepScore28dAvg=78.0,
        restingHr7dAvg=52.0,
        restingHr28dAvg=54.0,
        hrv7dAvg=60.0,
        hrv28dAvg=58.0,
        respiration7dAvg=14.0,
        respiration28dAvg=14.2,
        hrv28dStdev=5.0,
        restingHr28dStdev=2.0,
        sleepScore28dStdev=6.0,
        respiration28dMad=0.5,
        steps7dAvg=8000.0,
        steps28dAvg=7500.0,
        steps28dStdev=2000.0,
        sleepScore7dMedian=81.0,
        sleepScore28dMedian=79.0,
        sleepScore28dMad=4.0,
        restingHr7dMedian=51.0,
        restingHr28dMedian=53.0,
        restingHr28dMad=1.5,
        hrv7dMedian=61.0,
        hrv28dMedian=59.0,
        hrv28dMad=4.5,
        steps7dMedian=8200.0,
        steps28dMedian=7600.0,
        steps28dMad=1500.0,
        bodyBatteryWake7dMedian=90.0,
        bodyBatteryWake28dMedian=85.0,
        bodyBatteryWake28dMad=5.0,
        stressAvg7dMedian=25.0,
        stressAvg28dMedian=28.0,
        stressAvg28dMad=3.0,
        stressMax7dMedian=85.0,
        stressMax28dMedian=88.0,
        stressMax28dMad=6.0,
        trainingReadinessScore7dMedian=75.0,
        trainingReadinessScore28dMedian=70.0,
        trainingReadinessScore28dMad=10.0,
        deltas=dd,
    )
    d = dm.to_dict()
    assert d["deltas"]["sleepScoreVs7d"] == 5.0
    assert d["sleepScore7dAvg"] == 80.0
    assert d["stressMax28dMad"] == 6.0


def test_data_quality_serialization() -> None:
    dq = DataQuality(
        sleepScoreAvailable=True,
        restingHrAvailable=False,
        hrvAvailable=True,
        baseline7dReady=True,
        baseline28dReady=False,
        stressAvailable=True,
        bodyBatteryDetailAvailable=False,
        trainingReadinessAvailable=True,
        trainingStatusAvailable=False,
        heartRateZonesAvailable=True,
        spo2Available=False,
        skinTempAvailable=True,
    )
    d = dq.to_dict()
    assert d["sleepScoreAvailable"] is True
    assert d["restingHrAvailable"] is False
    assert d["heartRateZonesAvailable"] is True


def test_daily_recovery_snapshot_serialization() -> None:
    rm = RawMetrics(sleepScore=85)
    dm = DerivedMetrics(deltas=DerivedDeltas())
    sm = SourceMetadata(garminSyncedAt="2023-10-25T12:00:00Z")
    dq = DataQuality()

    snap = DailyRecoverySnapshot(
        userId="user1", date="2023-10-25", source=sm, raw=rm, derived=dm, dataQuality=dq
    )
    d = snap.to_dict()
    assert d["userId"] == "user1"
    assert d["date"] == "2023-10-25"
    assert d["raw"]["sleepScore"] == 85
    assert d["source"]["garminSyncedAt"] == "2023-10-25T12:00:00Z"


def test_health_observation_dto_serialization() -> None:
    obs = HealthObservationDTO(
        observationId="obs-1",
        metric="heart_rate",
        value=60.0,
        unit="bpm",
        observedStart="2023-10-25T12:00:00Z",
    )
    d = obs.to_dict()
    assert d["observationId"] == "obs-1"
    assert d["value"] == 60.0
    assert "sourceRecordId" not in d  # Test omitting None values


def test_health_observation_day_bundle_serialization() -> None:
    obs1 = HealthObservationDTO(
        observationId="obs-1",
        metric="hr",
        value=60.0,
        unit="bpm",
        observedStart="2023-10-25T12:00:00Z",
    )
    obs2 = HealthObservationDTO(
        observationId="obs-2",
        metric="hrv",
        value=55.0,
        unit="ms",
        observedStart="2023-10-25T12:00:00Z",
    )
    bundle = HealthObservationDayBundle(
        userId="user1",
        logicalDate="2023-10-25",
        provider="garmin",
        transport="api",
        observations=[obs1, obs2],
        sourcePayloadHash="abc123hash",
    )
    d = bundle.to_dict()
    assert d["userId"] == "user1"
    assert d["logicalDate"] == "2023-10-25"
    assert len(d["observations"]) == 2
    assert d["observations"][0]["observationId"] == "obs-1"
    assert d["sourcePayloadHash"] == "abc123hash"


def test_daily_recovery_snapshot_serialization_with_timestamps() -> None:
    rm = RawMetrics(sleepScore=85)
    dm = DerivedMetrics(deltas=DerivedDeltas())
    sm = SourceMetadata(garminSyncedAt="2023-10-25T12:00:00Z")
    dq = DataQuality()

    snap = DailyRecoverySnapshot(
        userId="user1",
        date="2023-10-25",
        source=sm,
        raw=rm,
        derived=dm,
        dataQuality=dq,
        createdAt="2023-10-25T13:00:00Z",
        updatedAt="2023-10-25T14:00:00Z",
    )
    d = snap.to_dict()
    assert d["userId"] == "user1"
    assert d["createdAt"] == "2023-10-25T13:00:00Z"
    assert d["updatedAt"] == "2023-10-25T14:00:00Z"


def test_health_observation_day_bundle_serialization_with_optional() -> None:
    obs1 = HealthObservationDTO(
        observationId="obs-1",
        metric="hr",
        value=60.0,
        unit="bpm",
        observedStart="2023-10-25T12:00:00Z",
    )
    bundle = HealthObservationDayBundle(
        userId="user1",
        logicalDate="2023-10-25",
        provider="garmin",
        transport="api",
        observations=[obs1],
        sourcePayloadHash="abc123hash",
        rawArchiveRef="path/to/archive.json",
        ingestedAt="2023-10-25T12:05:00Z",
        effectiveAt="2023-10-25T12:00:00Z",
    )
    d = bundle.to_dict()
    assert d["rawArchiveRef"] == "path/to/archive.json"
    assert d["ingestedAt"] == "2023-10-25T12:05:00Z"
    assert d["effectiveAt"] == "2023-10-25T12:00:00Z"
