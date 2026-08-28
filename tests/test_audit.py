from garmin_sync.audit import AuditReport, format_report

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

    assert "Garmin sync audit: 2023-10-01 -> 2023-10-05" in result
    assert "Expected dates:              5" in result
    assert "Snapshots present:           5" in result
    assert "Missing snapshots:           0" in result
    assert "Sleep available:             4" in result
    assert "HRV available:                3" in result
    assert "RHR available:                5" in result
    assert "SpO2 available:               2" in result
    assert "Skin temp available:          1" in result
    assert "Activities discovered:       10" in result
    assert "Raw payloads archived:        20" in result
    assert "Rebuildable dates:            4" in result
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

    assert "Raw archive:                  disabled (GARMIN_ARCHIVE_ENABLED=false)" in result
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

    assert "Missing snapshots:           3" in result
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

    assert "Missing snapshots:           15" in result
    preview = ", ".join(missing_dates[:10])
    assert f"Missing dates: {preview} (+5 more)" in result
