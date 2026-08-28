import re

from garmin_sync.audit import AuditReport, format_report


def assert_contains_match(pattern: str, text: str) -> None:
    assert re.search(pattern, text), f"Pattern '{pattern}' not found in:\n{text}"

def test_format_report_archiving_enabled() -> None:
    report = AuditReport(
        start_date="2023-10-01",
        end_date="2023-10-05",
        expected_dates=5,
        snapshots_present=5,
        missing_snapshots=[],
        sleep_available=4,
        hrv_available=3,
        rhr_available=5,
        spo2_available=2,
        skin_temp_available=1,
        activities_discovered=10,
        archiving_enabled=True,
        raw_payloads_archived=20,
        rebuildable_dates=4,
    )
    result = format_report(report)

    assert_contains_match(r"Garmin sync audit: 2023-10-01 -> 2023-10-05", result)
    assert_contains_match(r"Expected dates:\s+5", result)
    assert_contains_match(r"Snapshots present:\s+5", result)
    assert_contains_match(r"Missing snapshots:\s+0", result)
    assert_contains_match(r"Sleep available:\s+4", result)
    assert_contains_match(r"HRV available:\s+3", result)
    assert_contains_match(r"RHR available:\s+5", result)
    assert_contains_match(r"SpO2 available:\s+2", result)
    assert_contains_match(r"Skin temp available:\s+1", result)
    assert_contains_match(r"Activities discovered:\s+10", result)
    assert_contains_match(r"Raw payloads archived:\s+20", result)
    assert_contains_match(r"Rebuildable dates:\s+4", result)
    assert "Missing dates:" not in result

def test_format_report_archiving_disabled() -> None:
    report = AuditReport(
        start_date="2023-10-01",
        end_date="2023-10-05",
        expected_dates=5,
        snapshots_present=5,
        missing_snapshots=[],
        sleep_available=4,
        hrv_available=3,
        rhr_available=5,
        spo2_available=2,
        skin_temp_available=1,
        activities_discovered=10,
        archiving_enabled=False,
        raw_payloads_archived=0,
        rebuildable_dates=0,
    )
    result = format_report(report)

    assert_contains_match(r"Raw archive:\s+disabled \(GARMIN_ARCHIVE_ENABLED=false\)", result)
    assert "Raw payloads archived:" not in result
    assert "Rebuildable dates:" not in result

def test_format_report_few_missing_snapshots() -> None:
    report = AuditReport(
        start_date="2023-10-01",
        end_date="2023-10-05",
        expected_dates=5,
        snapshots_present=2,
        missing_snapshots=["2023-10-02", "2023-10-03", "2023-10-04"],
        sleep_available=0,
        hrv_available=0,
        rhr_available=0,
        spo2_available=0,
        skin_temp_available=0,
        activities_discovered=0,
        archiving_enabled=True,
        raw_payloads_archived=0,
        rebuildable_dates=0,
    )
    result = format_report(report)

    assert_contains_match(r"Missing snapshots:\s+3", result)
    assert "Missing dates: 2023-10-02, 2023-10-03, 2023-10-04" in result
    assert "more" not in result

def test_format_report_many_missing_snapshots() -> None:
    missing_dates = [f"2023-10-{i:02d}" for i in range(1, 16)] # 15 missing dates
    report = AuditReport(
        start_date="2023-10-01",
        end_date="2023-10-15",
        expected_dates=15,
        snapshots_present=0,
        missing_snapshots=missing_dates,
        sleep_available=0,
        hrv_available=0,
        rhr_available=0,
        spo2_available=0,
        skin_temp_available=0,
        activities_discovered=0,
        archiving_enabled=True,
        raw_payloads_archived=0,
        rebuildable_dates=0,
    )
    result = format_report(report)

    assert_contains_match(r"Missing snapshots:\s+15", result)
    preview = ", ".join(missing_dates[:10])
    assert f"Missing dates: {preview} (+5 more)" in result
