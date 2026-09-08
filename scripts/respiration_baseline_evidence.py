"""Synthetic sensitivity/mechanics evidence for the respiration median/MAD baseline
candidate (docs/adr/0024-biometric-baseline-estimator-policy.md).

PR #136 shipped the `median-mad-v1` respiration strain path default-off, and both the PR
description and ADR-0024 flag the same open item: the path has not yet been run through
anything like the Phase-9.6 sensitivity/mechanics harness that ``rules.ts``'s other
comparison-policy features got (see ``app/scripts/simulate-subjective-drift.mjs`` for the
precedent this mirrors). This script is that first mechanics pass for respiration.

It exercises the *actual* estimator functions (``calculate_median``/``calculate_mad``/
``calculate_average``/``calculate_stdev`` from ``garmin_sync.metrics``) against synthetic
daily respiration profiles -- a stable-healthy control, a noisy-but-healthy control with
occasional non-illness elevated nights, a short self-resolving "mild cold" bump, a longer
"sustained illness" ramp, and a quantized/tied-values profile -- and reports the statistics
ADR-0024's release criteria call for: mean-minus-median difference, stdev/MAD relationship,
zero-MAD frequency, and ties/quantization frequency. It also reports a strain-contribution
mechanics comparison using ``rules.ts``'s respiration weight/floor/z-cap constants, mirrored
here in ``_MIRRORED_RULES_TS_CONSTANTS`` (keep these in sync manually if that file changes;
there is no automated cross-language link).

This is explicitly a synthetic sweep, not calibration. ADR-0024 is direct on this point:
"Synthetic sweeps are useful for threshold discovery but are explicitly not sufficient
calibration without historical replay or prospectively labelled data." Nothing here changes
the fact that ``RespirationStrainPolicy`` defaults to ``'off'`` in production; this script
only produces measurement evidence for that future calibration decision.
"""

import argparse
import json
import random
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, TypedDict

from garmin_sync.metrics import (
    calculate_average,
    calculate_delta,
    calculate_mad,
    calculate_median,
    calculate_stdev,
)

# Mirrors app/src/engine/rules.ts's respiration constants (RESPIRATION_STRAIN_WEIGHT,
# RESPIRATION_MAD_FLOOR_BR, STRAIN_Z_CAP, CHRONIC_STRAIN_MULTIPLIER) as of PR #136. If those
# change, update this mapping too -- there is no shared source of truth across languages.
_MIRRORED_RULES_TS_CONSTANTS = {
    "weight": 0.3,
    "floor": 1.0,
    "z_cap": 2.0,
    "chronic_multiplier": 1.5,
    "sign": -1,  # elevated respiration is the adverse direction, same convention as RHR
}

MIN_7D = 4
MIN_28D = 14
WINDOW_7D = 7
WINDOW_28D = 28


def _profile_stable_healthy(rng: random.Random, days: int) -> list[float]:
    """Healthy nights with ordinary night-to-night jitter and no elevation episode."""
    return [round(14.0 + rng.gauss(0, 0.4), 1) for _ in range(days)]


def _profile_noisy_healthy(rng: random.Random, days: int) -> list[float]:
    """Healthy nights with larger jitter plus occasional non-illness elevated nights
    (heat, alcohol, travel) -- a false-positive resistance control."""
    values = []
    for _ in range(days):
        v = 14.0 + rng.gauss(0, 0.6)
        if rng.random() < 0.08:
            v += rng.uniform(1.5, 2.5)
        values.append(round(v, 1))
    return values


def _profile_mild_cold(rng: random.Random, days: int) -> list[float]:
    """A short, self-resolving elevation (days 40-44) against an otherwise stable
    baseline -- tests lead time and false-positive persistence after resolution."""
    values = []
    for i in range(days):
        base = 14.0 + (1.8 if 40 <= i <= 44 else 0.0)
        values.append(round(base + rng.gauss(0, 0.3), 1))
    return values


def _profile_sustained_illness(rng: random.Random, days: int) -> list[float]:
    """A worsening ramp (days 40-46) followed by a sustained elevated plateau
    (days 47-58) -- an illness-like pattern the ADR expects respiration to help flag."""
    values = []
    for i in range(days):
        if 40 <= i < 47:
            base = 14.0 + (i - 39) * 0.4
        elif 47 <= i <= 58:
            base = 14.0 + 2.8
        else:
            base = 14.0
        values.append(round(base + rng.gauss(0, 0.3), 1))
    return values


def _profile_quantized_ties(rng: random.Random, days: int) -> list[float]:
    """Garmin-style integer rounding with only two adjacent observed values -- the
    scenario ADR-0024 warns produces MAD == 0 and turns any floor into pure modelling
    assumption rather than a measured spread."""
    return [14.0 if rng.random() < 0.6 else 15.0 for _ in range(days)]


