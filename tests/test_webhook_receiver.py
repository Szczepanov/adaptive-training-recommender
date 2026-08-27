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
