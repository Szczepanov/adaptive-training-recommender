from datetime import datetime
from io import BytesIO
from unittest.mock import MagicMock, patch
from zipfile import ZipFile

import fitdecode
import pytest

from garmin_sync.fit_activity import FitActivityDecodeError, decode_activity_original

_MISSING = object()


class FakeDataMessage:
    frame_type = fitdecode.FIT_FRAME_DATA

    def __init__(self, name: str, **values: object):
        self.name = name
        self.values = values

    def get_value(self, name: str, *, fallback: object = _MISSING) -> object | None:
        if name in self.values:
            return self.values[name]
        if fallback is _MISSING:
            raise KeyError(name)
        return fallback


class FakeDefinitionMessage:
    frame_type = fitdecode.FIT_FRAME_DEFINITION

    def __init__(self, name: str):
        self.name = name


def _synthetic_original_zip() -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("synthetic.fit", b"not-a-real-fixture")
    return buffer.getvalue()


def _reader_with(messages: list[object]) -> MagicMock:
    reader = MagicMock()
    reader.__enter__.return_value = messages
    return reader


def test_decode_activity_original_extracts_only_compact_evidence_from_zip():
    messages = [
        FakeDefinitionMessage("device_info"),
        FakeDataMessage(
            "device_info",
            device_index=1,
            manufacturer="garmin",
            product=123,
            device_type="heart_rate",
            source_type="antplus",
        ),
        FakeDefinitionMessage("record"),
        FakeDataMessage(
            "event",
            timestamp=datetime(2026, 1, 1, 9, 59),
            event="timer",
            event_type="start",
        ),
        FakeDataMessage(
            "record",
            timestamp=datetime(2026, 1, 1, 10, 0),
            heart_rate=151,
            cadence=82,
            power=217,
        ),
        FakeDataMessage(
            "session",
            avg_heart_rate=148,
            time_in_hr_zone=(0, 15, 120, 60, 30, 5, 0),
        ),
        FakeDataMessage("lap", avg_heart_rate=150),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert len(evidence.devices) == 1
    assert evidence.devices[0].device_index == 1
    assert len(evidence.records) == 1
    assert evidence.records[0].heart_rate_bpm == 151.0
    assert evidence.average_heart_rate_bpm == 148.0
    assert evidence.lap_average_heart_rate_bpm == (150.0,)
    assert evidence.time_in_hr_zone_seconds == (0.0, 15.0, 120.0, 60.0, 30.0, 5.0, 0.0)
    assert len(evidence.timer_events) == 1
    assert evidence.timer_events[0].event_type == "start"


def test_decode_activity_original_tolerates_missing_optional_fit_fields():
    messages = [
        FakeDataMessage("device_info", device_index=1, device_type="heart_rate"),
        FakeDataMessage(
            "record",
            timestamp=datetime(2026, 1, 1, 10, 0),
            heart_rate=151,
        ),
        FakeDataMessage("session", avg_heart_rate=148),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert evidence.devices[0].manufacturer is None
    assert evidence.devices[0].source_type is None
    assert evidence.records[0].cadence_rpm is None
    assert evidence.records[0].power_watts is None


def test_decode_activity_original_uses_only_session_scoped_time_in_zone_fallback():
    messages = [
        FakeDataMessage("session", avg_heart_rate=148),
        FakeDataMessage(
            "time_in_zone",
            reference_mesg="lap",
            reference_index=0,
            time_in_hr_zone=(1, 2, 3),
        ),
        FakeDataMessage(
            "time_in_zone",
            reference_mesg="session",
            reference_index=0,
            time_in_hr_zone=(10, 20, 30, 40, 50),
        ),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert evidence.time_in_hr_zone_seconds == (10.0, 20.0, 30.0, 40.0, 50.0)


def test_decode_activity_original_ignores_non_timer_events():
    messages = [
        FakeDataMessage(
            "event",
            timestamp=datetime(2026, 1, 1, 10, 0),
            event="lap",
            event_type="stop",
        ),
        FakeDataMessage(
            "event",
            timestamp=datetime(2026, 1, 1, 10, 1),
            event=0,
            event_type="stop_all",
        ),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert len(evidence.timer_events) == 1
    assert evidence.timer_events[0].event_type == "stop_all"


@pytest.mark.parametrize("original", [b"", b"not-a-fit-or-zip"])
def test_decode_activity_original_rejects_unknown_containers(original: bytes):
    with pytest.raises(FitActivityDecodeError):
        decode_activity_original(original)


def test_decode_activity_original_rejects_zip_with_extra_or_non_fit_members():
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("one.fit", b"x")
        archive.writestr("extra.txt", b"x")

    with pytest.raises(FitActivityDecodeError, match="exactly one FIT"):
        decode_activity_original(buffer.getvalue())


def test_decode_activity_original_discards_partial_messages_after_decoder_error():
    reader = MagicMock()
    reader.__enter__.return_value = iter([FakeDataMessage("record", heart_rate=150)])
    reader.__exit__.side_effect = ValueError("crc failure")

    with patch("garmin_sync.fit_activity.fitdecode.FitReader", return_value=reader):
        with pytest.raises(FitActivityDecodeError, match="could not be decoded safely"):
            decode_activity_original(_synthetic_original_zip())


def test_decode_activity_original_caps_transient_record_growth():
    messages = [
        FakeDataMessage("record", heart_rate=150),
        FakeDataMessage("record", heart_rate=151),
    ]

    with (
        patch("garmin_sync.fit_activity._MAX_RECORD_SAMPLES", 1),
        patch(
            "garmin_sync.fit_activity.fitdecode.FitReader",
            return_value=_reader_with(messages),
        ),
    ):
        with pytest.raises(FitActivityDecodeError, match="record sample limit"):
            decode_activity_original(_synthetic_original_zip())