PROFILES: dict[str, Callable[[random.Random, int], list[float]]] = {
    "stable_healthy": _profile_stable_healthy,
    "noisy_healthy": _profile_noisy_healthy,
    "mild_cold": _profile_mild_cold,
    "sustained_illness": _profile_sustained_illness,
    "quantized_ties": _profile_quantized_ties,
}


class ContributionEvidence(TypedDict):
    acute: float
    chronic: float
    total: float


class ContributionSummary(TypedDict):
    mean: float | None
    max: float
    nonzeroRate: float | None


class ProfileSummary(TypedDict):
    profile: str
    evaluatedDays: int
    meanMinusMedian28dAvg: float | None
    meanMinusMedian28dMaxAbs: float
    zeroMadRate: float | None
    tiedMajorityRate: float | None
    medianMadContribution: ContributionSummary
    meanStdevCounterfactualContribution: ContributionSummary


class EvidenceResult(TypedDict):
    days: int
    seed: int
    mirroredRulesTsConstants: dict[str, float]
    summaries: list[ProfileSummary]
    rows: dict[str, list[dict[str, object]]]


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _strain_contribution(
    delta_7d: float | None, delta_28d: float | None, spread: float | None
) -> ContributionEvidence:
    """Mirrors rules.ts's metricStrain() for the respiration weight/floor/cap. Applied here
    to both the median/MAD path (the real `median-mad-v1` code path) and, as a labelled
    counterfactual, the mean/stdev path (which respiration has no production code for) so
    the two estimators' would-be contributions can be compared directly."""
    c = _MIRRORED_RULES_TS_CONSTANTS
    if delta_7d is None:
        return {"acute": 0.0, "chronic": 0.0, "total": 0.0}
    sd = max(spread if spread is not None else c["floor"], c["floor"])
    z_acute = (c["sign"] * delta_7d) / sd
    acute = _clamp(-z_acute, 0, c["z_cap"])
    chronic = 0.0
    if delta_28d is not None:
        z_chronic = (c["sign"] * (delta_28d - delta_7d)) / sd
        chronic = _clamp(-z_chronic, 0, c["z_cap"])
    acute_dev = c["weight"] * acute
    chronic_dev = c["weight"] * c["chronic_multiplier"] * chronic
    return {"acute": acute_dev, "chronic": chronic_dev, "total": acute_dev + chronic_dev}


@dataclass
class DayEvidence:
    day_index: int
    current: float
    mean_7d: float | None
    median_7d: float | None
    mean_28d: float | None
    median_28d: float | None
    stdev_28d: float | None
    mad_28d: float | None
    ties_fraction_28d: float | None
    median_mad_contribution: ContributionEvidence
    mean_stdev_counterfactual_contribution: ContributionEvidence


def evaluate_profile(values: list[float]) -> list[DayEvidence]:
    """Replays service.py's trailing-window convention (current day excluded, 7d/28d
    windows ending the day before) over one synthetic respiration series."""
    days: list[DayEvidence] = []
    for i in range(WINDOW_28D, len(values)):
        current = values[i]
        window_7d = values[i - WINDOW_7D : i]
        window_28d = values[i - WINDOW_28D : i]

        mean_7d = calculate_average(window_7d, MIN_7D)
        median_7d = calculate_median(window_7d, MIN_7D)
        mean_28d = calculate_average(window_28d, MIN_28D)
        median_28d = calculate_median(window_28d, MIN_28D)
        stdev_28d = calculate_stdev(window_28d, MIN_28D)
        mad_28d = calculate_mad(window_28d, MIN_28D)

        ties_fraction = None
        if median_28d is not None:
            ties_fraction = sum(1 for v in window_28d if v == median_28d) / len(window_28d)

        delta_median_7d = calculate_delta(current, median_7d)
        delta_median_28d = calculate_delta(current, median_28d)
        delta_mean_7d = calculate_delta(current, mean_7d)
        delta_mean_28d = calculate_delta(current, mean_28d)

        days.append(
            DayEvidence(
                day_index=i,
                current=current,
                mean_7d=mean_7d,
                median_7d=median_7d,
                mean_28d=mean_28d,
                median_28d=median_28d,
                stdev_28d=stdev_28d,
                mad_28d=mad_28d,
                ties_fraction_28d=ties_fraction,
                median_mad_contribution=_strain_contribution(
                    delta_median_7d, delta_median_28d, mad_28d
                ),
                mean_stdev_counterfactual_contribution=_strain_contribution(
                    delta_mean_7d, delta_mean_28d, stdev_28d
                ),
            )
        )
    return days


