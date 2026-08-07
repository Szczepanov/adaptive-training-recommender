from dataclasses import dataclass, field, asdict
from typing import Any

SCHEMA_VERSION = 3
# v2: added 28-day trailing population stdev per metric (hrv28dStdev,
# restingHr28dStdev, sleepScore28dStdev), consumed by the engine's baseline-relative
# strain scoring (see app/src/engine/rules.ts metricStrain). Older documents simply
# lack these fields -- readers must treat them as optional/None, never assume presence.
BASELINE_COMPUTATION_VERSION = 2


@dataclass
class MetricDates:
    sleep: str | None = None
    hrv: str | None = None
    restingHr: str | None = None
    bodyBatteryWake: str | None = None
    steps: str | None = None
    activitiesThrough: str | None = None
    stress: str | None = None
    bodyBattery: str | None = None
    trainingReadiness: str | None = None
    trainingStatus: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass
class SourceMetadata:
    garminSyncedAt: str
    sourceSchemaVersion: int = SCHEMA_VERSION
    timezone: str = "Europe/Warsaw"
    metricDates: MetricDates = field(default_factory=MetricDates)
    garminconnectVersion: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {
            "garminSyncedAt": self.garminSyncedAt,
            "sourceSchemaVersion": self.sourceSchemaVersion,
            "timezone": self.timezone,
            "metricDates": self.metricDates.to_dict(),
        }
        if self.garminconnectVersion:
            d["garminconnectVersion"] = self.garminconnectVersion
        return d


@dataclass
class PrimaryActivity:
    activityId: int | str
    type: str
    durationMin: int | None
    trainingEffect: float
    intensityTag: str  # "hard" or "moderate/easy"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class YesterdayTraining:
    activityCount: int
    totalDurationMin: int
    hardActivityCount: int
    primaryActivity: PrimaryActivity | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if self.primaryActivity:
            d["primaryActivity"] = self.primaryActivity.to_dict()
        return d


@dataclass
class StressSummary:
    avg: int | None = None
    max: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TrainingReadinessSummary:
    score: int | None = None
    level: str | None = None
    feedback: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TrainingStatusSummary:
    statusPhrase: str | None = None
    acuteTrainingLoad: float | None = None
    acwrStatus: str | None = None
    vo2MaxRunning: float | None = None
    vo2MaxRunningDate: str | None = None
    vo2MaxCycling: float | None = None
    vo2MaxCyclingDate: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class HeartRateZonesSummary:
    """Garmin's own configured max-HR/zone values for this person -- see
    CanonicalHeartRateZones. Recorded for observation alongside the other metric
    enrichment fields, not yet consumed by classify_activity_intensity."""
    restingHrUsed: int | None = None
    maxHrUsed: int | None = None
    zone4Floor: int | None = None
    sport: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RawMetrics:
    sleepScore: int | float | None = None
    sleepDurationSec: int | None = None
    restingHr: int | float | None = None
    hrvOvernightAvg: int | float | None = None
    hrvStatus: str | None = None
    respirationAvg: float | None = None
    bodyBatteryWake: int | float | None = None
    bodyBatteryChange: int | float | None = None
    totalSteps: int | None = None
    last3DaysHardSessionsCount: int = 0
    yesterdayTraining: YesterdayTraining | None = None
    # Same-day activity synced from Garmin for `date` itself. Reuses the YesterdayTraining
    # shape (it's just "activity summary for one specific day"). Only populated if a sync
    # runs after the activity was uploaded to Garmin -- absent doesn't mean "didn't train
    # today", just "not yet synced". See CLAUDE.md / DailySubjectiveCheckin.alreadyTrainedToday
    # for the reliable same-day signal the recommendation engine prefers.
    todayTraining: YesterdayTraining | None = None
    # Metric enrichment (item 4): archived + recorded, not yet consumed by the
    # recommendation engine -- see DataQuality.*Available for observed real-world
    # availability before these get wired into any rule.
    bodyBatteryCharged: int | None = None
    bodyBatteryDrained: int | None = None
    stress: StressSummary | None = None
    trainingReadiness: TrainingReadinessSummary | None = None
    trainingStatus: TrainingStatusSummary | None = None
    heartRateZones: HeartRateZonesSummary | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if self.yesterdayTraining:
            d["yesterdayTraining"] = self.yesterdayTraining.to_dict()
        if self.todayTraining:
            d["todayTraining"] = self.todayTraining.to_dict()
        if self.stress:
            d["stress"] = self.stress.to_dict()
        if self.trainingReadiness:
            d["trainingReadiness"] = self.trainingReadiness.to_dict()
        if self.trainingStatus:
            d["trainingStatus"] = self.trainingStatus.to_dict()
        if self.heartRateZones:
            d["heartRateZones"] = self.heartRateZones.to_dict()
        return d


@dataclass
class DerivedDeltas:
    sleepScoreVs7d: float | None = None
    sleepScoreVs28d: float | None = None
    restingHrVs7d: float | None = None
    restingHrVs28d: float | None = None
    hrvVs7d: float | None = None
    hrvVs28d: float | None = None
    respirationVs7d: float | None = None
    respirationVs28d: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DerivedMetrics:
    baselineComputationVersion: int = BASELINE_COMPUTATION_VERSION
    sleepScore7dAvg: float | None = None
    sleepScore28dAvg: float | None = None
    restingHr7dAvg: float | None = None
    restingHr28dAvg: float | None = None
    hrv7dAvg: float | None = None
    hrv28dAvg: float | None = None
    respiration7dAvg: float | None = None
    respiration28dAvg: float | None = None
    # Trailing 28-day population stdev per metric -- this user's own night-to-night
    # variability, used to baseline-relative-normalize the engine's strain scoring
    # instead of comparing everyone against the same fixed absolute threshold.
    hrv28dStdev: float | None = None
    restingHr28dStdev: float | None = None
    sleepScore28dStdev: float | None = None
    deltas: DerivedDeltas = field(default_factory=DerivedDeltas)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["deltas"] = self.deltas.to_dict()
        return d


@dataclass
class DataQuality:
    sleepScoreAvailable: bool = False
    restingHrAvailable: bool = False
    hrvAvailable: bool = False
    baseline7dReady: bool = False
    baseline28dReady: bool = False
    # Metric enrichment (item 4) availability tracking -- the mechanism for "measure
    # availability for several weeks" before deciding whether to expose these to rules.
    stressAvailable: bool = False
    bodyBatteryDetailAvailable: bool = False
    trainingReadinessAvailable: bool = False
    trainingStatusAvailable: bool = False
    heartRateZonesAvailable: bool = False

    def to_dict(self) -> dict[str, bool]:
        return asdict(self)


@dataclass
class DailyRecoverySnapshot:
    userId: str
    date: str  # YYYY-MM-DD
    source: SourceMetadata
    raw: RawMetrics
    derived: DerivedMetrics
    dataQuality: DataQuality
    createdAt: str | None = None
    updatedAt: str | None = None

    def to_dict(self) -> dict[str, Any]:
        res = {
            "userId": self.userId,
            "date": self.date,
            "source": self.source.to_dict(),
            "raw": self.raw.to_dict(),
            "derived": self.derived.to_dict(),
            "dataQuality": self.dataQuality.to_dict(),
        }
        if self.createdAt:
            res["createdAt"] = self.createdAt
        if self.updatedAt:
            res["updatedAt"] = self.updatedAt
        return res
