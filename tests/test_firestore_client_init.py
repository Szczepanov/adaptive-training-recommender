from unittest.mock import MagicMock

from garmin_sync import firestore_repository


def test_init_firestore_client_uses_credentials_path_from_environment(
    monkeypatch, tmp_path,
):
    credential_file = tmp_path / "firebase-service-account.json"
    credential_file.write_text("{}", encoding="utf-8")

    fake_credentials = object()
    fake_client = object()
    certificate = MagicMock(return_value=fake_credentials)
    initialize_app = MagicMock()
    firestore_client = MagicMock(return_value=fake_client)

    monkeypatch.setattr(firestore_repository.firebase_admin, "_apps", {})
    monkeypatch.setattr(firestore_repository.credentials, "Certificate", certificate)
    monkeypatch.setattr(firestore_repository.firebase_admin, "initialize_app", initialize_app)
    monkeypatch.setattr(firestore_repository.firestore, "client", firestore_client)
    monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(credential_file))

    result = firestore_repository.init_firestore_client()

    assert result is fake_client
    certificate.assert_called_once_with(str(credential_file))
    initialize_app.assert_called_once_with(fake_credentials)
    firestore_client.assert_called_once_with()


def test_init_firestore_client_explicit_path_overrides_environment(monkeypatch, tmp_path):
    explicit_file = tmp_path / "explicit.json"
    env_file = tmp_path / "env.json"
    explicit_file.write_text("{}", encoding="utf-8")
    env_file.write_text("{}", encoding="utf-8")

    fake_credentials = object()
    certificate = MagicMock(return_value=fake_credentials)

    monkeypatch.setattr(firestore_repository.firebase_admin, "_apps", {})
    monkeypatch.setattr(firestore_repository.credentials, "Certificate", certificate)
    monkeypatch.setattr(firestore_repository.firebase_admin, "initialize_app", MagicMock())
    monkeypatch.setattr(firestore_repository.firestore, "client", MagicMock())
    monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(env_file))

    firestore_repository.init_firestore_client(str(explicit_file))

    certificate.assert_called_once_with(str(explicit_file))
