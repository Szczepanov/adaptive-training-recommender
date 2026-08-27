"""Biometric co-presence and imposter detection filter (ADR-0027).

Protects athlete baselines and recommendations from being corrupted when a family member
(child, spouse, guest) sleeps on the athlete's Eight Sleep mattress, or when the athlete
sleeps away from the mattress (travel/hotel).
"""

from dataclasses import dataclass
from typing import Any

from .canonical import METRIC_DAILY_RESTING_HEART_RATE_BPM


@dataclass
class PresenceValidationVerdict:
    verifiedAthlete: bool
    imposterConfidence: (
        str  # "VERIFIED" | "IMPOSTER_REJECTED" | "UNVERIFIED_OFF_WRIST" | "NO_SECONDARY_DATA"
    )
    reason: str
    garminRhr: float | None
    eightSleepRhr: float | None
    rhrDelta: float | None


def validate_co_presence(
    garmin_snapshot: dict[str, Any] | None,
    eight_sleep_bundle: dict[str, Any] | None,
    athlete_rhr_28d_median: float | None = None,
    max_rhr_delta_bpm: float = 8.0,
    max_unverified_rhr_delta_bpm: float = 12.0,
) -> PresenceValidationVerdict:
    """Validate whether the Eight Sleep payload corresponds to the genuine athlete."""
    if not eight_sleep_bundle:
        return PresenceValidationVerdict(
            verifiedAthlete=True,
            imposterConfidence="NO_SECONDARY_DATA",
            reason="No Eight Sleep data present for this date; Garmin Direct is sole authority.",
            garminRhr=None,
            eightSleepRhr=None,
            rhrDelta=None,
        )

    # Extract Eight Sleep RHR
    eight_rhr: float | None = None
    for obs in eight_sleep_bundle.get("observations", []):
        if obs.get("metric") in [METRIC_DAILY_RESTING_HEART_RATE_BPM, "resting_heart_rate_bpm"]:
            val = obs.get("value")
            if isinstance(val, (int, float)):
                eight_rhr = float(val)
                break

    # Extract Garmin RHR
    garmin_rhr: float | None = None
    if garmin_snapshot:
        raw = garmin_snapshot.get("raw", {}) or {}
        rhr = (
            raw.get("restingHr")
            or garmin_snapshot.get("restingHeartRate")
            or garmin_snapshot.get("resting_heart_rate")
        )
        if isinstance(rhr, (int, float)):
            garmin_rhr = float(rhr)

    # Case 1: Both sensors present -> Cross-sensor boundary check
    if garmin_rhr is not None and eight_rhr is not None:
        delta = abs(garmin_rhr - eight_rhr)
        if delta > max_rhr_delta_bpm:
            return PresenceValidationVerdict(
                verifiedAthlete=False,
                imposterConfidence="IMPOSTER_REJECTED",
                reason=(
                    f"RHR discrepancy ({delta:.1f} bpm > {max_rhr_delta_bpm:.1f} bpm limit). "
                    f"Garmin={garmin_rhr:.1f} bpm vs EightSleep={eight_rhr:.1f} bpm. "
                    "Likely a family member or guest sleeping on mattress."
                ),
                garminRhr=garmin_rhr,
                eightSleepRhr=eight_rhr,
                rhrDelta=delta,
            )

        return PresenceValidationVerdict(
            verifiedAthlete=True,
            imposterConfidence="VERIFIED",
            reason=f"Cross-sensor RHR is concordant (delta = {delta:.1f} bpm <= {max_rhr_delta_bpm:.1f} bpm).",
            garminRhr=garmin_rhr,
            eightSleepRhr=eight_rhr,
            rhrDelta=delta,
        )

    # Case 2: Garmin watch was off-wrist overnight -> Validate against historical baseline
    if eight_rhr is not None:
        if athlete_rhr_28d_median is not None:
            baseline_delta = abs(eight_rhr - athlete_rhr_28d_median)
            if baseline_delta > max_unverified_rhr_delta_bpm:
                return PresenceValidationVerdict(
                    verifiedAthlete=False,
                    imposterConfidence="IMPOSTER_REJECTED",
                    reason=(
                        f"Watch off-wrist and Eight Sleep RHR ({eight_rhr:.1f} bpm) deviates "
                        f"by {baseline_delta:.1f} bpm from 28d baseline ({athlete_rhr_28d_median:.1f} bpm)."
                    ),
                    garminRhr=None,
                    eightSleepRhr=eight_rhr,
                    rhrDelta=baseline_delta,
                )

            return PresenceValidationVerdict(
                verifiedAthlete=True,
                imposterConfidence="UNVERIFIED_OFF_WRIST",
                reason="Watch off-wrist overnight; Eight Sleep RHR matches historical baseline expectations.",
                garminRhr=None,
                eightSleepRhr=eight_rhr,
                rhrDelta=baseline_delta,
            )

        return PresenceValidationVerdict(
            verifiedAthlete=False,
            imposterConfidence="UNVERIFIED_OFF_WRIST",
            reason="Watch off-wrist overnight; Eight Sleep data cannot be verified without Garmin RHR or a historical baseline.",
            garminRhr=None,
            eightSleepRhr=eight_rhr,
            rhrDelta=None,
        )

    # Default fallback: Eight sleep has no RHR or no baseline
    return PresenceValidationVerdict(
        verifiedAthlete=False,
        imposterConfidence="UNVERIFIED_OFF_WRIST",
        reason="Eight Sleep data cannot be verified without resting heart rate or historical baseline.",
        garminRhr=garmin_rhr,
        eightSleepRhr=eight_rhr,
        rhrDelta=None,
    )
