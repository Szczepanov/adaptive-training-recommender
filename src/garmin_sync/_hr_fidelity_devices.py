"""Device identification and HR source evidence reasoning for FIT activities."""

from fitdecode.profile import FIELD_TYPES

from .canonical import (
    CanonicalHrSourceEvidence,
    HrSensorTechnology,
)
from .fit_activity import FitDeviceInventoryEntry

# Authoritative Garmin ANT+ / BLE product IDs extracted dynamically from fitdecode's Garmin profile.
_gp = FIELD_TYPES.get("garmin_product")
if _gp and hasattr(_gp, "enum") and isinstance(_gp.enum, dict):
    _GARMIN_HRM_PRODUCT_IDS: frozenset[int] = frozenset(
        k
        for k, v in _gp.enum.items()
        if isinstance(v, str) and ("hrm" in v.lower() or "heart" in v.lower())
    )
    _GARMIN_EDGE_PRODUCT_IDS: frozenset[int] = frozenset(
        k for k, v in _gp.enum.items() if isinstance(v, str) and "edge" in v.lower()
    )
else:
    # Static fallback if profile is unavailable
    _GARMIN_HRM_PRODUCT_IDS = frozenset(
        {1, 5, 7, 8, 12, 13, 22, 1743, 1752, 2327, 3299, 3300, 4130, 4446, 4606}
    )
    _GARMIN_EDGE_PRODUCT_IDS = frozenset(
        {
            1036,
            1169,
            1561,
            1567,
            1836,
            2067,
            2530,
            2713,
            2909,
            3011,
            3112,
            3121,
            3122,
            3558,
            3570,
            3843,
            4061,
            4062,
            4169,
            4440,
        }
    )

_CHEST_STRAP_NAME_SUBSTRINGS: tuple[str, ...] = (
    "hrm",
    "chest",
    "strap",
    "h10",
    "h9",
    "h7",
    "tickr",
)

_CYCLING_HEAD_UNIT_NAME_SUBSTRINGS: tuple[str, ...] = (
    "edge",
    "elemnt",
    "karoo",
    "bolt",
    "roam",
)

_WATCH_NAME_SUBSTRINGS: tuple[str, ...] = (
    "forerunner",
    "fenix",
    "epix",
    "venu",
    "vivoactive",
    "vivosmart",
    "enduro",
    "marq",
    "tactix",
    "descent",
    "instinct",
    "approach",
    "lily",
    "fr_",
    "watch",
)

# Known manufacturer IDs
_MFG_GARMIN = 1
_MFG_DYNASTREAM = 15
_MFG_WAHOO = 32
_MFG_POLAR = 123


def _matches_substring(value: str | int | None, substrings: tuple[str, ...]) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.strip().lower()
    return any(sub in normalized for sub in substrings)


def _matches_manufacturer(
    mfg: str | int | None, expected_ids: tuple[int, ...], expected_names: tuple[str, ...]
) -> bool:
    if isinstance(mfg, int) and mfg in expected_ids:
        return True
    if isinstance(mfg, str):
        normalized = mfg.strip().lower()
        return normalized in expected_names
    return False


def is_cycling_head_unit(device: FitDeviceInventoryEntry | None) -> bool:
    """Return True if the device is a cycling computer without optical HR sensors."""
    if device is None:
        return False
    if isinstance(device.product, int) and device.product in _GARMIN_EDGE_PRODUCT_IDS:
        return True
    return _matches_substring(device.product, _CYCLING_HEAD_UNIT_NAME_SUBSTRINGS)


def is_watch_device(device: FitDeviceInventoryEntry | None) -> bool:
    """Return True if the device is a wearable watch equipped with optical wrist PPG."""
    if device is None:
        return False
    return _matches_substring(device.product, _WATCH_NAME_SUBSTRINGS)


