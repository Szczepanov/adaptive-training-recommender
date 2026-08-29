"""Timer-window, sampling, and coverage primitives for HRF3."""

from __future__ import annotations

from datetime import datetime
from statistics import median
from typing import TYPE_CHECKING

from .fit_activity import FitActivityEvidence, FitRecordSample

if TYPE_CHECKING:
    from .hr_fidelity import HrFidelityPolicy


def timestamped_records(records: tuple[FitRecordSample, ...]) -> list[FitRecordSample]:
    return sorted(
        (record for record in records if record.timestamp is not None),
        key=record_timestamp,
    )


def unique_timestamp_count(records: list[FitRecordSample]) -> int:
    return len({record_timestamp(record) for record in records})


def analysis_windows(
    records: list[FitRecordSample], evidence: FitActivityEvidence
) -> tuple[tuple[tuple[datetime, datetime], ...], bool]:
    """Reconstruct active timer windows without treating malformed topology as complete."""
    first = record_timestamp(records[0])
    last = record_timestamp(records[-1])
    timer_events = sorted(
        (event for event in evidence.timer_events if event.timestamp is not None),
        key=_event_timestamp,
    )
    if not timer_events:
        return ((first, last),), False

    windows: list[tuple[datetime, datetime]] = []
    active_start: datetime | None = None
    topology_complete = True
    has_opening_start = False
    has_terminal_stop = False

    for event in timer_events:
        timestamp = _event_timestamp(event)
        if _is_timer_start(event.event_type):
            if active_start is not None:
                topology_complete = False
                continue
            active_start = timestamp
            if not windows and timestamp <= first:
                has_opening_start = True
            continue

        if not _is_timer_stop(event.event_type):
            # This collection only contains FIT timer events. An unknown transition
            # may change active state, so ignorance reduces assessability.
            topology_complete = False
            continue

        if active_start is None:
            # Preserve an inferable leading active segment, but never call it complete.
            if not windows and timestamp > first:
                windows.append((first, timestamp))
            topology_complete = False
        elif timestamp > active_start:
            windows.append((active_start, timestamp))
            active_start = None
        else:
            topology_complete = False
            active_start = None

        if timestamp >= last:
            has_terminal_stop = True

    if active_start is not None:
        if last > active_start:
            windows.append((active_start, last))
        topology_complete = False

    # FIT best practice permits start before the first Record and stop after the last.
    clamped = _clamp_and_merge_windows(windows, first, last)
    if not clamped:
        return ((first, last),), False
    complete = topology_complete and has_opening_start and has_terminal_stop
    return clamped, complete


def window_duration(windows: tuple[tuple[datetime, datetime], ...]) -> float:
    return sum(max(0.0, (end - start).total_seconds()) for start, end in windows)


def in_windows(
    timestamp: datetime | None,
    windows: tuple[tuple[datetime, datetime], ...],
) -> bool:
    return timestamp is not None and any(start <= timestamp <= end for start, end in windows)


def record_timestamp(record: FitRecordSample) -> datetime:
    assert record.timestamp is not None
    return record.timestamp


def valid_hr(value: float | None) -> bool:
    return value is not None and 25.0 <= value <= 250.0


def sampling_profile(
    records: list[FitRecordSample],
    windows: tuple[tuple[datetime, datetime], ...],
    policy: HrFidelityPolicy,
) -> tuple[float | None, float | None]:
    intervals: list[float] = []
    for start, end in windows:
        timestamps = sorted(
            {
                record_timestamp(record)
                for record in records
                if in_windows(record.timestamp, ((start, end),))
            }
        )
        intervals.extend(_positive_intervals(timestamps))
    if not intervals:
        return None, None
    observed = float(median(intervals))
    if observed <= 0:
        return None, None
    # Smart Recording may be intentionally irregular, so this is descriptive only.
    irregular = sum(
        abs(interval - observed) / observed > policy.sampling_irregularity_tolerance_ratio
        for interval in intervals
    )
    return observed, (irregular / len(intervals)) * 100.0


def coverage(
    records: list[FitRecordSample],
    valid: list[FitRecordSample],
    windows: tuple[tuple[datetime, datetime], ...],
    sample_interval: float | None,
    policy: HrFidelityPolicy,
) -> tuple[float, float, int]:
    """Measure HR availability over the FIT Record surface, not an invented grid.

    FIT permits regular 1/5/10/30-second recording and irregular Smart Recording.
    Coverage is the fraction of unique active Record timestamps containing valid HR;
    time gaps remain an independent diagnostic compared with observed record cadence.
    """
    active_timestamps: set[datetime] = set()
    valid_timestamps: set[datetime] = set()
    gaps: list[float] = []
    dropout_count = 0

    for start, end in windows:
        record_times = _times_in_window(records, start, end)
        valid_times = _times_in_window(valid, start, end)
        active_timestamps.update(record_times)
        valid_timestamps.update(valid_times)

        window_interval = _median_time_interval(record_times)
        reference_interval = min(
            window_interval or sample_interval or 1.0,
            policy.max_expected_sample_interval_seconds,
        )
        threshold = max(policy.dropout_gap_seconds, reference_interval * 5.0)

        if not valid_times:
            if end > start:
                duration = (end - start).total_seconds()
                gaps.append(duration)
                dropout_count += int(duration > threshold)
            continue

        window_gaps = [max(0.0, (valid_times[0] - start).total_seconds())]
        window_gaps.extend(_positive_intervals(valid_times))
        window_gaps.append(max(0.0, (end - valid_times[-1]).total_seconds()))
        gaps.extend(window_gaps)
        dropout_count += sum(gap > threshold for gap in window_gaps)

    sample_coverage = min(
        100.0,
        (len(valid_timestamps) / max(1, len(active_timestamps))) * 100.0,
    )
    return sample_coverage, max(gaps, default=0.0), dropout_count


def _times_in_window(
    records: list[FitRecordSample], start: datetime, end: datetime
) -> list[datetime]:
    return sorted(
        {
            record_timestamp(record)
            for record in records
            if in_windows(record.timestamp, ((start, end),))
        }
    )


def _positive_intervals(timestamps: list[datetime]) -> list[float]:
    return [
        (later - earlier).total_seconds()
        for earlier, later in zip(timestamps, timestamps[1:], strict=False)
        if later > earlier
    ]


def _median_time_interval(timestamps: list[datetime]) -> float | None:
    intervals = _positive_intervals(timestamps)
    return float(median(intervals)) if intervals else None


def _event_timestamp(event: object) -> datetime:
    timestamp = getattr(event, "timestamp", None)
    assert isinstance(timestamp, datetime)
    return timestamp


def _is_timer_start(event_type: str | int | None) -> bool:
    if isinstance(event_type, str):
        return event_type.lower() in {"start", "resume"}
    return event_type == 0


def _is_timer_stop(event_type: str | int | None) -> bool:
    if isinstance(event_type, str):
        return event_type.lower() in {
            "stop",
            "stop_all",
            "stop_disable",
            "stop_disable_all",
        }
    return event_type in {1, 4, 8, 9}


def _clamp_and_merge_windows(
    windows: list[tuple[datetime, datetime]], first: datetime, last: datetime
) -> tuple[tuple[datetime, datetime], ...]:
    clamped = sorted(
        (
            (max(start, first), min(end, last))
            for start, end in windows
            if min(end, last) > max(start, first)
        ),
        key=lambda window: window[0],
    )
    merged: list[tuple[datetime, datetime]] = []
    for start, end in clamped:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
            continue
        previous_start, previous_end = merged[-1]
        merged[-1] = (previous_start, max(previous_end, end))
    return tuple(merged)
