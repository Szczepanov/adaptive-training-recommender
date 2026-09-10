from typing import Any

from garmin_sync.account_link import GarminConnectionRepository


class _Snapshot:
    def __init__(self, doc_id: str, data: dict[str, Any]) -> None:
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict[str, Any]:
        return dict(self._data)


class _Query:
    def __init__(self, documents: dict[str, dict[str, Any]]) -> None:
        self._documents = documents
        self.filter: Any = None

    def where(self, *, filter: Any) -> "_Query":
        self.filter = filter
        return self

    def stream(self) -> list[_Snapshot]:
        assert self.filter is not None
        assert self.filter.field_path == "status"
        assert self.filter.op_string == "=="
        assert self.filter.value == "active"
        return [
            _Snapshot(doc_id, data)
            for doc_id, data in self._documents.items()
            if data.get("status") == "active"
        ]


class _Db:
    def __init__(self, documents: dict[str, dict[str, Any]]) -> None:
        self.documents = documents
        self.last_query: _Query | None = None

    def collection(self, name: str) -> _Query:
        assert name == "garminConnections"
        self.last_query = _Query(self.documents)
        return self.last_query


def test_list_active_connections_filters_at_query_and_preserves_token_object() -> None:
    db = _Db(
        {
            "user-active-1": {
                "userId": "user-active-1",
                "status": "active",
                "tokenObject": "garmin/users/user-active-1/tokens.json",
            },
            "user-inactive": {
                "userId": "user-inactive",
                "status": "inactive",
                "tokenObject": "garmin/users/user-inactive/tokens.json",
            },
            "user-active-2": {
                "status": "active",
                "tokenObject": "garmin/users/user-active-2/tokens.json",
            },
        }
    )

    repository = GarminConnectionRepository(db=db)

    assert repository.list_active_connections() == [
        ("user-active-1", "garmin/users/user-active-1/tokens.json"),
        ("user-active-2", "garmin/users/user-active-2/tokens.json"),
    ]
    assert db.last_query is not None
    assert db.last_query.filter is not None
    assert db.last_query.filter.field_path == "status"
