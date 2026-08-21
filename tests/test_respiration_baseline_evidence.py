from respiration_baseline_evidence import (
    _MIRRORED_RULES_TS_CONSTANTS,
    _strain_contribution,
    evaluate_profile,
    render_report,
    run,
    summarize_profile,
)


def test_mirrored_constants_match_rules_ts_respiration_weights() -> None:
    """Pins the values mirrored from app/src/engine/rules.ts. If rules.ts's
    RESPIRATION_STRAIN_WEIGHT / RESPIRATION_MAD_FLOOR_BR / STRAIN_Z_CAP /
    CHRONIC_STRAIN_MULTIPLIER ever change, this must be updated to match, or this
    script's contribution numbers silently stop representing the real code path."""
    assert _MIRRORED_RULES_TS_CONSTANTS == {
        "weight": 0.3,
        "floor": 1.0,
        "z_cap": 2.0,
        "chronic_multiplier": 1.5,
        "sign": -1,
    }


def test_strain_contribution_is_inert_without_a_7d_delta() -> None:
    assert _strain_contribution(None, None, 1.0) == {"acute": 0.0, "chronic": 0.0, "total": 0.0}


def test_strain_contribution_lower_respiration_never_adds_strain() -> None:
    # Calmer-than-usual respiration is the "good" direction and must contribute nothing.
    contribution = _strain_contribution(-2.0, -2.0, 1.0)
    assert contribution["total"] == 0.0


def test_strain_contribution_elevated_respiration_is_capped() -> None:
    # A large elevation against a tight (floored) spread should saturate at the z-cap,
    # not grow without bound.
    contribution = _strain_contribution(10.0, 10.0, 1.0)
    weight = _MIRRORED_RULES_TS_CONSTANTS["weight"]
    z_cap = _MIRRORED_RULES_TS_CONSTANTS["z_cap"]
    assert contribution["acute"] == weight * z_cap


def test_evaluate_profile_windows_exclude_the_current_day() -> None:
    # 28 constant days followed by one elevated day: the elevated day's own value must
    # never leak into its own 7d/28d baseline windows.
    values = [14.0] * 28 + [20.0]
    rows = evaluate_profile(values)
    assert len(rows) == 1
    row = rows[0]
    assert row.current == 20.0
    assert row.median_28d == 14.0
    assert row.mean_28d == 14.0


def test_sustained_illness_profile_diverges_mean_from_median() -> None:
    result = run(days=90, seed=42)
    summaries = {s["profile"]: s for s in result["summaries"]}
    illness = summaries["sustained_illness"]
    stable = summaries["stable_healthy"]

    # The illness ramp/plateau should pull the mean away from the median more than a
    # stable-healthy control does.
    assert illness["meanMinusMedian28dMaxAbs"] > stable["meanMinusMedian28dMaxAbs"]
    # And it should produce real median/MAD strain contribution on at least some days.
    assert illness["medianMadContribution"]["nonzeroRate"] > 0


def test_quantized_ties_profile_has_frequent_zero_mad() -> None:
    result = run(days=90, seed=42)
    summaries = {s["profile"]: s for s in result["summaries"]}
    quantized = summaries["quantized_ties"]

    # A two-value quantized series should tie on the median in the majority of windows,
    # which is exactly the zero-MAD scenario ADR-0024 warns about.
    assert quantized["zeroMadRate"] > 0.5
    assert quantized["tiedMajorityRate"] > 0.5


def test_noisy_healthy_profile_rarely_crosses_into_nonzero_strain() -> None:
    # Occasional non-illness elevated nights (heat, travel, alcohol) should mostly stay
    # under the MAD-scaled floor and not read as sustained strain the way illness does.
    result = run(days=90, seed=42)
    summaries = {s["profile"]: s for s in result["summaries"]}
    noisy = summaries["noisy_healthy"]
    illness = summaries["sustained_illness"]

    assert (
        noisy["medianMadContribution"]["nonzeroRate"]
        < illness["medianMadContribution"]["nonzeroRate"]
    )


def test_run_is_deterministic_for_a_fixed_seed() -> None:
    first = run(days=60, seed=7)
    second = run(days=60, seed=7)
    assert first["summaries"] == second["summaries"]


def test_summarize_profile_handles_empty_rows() -> None:
    summary = summarize_profile("empty", [])
    assert summary["evaluatedDays"] == 0
    assert summary["zeroMadRate"] is None


def test_render_report_includes_every_profile() -> None:
    result = run(days=60, seed=1)
    report = render_report(result)
    for summary in result["summaries"]:
        assert summary["profile"] in report
    assert "Not calibration" in report