def classify_hr_sensor_technology(
    device: FitDeviceInventoryEntry,
) -> HrSensorTechnology:
    """Classify the physical sensing technology of a decoded HR device entry."""
    product = device.product
    mfg = device.manufacturer

    # 1. Check if the device is a watch broadcasting HR (e.g. to an Edge)
    if is_watch_device(device):
        return "wrist_ppg"

    # 2. Check for Garmin / Dynastream electrode chest straps (requires approved Garmin/Dynastream mfg)
    is_garmin_or_dynastream = _matches_manufacturer(
        mfg, (_MFG_GARMIN, _MFG_DYNASTREAM), ("garmin", "dynastream")
    )
    if is_garmin_or_dynastream:
        if isinstance(product, int) and product in _GARMIN_HRM_PRODUCT_IDS:
            return "electrode_chest_strap"
        if _matches_substring(product, _CHEST_STRAP_NAME_SUBSTRINGS):
            return "electrode_chest_strap"

    # 3. Check for Polar chest straps / armbands (requires approved Polar mfg 123)
    if _matches_manufacturer(mfg, (_MFG_POLAR,), ("polar", "polar_electro")):
        if _matches_substring(product, ("verity", "oh1", "armband")):
            return "optical_armband"
        if _matches_substring(product, _CHEST_STRAP_NAME_SUBSTRINGS) or product is None:
            return "electrode_chest_strap"

    # 4. Check for Wahoo TICKR straps / armbands (requires approved Wahoo mfg 32)
    if _matches_manufacturer(mfg, (_MFG_WAHOO,), ("wahoo", "wahoo_fitness")):
        if _matches_substring(product, ("fit", "armband")):
            return "optical_armband"
        if _matches_substring(product, _CHEST_STRAP_NAME_SUBSTRINGS) or product is None:
            return "electrode_chest_strap"

    # Finding 3: Do NOT classify arbitrary text as a verified chest strap without an approved manufacturer!
    return "external_unknown"


