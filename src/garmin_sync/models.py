from dataclasses import dataclass, field, asdict
from typing import Any

SCHEMA_VERSION = 2
BASELINE_COMPUTATION_VERSION = 1


@dataclass
class MetricDates:
    sleep: str | None = None
    hrv: str | None = None
    restingHr: str | None = None
    bodyBatteryWake: str | None = None
    steps: str | None = None
    activitiesThrough: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass
class SourceMetadata:
    garminSyncedAt: str
    sourceSchemaVersion: int = SCHEMA_VERSION
    timezone: str = "Europe/Warsaw"
    metricDates: MetricDates = field(default_factory=MetricDates)

    def to_dict(self) -> dict[str, Any]:
        return {
            "garminSyncedAt": self.garminSyncedAt,
            "sourceSchemaVersion": self.sourceSchemaVersion,
            "timezone": self.timezone,
            "metricDates": self.metricDates.to_dict(),
        }


@dataclass
class YesterdayTraining:
    type: str
    durationMin: int | None
    trainingEffect: float
    intensityTag: str  # "hard" or "moderate/easy"

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

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if self.yesterdayTraining:
            d["yesterdayTraining"] = self.yesterdayTraining.to_dict()
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
