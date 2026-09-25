"""Provider-neutral activity classification that keeps two concepts apart (issue #809).

* **Stimulus / exercise intensity** -- which physiological domain dominated the work
  (``stimulus_domain``) and its coarse legacy projection ``intensity_tag``
  (``easy | moderate | hard``). ``intensity_tag == "hard"`` means *high-intensity
  stimulus* and nothing else; it feeds hard-session counts and recovery spacing.
* **Session cost / dose** -- how much recovery capacity the whole session consumed
  (``session_cost``). Training Effect is an accumulated dose signal, so it drives cost,
  and cost can rise with duration while the stimulus stays aerobic.

Evidence hierarchy for the stimulus (first applicable wins, recorded in
``intensity_evidence``):

1. ``race`` -- the provider marked the activity as a race event.
2. ``anaerobicTrainingEffect`` -- anaerobic TE >= 3.0 is interval/anaerobic evidence in
   any modality, so short hard repeats with a modest aerobic TE stay ``hard``.
3. ``powerIntensityFactor`` -- power-sport (cycling) IF, plus the high power-zone share
   to catch interval sessions whose IF is diluted by recovery segments.
4. ``hrZoneDistribution`` -- HR time-in-zone for endurance modalities (never strength,
   where HR does not describe the stimulus).
5. ``trainingEffectFallback`` -- the legacy rule (TE >= 3.0 or average HR >= the hard-HR
   threshold) when no measured intensity evidence exists; still documented as a fallback,
   not as proof of intensity.

Athlete reclassification and structured-workout identity sit *above* this hierarchy but
live downstream (``app/src/engine/completedTraining.ts`` applies ``ActivityOverride``),
so they keep their explicit provenance and precedence.

Takes plain extracted values only; provider adapters extract, this module classifies.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

# Version of this classifier's semantics. Persisted beside the tags so records produced
# by the legacy TE-only rule (no version field) are never silently reinterpreted.
INTENSITY_CLASSIFICATION_VERSION = 2

# Legacy fallback thresholds (temporary heuristics, unchanged from the pre-#809 rule).
HARD_SESSION_MIN_TRAINING_EFFECT = 3.0
HARD_SESSION_MIN_AVERAGE_HR = 145
MODERATE_SESSION_MIN_TRAINING_EFFECT = 2.0

# Anaerobic/interval evidence: Garmin anaerobic TE >= 3.0 ("improving" anaerobic).
ANAEROBIC_HARD_MIN_TRAINING_EFFECT = 3.0

# Coggan intensity-factor bands (fraction of FTP): recovery < 0.56, endurance < 0.76,
# tempo < 0.91, threshold < 1.06, VO2 and above otherwise.
IF_ENDURANCE_MIN = 0.56
IF_TEMPO_MIN = 0.76
IF_THRESHOLD_MIN = 0.91
IF_VO2_MIN = 1.06
# Share of recorded power time in Coggan zone 5+ that marks interval work even when
# recovery segments dilute IF.
POWER_HIGH_ZONE_HARD_SHARE = 0.10
POWER_HIGH_ZONE_START = 5

# HR time-in-zone (5-zone model) shares.
HR_Z5_HARD_SHARE = 0.10
HR_Z4_PLUS_HARD_SHARE = 0.30
HR_Z3_PLUS_MODERATE_SHARE = 0.30
HR_Z1_RECOVERY_SHARE = 0.80
HR_RECOVERY_MAX_DURATION_SECONDS = 45 * 60
# Zone data must cover at least half the session to be trusted.
MIN_ZONE_COVERAGE = 0.5

# Session-cost bands on the max Training Effect (an accumulated dose signal).
COST_MODERATE_MIN_TE = 2.0
COST_HIGH_MIN_TE = 3.0
COST_VERY_HIGH_MIN_TE = 4.0
_POWER_SPORT_MARKERS = ("cycl", "bik", "ride", "spin")
_STRENGTH_MARKERS = ("strength", "weight", "lift", "hiit", "crossfit")

_TAG_BY_DOMAIN = {
    "recovery": "easy",
    "endurance": "easy",
    "tempo": "moderate",
    "mixed": "moderate",
    "threshold": "hard",
    "vo2": "hard",
    "anaerobic": "hard",
    "race": "hard",
}


@dataclass(frozen=True)
class ActivityIntensityEvidence:
    """Provider-neutral measured evidence for one activity."""

    activity_type: str
    duration_seconds: float
    training_effect_aerobic: float
    training_effect_anaerobic: float
    average_hr: float | None = None
    hard_hr_threshold: float | None = None
    intensity_factor: float | None = None
    # Seconds in zone, index 0 == zone 1. Empty/None when unavailable.
    hr_zone_seconds: Sequence[float] | None = None
    power_zone_seconds: Sequence[float] | None = None
    is_race: bool = False


@dataclass(frozen=True)
class ActivityClassification:
    intensity_tag: str  # easy | moderate | hard -- stimulus intensity only
    stimulus_domain: str
    session_cost: str  # low | moderate | high | very_high | unknown
    intensity_evidence: str
    classification_version: int = INTENSITY_CLASSIFICATION_VERSION

    @property
    def is_hard(self) -> bool:
        return self.intensity_tag == "hard"


def _is_power_sport(activity_type: str) -> bool:
    normalized = activity_type.lower()
    return any(marker in normalized for marker in _POWER_SPORT_MARKERS)


def _is_strength(activity_type: str) -> bool:
    normalized = activity_type.lower()
    return any(marker in normalized for marker in _STRENGTH_MARKERS)


def _valid_zones(zones: Sequence[float] | None, duration_seconds: float) -> list[float] | None:
    if not zones:
        return None
    cleaned = [max(0.0, float(z or 0.0)) for z in zones]
    total = sum(cleaned)
    if total <= 0:
        return None
    if duration_seconds > 0 and total < MIN_ZONE_COVERAGE * duration_seconds:
        return None
    return cleaned


def _power_stimulus(evidence: ActivityIntensityEvidence) -> str | None:
    if not _is_power_sport(evidence.activity_type):
        return None
    intensity_factor = evidence.intensity_factor
    if intensity_factor is None or intensity_factor <= 0:
        return None
    zones = _valid_zones(evidence.power_zone_seconds, evidence.duration_seconds)
    high_share = sum(zones[POWER_HIGH_ZONE_START - 1 :]) / sum(zones) if zones is not None else 0.0
    if intensity_factor >= IF_VO2_MIN:
        return "vo2"
    if intensity_factor >= IF_THRESHOLD_MIN:
        return "threshold"
    if high_share >= POWER_HIGH_ZONE_HARD_SHARE:
        return "vo2"
    if intensity_factor >= IF_TEMPO_MIN:
        return "tempo"
    if intensity_factor >= IF_ENDURANCE_MIN:
        return "endurance"
    return "recovery"


def _hr_zone_stimulus(evidence: ActivityIntensityEvidence) -> str | None:
    if _is_strength(evidence.activity_type):
        return None
    zones = _valid_zones(evidence.hr_zone_seconds, evidence.duration_seconds)
    if zones is None or len(zones) < 5:
        return None
    total = sum(zones)
    z5 = sum(zones[4:]) / total
    z4_plus = sum(zones[3:]) / total
    z3_plus = sum(zones[2:]) / total
    if z5 >= HR_Z5_HARD_SHARE:
        return "vo2"
    if z4_plus >= HR_Z4_PLUS_HARD_SHARE:
        return "threshold"
    if z3_plus >= HR_Z3_PLUS_MODERATE_SHARE:
        return "tempo"
    if (
        zones[0] / total >= HR_Z1_RECOVERY_SHARE
        and evidence.duration_seconds <= HR_RECOVERY_MAX_DURATION_SECONDS
    ):
        return "recovery"
    return "endurance"


def legacy_intensity_tag(
    training_effect: float, average_hr: float | None, hard_hr_threshold: float | None = None
) -> str:
    """The pre-#809 rule (TE >= 3.0 or average HR >= threshold => hard); the
    ``trainingEffectFallback`` tier only."""
    te = training_effect or 0.0
    avg_hr = average_hr or 0
    threshold = (
        hard_hr_threshold
        if hard_hr_threshold is not None and hard_hr_threshold > 0
        else HARD_SESSION_MIN_AVERAGE_HR
    )
    if te >= HARD_SESSION_MIN_TRAINING_EFFECT or avg_hr >= threshold:
        return "hard"
    if te < MODERATE_SESSION_MIN_TRAINING_EFFECT:
        return "easy"
    return "moderate"


def classify_session_cost(evidence: ActivityIntensityEvidence) -> str:
    """Total session dose from the max Training Effect (it accumulates with duration).

    Without Training Effect the dose is ``unknown`` rather than guessed from duration: a
    sport-independent duration band would, for example, charge a long HR-less strength or
    yoga session as a hard session. Downstream consumers then fall back to the stimulus tag.
    A race is never below ``high``."""
    te = max(evidence.training_effect_aerobic or 0.0, evidence.training_effect_anaerobic or 0.0)
    if te >= COST_VERY_HIGH_MIN_TE:
        cost = "very_high"
    elif te >= COST_HIGH_MIN_TE:
        cost = "high"
    elif te >= COST_MODERATE_MIN_TE:
        cost = "moderate"
    elif te > 0:
        cost = "low"
    else:
        cost = "unknown"
    if evidence.is_race and cost in ("unknown", "low", "moderate"):
        cost = "high"
    return cost


def _stimulus(evidence: ActivityIntensityEvidence) -> tuple[str, str, str]:
    """Return (intensity_tag, stimulus_domain, evidence_source)."""
    if evidence.is_race:
        return "hard", "race", "race"
    if (evidence.training_effect_anaerobic or 0.0) >= ANAEROBIC_HARD_MIN_TRAINING_EFFECT:
        return "hard", "anaerobic", "anaerobicTrainingEffect"
    power_domain = _power_stimulus(evidence)
    if power_domain is not None:
        return _TAG_BY_DOMAIN[power_domain], power_domain, "powerIntensityFactor"
    hr_domain = _hr_zone_stimulus(evidence)
    if hr_domain is not None:
        return _TAG_BY_DOMAIN[hr_domain], hr_domain, "hrZoneDistribution"
    tag = legacy_intensity_tag(
        max(evidence.training_effect_aerobic or 0.0, evidence.training_effect_anaerobic or 0.0),
        evidence.average_hr,
        evidence.hard_hr_threshold,
    )
    domain = "strength" if _is_strength(evidence.activity_type) else "unknown"
    return tag, domain, "trainingEffectFallback"


def classify_activity(evidence: ActivityIntensityEvidence) -> ActivityClassification:
    """Deterministic: identical evidence always yields an identical classification."""
    tag, domain, source = _stimulus(evidence)
    return ActivityClassification(
        intensity_tag=tag,
        stimulus_domain=domain,
        session_cost=classify_session_cost(evidence),
        intensity_evidence=source,
    )