def source_evidence_from_fit_devices(
    devices: tuple[FitDeviceInventoryEntry, ...],
) -> CanonicalHrSourceEvidence:
    """Derive source, provenance, and sensor technology from FIT device inventory per ADR-0031.

    Handles 5 canonical scenarios:
    1. Watch only: no external HR sensor -> wrist PPG (inferred).
    2. Watch + Chest strap: single verified electrode chest strap present -> confirmed external (Option A).
    3. Cycling head unit (Edge) + Chest strap: head unit has no optical HR -> confirmed external.
    4. Cycling head unit (Edge) + Watch broadcast: external sensor is a watch -> confirmed external wrist PPG.
    5. Standalone chest strap (TrueUp / offline): recorder is strap -> confirmed external.
    Fallback / Multiple competing external sensors: fail closed to mixed_possible, ambiguous.
    """
    if not devices:
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=None,
            source_for_activity="unknown",
            provenance_confidence="unknown",
            sensor_technology="unknown",
        )

    # External HR accessories have device_type in {'heart_rate', 'heart_rate_monitor'}
    # and are not the primary recording unit when multiple devices exist.
    external_hr_devices: list[FitDeviceInventoryEntry] = []
    for d in devices:
        is_hr_sensor = isinstance(d.device_type, str) and d.device_type.strip().lower() in {
            "heart_rate",
            "heart_rate_monitor",
        }
        if not is_hr_sensor:
            continue
        # If multiple devices are present, the primary recorder is not an external accessory
        if (
            len(devices) > 1
            and (d.device_index == 0 or d.source_type == "local")
            and not _matches_substring(d.product, _CHEST_STRAP_NAME_SUBSTRINGS)
        ):
            continue
        external_hr_devices.append(d)

    # Identify primary recording unit (creator)
    creator_candidates = [d for d in devices if d.device_index == 0 or d.source_type == "local"]
    if len(creator_candidates) > 1:
        # Check for malformed inventory with conflicting recording unit identities
        creator_signatures = {
            (d.manufacturer, d.product)
            for d in creator_candidates
            if not _matches_substring(d.product, _CHEST_STRAP_NAME_SUBSTRINGS)
        }
        if len(creator_signatures) > 1:
            # Conflicting creator signatures; fail closed to ambiguous provenance
            return CanonicalHrSourceEvidence(
                external_hr_sensor_present=True if external_hr_devices else None,
                source_for_activity="mixed_possible" if external_hr_devices else "unknown",
                provenance_confidence="ambiguous",
                sensor_technology="external_unknown" if external_hr_devices else "unknown",
            )
    recorder = creator_candidates[0] if creator_candidates else devices[0]

    # Scenario 1: No external HR sensor found
    if not external_hr_devices:
        if is_watch_device(recorder):
            return CanonicalHrSourceEvidence(
                external_hr_sensor_present=False,
                source_for_activity="wrist",
                provenance_confidence="inferred",
                sensor_technology="wrist_ppg",
            )
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=None,
            source_for_activity="unknown",
            provenance_confidence="unknown",
            sensor_technology="unknown",
        )

    # Finding 2: Deduplicate ONLY indexed entries with matching metadata.
    # Entries with device_index=None lack a stable identifier; multiple indexless entries
    # cannot be collapsed and must be treated as distinct/competing sensors.
    distinct_external: list[FitDeviceInventoryEntry] = []
    seen_indexed_signatures: dict[int, tuple[object, ...]] = {}

    for d in external_hr_devices:
        if d.device_index is not None:
            sig = (d.manufacturer, d.product, d.device_type, d.source_type)
            if d.device_index not in seen_indexed_signatures:
                seen_indexed_signatures[d.device_index] = sig
                distinct_external.append(d)
            elif seen_indexed_signatures[d.device_index] != sig:
                # Same device_index has conflicting definitions; preserve both to fail closed
                distinct_external.append(d)
        else:
            # Unindexed entry; cannot assume it is identical to any other entry
            distinct_external.append(d)

    # If multiple distinct external HR devices are present, we cannot know which sensor
    # was selected without sample-level attribution; fail closed to ambiguous provenance.
    if len(distinct_external) > 1:
        techs = {classify_hr_sensor_technology(d) for d in distinct_external}
        multi_tech: HrSensorTechnology = (
            "electrode_chest_strap" if techs == {"electrode_chest_strap"} else "external_unknown"
        )
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=True,
            source_for_activity="mixed_possible",
            provenance_confidence="ambiguous",
            sensor_technology=multi_tech,
        )

    # Single distinct external HR sensor
    external_sensor = distinct_external[0]
    tech = classify_hr_sensor_technology(external_sensor)

    # Finding 3: A stable sensor identity (integer device_index) is required for confirmed provenance
    if external_sensor.device_index is None:
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=True,
            source_for_activity="mixed_possible",
            provenance_confidence="ambiguous",
            sensor_technology=tech,
        )

    # Scenario 4: External HR sensor is actually a watch broadcasting optical HR
    if tech == "wrist_ppg":
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=True,
            source_for_activity="external",
            provenance_confidence="confirmed",
            sensor_technology="wrist_ppg",
        )

    # Scenario 3: Head unit (Garmin Edge) + Chest strap
    # Cycling head units have no optical HR sensor; source switching is physically impossible.
    if is_cycling_head_unit(recorder):
        if tech == "electrode_chest_strap":
            return CanonicalHrSourceEvidence(
                external_hr_sensor_present=True,
                source_for_activity="external",
                provenance_confidence="confirmed",
                sensor_technology="electrode_chest_strap",
            )
        # Head unit with unidentified external HR sensor fails closed to ambiguous
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=True,
            source_for_activity="mixed_possible",
            provenance_confidence="ambiguous",
            sensor_technology=tech,
        )

    # Scenario 2 & 5: Watch or Standalone + Electrode Chest Strap
    if tech == "electrode_chest_strap":
        return CanonicalHrSourceEvidence(
            external_hr_sensor_present=True,
            source_for_activity="external",
            provenance_confidence="confirmed",
            sensor_technology="electrode_chest_strap",
        )

    # Fallback: Unidentified external HR device (e.g. unknown product/manufacturer)
    # Retain conservative ambiguous provenance per ADR-0031
    return CanonicalHrSourceEvidence(
        external_hr_sensor_present=True,
        source_for_activity="mixed_possible",
        provenance_confidence="ambiguous",
        sensor_technology="external_unknown",
    )
