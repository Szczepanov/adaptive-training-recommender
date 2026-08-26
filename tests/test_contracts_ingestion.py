"""Contract 1: Ingestion <-> Canonical Observations / Snapshots.

Loads the same JSON fixtures as app/src/contracts/ingestionSnapshotContract.test.ts
(tests/fixtures/contracts/), so a field added to DailyRecoverySnapshot or
CanonicalActivity without updating the TypeScript-side contract fails this suite
too, instead of the two suites silently drifting apart.

The fixtures only cover the subset of fields the contract validates -- see
src/garmin_sync/models.py for the full DailyRecoverySnapshot schema, which carries
many more optional/observation-only fields (metric enrichment, medians, MADs) than
are worth coupling to a cross-language contract.
"""

import json
import re
from pathlib import Path

from garmin_sync.canonical import CanonicalActivity
from garmin_sync.mapper import normalize_activity
from garmin_sync.models import (
    DailyRecoverySnapshot,
    DataQuality,
    DerivedDeltas,
    DerivedMetrics,
    RawMetrics,
    SourceMetadata,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "contracts"


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def _assert_subset(expected: dict, actual: dict, path: str = "") -> None:
    """Assert every key in `expected` is present in `actual` with an equal value,
    recursing into nested dicts. `actual` may have additional keys the fixture
    doesn't care about (e.g. DailyRecoverySnapshot's many observation-only fields)."""
    for key, expected_value in expected.items():
        if key == "_comment":
            continue
        full_path = f"{path}.{key}" if path else key
        assert key in actual, f"missing key {full_path!r} in real output"
        actual_value = actual[key]
        if isinstance(expected_value, dict):
            assert isinstance(actual_value, dict), f"{full_path!r} expected an object"
            _assert_subset(expected_value, actual_value, full_path)
        else:
            assert actual_value == expected_value, (
                f"{full_path!r} mismatch: fixture says {expected_value!r}, "
                f"real serialization produced {actual_value!r}"
            )


def test_ingestion_snapshot_contract_serialization() -> None:
    fixture = _load("ingestion_snapshot.json")

    snapshot = DailyRecoverySnapshot(
        userId=fixture["userId"],
        date=fixture["date"],
        source=SourceMetadata(
            sourceSchemaVersion=fixture["source"]["sourceSchemaVersion"],
            garminSyncedAt=fixture["source"]["garminSyncedAt"],
        ),
        raw=RawMetrics(**{k: v for k, v in fixture["raw"].items() if k != "_comment"}),
        derived=DerivedMetrics(
            **{k: v for k, v in fixture["derived"].items() if k not in ("_comment", "deltas")},
            deltas=DerivedDeltas(**fixture["derived"]["deltas"]),
        ),
        dataQuality=DataQuality(
            **{k: v for k, v in fixture["dataQuality"].items() if k != "_comment"}
        ),
    )

    payload = snapshot.to_dict()

    # The real serialization must reproduce every fixture-declared field exactly --
    # this is the cross-language contract, not just "some snapshot came out".
    _assert_subset(fixture, payload)

    # Range/shape invariants the TypeScript-side validator also enforces.
    assert re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$", payload["date"])
    assert payload["source"]["sourceSchemaVersion"] in [2, 3]
    assert 0 <= payload["raw"]["sleepScore"] <= 100
    assert 20 <= payload["raw"]["restingHr"] <= 240
    assert payload["raw"]["totalSteps"] >= 0


def test_normalized_activity_contract() -> None:
    fixture = _load("normalized_activity.json")

    activity = CanonicalActivity(
        activity_id=fixture["canonical"]["activity_id"],
        date=fixture["canonical"]["date"],
        type=fixture["canonical"]["type"],
        duration_min=fixture["canonical"]["duration_min"],
        duration_seconds=fixture["canonical"]["duration_seconds"],
        training_effect_aerobic=fixture["canonical"]["training_effect_aerobic"],
        training_effect_anaerobic=fixture["canonical"]["training_effect_anaerobic"],
        average_hr=fixture["canonical"]["average_hr"],
        training_load=fixture["canonical"]["training_load"],
        intensity_tag=fixture["canonical"]["intensity_tag"],
    )

    payload = normalize_activity(activity, sync_run_id=fixture["normalized"]["syncRunId"])

    # syncedAt is stamped with a real timestamp by normalize_activity, so the
    # fixture's value is a placeholder for the TS-side literal-shape test only --
    # everything else must match exactly.
    expected = {k: v for k, v in fixture["normalized"].items() if k != "syncedAt"}
    _assert_subset(expected, payload)
    assert isinstance(payload["syncedAt"], str) and payload["syncedAt"]
