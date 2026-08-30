"""Secondary-source identity and session concordance filter (ADR-0027 D-MS-IDENTITY, D-MS-PREBASE).

PROVISIONAL / LEGACY COMPATIBILITY LOGIC (PI0, ADR-0028). This module is a temporary scalar
heuristic (fixed session-overlap and RHR-delta bounds), not a validated biometric identity
classifier. The `60 min` / `10 bpm` / `14 bpm` defaults are unvalidated safety guards carried
over from PR #240 and must not be described as validated identity thresholds.

It will be superseded by the ternary Physiological Identity Passport gate (`USER | NOT_USER |
UNCERTAIN`, see ADR-0028 and
docs/plans/physiological-identity-passport-and-measurement-trust.md, tasks PI1-PI9), which sits
upstream of rolling baseline accumulation. `verified_athlete: bool` and `imposterConfidence` are
legacy vocabulary; new code must not depend on them as permanent domain contracts.

A physiological anomaly alone (e.g. illness driving up RHR) is NOT proof that another person used
the shared device -- this module deliberately never asserts that; see
`tests/test_presence_filter.py` for the regression test documenting this (ADR-0028 P-PI-8).

Protects athlete baselines and engine readiness from being corrupted when a family member
sleeps on the athlete's Eight Sleep mattress, or when the athlete sleeps away from the mattress (travel).
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .canonical import METRIC_DAILY_RESTING_HEART_RATE_BPM


@dataclass
class PresenceValidationVerdict:
    """Provisional quarantine/concordance verdict (PI0) -- intentionally NOT an identity verdict.

    `verifiedAthlete` and `concordanceStatus` never assert who used the device, only whether the
    secondary record is concordant enough to trust. Superseded by `EffectiveIdentityDecision`
    (PI1) once it lands.
    """

    verifiedAthlete: bool
    concordanceStatus: (
        str  # "CONCORDANT" | "DISCORDANT_SECONDARY" | "UNVERIFIED_OFF_WRIST" | "NO_SECONDARY_DATA"
    )
    reason: str
    garminRhr: float | None
    eightSleepRhr: float | None
    rhrDelta: float | None
    timingOverlapMinutes: int | None = None

    @property
    def imposterConfidence(self) -> str:
        """Backwards compatibility alias for concordanceStatus.

        @deprecated legacy alias (PI0); `IMPOSTER_REJECTED` is not a confirmed identity-fraud
        determination -- it only means the secondary record was quarantined from baseline/fusion.
        """
        if self.concordanceStatus == "CONCORDANT":
            return "VERIFIED"
        if self.concordanceStatus == "DISCORDANT_SECONDARY":
            return "IMPOSTER_REJECTED"
        return self.concordanceStatus


def _calculate_session_overlap_minutes(start_a: str, end_a: str, start_b: str, end_b: str) -> int:
    """Calculate the overlap in minutes between two ISO 8601 interval strings."""
    try:
        dt_start_a = datetime.fromisoformat(start_a.replace("Z", "+00:00"))
        dt_end_a = datetime.fromisoformat(end_a.replace("Z", "+00:00"))
        dt_start_b = datetime.fromisoformat(start_b.replace("Z", "+00:00"))
        dt_end_b = datetime.fromisoformat(end_b.replace("Z", "+00:00"))

        overlap_start = max(dt_start_a, dt_start_b)
        overlap_end = min(dt_end_a, dt_end_b)
        diff = (overlap_end - overlap_start).total_seconds()
        return max(0, int(diff // 60))
    except Exception:
        return 0


def validate_co_presence(
    garmin_snapshot: dict[str, Any] | None,
    eight_sleep_bundle: dict[str, Any] | None,
    athlete_rhr_28d_median: float | None = None,
    min_overlap_minutes: int = 60,
    max_rhr_delta_bpm: float = 10.0,
    max_unverified_rhr_delta_bpm: float = 14.0,
) -> PresenceValidationVerdict:
    """Evaluate provisional co-presence concordance for the Eight Sleep payload.

    PROVISIONAL (PI0, ADR-0028) -- see module doc comment above. Do not present this output as a
    validated identity determination.
    """
    if not eight_sleep_bundle:
        return PresenceValidationVerdict(
            verifiedAthlete=True,
            concordanceStatus="NO_SECONDARY_DATA",
            reason="No Eight Sleep data present for this date; Garmin Direct is sole authority.",
            garminRhr=None,
            eightSleepRhr=None,
            rhrDelta=None,
            timingOverlapMinutes=None,
        )

    # Extract Eight Sleep RHR and sleep session interval
    eight_rhr: float | None = None
    eight_start: str | None = None
    eight_end: str | None = None
    for obs in eight_sleep_bundle.get("observations", []):
        metric = obs.get("metric")
        if metric in [METRIC_DAILY_RESTING_HEART_RATE_BPM, "resting_heart_rate_bpm"]:
            val = obs.get("value")
            if isinstance(val, (int, float)):
                eight_rhr = float(val)
        elif metric == "sleep_duration_seconds":
            eight_start = obs.get("observedStart")
            eight_end = obs.get("observedEnd")

    # Extract Garmin RHR and sleep session interval
    garmin_rhr: float | None = None
    garmin_start: str | None = None
    garmin_end: str | None = None
    if garmin_snapshot:
        raw = garmin_snapshot.get("raw", {}) or {}
        rhr = (
            raw.get("restingHr")
            or garmin_snapshot.get("restingHeartRate")
            or garmin_snapshot.get("resting_heart_rate")
        )
        if isinstance(rhr, (int, float)):
            garmin_rhr = float(rhr)

        sleep_raw = raw.get("sleep", {}) or {}
        garmin_start = sleep_raw.get("startTimeGmt") or sleep_raw.get("start")
        garmin_end = sleep_raw.get("endTimeGmt") or sleep_raw.get("end")

    # Step 1: Evaluate sleep timing concordance if session boundaries exist
    overlap_mins: int | None = None
    if garmin_start and garmin_end and eight_start and eight_end:
        overlap_mins = _calculate_session_overlap_minutes(
            garmin_start, garmin_end, eight_start, eight_end
        )
        if overlap_mins < min_overlap_minutes:
            return PresenceValidationVerdict(
                verifiedAthlete=False,
                concordanceStatus="DISCORDANT_SECONDARY",
                reason=(
                    f"Sleep timing mismatch: Garmin and Eight Sleep sessions overlap for only "
                    f"{overlap_mins} min (< {min_overlap_minutes} min threshold). Secondary record quarantined."
                ),
                garminRhr=garmin_rhr,
                eightSleepRhr=eight_rhr,
                rhrDelta=abs(garmin_rhr - eight_rhr)
                if (garmin_rhr is not None and eight_rhr is not None)
                else None,
                timingOverlapMinutes=overlap_mins,
            )

    # Step 2: Both sensors present -> Cross-sensor physiological boundary check
    if garmin_rhr is not None and eight_rhr is not None:
        delta = abs(garmin_rhr - eight_rhr)
        if delta > max_rhr_delta_bpm:
            return PresenceValidationVerdict(
                verifiedAthlete=False,
                concordanceStatus="DISCORDANT_SECONDARY",
                reason=(
                    f"Cross-sensor physiological divergence ({delta:.1f} bpm > {max_rhr_delta_bpm:.1f} bpm limit). "
                    f"Garmin={garmin_rhr:.1f} bpm vs EightSleep={eight_rhr:.1f} bpm. "
                    "Secondary record quarantined from baseline and fusion (D-MS-PREBASE)."
                ),
                garminRhr=garmin_rhr,
                eightSleepRhr=eight_rhr,
                rhrDelta=delta,
                timingOverlapMinutes=overlap_mins,
            )

        return PresenceValidationVerdict(
            verifiedAthlete=True,
            concordanceStatus="CONCORDANT",
            reason=f"Cross-sensor RHR is concordant (delta = {delta:.1f} bpm <= {max_rhr_delta_bpm:.1f} bpm).",
            garminRhr=garmin_rhr,
            eightSleepRhr=eight_rhr,
            rhrDelta=delta,
            timingOverlapMinutes=overlap_mins,
        )

    # Step 3: Garmin watch was off-wrist overnight -> Validate against historical baseline
    if eight_rhr is not None:
        if athlete_rhr_28d_median is not None:
            baseline_delta = abs(eight_rhr - athlete_rhr_28d_median)
            if baseline_delta > max_unverified_rhr_delta_bpm:
                return PresenceValidationVerdict(
                    verifiedAthlete=False,
                    concordanceStatus="DISCORDANT_SECONDARY",
                    reason=(
                        f"Watch off-wrist and Eight Sleep RHR ({eight_rhr:.1f} bpm) deviates "
                        f"by {baseline_delta:.1f} bpm from 28d baseline ({athlete_rhr_28d_median:.1f} bpm). Quarantined."
                    ),
                    garminRhr=None,
                    eightSleepRhr=eight_rhr,
                    rhrDelta=baseline_delta,
                    timingOverlapMinutes=overlap_mins,
                )

            # Off-wrist is plausible for fallback viewing but strictly quarantined from mutating athlete baseline (D-MS-PREBASE)
            return PresenceValidationVerdict(
                verifiedAthlete=False,
                concordanceStatus="UNVERIFIED_OFF_WRIST",
                reason=(
                    "Watch off-wrist overnight; Eight Sleep RHR matches historical baseline expectations "
                    "but is quarantined from baseline mutation (D-MS-PREBASE)."
                ),
                garminRhr=None,
                eightSleepRhr=eight_rhr,
                rhrDelta=baseline_delta,
                timingOverlapMinutes=overlap_mins,
            )

        return PresenceValidationVerdict(
            verifiedAthlete=False,
            concordanceStatus="UNVERIFIED_OFF_WRIST",
            reason="Watch off-wrist overnight; Eight Sleep data cannot be verified without Garmin RHR or a historical baseline.",
            garminRhr=None,
            eightSleepRhr=eight_rhr,
            rhrDelta=None,
            timingOverlapMinutes=overlap_mins,
        )

    # Default fallback: Eight sleep has no RHR or no baseline
    return PresenceValidationVerdict(
        verifiedAthlete=False,
        concordanceStatus="UNVERIFIED_OFF_WRIST",
        reason="Eight Sleep data cannot be verified without resting heart rate or historical baseline.",
        garminRhr=garmin_rhr,
        eightSleepRhr=eight_rhr,
        rhrDelta=None,
        timingOverlapMinutes=overlap_mins,
    )
