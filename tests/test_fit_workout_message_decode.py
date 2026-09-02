from io import BytesIO
from unittest.mock import MagicMock, patch
from zipfile import ZipFile

import fitdecode

from garmin_sync.fit_activity import decode_activity_original
from garmin_sync.fit_workout_identity import compute_fit_workout_fingerprint

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


def _synthetic_original_zip() -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("synthetic.fit", b"not-a-real-fixture")
    return buffer.getvalue()


def _reader_with(messages: list[object]) -> MagicMock:
    reader = MagicMock()
    reader.__enter__.return_value = messages
    reader.__exit__.return_value = False
    return reader


def test_decodes_fit_standard_workout_definition_and_lap_step_linkage() -> None:
    messages = [
        FakeDataMessage("session", avg_heart_rate=150, workout_name="Session Alias"),
        FakeDataMessage("workout", wkt_name="VO2 Builder", num_valid_steps=2),
        FakeDataMessage(
            "workout_step",
            message_index=0,
            wkt_step_name="Work",
            duration_type="time",
            duration_value=240000,
            target_type="power",
            target_value=5,
            intensity="active",
            equipment="bike",
        ),
        FakeDataMessage(
            "workout_step",
            message_index=1,
            wkt_step_name="Recover",
            duration_type="time",
            duration_value=120000,
            target_type="open",
            target_value=0,
            intensity="rest",
            equipment="bike",
        ),
        FakeDataMessage("lap", workout_step_index=0),
        FakeDataMessage("lap", workout_step_index=1),
        FakeDataMessage("lap", workout_step_index=0),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert evidence.workout_name == "VO2 Builder"
    assert evidence.workout_step_indices == (0, 1)
    assert len(evidence.workout_steps) == 2
    assert evidence.workout_steps[0].message_index == 0
    assert evidence.workout_steps[0].duration_value == 240000.0
    assert evidence.workout_steps[0].target_type == "power"
    assert evidence.workout_steps[1].intensity == "rest"
    assert evidence.workout_step_indices.workout_steps == evidence.workout_steps

    # The legacy two-argument service call must still consume the semantic definitions
    # attached by the decoder, rather than falling back to name + observed indexes.
    implicit = compute_fit_workout_fingerprint(evidence.workout_name, evidence.workout_step_indices)
    explicit = compute_fit_workout_fingerprint(
        evidence.workout_name,
        tuple(evidence.workout_step_indices),
        evidence.workout_steps,
    )
    assert implicit == explicit


def test_multiple_workout_messages_do_not_blend_definitions_into_one_semantic_identity() -> None:
    messages = [
        FakeDataMessage("workout", wkt_name="First"),
        FakeDataMessage("workout_step", message_index=0, duration_type="time", duration_value=60),
        FakeDataMessage("workout", wkt_name="Second"),
        FakeDataMessage("workout_step", message_index=0, duration_type="time", duration_value=120),
        FakeDataMessage("lap", workout_step_index=0),
    ]

    with patch(
        "garmin_sync.fit_activity.fitdecode.FitReader",
        return_value=_reader_with(messages),
    ):
        evidence = decode_activity_original(_synthetic_original_zip())

    assert evidence.workout_steps == ()
    assert evidence.workout_step_indices.workout_steps == ()
    # Observed step linkage remains available as a weaker fallback rather than producing
    # a false semantic definition from two invalidly-combined Workout messages.
    assert evidence.workout_step_indices == (0,)
