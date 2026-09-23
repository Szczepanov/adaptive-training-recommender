"""Server-only, durable Garmin account-link attempt and upstream cooldown state.

Firestore transactions serialize competing requests for one bucket. Document IDs are
domain-separated HMACs, so neither account emails, Firebase UIDs nor client IPs appear
in datastore paths or payloads.
"""

import hashlib
import hmac
import math
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

from .firestore_repository import init_firestore_client

COLLECTION = "garminLoginRateLimits"
PROVIDER_DOCUMENT = "provider"
BREAKER_DISTINCT_ACCOUNTS = 3
BREAKER_WINDOW_SECONDS = 10 * 60


class FirestoreLoginRateLimiter:
    """Atomic attempt budgets and cooldowns shared across Cloud Run instances."""

    def __init__(
        self,
        secret: str,
        *,
        db: Any = None,
        clock: Callable[[], float] = time.time,
        window_seconds: int = 10 * 60,
        max_attempts: int = 5,
        upstream_cooldown_seconds: int = 30 * 60,
    ) -> None:
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("GARMIN_RATE_LIMIT_HMAC_KEY must contain at least 32 bytes.")
        self._secret = secret.encode("utf-8")
        self._db = db if db is not None else init_firestore_client()
        self._clock = clock
        self._window_seconds = window_seconds
        self._max_attempts = max_attempts
        self._upstream_cooldown_seconds = upstream_cooldown_seconds

    def _digest(self, kind: str, value: str) -> str:
        return hmac.new(self._secret, f"{kind}\x00{value}".encode(), hashlib.sha256).hexdigest()

    def _key(self, key: str) -> tuple[str, str]:
        kind, separator, value = key.partition(":")
        if separator and kind in {"account", "uid"}:
            if not value:
                raise ValueError("Rate-limit key must not be empty.")
            return kind, self._digest(kind, value)
        if not key:
            raise ValueError("Rate-limit key must not be empty.")
        return "ip", self._digest("ip", key)

    def _ref(self, kind: str, digest: str) -> Any:
        return self._db.collection(COLLECTION).document(f"{kind}-{digest}")

    @staticmethod
    def _data(snapshot: Any) -> dict[str, Any]:
        return (snapshot.to_dict() or {}) if snapshot.exists else {}

    @staticmethod
    def _delay(until: float, now: float) -> int:
        return max(1, math.ceil(until - now))

    @staticmethod
    def _expiry(until: float) -> datetime:
        return datetime.fromtimestamp(until, tz=timezone.utc)

    def _attempts(self, bucket: dict[str, Any], now: float) -> list[float]:
        return [
            float(attempt)
            for attempt in bucket.get("attempts", [])
            if isinstance(attempt, (int, float)) and now - self._window_seconds < attempt <= now
        ]

    def check(self, key: str) -> tuple[bool, int | None]:
        """Record an allowed attempt, or return the authoritative retry delay."""
        kind, digest = self._key(key)
        bucket_ref = self._ref(kind, digest)
        provider_ref = self._db.collection(COLLECTION).document(PROVIDER_DOCUMENT)

        @firestore.transactional
        def decide(transaction: Any) -> tuple[bool, int | None]:
            now = self._clock()
            provider = self._data(provider_ref.get(transaction=transaction))
            bucket = self._data(bucket_ref.get(transaction=transaction))
            blocked_until = max(
                float(provider.get("cooldownUntil", 0)),
                float(bucket.get("cooldownUntil", 0)),
            )
            if blocked_until > now:
                return False, self._delay(blocked_until, now)

            attempts = self._attempts(bucket, now)
            if len(attempts) >= self._max_attempts:
                return False, self._delay(attempts[0] + self._window_seconds, now)
            attempts.append(now)
            transaction.set(
                bucket_ref,
                {
                    "attempts": attempts,
                    "expireAt": self._expiry(max(now + self._window_seconds, blocked_until)),
                },
                merge=True,
            )
            return True, None

        return decide(self._db.transaction())

    def check_login(
        self,
        client_ip: str,
        account_key: str,
        uid_key: str | None = None,
    ) -> tuple[bool, int | None]:
        """Apply all login budgets atomically and return the longest delay.

        A denied account or UID must not consume the shared IP budget. Otherwise a
        caller could repeatedly submit a known-cooled identity through a shared NAT and
        exhaust the IP bucket for unrelated users.
        """
        ip_kind, ip_digest = self._key(client_ip)
        account_kind, account_digest = self._key(account_key)
        if ip_kind != "ip" or account_kind != "account":
            raise ValueError("Login check requires an IP and account key.")

        refs = [
            self._ref(ip_kind, ip_digest),
            self._ref(account_kind, account_digest),
        ]
        if uid_key is not None:
            uid_kind, uid_digest = self._key(uid_key)
            if uid_kind != "uid":
                raise ValueError("Login UID key must use the uid: prefix.")
            refs.append(self._ref(uid_kind, uid_digest))

        provider_ref = self._db.collection(COLLECTION).document(PROVIDER_DOCUMENT)

        @firestore.transactional
        def decide(transaction: Any) -> tuple[bool, int | None]:
            now = self._clock()
            provider = self._data(provider_ref.get(transaction=transaction))
            buckets = [(ref, self._data(ref.get(transaction=transaction))) for ref in refs]
            blocked_until = max(
                [float(provider.get("cooldownUntil", 0))]
                + [float(bucket.get("cooldownUntil", 0)) for _, bucket in buckets]
            )
            attempts_by_ref = [
                (ref, self._attempts(bucket, now)) for ref, bucket in buckets
            ]
            for _, attempts in attempts_by_ref:
                if len(attempts) >= self._max_attempts:
                    blocked_until = max(blocked_until, attempts[0] + self._window_seconds)
            if blocked_until > now:
                return False, self._delay(blocked_until, now)

            for ref, attempts in attempts_by_ref:
                attempts.append(now)
                transaction.set(
                    ref,
                    {"attempts": attempts, "expireAt": self._expiry(now + self._window_seconds)},
                    merge=True,
                )
            return True, None

        return decide(self._db.transaction())

    def check_provider(self) -> tuple[bool, int | None]:
        """Reject before parsing credentials when the evidence-backed breaker is open."""
        data = self._data(self._db.collection(COLLECTION).document(PROVIDER_DOCUMENT).get())
        now = self._clock()
        until = float(data.get("cooldownUntil", 0))
        return (False, self._delay(until, now)) if until > now else (True, None)

    def record_upstream_rate_limit(self, account_key: str) -> int:
        """Cool this account; open the provider breaker after three distinct accounts.

        Repeated 429s from one account contribute only one signal in the evidence window.
        Authentication failures never call this method.
        """
        kind, digest = self._key(account_key)
        if kind != "account":
            raise ValueError("Upstream rate-limit evidence requires an account key.")
        bucket_ref = self._ref(kind, digest)
        provider_ref = self._db.collection(COLLECTION).document(PROVIDER_DOCUMENT)

        @firestore.transactional
        def record(transaction: Any) -> int:
            now = self._clock()
            account = self._data(bucket_ref.get(transaction=transaction))
            provider = self._data(provider_ref.get(transaction=transaction))
            account_until = max(
                float(account.get("cooldownUntil", 0)), now + self._upstream_cooldown_seconds
            )
            evidence = [
                item
                for item in provider.get("evidence", [])
                if isinstance(item, dict)
                and isinstance(item.get("account"), str)
                and isinstance(item.get("at"), (int, float))
                and now - BREAKER_WINDOW_SECONDS < item["at"] <= now
            ]
            if all(item["account"] != digest for item in evidence):
                evidence.append({"account": digest, "at": now})
            provider_until = float(provider.get("cooldownUntil", 0))
            if len(evidence) >= BREAKER_DISTINCT_ACCOUNTS:
                provider_until = max(provider_until, now + self._upstream_cooldown_seconds)
            transaction.set(
                bucket_ref,
                {
                    "cooldownUntil": account_until,
                    "expireAt": self._expiry(account_until),
                },
                merge=True,
            )
            transaction.set(
                provider_ref,
                {
                    "cooldownUntil": provider_until,
                    "evidence": evidence,
                    "expireAt": self._expiry(max(provider_until, now + BREAKER_WINDOW_SECONDS)),
                },
                merge=True,
            )
            return self._delay(max(account_until, provider_until), now)

        return record(self._db.transaction())
