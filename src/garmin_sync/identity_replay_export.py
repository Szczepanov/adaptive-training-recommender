"""Real-data exporter for the PI8 historical out-of-sample identity replay (ADR-0028).

Converts real Garmin Direct (`daily_recovery_snapshots`) and Eight Sleep-via-Google-Health
(`health_observation_days`, provider="eight_sleep", transport="google_health") Firestore data into
the exact `{"nights": IdentityReplayNightInput[], "config": IdentityReplayConfig}` JSON shape that
`app/src/engine/identityReplay.ts`'s `runIdentityReplay` (via `identity-replay-evidence.mjs`)
consumes.

One real, honest gap this module does not paper over:

- Neither `HealthObservationDayBundle` (models.py) nor any real Firestore write path sets `id` or
  `lineageKey` on a bundle document (`identity_eligibility.py` only ever reads `lineageKey`, never
  writes it -- confirmed by repo-wide grep). Both `ObservationBundleRef`s this module builds are
  therefore synthesized, constant-per-user-per-source values, not read verbatim from Firestore.
  Only `sourcePayloadHash` and `revision` are read from the real bundle document, since those two
  fields genuinely are written by `save_health_observation_day_bundle`.

`garminSessions` is populated from `raw.sleepSessionStart`/`sleepSessionEnd` (models.py's
`RawMetrics`), Garmin's own `dailySleepDTO.sleepStartTimestampGMT`/`sleepEndTimestampGMT` --
previously parsed in-process (garmin_provider.py's `_sleep_window_gmt_ms`) only to feed a
respiration-window average, then discarded, so every real night's replay input had
`garminSessions: []` until that plumbing gap was closed. Historical nights synced before that fix
still have no session timing until re-derived (run `rebuild --start-date ... --end-date ...`,
which already replays every archived raw payload through the same canonicalization path -- no
bespoke backfill script needed); `garminSessions` is `[]` for those exactly as before, which is
accurate for them, not a synthesized placeholder.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .canonical import METRIC_SLEEP_SESSION
from .firestore_repository import FirestoreRecoveryRepository, is_snapshot_complete

WARSAW_TZ = ZoneInfo("Europe/Warsaw")

# Mirrors identityAttribution.ts's IDENTITY_POLICY_VERSION / the identityReplay.test.ts fixture's
# featureSchemaVersion -- kept as literal constants here (not imported, TS/Python boundary) so a
# real version bump on the TS side is a deliberate, visible edit on this side too.
IDENTITY_POLICY_VERSION = "identity-v1-shadow"
IDENTITY_FEATURE_SCHEMA_VERSION = "identity-features-v1"

ANCHOR_PROVIDER = "garmin"
ANCHOR_TRANSPORT = "garmin_direct"
SHARED_PROVIDER = "eight_sleep"
SHARED_TRANSPORT = "google_health"


@dataclass
class IdentityReplayExportResult:
    nights: list[dict[str, Any]] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)
    pairedNightCount: int = 0
    anchorPresentCount: int = 0
    anchorMissingCount: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {"nights": self.nights, "config": self.config}


def _sha256_of(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, default=str).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _anchor_bundle_ref(app_user_id: str, date: str, raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"{date}_{ANCHOR_PROVIDER}_{ANCHOR_TRANSPORT}",
        "provider": ANCHOR_PROVIDER,
        "transport": ANCHOR_TRANSPORT,
        "revision": 1,
        "sourcePayloadHash": _sha256_of(
            {
                "restingHr": raw.get("restingHr"),
                "hrvOvernightAvg": raw.get("hrvOvernightAvg"),
                "respirationAvg": raw.get("respirationAvg"),
                "sleepDurationSec": raw.get("sleepDurationSec"),
                "sleepSessionStart": raw.get("sleepSessionStart"),
                "sleepSessionEnd": raw.get("sleepSessionEnd"),
            }
        ),
        "lineageKey": f"{ANCHOR_TRANSPORT}:{app_user_id}",
    }


def _shared_bundle_ref(app_user_id: str, date: str, bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"{date}_{SHARED_PROVIDER}_{SHARED_TRANSPORT}",
        "provider": SHARED_PROVIDER,
        "transport": SHARED_TRANSPORT,
        # Genuinely real fields, written by save_health_observation_day_bundle -- read verbatim,
        # not synthesized. Falls back to a hash of the bundle when either is absent (older writes).
        "revision": int(bundle.get("revision") or 1),
        "sourcePayloadHash": bundle.get("sourcePayloadHash")
        or _sha256_of(bundle.get("observations")),
        "lineageKey": f"{SHARED_TRANSPORT}:{app_user_id}",
    }


def _find_sleep_session_observation(bundle: dict[str, Any]) -> dict[str, Any] | None:
    for obs in bundle.get("observations", []) or []:
        if obs.get("metric") == METRIC_SLEEP_SESSION and obs.get("observedStart"):
            return obs
    return None


def _sleep_start_minutes_local(observed_start_iso: str) -> int | None:
    try:
        dt = datetime.fromisoformat(observed_start_iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    local_dt = dt.astimezone(WARSAW_TZ)
    return local_dt.hour * 60 + local_dt.minute


def _sleep_duration_minutes(observed_start_iso: str, observed_end_iso: str) -> float | None:
    try:
        start = datetime.fromisoformat(observed_start_iso.replace("Z", "+00:00"))
        end = datetime.fromisoformat(observed_end_iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = end - start
    if delta.total_seconds() <= 0:
        return None
    return round(delta.total_seconds() / 60.0, 1)


def _numeric_metric(bundle: dict[str, Any], metric: str) -> float | None:
    for obs in bundle.get("observations", []) or []:
        if obs.get("metric") != metric:
            continue
        val = obs.get("value")
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            return float(val)
    return None


def export_identity_replay_input(
    repository: FirestoreRecoveryRepository,
    start_date_iso: str,
    end_date_iso: str,
    app_user_id: str,
) -> IdentityReplayExportResult:
    """Builds the real-data PI8 replay input for one user across [start_date_iso, end_date_iso].

    A night is included only when a shared-source (Eight Sleep) bundle exists for that date --
    `sharedBundleRef` is a required, non-optional field of `IdentityReplayNightInput`. A date with
    a shared-source bundle but no Garmin Direct snapshot is still included, with
    `anchorPresent: false` and `anchorBundleRefs: []`, so the replay records a real
    `ANCHOR_MISSING` abstention rather than silently dropping the night.
    """
    from .canonical import (
        METRIC_DAILY_RESTING_HEART_RATE_BPM,
        METRIC_HRV_RMSSD_MS,
        METRIC_RESPIRATION_RATE_BRPM,
    )

    garmin_snaps = repository.get_historical_snapshots(start_date_iso, end_date_iso)
    shared_bundles = repository.get_health_observation_bundles_in_range(
        start_date_iso, end_date_iso, provider=SHARED_PROVIDER, transport=SHARED_TRANSPORT
    )
    shared_by_date = {b.get("logicalDate"): b for b in shared_bundles if b.get("logicalDate")}

    nights: list[dict[str, Any]] = []
    anchor_present_count = 0
    anchor_missing_count = 0

    start_dt = datetime.strptime(start_date_iso, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_iso, "%Y-%m-%d")
    curr = start_dt
    while curr <= end_dt:
        date = curr.strftime("%Y-%m-%d")
        curr += timedelta(days=1)

        bundle = shared_by_date.get(date)
        if bundle is None:
            continue

        snap = garmin_snaps.get(date)
        anchor_present = snap is not None
        raw = snap.get("raw", {}) if snap is not None else {}
        anchor_technically_eligible = snap is not None and is_snapshot_complete(snap)

        if anchor_present:
            anchor_present_count += 1
            anchor_bundle_refs = [_anchor_bundle_ref(app_user_id, date, raw)]
        else:
            anchor_missing_count += 1
            anchor_bundle_refs = []

        sleep_obs = _find_sleep_session_observation(bundle)
        shared_sleep_start = None
        shared_sleep_duration = None
        if sleep_obs is not None and sleep_obs.get("observedEnd"):
            shared_sleep_start = _sleep_start_minutes_local(sleep_obs["observedStart"])
            shared_sleep_duration = _sleep_duration_minutes(
                sleep_obs["observedStart"], sleep_obs["observedEnd"]
            )

        garmin_rhr = raw.get("restingHr")
        garmin_hrv = raw.get("hrvOvernightAvg")
        garmin_resp = raw.get("respirationAvg")
        garmin_sleep_start = raw.get("sleepSessionStart")
        garmin_sleep_end = raw.get("sleepSessionEnd")

        nights.append(
            {
                "sourceNightKey": date,
                "sharedBundleRef": _shared_bundle_ref(app_user_id, date, bundle),
                "anchorBundleRefs": anchor_bundle_refs,
                "anchorPresent": anchor_present,
                "anchorTechnicallyEligible": anchor_technically_eligible,
                "garminSessions": (
                    [{"startIso": garmin_sleep_start, "endIso": garmin_sleep_end}]
                    if garmin_sleep_start and garmin_sleep_end
                    else []
                ),
                "eightSleepSessions": (
                    [{"startIso": sleep_obs["observedStart"], "endIso": sleep_obs["observedEnd"]}]
                    if sleep_obs is not None and sleep_obs.get("observedEnd")
                    else []
                ),
                "sharedRestingHeartRate": _numeric_metric(
                    bundle, METRIC_DAILY_RESTING_HEART_RATE_BPM
                ),
                "garminRestingHeartRate": float(garmin_rhr)
                if isinstance(garmin_rhr, (int, float))
                else None,
                "sharedRespirationRate": _numeric_metric(bundle, METRIC_RESPIRATION_RATE_BRPM),
                "garminRespirationRate": float(garmin_resp)
                if isinstance(garmin_resp, (int, float))
                else None,
                "sharedHrv": _numeric_metric(bundle, METRIC_HRV_RMSSD_MS),
                "garminHrv": float(garmin_hrv) if isinstance(garmin_hrv, (int, float)) else None,
                "sharedSleepStartMinutesLocal": shared_sleep_start,
                "sharedSleepDurationMinutes": shared_sleep_duration,
            }
        )

    config = {
        "method": "leaveOneOut",
        "policyVersion": IDENTITY_POLICY_VERSION,
        "featureSchemaVersion": IDENTITY_FEATURE_SCHEMA_VERSION,
        "anchorPolicy": {
            "primaryProvider": ANCHOR_PROVIDER,
            "primaryTransport": ANCHOR_TRANSPORT,
            "role": "personal_wearable_anchor",
            "requireIndependentLineage": True,
        },
    }

    return IdentityReplayExportResult(
        nights=nights,
        config=config,
        pairedNightCount=len(nights),
        anchorPresentCount=anchor_present_count,
        anchorMissingCount=anchor_missing_count,
    )
