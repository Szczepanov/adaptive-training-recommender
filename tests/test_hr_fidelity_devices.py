"""Tests for garmin_sync._hr_fidelity_devices unit logic and edge cases."""

import importlib
import sys
from unittest.mock import patch

from garmin_sync._hr_fidelity_devices import (
    _matches_manufacturer,
    _matches_substring,
    classify_hr_sensor_technology,
    is_cycling_head_unit,
    is_watch_device,
    source_evidence_from_fit_devices,
)
from garmin_sync.fit_activity import FitDeviceInventoryEntry


def test_matches_substring() -> None:
    assert _matches_substring("HRM Pro Plus", ("hrm", "strap")) is True
    assert _matches_substring("  FORERUNNER 955 ", ("forerunner",)) is True
    assert _matches_substring("Edge 1040", ("hrm", "strap")) is False
    assert _matches_substring(12345, ("hrm",)) is False
    assert _matches_substring(None, ("hrm",)) is False


def test_matches_manufacturer() -> None:
    # Match by integer ID
    assert _matches_manufacturer(1, (1, 15), ("garmin", "dynastream")) is True
    assert _matches_manufacturer(15, (1, 15), ("garmin", "dynastream")) is True
    assert _matches_manufacturer(32, (1, 15), ("garmin", "dynastream")) is False

    # Match by string name (case/whitespace insensitive)
    assert _matches_manufacturer("Garmin", (1, 15), ("garmin", "dynastream")) is True
    assert _matches_manufacturer("  DYNASTREAM ", (1, 15), ("garmin", "dynastream")) is True
    assert _matches_manufacturer("Polar", (1, 15), ("garmin", "dynastream")) is False

    # Non-matching/None
    assert _matches_manufacturer(None, (1, 15), ("garmin", "dynastream")) is False
    assert _matches_manufacturer(object(), (1, 15), ("garmin", "dynastream")) is False  # type: ignore[arg-type]