def summarize_profile(name: str, days: list[DayEvidence]) -> ProfileSummary:
    n = len(days)
    mean_minus_median = [
        d.mean_28d - d.median_28d
        for d in days
        if d.mean_28d is not None and d.median_28d is not None
    ]
    zero_mad_days = [d for d in days if d.mad_28d == 0.0]
    tied_majority_days = [
        d for d in days if d.ties_fraction_28d is not None and d.ties_fraction_28d >= 0.5
    ]
    median_mad_totals = [d.median_mad_contribution["total"] for d in days]
    mean_stdev_totals = [d.mean_stdev_counterfactual_contribution["total"] for d in days]

    def _avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 4) if xs else None

    return {
        "profile": name,
        "evaluatedDays": n,
        "meanMinusMedian28dAvg": _avg(mean_minus_median),
        "meanMinusMedian28dMaxAbs": round(max((abs(x) for x in mean_minus_median), default=0.0), 4),
        "zeroMadRate": round(len(zero_mad_days) / n, 4) if n else None,
        "tiedMajorityRate": round(len(tied_majority_days) / n, 4) if n else None,
        "medianMadContribution": {
            "mean": _avg(median_mad_totals),
            "max": round(max(median_mad_totals, default=0.0), 4),
            "nonzeroRate": round(sum(1 for t in median_mad_totals if t > 0) / n, 4) if n else None,
        },
        "meanStdevCounterfactualContribution": {
            "mean": _avg(mean_stdev_totals),
            "max": round(max(mean_stdev_totals, default=0.0), 4),
            "nonzeroRate": round(sum(1 for t in mean_stdev_totals if t > 0) / n, 4) if n else None,
        },
    }


def run(days: int, seed: int) -> EvidenceResult:
    rng = random.Random(seed)
    profiles = {name: fn(rng, days) for name, fn in PROFILES.items()}
    evidence = {name: evaluate_profile(values) for name, values in profiles.items()}
    summaries = [summarize_profile(name, rows) for name, rows in evidence.items()]
    return {
        "days": days,
        "seed": seed,
        "mirroredRulesTsConstants": _MIRRORED_RULES_TS_CONSTANTS,
        "summaries": summaries,
        "rows": {name: [asdict(d) for d in rows] for name, rows in evidence.items()},
    }


def render_report(result: EvidenceResult) -> str:
    lines = [
        "# Respiration median/MAD baseline evidence (synthetic sweep)",
        "",
        "## Evidence framing",
        "",
        "- **Synthetic mechanics evidence** (this report): exercises the real estimator "
        "functions against synthetic profiles to expose thresholds and compare the "
        "median/MAD and mean/stdev estimators directly.",
        "- **Not calibration.** ADR-0024 requires historical replay or prospectively "
        "labelled data before `RespirationStrainPolicy` may default to anything other "
        "than `'off'` in production. This report does not satisfy that bar on its own.",
        f"- Synthetic days per profile: {result['days']}; random seed: {result['seed']} "
        "(deterministic, reproducible).",
        f"- Mirrored rules.ts constants: {result['mirroredRulesTsConstants']}",
        "",
        "## Per-profile summary",
        "",
    ]
    for summary in result["summaries"]:
        mm = summary["medianMadContribution"]
        ms = summary["meanStdevCounterfactualContribution"]
        lines.extend(
            [
                f"### {summary['profile']}",
                "",
                f"- Evaluated days: {summary['evaluatedDays']}",
                f"- Mean-minus-median (28d): avg {summary['meanMinusMedian28dAvg']}, "
                f"max |diff| {summary['meanMinusMedian28dMaxAbs']}",
                f"- Zero-MAD rate (28d): {summary['zeroMadRate']}",
                f"- Tied-majority rate (>=50% of 28d window equals the median): "
                f"{summary['tiedMajorityRate']}",
                f"- Median/MAD contribution (real `median-mad-v1` path): mean "
                f"{mm['mean']}, max {mm['max']}, nonzero-day rate {mm['nonzeroRate']}",
                f"- Mean/stdev counterfactual contribution (no production code path, "
                f"comparison only): mean {ms['mean']}, max {ms['max']}, nonzero-day rate "
                f"{ms['nonzeroRate']}",
                "",
            ]
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=90, help="Synthetic days per profile")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic RNG seed")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("artifacts/respiration-baseline-evidence/latest"),
        help="Directory to write report.md and data.json into",
    )
    args = parser.parse_args()
    if args.days <= WINDOW_28D:
        parser.error(f"--days must exceed {WINDOW_28D} to fill a full 28d window")

    result = run(args.days, args.seed)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "data.json").write_text(json.dumps(result, indent=2) + "\n")
    (args.out_dir / "report.md").write_text(render_report(result))
    print(f"Respiration baseline evidence written to {args.out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
