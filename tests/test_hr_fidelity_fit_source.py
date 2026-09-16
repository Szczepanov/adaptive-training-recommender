from datetime import datetime, timedelta

from garmin_sync.fit_activity import (
    FitActivityEvidence,
    FitDeviceInventoryEntry,
    FitRecordSample,
    FitTimerEvent,
    _normalize_device_type,
)
from garmin_sync.hr_fidelity import assess_activity_hr_fidelity
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


def test_scenario_3_edge_head_unit_with_chest_strap_confirms_electrode_strap() -> None:
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_scenario_3_edge_with_numeric_product_ids_confirms_electrode_strap() -> None:
    # 4062 = Edge 840, 3300 = HRM-Pro (authoritative Garmin profile IDs)
    devices = (
        FitDeviceInventoryEntry(0, 1, 4062, None, "local"),
        FitDeviceInventoryEntry(1, 1, 3300, "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_multiple_competing_external_hr_devices_fail_closed_to_ambiguous() -> None:
    # If both a broadcast watch (wrist_ppg) and a strap (electrode_chest_strap) are paired,
    # provenance is genuinely ambiguous; fail closed to mixed_possible / ambiguous.
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "forerunner_965", "heart_rate", "antplus"),
        FitDeviceInventoryEntry(2, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_duplicate_device_info_for_same_strap_is_deduplicated() -> None:
    # Garmin frequently emits multiple device_info frames for the same sensor (initial connection & battery)
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_scenario_2_watch_with_chest_strap_confirms_electrode_strap() -> None:
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_dual", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_scenario_4_edge_with_watch_broadcasting_hr_classified_as_wrist_ppg() -> None:
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_1040", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "forerunner_965", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "wrist_ppg"


def test_scenario_1_watch_only_classified_as_inferred_wrist_ppg() -> None:
    devices = (FitDeviceInventoryEntry(0, "garmin", "fenix_7", None, "local"),)
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is False
    assert source.source_for_activity == "wrist"
    assert source.provenance_confidence == "inferred"
    assert source.sensor_technology == "wrist_ppg"


def test_scenario_5_standalone_chest_strap_confirms_electrode_strap() -> None:
    devices = (FitDeviceInventoryEntry(0, "garmin", "hrm_fit", "heart_rate", "local"),)
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def test_third_party_polar_and_wahoo_straps_recognized() -> None:
    # FIT decodes manufacturer 123 as "polar_electro" and 32 as "wahoo_fitness"
    polar_strap = (
        FitDeviceInventoryEntry(0, "garmin", "edge_540", None, "local"),
        FitDeviceInventoryEntry(1, "polar_electro", "h10", "heart_rate", "bluetooth"),
    )
    source_polar = _source_evidence_from_fit_devices(polar_strap)
    assert source_polar.sensor_technology == "electrode_chest_strap"

    wahoo_strap = (
        FitDeviceInventoryEntry(0, "garmin", "edge_540", None, "local"),
        FitDeviceInventoryEntry(1, "wahoo_fitness", "tickr", "heart_rate", "antplus"),
    )
    source_wahoo = _source_evidence_from_fit_devices(wahoo_strap)
    assert source_wahoo.sensor_technology == "electrode_chest_strap"


def test_optical_armbands_classified_as_optical_armband() -> None:
    # Verity Sense and TICKR FIT must classify as optical_armband under real decoded strings
    verity = (
        FitDeviceInventoryEntry(0, "garmin", "edge_540", None, "local"),
        FitDeviceInventoryEntry(1, "polar_electro", "verity_sense", "heart_rate", "bluetooth"),
    )
    source_verity = _source_evidence_from_fit_devices(verity)
    assert source_verity.sensor_technology == "optical_armband"

    tickr_fit = (
        FitDeviceInventoryEntry(0, "garmin", "edge_540", None, "local"),
        FitDeviceInventoryEntry(1, "wahoo_fitness", "tickr_fit", "heart_rate", "bluetooth"),
    )
    source_tickr_fit = _source_evidence_from_fit_devices(tickr_fit)
    assert source_tickr_fit.sensor_technology == "optical_armband"


def test_edge_with_unidentified_external_sensor_fails_closed_to_ambiguous() -> None:
    # Finding 4 fix: An unidentified sensor on an Edge must NOT be marked confirmed
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, None, None, "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_conflicting_sensors_with_same_device_index_fails_closed() -> None:
    # Finding 2 fix: Conflicting sensor definitions on the same index must not be merged
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
        FitDeviceInventoryEntry(1, "garmin", "forerunner_965", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "external_unknown"


def test_adr_0031_option_a_alignment_trace_verified_strap_provenance() -> None:
    # Alignment test for amended ADR-0031 (Option A):
    # Single verified electrode chest strap on watch produces confirmed external provenance
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "external"
    assert source.provenance_confidence == "confirmed"
    assert source.sensor_technology == "electrode_chest_strap"


def _make_test_evidence(seconds: int = 120) -> FitActivityEvidence:
    start = datetime(2026, 9, 15, 10, 0)
    records = tuple(
        FitRecordSample(
            timestamp=start + timedelta(seconds=i),
            heart_rate_bpm=145.0,
            cadence_rpm=85.0,
            power_watts=200.0,
        )
        for i in range(seconds + 1)
    )
    events = (
        FitTimerEvent(start, "start"),
        FitTimerEvent(start + timedelta(seconds=seconds), "stop"),
    )
    return FitActivityEvidence(
        devices=(),
        records=records,
        average_heart_rate_bpm=145.0,
        lap_average_heart_rate_bpm=(145.0,),
        time_in_hr_zone_seconds=(0.0, 10.0, 100.0, 10.0, 0.0, 0.0, 0.0),
        timer_events=events,
    )


def test_end_to_end_edge_with_chest_strap_yields_high_confidence() -> None:
    # User Case 3: Edge 840 + HRM-600 / HRM-Pro on a road ride with clean trace
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    evidence = _make_test_evidence(120)
    result = assess_activity_hr_fidelity("road_biking", evidence, source)

    assert result.assessment_state == "ASSESSABLE"
    assert result.quality.measurement_confidence == "high"
    assert result.quality.signal_quality == "clean"
    assert "PROVENANCE_AMBIGUOUS" not in result.quality.reasons


def test_end_to_end_watch_with_chest_strap_yields_high_confidence() -> None:
    # User Case 2: Forerunner 965 + HRM-Pro on clean trace
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    evidence = _make_test_evidence(120)
    result = assess_activity_hr_fidelity("running", evidence, source)

    assert result.assessment_state == "ASSESSABLE"
    assert result.quality.measurement_confidence == "high"
    assert result.quality.signal_quality == "clean"


def test_end_to_end_edge_with_watch_broadcast_caps_at_moderate() -> None:
    # User Case 4: Edge 840 receiving broadcast HR from Forerunner watch
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "forerunner_965", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    evidence = _make_test_evidence(120)
    result = assess_activity_hr_fidelity("road_biking", evidence, source)

    assert result.assessment_state == "ASSESSABLE"
    assert result.quality.measurement_confidence == "moderate"
    assert result.quality.signal_quality == "clean"
    assert "PROVENANCE_AMBIGUOUS" not in result.quality.reasons


def test_trace_artifacts_downgrade_persisted_provenance_to_ambiguous() -> None:
    # Finding 1: If an artifact is detected, provisional confirmed provenance must fail closed
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.provenance_confidence == "confirmed"

    # Create evidence with an isolated spike artifact (145 bpm jumping to 215 bpm for 1 second)
    start = datetime(2026, 9, 15, 10, 0)
    records = []
    for i in range(121):
        hr = 215.0 if i == 60 else 145.0
        records.append(FitRecordSample(start + timedelta(seconds=i), hr, 85.0, 200.0))
    events = (
        FitTimerEvent(start, "start"),
        FitTimerEvent(start + timedelta(seconds=120), "stop"),
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=145.0,
        lap_average_heart_rate_bpm=(145.0,),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )

    result = assess_activity_hr_fidelity("running", evidence, source)
    assert result.quality.source.source_for_activity == "mixed_possible"
    assert result.quality.source.provenance_confidence == "ambiguous"
    assert "PROVENANCE_AMBIGUOUS" in result.quality.reasons
    assert result.quality.measurement_confidence == "low"
    assert "ISOLATED_SPIKE" in result.quality.artifact_flags


def test_unindexed_identical_external_sensor_entries_fail_closed() -> None:
    # Finding 2: Two entries with device_index=None have no stable identifier and must not be merged
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(None, "garmin", "hrm_pro", "heart_rate", "antplus"),
        FitDeviceInventoryEntry(None, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"


def test_unapproved_manufacturer_with_chest_strap_product_text_remains_external_unknown() -> None:
    # Finding 3: Arbitrary product text without an approved manufacturer cannot unlock electrode_chest_strap
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(
            1, "custom_unapproved_mfg", "super_hrm_chest_strap", "heart_rate", "antplus"
        ),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.sensor_technology == "external_unknown"
    assert source.provenance_confidence == "ambiguous"


def test_malformed_inventory_with_conflicting_creators_fails_closed() -> None:
    # Residual risk: Two conflicting creator entries claiming device_index=0
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.provenance_confidence == "ambiguous"
    assert source.source_for_activity == "mixed_possible"


def test_manufacturer_name_must_be_exact_approved_enum() -> None:
    # Finding 2: Suffix/clone manufacturer names like not_polar, wahoo_clone, garmin_clone must be rejected
    for clone_mfg in ("not_polar", "wahoo_clone", "garmin_clone"):
        devices = (
            FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
            FitDeviceInventoryEntry(1, clone_mfg, "hrm_pro", "heart_rate", "antplus"),
        )
        source = _source_evidence_from_fit_devices(devices)
        assert source.sensor_technology == "external_unknown"
        assert source.provenance_confidence == "ambiguous"


def test_single_indexless_recognized_strap_fails_closed_to_ambiguous() -> None:
    # Finding 3: A single strap with device_index=None lacks stable sensor identity and must fail closed
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(None, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.provenance_confidence == "ambiguous"
    assert source.sensor_technology == "electrode_chest_strap"


def test_source_switch_signature_detected_and_downgrades_provenance() -> None:
    # Finding 1: An abrupt, persistent level shift during stable external workload triggers
    # SOURCE_SWITCH_POSSIBLE and downgrades provisional confirmed provenance to ambiguous.
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "edge_840", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.provenance_confidence == "confirmed"

    # Create a 120s ride with stable power (200W) and stable cadence (85rpm)
    # At t=60s, HR steps abruptly from 135 bpm to 175 bpm (+40 bpm shift, persistent)
    start = datetime(2026, 9, 15, 10, 0)
    records = []
    for i in range(121):
        hr = 135.0 if i < 60 else 175.0
        records.append(
            FitRecordSample(
                timestamp=start + timedelta(seconds=i),
                heart_rate_bpm=hr,
                cadence_rpm=85.0,
                power_watts=200.0,
            )
        )
    events = (
        FitTimerEvent(start, "start"),
        FitTimerEvent(start + timedelta(seconds=120), "stop"),
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=155.0,
        lap_average_heart_rate_bpm=(155.0,),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )

    result = assess_activity_hr_fidelity("road_biking", evidence, source)
    assert "SOURCE_SWITCH_POSSIBLE" in result.quality.artifact_flags
    assert result.quality.source.source_for_activity == "mixed_possible"
    assert result.quality.source.provenance_confidence == "ambiguous"
    assert "PROVENANCE_AMBIGUOUS" in result.quality.reasons
    assert result.quality.measurement_confidence in {"low", "moderate"}


def test_running_cadence_only_source_switch_detected_and_downgrades_provenance() -> None:
    # Finding 1: Running activity without power meter, but with stable cadence.
    # Abrupt HR jump triggers SOURCE_SWITCH_POSSIBLE and downgrades provisional confirmed provenance.
    devices = (
        FitDeviceInventoryEntry(0, "garmin", "forerunner_965", None, "local"),
        FitDeviceInventoryEntry(1, "garmin", "hrm_pro", "heart_rate", "antplus"),
    )
    source = _source_evidence_from_fit_devices(devices)
    assert source.provenance_confidence == "confirmed"

    start = datetime(2026, 9, 15, 7, 0)
    records = []
    for i in range(121):
        hr = 135.0 if i < 60 else 175.0
        records.append(
            FitRecordSample(
                timestamp=start + timedelta(seconds=i),
                heart_rate_bpm=hr,
                cadence_rpm=170.0,
                power_watts=None,
            )
        )
    events = (
        FitTimerEvent(start, "start"),
        FitTimerEvent(start + timedelta(seconds=120), "stop"),
    )
    evidence = FitActivityEvidence(
        devices=(),
        records=tuple(records),
        average_heart_rate_bpm=155.0,
        lap_average_heart_rate_bpm=(155.0,),
        time_in_hr_zone_seconds=(),
        timer_events=events,
    )

    result = assess_activity_hr_fidelity("running", evidence, source)
    assert "SOURCE_SWITCH_POSSIBLE" in result.quality.artifact_flags
    assert result.quality.source.source_for_activity == "mixed_possible"
    assert result.quality.source.provenance_confidence == "ambiguous"
    assert "PROVENANCE_AMBIGUOUS" in result.quality.reasons
    assert result.quality.measurement_confidence in {"low", "moderate"}
