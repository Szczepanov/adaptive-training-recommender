from garmin_sync.fit_activity import FitDeviceInventoryEntry, _normalize_device_type
from garmin_sync.service import _source_evidence_from_fit_devices


def test_raw_antplus_heart_rate_device_type_is_normalized_for_inventory_reasoning() -> None:
    device_type = _normalize_device_type(120, 1)

    assert device_type == "heart_rate"
    source = _source_evidence_from_fit_devices(
        (FitDeviceInventoryEntry(1, None, None, device_type, 1),)
    )
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_named_antplus_source_also_normalizes_raw_heart_rate_device_type() -> None:
    assert _normalize_device_type(120, "ANTPLUS") == "heart_rate"


def test_raw_numeric_device_type_without_antplus_context_is_not_interpreted() -> None:
    assert _normalize_device_type(120, None) == 120
    assert _normalize_device_type(120, "local") == 120
    assert _normalize_device_type(120, 5) == 120
