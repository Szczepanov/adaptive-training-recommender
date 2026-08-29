"""Google Health normalization and provenance mapper (MS6/ADR-0027).

Maps raw Google Health v4 data point payloads to CanonicalHealthObservation
records with strict origin application resolution, Europe/Warsaw date semantics,
and the step count provenance lock (D-MS-STEPS).
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .canonical import (
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_HEART_RATE_BPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_RESPIRATION_RATE_BRPM,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_SESSION,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_SECONDS,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS,
    METRIC_SLEEP_STAGE_REM_SECONDS,
    CanonicalHealthObservation,
    ObservationBatch,
    ObservationSource,
)

logger = logging.getLogger(__name__)

WARSAW_TZ = ZoneInfo("Europe/Warsaw")

# 1: original mapper.
# 2 (2026-08-29): fixed _map_sleep()'s duration fallback -- was the raw
# (endTime - startTime) span; now prefers elapsed-minus-awake when an explicit awake
# duration is available, matching how Garmin/Eight Sleep report "time actually asleep"
# rather than the full in-bed span. Bumping this is what actually makes
# save_health_observation_day_bundle re-persist already-fetched dates with the corrected
# duration -- sourcePayloadHash alone is blind to mapper logic changes, since the
# underlying raw Google Health response is unchanged.
NORMALIZER_VERSION: int = 2

# Controlled mapping table for origin applications (MS6 / ADR-0027)
ORIGIN_PACKAGE_MAP: dict[str, str] = {
    "com.garmin.android.apps.connectmobile": "garmin",
    "com.eightsleep.eight": "eight_sleep",
    "com.eightsleep.eightsleep": "eight_sleep",
    "com.google.android.apps.fitness": "google_fit",
    "com.ouraring.oura": "oura",
    "com.whoop.android": "whoop",
    "com.samsung.android.shealth": "samsung_health",
    "com.fitbit.FitbitMobile": "fitbit",
    "com.withings.wiscale2": "withings",
}


def resolve_provider_from_package(package_name: str | None) -> str:
    """Map origin application package name to canonical provider name."""
    if not package_name:
        return "unknown"
    cleaned = package_name.strip()
    if cleaned in ORIGIN_PACKAGE_MAP:
        return ORIGIN_PACKAGE_MAP[cleaned]
    return f"unknown:{cleaned}"


def parse_iso_datetime(dt_str: str | None) -> datetime | None:
    """Parse ISO8601 string to timezone-aware datetime."""
    if not dt_str:
        return None
    try:
        # Replace Z with +00:00 if present
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


def derive_warsaw_logical_date(
    observed_end: datetime | None, observed_start: datetime | None
) -> str:
    """Assign Europe/Warsaw logical date (YYYY-MM-DD) based on observation timestamps.

    For overnight sessions ending in the morning, the end timestamp's date in Warsaw time
    represents the logical recovery date.
    """
    ref_dt = observed_end or observed_start or datetime.now(timezone.utc)
    warsaw_dt = ref_dt.astimezone(WARSAW_TZ)
    return warsaw_dt.strftime("%Y-%m-%d")


# The real Google Health API v4 response does not carry a flat "dataTypeName"/"dataType"
# field on each point -- the reliable signal is the resource name path, e.g.
# "users/{id}/dataTypes/sleep/dataPoints/{id}". Confirmed 2026-08-27 against a live account;
# see docs/plans/2026-08-27-real-google-health-ingestion.md.
_NAME_DATA_TYPE_RE = re.compile(r"/dataTypes/([^/]+)/dataPoints")


def _data_type_from_name(point: dict[str, Any]) -> str | None:
    name = point.get("name")
    if not isinstance(name, str):
        return None
    match = _NAME_DATA_TYPE_RE.search(name)
    return match.group(1) if match else None


def _first_not_none(*values: Any) -> Any:
    """Return the first value that is not None, preserving legitimate 0 / False values."""
    for v in values:
        if v is not None:
            return v
    return None


class GoogleHealthMapper:
    """Normalizes raw Google Health API payloads into CanonicalHealthObservation instances."""

    def __init__(self, user_id: str, transport: str = "google_health"):
        self.user_id = user_id
        self.transport = transport

    def normalize_data_points(
        self,
        raw_data_points: list[dict[str, Any]],
        target_logical_date: str,
    ) -> ObservationBatch:
        """Transform a list of raw Google Health data points into an ObservationBatch."""
        observations: list[CanonicalHealthObservation] = []

        for point in raw_data_points:
            mapped = self._map_single_data_point(point, target_logical_date)
            if mapped:
                observations.extend(mapped)

        payload_bytes = json.dumps(raw_data_points, sort_keys=True, default=str).encode("utf-8")
        payload_hash = f"sha256:{hashlib.sha256(payload_bytes).hexdigest()}"

        return ObservationBatch(
            logical_date=target_logical_date,
            observations=observations,
            source_payload_hash=payload_hash,
            schema_version=1,
            normalizer_version=NORMALIZER_VERSION,
            revision=1,
        )

    def _map_single_data_point(
        self,
        point: dict[str, Any],
        target_logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        data_type = point.get("dataTypeName", "") or point.get("dataType", "")
        if not data_type:
            # Real API points don't carry a flat type field -- the resource name path
            # ("users/.../dataTypes/{type}/dataPoints/...") is the reliable signal.
            data_type = _data_type_from_name(point) or ""
        if not data_type:
            if "dailyHeartRateVariability" in point:
                data_type = "daily_heart_rate_variability"
            elif "dailyRestingHeartRate" in point:
                data_type = "daily_resting_heart_rate"
            elif "dailyRespiratoryRate" in point:
                data_type = "daily_respiratory_rate"
            elif "sleep" in point or "sleepSession" in point:
                data_type = "sleep"

        data_source = point.get("dataSource", {}) or {}
        app_meta = data_source.get("application", {}) or {}
        package_name = app_meta.get("packageName") or app_meta.get("id")
        provider = resolve_provider_from_package(package_name)
        device_meta = data_source.get("device", {}) or {}
        device_id = device_meta.get("model") or device_meta.get("id")
        source_record_id = point.get("dataPointId") or point.get("id") or point.get("name")

        # Real sleep points nest the session window under sleep.interval; legacy/synthetic
        # fixtures may still use a flat "sleepSession" or top-level startTime/endTime shape.
        sleep_interval = ((point.get("sleep") or {}).get("interval")) or {}
        session_obj = point.get("sleepSession", {}) or {}
        start_time = parse_iso_datetime(
            sleep_interval.get("startTime")
            or session_obj.get("startTime")
            or point.get("startTime")
            or point.get("startTimeNanos")
        )
        end_time = parse_iso_datetime(
            sleep_interval.get("endTime")
            or session_obj.get("endTime")
            or point.get("endTime")
            or point.get("endTimeNanos")
        )

        # Check sub-object date dictionaries e.g. {"year": 2026, "month": 8, "day": 17}
        date_dict = None
        for key in ("dailyHeartRateVariability", "dailyRestingHeartRate", "dailyRespiratoryRate"):
            sub_d = (point.get(key) or {}).get("date")
            if sub_d and isinstance(sub_d, dict) and "year" in sub_d:
                date_dict = sub_d
                break

        if date_dict:
            logical_date = (
                f"{date_dict['year']:04d}-{date_dict['month']:02d}-{date_dict['day']:02d}"
            )
        elif end_time or start_time:
            logical_date = derive_warsaw_logical_date(end_time, start_time)
        else:
            logical_date = target_logical_date

        # Step count provenance lock (D-MS-STEPS / P9):
        # Steps from Google Health are excluded from recovery observations.
        if "step" in data_type.lower():
            logger.debug("Skipping aggregator step count data point per D-MS-STEPS.")
            return []

        source = ObservationSource(
            provider=provider,
            transport=self.transport,
            origin_application=package_name,
            origin_device=device_id,
            source_record_id=source_record_id,
        )

        results: list[CanonicalHealthObservation] = []

        norm_type = data_type.lower().replace("-", "_")

        if "sleep" in norm_type:
            results.extend(self._map_sleep(point, source, start_time, end_time, logical_date))
        elif "heart_rate_variability" in norm_type or "hrv" in norm_type:
            results.extend(self._map_hrv(point, source, start_time, end_time, logical_date))
        elif "resting_heart_rate" in norm_type or "resting_hr" in norm_type:
            results.extend(self._map_resting_hr(point, source, start_time, end_time, logical_date))
        elif "heart_rate" in norm_type:
            results.extend(self._map_heart_rate(point, source, start_time, end_time, logical_date))
        elif "respirat" in norm_type:
            results.extend(self._map_respiration(point, source, start_time, end_time, logical_date))

        return results

    def _map_sleep(
        self,
        point: dict[str, Any],
        source: ObservationSource,
        start_time: datetime | None,
        end_time: datetime | None,
        logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        obs_list: list[CanonicalHealthObservation] = []
        value_dict = point.get("value", {}) or {}
        session_obj = point.get("sleepSession", {}) or {}
        summary_obj = session_obj.get("summary", {}) or point.get("summary", {})

        # Handle durations and stages from either value dict or sleepSession/summary
        # (legacy/synthetic shapes).
        minutes_asleep = summary_obj.get("minutesAsleep")
        duration_sec = _first_not_none(
            value_dict.get("durationSeconds"),
            value_dict.get("duration_seconds"),
            int(minutes_asleep) * 60 if minutes_asleep is not None else None,
        )

        deep_sec = _first_not_none(
            value_dict.get("deepSleepSeconds"), value_dict.get("deep_seconds")
        )
        rem_sec = _first_not_none(value_dict.get("remSleepSeconds"), value_dict.get("rem_seconds"))
        light_sec = _first_not_none(
            value_dict.get("lightSleepSeconds"), value_dict.get("light_seconds")
        )
        minutes_awake = summary_obj.get("minutesAwake")
        awake_sec = _first_not_none(
            value_dict.get("awakeSleepSeconds"),
            value_dict.get("awake_seconds"),
            int(minutes_awake) * 60 if minutes_awake is not None else None,
        )

        # Parse stagesSummary if present in summary_obj (legacy/synthetic shape: pre-aggregated
        # minutes per stage type).
        for stage in summary_obj.get("stagesSummary", []):
            stype = stage.get("type", "").upper()
            mins = int(stage.get("minutes", 0))
            if stype == "DEEP" and deep_sec is None:
                deep_sec = mins * 60
            elif stype == "REM" and rem_sec is None:
                rem_sec = mins * 60
            elif stype == "LIGHT" and light_sec is None:
                light_sec = mins * 60
            elif stype == "AWAKE" and awake_sec is None:
                awake_sec = mins * 60

        # Real API shape (confirmed 2026-08-27 against a live account): point["sleep"]["stages"]
        # is a flat list of {startTime, endTime, type} intervals -- sum durations per type rather
        # than a pre-aggregated minutes figure.
        real_stages = ((point.get("sleep") or {}).get("stages")) or []
        if real_stages:
            stage_totals: dict[str, float] = {}
            for stage in real_stages:
                s_start = parse_iso_datetime(stage.get("startTime"))
                s_end = parse_iso_datetime(stage.get("endTime"))
                if not s_start or not s_end:
                    continue
                stype = str(stage.get("type", "")).upper()
                stage_totals[stype] = (
                    stage_totals.get(stype, 0.0) + (s_end - s_start).total_seconds()
                )

            if deep_sec is None and "DEEP" in stage_totals:
                deep_sec = int(stage_totals["DEEP"])
            if rem_sec is None and "REM" in stage_totals:
                rem_sec = int(stage_totals["REM"])
            if light_sec is None and "LIGHT" in stage_totals:
                light_sec = int(stage_totals["LIGHT"])
            if awake_sec is None and "AWAKE" in stage_totals:
                awake_sec = int(stage_totals["AWAKE"])

        if duration_sec is None and start_time and end_time:
            # Real API shape has no top-level durationSeconds/minutesAsleep for at least
            # Eight-Sleep-origin sleep records (confirmed empirically 2026-08-28: ES9's
            # direct-vs-Google comparison showed Google's duration exactly equal to
            # end_time - start_time on every one of 38 real nights, while direct Eight
            # Sleep reports elapsed-minus-awake -- an average ~55min systematic gap that
            # was actually mostly this fallback, not a real transport disagreement).
            # Prefer elapsed-minus-awake ("time actually asleep") over the raw session span
            # when awake_sec is available -- it already reflects the same real per-stage
            # data (from sleep.stages) parsed just above, so this doesn't invent evidence.
            elapsed_sec = int((end_time - start_time).total_seconds())
            duration_sec = max(0, elapsed_sec - awake_sec) if awake_sec is not None else elapsed_sec

        session_val = {
            "durationSeconds": duration_sec,
            "deepSeconds": deep_sec,
            "remSeconds": rem_sec,
            "lightSeconds": light_sec,
            "awakeSeconds": awake_sec,
        }

        obs_list.append(
            CanonicalHealthObservation(
                metric=METRIC_SLEEP_SESSION,
                value=session_val,
                unit=None,
                source=source,
                observed_start=start_time,
                observed_end=end_time,
                logical_date=logical_date,
            )
        )

        if duration_sec is not None:
            obs_list.append(
                CanonicalHealthObservation(
                    metric=METRIC_SLEEP_DURATION_SECONDS,
                    value=duration_sec,
                    unit="seconds",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            )
        if deep_sec is not None:
            obs_list.append(
                CanonicalHealthObservation(
                    metric=METRIC_SLEEP_STAGE_DEEP_SECONDS,
                    value=deep_sec,
                    unit="seconds",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            )
        if rem_sec is not None:
            obs_list.append(
                CanonicalHealthObservation(
                    metric=METRIC_SLEEP_STAGE_REM_SECONDS,
                    value=rem_sec,
                    unit="seconds",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            )
        if light_sec is not None:
            obs_list.append(
                CanonicalHealthObservation(
                    metric=METRIC_SLEEP_STAGE_LIGHT_SECONDS,
                    value=light_sec,
                    unit="seconds",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            )
        if awake_sec is not None:
            obs_list.append(
                CanonicalHealthObservation(
                    metric=METRIC_SLEEP_STAGE_AWAKE_SECONDS,
                    value=awake_sec,
                    unit="seconds",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            )

        return obs_list

    def _map_hrv(
        self,
        point: dict[str, Any],
        source: ObservationSource,
        start_time: datetime | None,
        end_time: datetime | None,
        logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        val = _first_not_none(
            point.get("value"), point.get("dailyHeartRateVariability"), point.get("hrv"), {}
        )
        hrv_rmssd = None
        if isinstance(val, (int, float)):
            hrv_rmssd = float(val)
        elif isinstance(val, dict):
            hrv_rmssd = _first_not_none(
                val.get("deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"),
                val.get("averageHeartRateVariabilityMilliseconds"),
                val.get("rmssd"),
                val.get("hrvRmssd"),
                val.get("value"),
                val.get("hrv"),
                val.get("dailyHeartRateVariability"),
            )

        if hrv_rmssd is not None:
            return [
                CanonicalHealthObservation(
                    metric=METRIC_HRV_RMSSD_MS,
                    value=float(hrv_rmssd),
                    unit="ms",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            ]
        return []

    def _map_resting_hr(
        self,
        point: dict[str, Any],
        source: ObservationSource,
        start_time: datetime | None,
        end_time: datetime | None,
        logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        val = _first_not_none(
            point.get("value"),
            point.get("dailyRestingHeartRate"),
            point.get("restingHeartRate"),
            {},
        )
        rhr = None
        if isinstance(val, (int, float)):
            rhr = float(val)
        elif isinstance(val, dict):
            rhr = _first_not_none(
                val.get("beatsPerMinute"),
                val.get("bpm"),
                val.get("rate"),
                val.get("value"),
                val.get("restingHeartRate"),
                val.get("dailyRestingHeartRate"),
            )

        if rhr is not None:
            return [
                CanonicalHealthObservation(
                    metric=METRIC_DAILY_RESTING_HEART_RATE_BPM,
                    value=float(rhr),
                    unit="bpm",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            ]
        return []

    def _map_heart_rate(
        self,
        point: dict[str, Any],
        source: ObservationSource,
        start_time: datetime | None,
        end_time: datetime | None,
        logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        val = _first_not_none(point.get("value"), point.get("heartRate"), {})
        bpm = None
        if isinstance(val, (int, float)):
            bpm = float(val)
        elif isinstance(val, dict):
            bpm = _first_not_none(
                val.get("beatsPerMinute"), val.get("bpm"), val.get("rate"), val.get("value")
            )

        if bpm is not None:
            return [
                CanonicalHealthObservation(
                    metric=METRIC_HEART_RATE_BPM,
                    value=float(bpm),
                    unit="bpm",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            ]
        return []

    def _map_respiration(
        self,
        point: dict[str, Any],
        source: ObservationSource,
        start_time: datetime | None,
        end_time: datetime | None,
        logical_date: str,
    ) -> list[CanonicalHealthObservation]:
        val = _first_not_none(
            point.get("value"),
            point.get("dailyRespiratoryRate"),
            point.get("respiratoryRate"),
            {},
        )
        brpm = None
        if isinstance(val, (int, float)):
            brpm = float(val)
        elif isinstance(val, dict):
            brpm = _first_not_none(
                val.get("breathsPerMinute"),
                val.get("brpm"),
                val.get("rate"),
                val.get("value"),
                val.get("dailyRespiratoryRate"),
            )

        if brpm is not None:
            return [
                CanonicalHealthObservation(
                    metric=METRIC_RESPIRATION_RATE_BRPM,
                    value=float(brpm),
                    unit="brpm",
                    source=source,
                    observed_start=start_time,
                    observed_end=end_time,
                    logical_date=logical_date,
                )
            ]
        return []