def test_is_cycling_head_unit() -> None:
    assert is_cycling_head_unit(None) is False
    assert (
        is_cycling_head_unit(FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"))
        is True
    )
    assert (
        is_cycling_head_unit(FitDeviceInventoryEntry(0, 1, 4062, None, "local")) is True
    )  # Edge 840 ID
    assert (
        is_cycling_head_unit(FitDeviceInventoryEntry(0, "wahoo", "elemnt_bolt", None, "local"))
        is True
    )
    assert (
        is_cycling_head_unit(FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"))
        is False
    )
    assert is_cycling_head_unit(FitDeviceInventoryEntry(0, "garmin", None, None, "local")) is False
    assert (
        is_cycling_head_unit(FitDeviceInventoryEntry(0, "garmin", 999999, None, "local")) is False
    )


def test_is_watch_device() -> None:
    assert is_watch_device(None) is False
    assert (
        is_watch_device(FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local"))
        is True
    )
    assert is_watch_device(FitDeviceInventoryEntry(0, "garmin", "fenix_7", None, "local")) is True
    assert (
        is_watch_device(FitDeviceInventoryEntry(0, "garmin", "edge_1030", None, "local")) is False
    )


def test_classify_hr_sensor_technology() -> None:
    # 1. Watch device broadcasting optical HR
    watch = FitDeviceInventoryEntry(1, "garmin", "forerunner_255", "heart_rate", "antplus")
    assert classify_hr_sensor_technology(watch) == "wrist_ppg"

    # 2. Garmin / Dynastream electrode chest straps and non-strap Garmin/Dynastream products
    hrm_garmin = FitDeviceInventoryEntry(1, 1, 3300, "heart_rate", "antplus")  # HRM Pro ID
    assert classify_hr_sensor_technology(hrm_garmin) == "electrode_chest_strap"

    hrm_garmin_name = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    assert classify_hr_sensor_technology(hrm_garmin_name) == "electrode_chest_strap"

    hrm_dynastream = FitDeviceInventoryEntry(
        1, "dynastream", "chest_strap", "heart_rate", "antplus"
    )
    assert classify_hr_sensor_technology(hrm_dynastream) == "electrode_chest_strap"

    garmin_non_strap = FitDeviceInventoryEntry(1, "garmin", "vector_3", "heart_rate", "antplus")
    assert classify_hr_sensor_technology(garmin_non_strap) == "external_unknown"

    # 3. Polar chest straps, armbands, and non-strap Polar products
    polar_verity = FitDeviceInventoryEntry(1, "polar", "verity_sense", "heart_rate", "ble")
    assert classify_hr_sensor_technology(polar_verity) == "optical_armband"

    polar_strap = FitDeviceInventoryEntry(1, "polar", "h10_strap", "heart_rate", "ble")
    assert classify_hr_sensor_technology(polar_strap) == "electrode_chest_strap"

    polar_non_strap = FitDeviceInventoryEntry(1, "polar", "vantage_v2", "heart_rate", "ble")
    assert classify_hr_sensor_technology(polar_non_strap) == "external_unknown"

    # 4. Wahoo TICKR straps, armbands, and non-strap Wahoo products
    wahoo_fit = FitDeviceInventoryEntry(1, "wahoo", "tickr_fit", "heart_rate", "ble")
    assert classify_hr_sensor_technology(wahoo_fit) == "optical_armband"

    wahoo_strap = FitDeviceInventoryEntry(1, "wahoo", "tickr_x", "heart_rate", "ble")
    assert classify_hr_sensor_technology(wahoo_strap) == "electrode_chest_strap"

    wahoo_non_strap = FitDeviceInventoryEntry(1, "wahoo", "kickr_v5", "heart_rate", "ble")
    assert classify_hr_sensor_technology(wahoo_non_strap) == "external_unknown"

    # 5. External unknown (unapproved manufacturer or unrecognized string)
    unapproved_mfg = FitDeviceInventoryEntry(1, "unknown_brand", "hrm_pro", "heart_rate", "antplus")
    assert classify_hr_sensor_technology(unapproved_mfg) == "external_unknown"


def test_source_evidence_empty_devices() -> None:
    source = source_evidence_from_fit_devices(())
    assert source.external_hr_sensor_present is None
    assert source.source_for_activity == "unknown"
    assert source.provenance_confidence == "unknown"
    assert source.sensor_technology == "unknown"


def test_source_evidence_watch_only() -> None:
    watch = FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local")
    source = source_evidence_from_fit_devices((watch,))
    assert source.external_hr_sensor_present is False
    assert source.source_for_activity == "wrist"
    assert source.provenance_confidence == "inferred"
    assert source.sensor_technology == "wrist_ppg"


def test_source_evidence_non_watch_recorder_without_external_hr() -> None:
    # Non-watch recorder (e.g. unknown device type) and no external HR device
    devices = (FitDeviceInventoryEntry(0, "custom_mfg", "custom_tracker", None, "local"),)
    source = source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is None
    assert source.source_for_activity == "unknown"
    assert source.provenance_confidence == "unknown"
    assert source.sensor_technology == "unknown"


def test_source_evidence_primary_recorder_has_hr_device_type() -> None:
    # Primary recorder has device_type="heart_rate", but is not a chest strap and is device_index 0 / local.
    # It should be skipped from external_hr_devices.
    recorder = FitDeviceInventoryEntry(0, "garmin", "forerunner_955", "heart_rate", "local")
    strap = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    source = source_evidence_from_fit_devices((recorder, strap))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_evidence_conflicting_creator_signatures() -> None:
    # Multiple creator candidates (device_index=0 or local) with conflicting signatures
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local"),
        FitDeviceInventoryEntry(0, "wahoo", "elemnt_bolt", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"

    # Conflicting creators with NO external HR devices
    devices_no_ext = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local"),
        FitDeviceInventoryEntry(0, "wahoo", "elemnt_bolt", None, "local"),
    )
    source_no_ext = source_evidence_from_fit_devices(devices_no_ext)
    assert source_no_ext.external_hr_sensor_present is None
    assert source_no_ext.source_for_activity == "unknown"
    assert source_no_ext.provenance_confidence == "ambiguous"
    assert source_no_ext.sensor_technology == "unknown"


def test_source_evidence_deduplication_and_multiple_external_sensors() -> None:
    # Duplicate indexed entries with identical signature should collapse to 1 distinct sensor
    dup1 = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    dup2 = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    watch = FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local")
    source = source_evidence_from_fit_devices((watch, dup1, dup2))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"

    # Same device_index with conflicting signatures -> preserved as multiple distinct
    conf1 = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    conf2 = FitDeviceInventoryEntry(1, "garmin", "hrm_dual", "heart_rate", "ble")
    source_conf = source_evidence_from_fit_devices((watch, conf1, conf2))
    assert source_conf.external_hr_sensor_present is True
    assert source_conf.source_for_activity == "mixed_possible"
    assert source_conf.provenance_confidence == "ambiguous"
    assert source_conf.sensor_technology == "electrode_chest_strap"

    # Multiple distinct external sensors with different technologies
    strap = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    armband = FitDeviceInventoryEntry(2, "polar", "verity_sense", "heart_rate", "ble")
    source_multi_diff = source_evidence_from_fit_devices((watch, strap, armband))
    assert source_multi_diff.external_hr_sensor_present is True
    assert source_multi_diff.source_for_activity == "mixed_possible"
    assert source_multi_diff.provenance_confidence == "ambiguous"
    assert source_multi_diff.sensor_technology == "external_unknown"


def test_source_evidence_unindexed_external_sensor() -> None:
    watch = FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local")
    unindexed_strap = FitDeviceInventoryEntry(None, "garmin", "hrm_pro", "heart_rate", "antplus")
    source = source_evidence_from_fit_devices((watch, unindexed_strap))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_evidence_broadcasting_watch() -> None:
    edge = FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local")
    broadcasting_watch = FitDeviceInventoryEntry(
        1, "garmin", "forerunner_255", "heart_rate", "antplus"
    )
    source = source_evidence_from_fit_devices((edge, broadcasting_watch))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "wrist_ppg"


def test_source_evidence_headunit_with_chest_strap() -> None:
    edge = FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local")
    strap = FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus")
    source = source_evidence_from_fit_devices((edge, strap))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_evidence_headunit_with_unknown_external_sensor() -> None:
    # Edge head unit + external HR sensor that is external_unknown
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_530", None, "local"),
        FitDeviceInventoryEntry(1, "unknown_mfg", "mystery_sensor", "heart_rate", "antplus"),
    )
    source = source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_source_evidence_standalone_chest_strap() -> None:
    # Recorder itself is the chest strap
    strap = FitDeviceInventoryEntry(0, "garmin", "hrm_pro", "heart_rate", "local")
    source = source_evidence_from_fit_devices((strap,))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_evidence_unknown_recorder_with_chest_strap() -> None:
    # Unknown recorder (neither watch nor edge) with verified electrode chest strap
    devices = (
        FitDeviceInventoryEntry(0, "unknown_mfg", "recorder_device", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_evidence_unrecognized_external_sensor() -> None:
    watch = FitDeviceInventoryEntry(0, "garmin", "forerunner_955", None, "local")
    unknown_ext = FitDeviceInventoryEntry(
        1, "unknown_mfg", "unknown_device", "heart_rate", "antplus"
    )
    source = source_evidence_from_fit_devices((watch, unknown_ext))
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_static_fallback_product_ids_when_fitdecode_profile_missing() -> None:
    """Test module initialization when fitdecode profile lacks garmin_product field."""
    with patch("fitdecode.profile.FIELD_TYPES", {}):
        # Unload module from sys.modules to trigger re-execution of top-level code
        sys.modules.pop("garmin_sync._hr_fidelity_devices", None)
        mod = importlib.import_module("garmin_sync._hr_fidelity_devices")

        # Verify static fallbacks are loaded
        assert 3300 in mod._GARMIN_HRM_PRODUCT_IDS
        assert 4062 in mod._GARMIN_EDGE_PRODUCT_IDS

        # Clean up by re-importing fresh
        sys.modules.pop("garmin_sync._hr_fidelity_devices", None)
        importlib.import_module("garmin_sync._hr_fidelity_devices")
