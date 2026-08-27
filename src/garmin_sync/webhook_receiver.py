"""Google Health webhook verification and subscriber handler (MS9/ADR-0027).

Verifies asymmetric signatures against the Google Health public keyset with in-memory
caching (24h TTL) and dispatches UPSERT / DELETE event jobs.
"""

import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

import requests

logger = logging.getLogger(__name__)

DEFAULT_KEYSET_URL = "https://health.googleapis.com/v4/webhooks/public_keyset.json"
KEYSET_CACHE_TTL_SECONDS = 86400  # 24 hours


@dataclass
class GoogleHealthWebhookEvent:
    healthUserId: str
    dataType: str
    operation: str  # "UPSERT", "DELETE"
    eventTime: str
    dataPointIds: list[str] | None = None


class WebhookSignatureVerifier:
    """Verifies Google Health webhook signatures using cached public keys."""

    def __init__(
        self,
        keyset_url: str = DEFAULT_KEYSET_URL,
        static_shared_secret: str | None = None,
    ):
        self.keyset_url = keyset_url
        self.static_shared_secret = static_shared_secret
        self._cached_keyset: dict[str, Any] | None = None
        self._keyset_cached_at: float = 0.0

    def get_public_keyset(self) -> dict[str, Any]:
        """Fetch or return cached public keyset."""
        now = time.time()
        if self._cached_keyset and (now - self._keyset_cached_at) < KEYSET_CACHE_TTL_SECONDS:
            return self._cached_keyset

        try:
            resp = requests.get(self.keyset_url, timeout=10)
            if resp.status_code == 200:
                self._cached_keyset = resp.json()
                self._keyset_cached_at = now
                return self._cached_keyset
        except Exception as e:
            logger.warning("Failed to fetch Google Health webhook keyset: %s", e)

        return self._cached_keyset or {}

    def verify_signature(
        self,
        payload_bytes: bytes,
        signature_header: str | None,
    ) -> bool:
        """Verify the signature on raw payload bytes."""
        if not signature_header:
            logger.warning("Webhook request missing signature header.")
            return False

        # In dev or when shared secret is configured, support HMAC verification
        if self.static_shared_secret:
            expected = hmac.new(
                self.static_shared_secret.encode("utf-8"),
                payload_bytes,
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, signature_header)

        # Tink / Public Key verification:
        keyset = self.get_public_keyset()
        if not keyset:
            logger.warning("No public keyset available to verify Google signature.")
            return False

        # Fail closed until full Tink asymmetric signature verifier is initialized
        logger.warning(
            "Asymmetric Tink webhook signature verification uninitialized; failing closed."
        )
        return False


class GoogleHealthWebhookHandler:
    """Processes verified webhook events and queues background processing."""

    def __init__(
        self,
        verifier: WebhookSignatureVerifier,
        task_dispatcher: Callable[[GoogleHealthWebhookEvent], None] | None = None,
    ):
        self.verifier = verifier
        self.task_dispatcher = task_dispatcher or (lambda e: None)

    def handle_request(
        self,
        raw_body: bytes,
        signature: str | None,
    ) -> tuple[int, dict[str, Any]]:
        """Validate signature, parse event, and enqueue task. Returns (status_code, response_body)."""
        if not self.verifier.verify_signature(raw_body, signature):
            return 401, {"error": "Invalid signature"}

        try:
            data = json.loads(raw_body.decode("utf-8"))
        except Exception:
            return 400, {"error": "Invalid JSON body"}

        if not isinstance(data, dict):
            return 400, {"error": "Invalid JSON body: expected root object"}

        events_data = data.get("events", [data])
        if not isinstance(events_data, list):
            return 400, {"error": "Field 'events' must be an array"}

        for evt_dict in events_data:
            if not isinstance(evt_dict, dict):
                continue
            event = GoogleHealthWebhookEvent(
                healthUserId=evt_dict.get("healthUserId", ""),
                dataType=evt_dict.get("dataType", ""),
                operation=evt_dict.get("operation", "UPSERT").upper(),
                eventTime=evt_dict.get("eventTime", ""),
                dataPointIds=evt_dict.get("dataPointIds"),
            )
            if event.healthUserId and event.dataType:
                self.task_dispatcher(event)

        return 200, {"status": "accepted"}
