from typing import Any
from unittest.mock import MagicMock

from garmin_sync.firestore_repository import FirestoreRecoveryRepository


class _Document:
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        return self.data


class _PagedQuery:
    def __init__(self, pages: list[list[_Document]]) -> None:
        self.pages = pages
        self.page_index = 0
        self.limit_values: list[int] = []
        self.start_after_documents: list[_Document] = []

    def where(self, **_: Any) -> "_PagedQuery":
        return self

    def limit(self, value: int) -> "_PagedQuery":
        self.limit_values.append(value)
        return self

    def start_after(self, document: _Document) -> "_PagedQuery":
        self.start_after_documents.append(document)
        return self

    def stream(self) -> list[_Document]:
        page = self.pages[self.page_index]
        self.page_index += 1
        return page


def test_get_health_observation_bundles_in_range_paginates_at_query_boundary() -> None:
    first_page = [
        _Document(
            {
                "logicalDate": f"2026-08-{(index % 28) + 1:02d}",
                "provider": "garmin",
                "transport": "google_health",
            }
        )
        for index in range(500)
    ]
    second_page = [
        _Document(
            {
                "logicalDate": "2026-09-01",
                "provider": "garmin",
                "transport": "google_health",
            }
        )
    ]
    query = _PagedQuery([first_page, second_page, []])

    collection = MagicMock()
    collection.where.return_value = query
    db = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value = collection

    repository = FirestoreRecoveryRepository(user_id="test_uid", db=db)

    result = repository.get_health_observation_bundles_in_range(
        "2026-08-01", "2026-09-30", provider="garmin", transport="google_health"
    )

    assert len(result) == 501
    assert result[-1]["logicalDate"] == "2026-09-01"
    assert query.limit_values == [500, 500]
    assert query.start_after_documents == [first_page[-1]]
