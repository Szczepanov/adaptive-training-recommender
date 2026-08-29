from datetime import datetime
from io import BytesIO
from unittest.mock import MagicMock, patch
from zipfile import ZipFile

import pytest

from garmin_sync.fit_activity import FitActivityDecodeError, decode_activity_original


class FakeMessage:
    def __init__(self, name: str, **values: object):
        self.name = name
        self.values = values

    def get_value(self, name: str) -> object | None:
        return self.values.get(name)


def _synthetic_original_zip() -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("synthetic.fit", b"not-a-real-fixture")
    return buffer.getvalue()


def test_decode_activity_original_extracts_only_compact_evidence_from_zip():
    messages = [
        FakeMessage(
            "device_info",
            device_index=1,
            manufacturer="garmin",
            product=123,
            device_type="heart_rate",
            source_type="antplus",
        ),
        FakeMessage(
            "record",
            timestamp=datetime(2026, 1, 1, 10, 0),
            heart_rate=151,
            cadence=82,
            power=217,
        ),
        FakeMessage("session", avg_heart_rate=148),
        FakeMessage("lap", avg_heart_rate=150),
        FakeMessage("time_in_zone", time_in_hr_zone=120),
    ]
    reader = MagicMock()
    reader.__enter__.return_value = messages

    with patch("garmin_sync.fit_activity.fitdecode.FitReader", return_value=reader):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert evidence.devices[0].device_index == 1
    assert evidence.records[0].heart_rate_bpm == 151.0
    assert evidence.average_heart_rate_bpm == 148.0
    assert evidence.lap_average_heart_rate_bpm == (150.0,)
    assert evidence.time_in_hr_zone_seconds == (120.0,)


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
    reader.__enter__.return_value = iter([FakeMessage("record", heart_rate=150)])
    reader.__exit__.side_effect = ValueError("crc failure")

    with patch("garmin_sync.fit_activity.fitdecode.FitReader", return_value=reader):
        with pytest.raises(FitActivityDecodeError, match="could not be decoded safely"):
            decode_activity_original(_synthetic_original_zip())
