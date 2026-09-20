"""Tests for nutrition and energy expenditure ingestion (ADR-0042)."""

from unittest.mock import MagicMock

import pytest

from garmin_sync.canonical import (
    CanonicalDailyMetrics,
    CanonicalNutritionDay,
    NutritionSource,
)
from garmin_sync.config import Settings
from garmin_sync.firestore_repository import FirestoreRecoveryRepository
from garmin_sync.garmin_client import GarminClientWrapper
from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    RawGarminTelemetry,
    canonicalize_from_raw,
)
from garmin_sync.mapper import build_snapshot_from_canonical
from garmin_sync.metrics import DerivedMetrics
from garmin_sync.models import NutritionDayDTO
from garmin_sync.provider import NutritionProvider, ProviderNutritionResult
from garmin_sync.service import GarminSyncService


def test_nutrition_source_validation() -> None:
    source = NutritionSource(provider="garmin", transport="garmin_connect", origin="myfitnesspal")
    assert source.provider == "garmin"
    assert source.transport == "garmin_connect"
    assert source.origin == "myfitnesspal"

    with pytest.raises(ValueError, match="non-empty provider"):
        NutritionSource(provider="", transport="garmin_connect")

    with pytest.raises(ValueError, match="non-empty transport"):
        NutritionSource(provider="garmin", transport="")


def test_canonical_nutrition_day_validation() -> None:
    source = NutritionSource(provider="garmin", transport="garmin_connect")
    day = CanonicalNutritionDay(
        logical_date="2026-09-19",
        source=source,
        energy_intake_kcal=2400.0,
        protein_g=None,
        carbohydrate_g=None,
        fat_g=None,
        has_intake_data=True,
        is_partial=False,
    )
    assert day.logical_date == "2026-09-19"
    assert day.energy_intake_kcal == 2400.0
    assert day.protein_g is None  # Missing must stay None, not 0!

    with pytest.raises(ValueError, match="valid YYYY-MM-DD logical_date"):
        CanonicalNutritionDay(logical_date="invalid-date", source=source)


def test_energy_expenditure_canonicalization() -> None:
    telemetry = RawGarminTelemetry(
        stats_today={
            "restingHeartRate": 52,
            "totalSteps": 8000,
            "activeKilocalories": 600.0,
            "bmrKilocalories": 1800.0,
            "totalKilocalories": 2400.0,
        },
        stats_fallback=None,
        sleep_today=None,
        sleep_fallback=None,
        hrv_today=None,
    )
    canonical = canonicalize_from_raw(telemetry, "2026-09-19", "2026-09-18")
    assert canonical.active_energy_kcal == 600.0
    assert canonical.resting_energy_kcal == 1800.0
    assert canonical.total_energy_expenditure_kcal == 2400.0


def test_energy_expenditure_mapping_to_raw_metrics() -> None:
    canonical = CanonicalDailyMetrics(
        date="2026-09-19",
        active_energy_kcal=600.0,
        resting_energy_kcal=1800.0,
        total_energy_expenditure_kcal=2400.0,
    )
    derived = DerivedMetrics()
    snapshot = build_snapshot_from_canonical(
        user_id="user_123",
        target_date_iso="2026-09-19",
        canonical=canonical,
        canonical_activities=[],
        derived_metrics=derived,
    )
    assert snapshot.raw.activeEnergyKcal == 600.0
    assert snapshot.raw.restingEnergyKcal == 1800.0
    assert snapshot.raw.totalEnergyExpenditureKcal == 2400.0
    assert snapshot.source.metricDates.energyExpenditure == "2026-09-19"


def test_garmin_provider_adapter_fetch_daily_nutrition_from_cached_stats_only() -> None:
    mock_client = MagicMock(spec=GarminClientWrapper)
    mock_client.get_stats.return_value = {
        "calendarDate": "2026-09-19",
        "consumedKilocalories": 2400.0,
        "includesCalorieConsumedData": True,
        "netCalorieGoal": 2300,
    }
    adapter = GarminProviderAdapter(client=mock_client)
    assert isinstance(adapter, NutritionProvider)
    assert adapter.capabilities.nutrition is True
    assert adapter.capabilities.energy_expenditure is True

    result = adapter.fetch_daily_nutrition("2026-09-19")
    assert result is not None
    canonical = result.canonical
    assert canonical.logical_date == "2026-09-19"
    assert canonical.energy_intake_kcal == 2400.0
    assert canonical.has_intake_data is True
    assert canonical.protein_g is None  # Not provided by Garmin MFP bridge
    assert canonical.goal_energy_intake_kcal == 2300.0

    # Normal sync must not add one nutrition-service request per logged day.
    mock_client.get_nutrition_daily_food_log.assert_not_called()
    assert result.raw_payload == {
        "stats_consumed": 2400.0,
        "stats_includes_data": True,
        "stats_goal": 2300,
    }


def test_garmin_provider_adapter_fetch_daily_nutrition_unlogged() -> None:
    mock_client = MagicMock(spec=GarminClientWrapper)
    mock_client.get_stats.return_value = {
        "calendarDate": "2026-09-19",
        "consumedKilocalories": None,
        "includesCalorieConsumedData": False,
        "bmrKilocalories": 1800.0,
    }

    adapter = GarminProviderAdapter(client=mock_client)
    result = adapter.fetch_daily_nutrition("2026-09-19")
    assert result is not None
    canonical = result.canonical
    assert canonical.energy_intake_kcal is None
    assert canonical.has_intake_data is False
    assert canonical.protein_g is None


