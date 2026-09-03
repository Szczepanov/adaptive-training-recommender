from datetime import datetime, timedelta

from garmin_sync._hr_fidelity_detectors import workload_flags
from garmin_sync.fit_activity import FitRecordSample
from garmin_sync.hr_fidelity import DEFAULT_HR_FIDELITY_POLICY

_START = datetime(2026, 8, 29, 8, 0)


def _records(
    seconds: list[int],
    *,
    hr: float = 140,
    cadence: float | None = None,
    power: float | None = None,
) -> list[FitRecordSample]:
    return [
        FitRecordSample(
            timestamp=_START + timedelta(seconds=second),
            heart_rate_bpm=hr,
            cadence_rpm=cadence,
            power_watts=power,
        )
        for second in seconds
    ]


def test_workload_flags_too_few_records() -> None:
    assert workload_flags(_records([0]), DEFAULT_HR_FIDELITY_POLICY) == set()


def test_workload_flags_short_duration() -> None:
    assert workload_flags(_records([0, 179]), DEFAULT_HR_FIDELITY_POLICY) == set()


def test_workload_flags_stale_plateau() -> None:
    records = []
    for i in range(181):
        hr = 140.0
        if i < 60:
            power = 100.0
        elif i < 120:
            power = 100.0
        else:
            power = 250.0

        records.append(
            FitRecordSample(
                timestamp=_START + timedelta(seconds=i),
                heart_rate_bpm=hr,
                power_watts=power,
                cadence_rpm=None,
            )
        )

    flags = workload_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert flags == {"STALE_PLATEAU", "WORKLOAD_DISCORDANCE"}


def test_workload_flags_no_stale_plateau() -> None:
    records = []
    for i in range(181):
        records.append(
            FitRecordSample(
                timestamp=_START + timedelta(seconds=i),
                heart_rate_bpm=140.0,
                power_watts=100.0,
                cadence_rpm=None,
            )
        )

    flags = workload_flags(records, DEFAULT_HR_FIDELITY_POLICY)
    assert flags == set()
