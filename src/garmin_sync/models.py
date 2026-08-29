from dataclasses import asdict, dataclass, field
from typing import Any

SCHEMA_VERSION = 3
# v2: added 28-day trailing population stdev per metric (hrv28dStdev,
# restingHr28dStdev, sleepScore28dStdev), consumed by the engine's baseline-relative
# strain scoring (see app/src/engine/rules.ts metricStrain). Older documents simply
# lack these fields -- readers must treat them as optional/None, never assume presence.
# v3: respiration7dAvg/respiration28dAvg are now the *median* (not mean) of the window,
# and respiration28dMad (median absolute deviation, scaled to be stdev-comparable) was
# added alongside them -- see calculate_median/calculate_mad in metrics.py for why. This
# changes the *meaning* of an existing field rather than only adding a new one: a document
# written at version 2 or earlier holds a mean in respiration7dAvg/28dAvg, not a median.
# Readers that need the distinction should check baselineComputationVersion; the rebuild
# pipeline (ADR-0005) recomputes older documents onto the current version.
# v4 (docs/adr/0006 amendment): adds median/MAD fields for sleep score, RHR, HRV, and steps
# *alongside* their existing mean/stdev fields (sleepScore7dMedian, restingHr28dMad, etc.)
# -- purely additive, unlike v3's respiration change. These are observation-only: nothing
# in the engine reads them yet. They exist so a comparison harness can measure how a
# median/MAD baseline would have scored real history before any of these four metrics'
# live mean/stdev is replaced (see ADR-0014's precedent for that bar). Absent on documents
# written before v4.
# v5 (docs/adr/0006 amendment): adds observation-only 7d/28d median + 28d MAD baselines for
# body battery wake and the "metric enrichment" fields stress avg/max and training
# readiness score (bodyBatteryWake28dMad, stressAvg7dMedian, etc.). Unlike v4, none of
# these had *any* baseline before -- this is new, not an alternate stat alongside an
# existing mean. Still not consumed by the engine. Absent on documents written before v5.
# v6 (Phase 2, sleep-decision-authority plan, 2026-08-29): adds observation-only
# sleep-duration median/MAD/deltas (sleepDuration7dMedian etc.) and a 2-day/3-day
# accumulated sleep-duration deficit (signed: positive = net shortfall vs the 28d median
# baseline over the most recent N nights with data, negative = net surplus -- "most recent
# N nights with data" tolerates a sync gap the same way calculate_median/calculate_average
# already do elsewhere in this file, so it is not strictly the last N *calendar* nights).
# Also adds bedtime/wake-time/sleep-midpoint circular-mean baselines and signed
# shortest-arc deviations (bedtime7dCircularMeanMinutes etc.) -- clock times wrap at
# midnight, so these deliberately use circular mean + shortest-arc delta, not the
# linear median/MAD the rest of this file uses; see calculate_circular_mean_minutes/
# calculate_circular_delta_minutes in metrics.py. Sleep midpoint is computed from the real
# sleep_session_start/end timestamps (exact datetime arithmetic), not circularly averaged
# from separately-converted bedtime/wake-time values. Still not consumed by the engine.
# Per the reviewed analysis (docs/analysis/2026-08-29-sleep-data-training-recommendations-
# analysis.md), these are meant for planning/coaching use once wired up, not training
# readiness -- see OBSERVATION_AUTHORITY in canonical.py for the analogous ADR-0027 policy.
BASELINE_COMPUTATION_VERSION = 6


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
    weight: str | None = None
    spo2: str | None = None
    skinTempDeviation: str | None = None

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
    enrichment fields and consumed by classify_activity_intensity."""

    restingHrUsed: int | None = None
    maxHrUsed: int | None = None
    zone4Floor: int | None = None
    sport: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Spo2Summary:
    avgPct: float | None = None
    minPct: float | None = None
    sleepAvgPct: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RawMetrics:
    sleepScore: int | float | None = None
    sleepDurationSec: int | None = None
    # ISO 8601 UTC timestamps for the actual sleep-session window (see
    # CanonicalDailyMetrics.sleep_session_start/end) -- None when Garmin's raw sleep
    # payload didn't include a timing window for the selected (target-date or D-1
    # fallback) sleep record.
    sleepSessionStart: str | None = None
    sleepSessionEnd: str | None = None
    deepSleepSec: int | None = None
    remSleepSec: int | None = None
    lightSleepSec: int | None = None
    awakeSleepSec: int | None = None
    restlessMomentsCount: int | None = None
    # Garmin's own per-night awakening count (dailySleepDTO.awakeCount) -- unlike
    # restlessMomentsCount (confirmed null on this account for 73/73 sampled nights,
    # 2026-08-29), this field is populated every sampled night across the full comparison
    # year, with real variation (0-6 observed). Observability-only: not consumed by the
    # recommendation engine.
    awakeCount: int | None = None
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
    weightKg: float | None = None
    bodyFatPct: float | None = None
    spo2: Spo2Summary | None = None
    skinTempDeviationCelsius: float | None = None
    recoveryTimeHours: int | None = None

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
        if self.spo2:
            d["spo2"] = self.spo2.to_dict()
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
    stepsVs7d: float | None = None
    stepsVs28d: float | None = None
    # v4: median-baseline deltas, observation-only -- see BASELINE_COMPUTATION_VERSION's v4
    # note. Current value minus the corresponding *dMedian field below, not the *dAvg one.
    sleepScoreVs7dMedian: float | None = None
    sleepScoreVs28dMedian: float | None = None
    restingHrVs7dMedian: float | None = None
    restingHrVs28dMedian: float | None = None
    hrvVs7dMedian: float | None = None
    hrvVs28dMedian: float | None = None
    stepsVs7dMedian: float | None = None
    stepsVs28dMedian: float | None = None
    # v5: median-baseline deltas for body battery wake / stress / training readiness,
    # observation-only -- see BASELINE_COMPUTATION_VERSION's v5 note.
    bodyBatteryWakeVs7dMedian: float | None = None
    bodyBatteryWakeVs28dMedian: float | None = None
    stressAvgVs7dMedian: float | None = None
    stressAvgVs28dMedian: float | None = None
    stressMaxVs7dMedian: float | None = None
    stressMaxVs28dMedian: float | None = None
    trainingReadinessScoreVs7dMedian: float | None = None
    trainingReadinessScoreVs28dMedian: float | None = None
    # v6: sleep-duration median-baseline deltas and circular time-of-day deviations --
    # see BASELINE_COMPUTATION_VERSION's v6 note.
    sleepDurationVs7dMedian: float | None = None
    sleepDurationVs28dMedian: float | None = None
    bedtimeDeviationVs7dMinutes: float | None = None
    bedtimeDeviationVs28dMinutes: float | None = None
    wakeTimeDeviationVs7dMinutes: float | None = None
    wakeTimeDeviationVs28dMinutes: float | None = None
    sleepMidpointDeviationVs7dMinutes: float | None = None
    sleepMidpointDeviationVs28dMinutes: float | None = None

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
    # Median absolute deviation (scaled by 1.4826), not population stdev -- respiration's
    # baseline is median-based (see BASELINE_COMPUTATION_VERSION v3 note above), so its
    # spread estimator is the matching robust one. Absent on documents written before v3.
    respiration28dMad: float | None = None
    steps7dAvg: float | None = None
    steps28dAvg: float | None = None
    steps28dStdev: float | None = None
    # v4: observation-only median/MAD baselines, computed alongside the mean/stdev fields
    # above -- see BASELINE_COMPUTATION_VERSION's v4 note. Not consumed by rules.ts or
    # fatigue.ts yet. Absent on documents written before v4.
    sleepScore7dMedian: float | None = None
    sleepScore28dMedian: float | None = None
    sleepScore28dMad: float | None = None
    restingHr7dMedian: float | None = None
    restingHr28dMedian: float | None = None
    restingHr28dMad: float | None = None
    hrv7dMedian: float | None = None
    hrv28dMedian: float | None = None
    hrv28dMad: float | None = None
    steps7dMedian: float | None = None
    steps28dMedian: float | None = None
    steps28dMad: float | None = None
    # v5: observation-only median/MAD baselines for body battery wake and the "metric
    # enrichment" fields -- see BASELINE_COMPUTATION_VERSION's v5 note. Unlike the fields
    # above, these metrics have no mean/stdev counterpart at all yet. Not consumed by
    # rules.ts or fatigue.ts. Absent on documents written before v5.
    bodyBatteryWake7dMedian: float | None = None
    bodyBatteryWake28dMedian: float | None = None
    bodyBatteryWake28dMad: float | None = None
    stressAvg7dMedian: float | None = None
    stressAvg28dMedian: float | None = None
    stressAvg28dMad: float | None = None
    stressMax7dMedian: float | None = None
    stressMax28dMedian: float | None = None
    stressMax28dMad: float | None = None
    trainingReadinessScore7dMedian: float | None = None
    trainingReadinessScore28dMedian: float | None = None
    trainingReadinessScore28dMad: float | None = None
    # v6: sleep-duration median/MAD baselines, accumulated deficit, and circular
    # time-of-day baselines for bedtime/wake-time/sleep-midpoint -- see
    # BASELINE_COMPUTATION_VERSION's v6 note. Not consumed by rules.ts or fatigue.ts.
    # Absent on documents written before v6.
    sleepDuration7dMedian: float | None = None
    sleepDuration28dMedian: float | None = None
    sleepDuration28dMad: float | None = None
    # Signed: positive = net shortfall vs the 28d median baseline over the trailing
    # window, negative = net surplus. None if fewer than N nights with data are available.
    sleepDurationAccumulated2dDeficitSec: float | None = None
    sleepDurationAccumulated3dDeficitSec: float | None = None
    # Circular mean (not median -- see the v6 note above), minutes since local midnight.
    bedtime7dCircularMeanMinutes: float | None = None
    bedtime28dCircularMeanMinutes: float | None = None
    wakeTime7dCircularMeanMinutes: float | None = None
    wakeTime28dCircularMeanMinutes: float | None = None
    sleepMidpoint7dCircularMeanMinutes: float | None = None
    sleepMidpoint28dCircularMeanMinutes: float | None = None
    deltas: DerivedDeltas = field(default_factory=DerivedDeltas)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["deltas"] = self.deltas.to_dict()
        return d


@dataclass
class DataQuality:
    sleepScoreAvailable: bool = False
    # True only when Garmin's raw sleep payload included both ends of the sleep-session
    # window (RawMetrics.sleepSessionStart/End) -- independent of sleepScoreAvailable,
    # since a night can have a score/duration without a captured start/end timestamp.
    sleepTimingAvailable: bool = False
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
    spo2Available: bool = False
    skinTempAvailable: bool = False

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


@dataclass
class HealthObservationDTO:
    observationId: str
    metric: str
    value: float | int | str | dict[str, Any] | None
    unit: str | None
    sourceRecordId: str | None = None
    observedStart: str | None = None
    observedEnd: str | None = None
    originApplication: str | None = None
    originDevice: str | None = None
    quality: dict[str, Any] | None = None
    semanticVersion: str = "1.0.0"

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class HealthObservationDayBundle:
    userId: str
    logicalDate: str
    provider: str
    transport: str
    observations: list[HealthObservationDTO]
    sourcePayloadHash: str
    rawArchiveRef: str | None = None
    schemaVersion: int = 1
    normalizerVersion: int = 1
    revision: int = 1
    ingestedAt: str | None = None
    effectiveAt: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "userId": self.userId,
            "logicalDate": self.logicalDate,
            "provider": self.provider,
            "transport": self.transport,
            "observations": [o.to_dict() for o in self.observations],
            "sourcePayloadHash": self.sourcePayloadHash,
            "rawArchiveRef": self.rawArchiveRef,
            "schemaVersion": self.schemaVersion,
            "normalizerVersion": self.normalizerVersion,
            "revision": self.revision,
            "ingestedAt": self.ingestedAt,
            "effectiveAt": self.effectiveAt,
        }