def test_garmin_provider_adapter_fetch_daily_nutrition_zero_kcal_logged() -> None:
    """A genuine 0-kcal logged day (e.g. a fasting day) must be distinguishable from an
    unlogged day: has_intake_data must stay True and energy_intake_kcal must be the real
    0.0, never coerced to or confused with None (ADR-0042 missingness semantics)."""
    mock_client = MagicMock(spec=GarminClientWrapper)
    mock_client.get_stats.return_value = {
        "calendarDate": "2026-09-19",
        "consumedKilocalories": 0.0,
        "includesCalorieConsumedData": True,
        "netCalorieGoal": 2300,
    }
    adapter = GarminProviderAdapter(client=mock_client)
    result = adapter.fetch_daily_nutrition("2026-09-19")
    assert result is not None
    canonical = result.canonical
    assert canonical.energy_intake_kcal == 0.0
    assert canonical.has_intake_data is True
    assert canonical.energy_intake_kcal is not None
    mock_client.get_nutrition_daily_food_log.assert_not_called()


def test_firestore_repository_nutrition_persistence() -> None:
    mock_db = MagicMock()
    # Exercise the deterministic non-transactional fallback. Production Firestore
    # uses the transactional branch.
    mock_db.transaction = None
    repo = FirestoreRecoveryRepository(user_id="user_test_123", db=mock_db)

    dto = NutritionDayDTO(
        userId="user_test_123",
        logicalDate="2026-09-19",
        provider="garmin",
        transport="garmin_connect",
        origin=None,
        energyIntakeKcal=2400.0,
        proteinG=None,
        hasIntakeData=True,
        isPartial=False,
    )

    doc_ref_mock = MagicMock()
    mock_doc_snap = MagicMock()
    mock_doc_snap.exists = False
    doc_ref_mock.get.return_value = mock_doc_snap

    mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value = doc_ref_mock

    changed, rev = repo.save_nutrition_day(dto)
    assert changed is True
    assert rev == 1
    assert dto.revision == 1
    assert dto.ingestedAt is not None
    doc_ref_mock.set.assert_called_once()

    first_payload = doc_ref_mock.set.call_args[0][0]
    assert first_payload["source"]["origin"] is None

    existing_doc = MagicMock()
    existing_doc.exists = True
    existing_doc.to_dict.return_value = first_payload
    doc_ref_mock.get.return_value = existing_doc

    replay = NutritionDayDTO(
        userId="user_test_123",
        logicalDate="2026-09-19",
        provider="garmin",
        transport="garmin_connect",
        origin=None,
        energyIntakeKcal=2400.0,
        proteinG=None,
        hasIntakeData=True,
        isPartial=False,
    )
    replay_changed, replay_rev = repo.save_nutrition_day(replay)
    assert replay_changed is False
    assert replay_rev == 1
    assert doc_ref_mock.set.call_count == 1

    updated = NutritionDayDTO(
        userId="user_test_123",
        logicalDate="2026-09-19",
        provider="garmin",
        transport="garmin_connect",
        origin=None,
        energyIntakeKcal=2450.0,
        proteinG=None,
        hasIntakeData=True,
        isPartial=False,
    )
    update_changed, update_rev = repo.save_nutrition_day(updated)
    assert update_changed is True
    assert update_rev == 2
    assert doc_ref_mock.set.call_count == 2


def test_sync_service_sync_daily_nutrition() -> None:
    settings = Settings(
        app_user_id="user_test_123",
        garmin_token_store="local",
        garmin_archive_enabled=False,
    )
    mock_repo = MagicMock()
    mock_provider = MagicMock()

    canonical = CanonicalNutritionDay(
        logical_date="2026-09-19",
        source=NutritionSource(provider="garmin", transport="garmin_connect"),
        energy_intake_kcal=2400.0,
        has_intake_data=True,
    )
    mock_provider.fetch_daily_nutrition.return_value = ProviderNutritionResult(
        canonical=canonical,
        raw_payload={"stats_consumed": 2400.0},
    )

    service = GarminSyncService(settings=settings, repository=mock_repo, provider=mock_provider)
    service._sync_daily_nutrition(mock_provider, "2026-09-19", "sync_run_1")

    mock_repo.save_nutrition_day.assert_called_once()
    saved_dto = mock_repo.save_nutrition_day.call_args[0][0]
    assert isinstance(saved_dto, NutritionDayDTO)
    assert saved_dto.energyIntakeKcal == 2400.0
    assert saved_dto.logicalDate == "2026-09-19"
    assert saved_dto.provider == "garmin"
    assert saved_dto.transport == "garmin_connect"


def test_probe_nutrition_cmd(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from garmin_sync.cli import run_probe_nutrition_cmd

    monkeypatch.setenv("APP_USER_ID", "test_user_probe")
    mock_wrapper = MagicMock()
    mock_adapter = MagicMock()
    mock_adapter.fetch_daily_nutrition.return_value = ProviderNutritionResult(
        canonical=CanonicalNutritionDay(
            logical_date="2026-09-19",
            source=NutritionSource(provider="garmin", transport="garmin_connect"),
            energy_intake_kcal=2500.0,
            has_intake_data=True,
        ),
        raw_payload={},
    )
    mock_adapter._get_stats.return_value = {
        "activeKilocalories": 500.0,
        "bmrKilocalories": 2000.0,
        "totalKilocalories": 2500.0,
    }

    monkeypatch.setattr("garmin_sync.garmin_client.GarminClientWrapper", lambda **kw: mock_wrapper)
    monkeypatch.setattr(
        "garmin_sync.garmin_provider.GarminProviderAdapter", lambda client: mock_adapter
    )

    code = run_probe_nutrition_cmd(["--date", "2026-09-19"])
    assert code == 0
    captured = capsys.readouterr()
    assert "authenticated" in captured.out
    assert "2500.0" in captured.out
    assert "macronutrientsAvailable" in captured.out
