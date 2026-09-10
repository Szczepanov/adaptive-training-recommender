import json

from garmin_sync.webhook_receiver import (
    GoogleHealthWebhookHandler,
    WebhookSignatureVerifier,
)


def test_webhook_receiver_hmac_verification() -> None:
    secret = "test_webhook_secret"
    verifier = WebhookSignatureVerifier(static_shared_secret=secret)
    events_received = []

    handler = GoogleHealthWebhookHandler(
        verifier=verifier,
        task_dispatcher=lambda evt: events_received.append(evt),
    )

    payload = json.dumps(
        {
            "healthUserId": "user_123",
            "dataType": "sleep",
            "operation": "UPSERT",
            "eventTime": "2026-08-27T06:00:00Z",
        }
    ).encode("utf-8")

    import hashlib
    import hmac

    valid_sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()

    # Invalid signature
    status, body = handler.handle_request(payload, "invalid_sig")
    assert status == 401
    assert len(events_received) == 0

    # Valid signature
    status, body = handler.handle_request(payload, valid_sig)
    assert status == 200
    assert len(events_received) == 1
    assert events_received[0].healthUserId == "user_123"
    assert events_received[0].dataType == "sleep"
    assert events_received[0].operation == "UPSERT"


def test_webhook_receiver_no_shared_secret_fails_closed() -> None:
    # Verifier with no shared secret configured must reject any header
    verifier = WebhookSignatureVerifier(static_shared_secret=None)
    handler = GoogleHealthWebhookHandler(verifier=verifier)

    payload = json.dumps({"healthUserId": "user_123", "dataType": "sleep"}).encode("utf-8")

    status, body = handler.handle_request(payload, "forged_signature_header")
    assert status == 401
    assert body == {"error": "Invalid signature"}


def test_handle_request_payload_too_large() -> None:
    verifier = WebhookSignatureVerifier(static_shared_secret="secret")
    handler = GoogleHealthWebhookHandler(verifier=verifier)

    large_payload = b"a" * (1024 * 1024 + 1)
    status, body = handler.handle_request(large_payload, "some_signature")
    assert status == 413
    assert body == {"error": "Payload exceeds maximum allowed size"}


def test_handle_request_payload_at_limit_still_reaches_signature_check() -> None:
    verifier = WebhookSignatureVerifier(static_shared_secret="secret")
    handler = GoogleHealthWebhookHandler(verifier=verifier)

    payload_at_limit = b"a" * (1024 * 1024)
    status, body = handler.handle_request(payload_at_limit, "invalid_sig")

    assert status == 401
    assert body == {"error": "Invalid signature"}


def test_handle_request_invalid_signature_before_json_parse() -> None:
    verifier = WebhookSignatureVerifier(static_shared_secret="secret")
    handler = GoogleHealthWebhookHandler(verifier=verifier)

    invalid_json_payload = b"invalid json body {{{"
    status, body = handler.handle_request(invalid_json_payload, "invalid_sig")
    assert status == 401
    assert body == {"error": "Invalid signature"}
