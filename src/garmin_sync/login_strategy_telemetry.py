"""Sanitized per-strategy telemetry for Garmin credential logins (#718).

The pinned ``garminconnect`` (0.3.x) tries a fixed chain of login strategies and reports
each attempt only through its ``garminconnect.client.sso`` logger. This module watches
that logger for the duration of one login, on the calling thread only, and keeps just:

* the strategy name, and only when it is one of the library's known names;
* an outcome category (``rate_limited``, ``failed``, ``token_rejected`` or the overall
  login outcome for the attempt that ended the chain).

It never keeps a formatted message or any argument beyond the strategy name, so emails,
passwords, MFA codes, service tickets, tokens and response bodies cannot reach the summary.
The library's DEBUG records are captured but not propagated to the application's handlers.
It observes only: it never changes ``skip_strategies``, retries or provokes requests.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

SSO_LOGGER_NAME = "garminconnect.client.sso"
KNOWN_STRATEGIES = frozenset(
    {"mobile+cffi", "mobile+requests", "widget+cffi", "portal+cffi", "portal+requests"}
)

# The library's format strings (garminconnect 0.3.x `client/sso.py` `SSOMixin.login`).
_TRYING = "Trying login strategy: %s"
_OUTCOME_BY_FORMAT = {
    "%s returned 429: %s": "rate_limited",
    "%s failed: %s": "failed",
    "%s obtained a token the API rejected; trying next strategy": "token_rejected",
}
_PENDING = "pending"

logger = logging.getLogger(__name__)
_sso_logger = logging.getLogger(SSO_LOGGER_NAME)
_level_lock = threading.Lock()
_active_recorders = 0
_saved_level = logging.NOTSET
_saved_effective_level = logging.WARNING


@dataclass(frozen=True)
class StrategyAttempt:
    name: str
    outcome: str


@dataclass(frozen=True)
class LoginStrategySummary:
    outcome: str
    attempts: tuple[StrategyAttempt, ...]

    @property
    def rate_limited_count(self) -> int:
        return sum(1 for attempt in self.attempts if attempt.outcome == "rate_limited")

    def log_line(self) -> str:
        sequence = ">".join(f"{a.name}:{a.outcome}" for a in self.attempts) or "none"
        return (
            f"garmin_login_strategies outcome={self.outcome} attempts={len(self.attempts)} "
            f"rate_limited={self.rate_limited_count} sequence={sequence}"
        )


class LoginStrategyRecorder(logging.Filter):
    """Collects strategy attempts from the SSO logger for the creating thread."""

    def __init__(self) -> None:
        super().__init__()
        self._thread_id = threading.get_ident()
        self._attempts: list[StrategyAttempt] = []

    def filter(self, record: logging.LogRecord) -> bool:
        if record.thread == self._thread_id:
            self._observe(record)
        return record.levelno >= _saved_effective_level

    def _observe(self, record: logging.LogRecord) -> None:
        args = record.args if isinstance(record.args, tuple) else ()
        if not args:
            return
        name = args[0] if args[0] in KNOWN_STRATEGIES else "other"
        if record.msg == _TRYING:
            self._attempts.append(StrategyAttempt(str(name), _PENDING))
            return
        outcome = _OUTCOME_BY_FORMAT.get(str(record.msg))
        if outcome is None:
            return
        for index in range(len(self._attempts) - 1, -1, -1):
            attempt = self._attempts[index]
            if attempt.name == name and attempt.outcome == _PENDING:
                self._attempts[index] = StrategyAttempt(attempt.name, outcome)
                return

    def summary(self, outcome: str) -> LoginStrategySummary:
        """Resolve the attempt that ended the chain with the overall login outcome."""
        attempts = tuple(
            StrategyAttempt(a.name, outcome) if a.outcome == _PENDING else a for a in self._attempts
        )
        return LoginStrategySummary(outcome=outcome, attempts=attempts)


def _acquire_debug_level() -> None:
    global _active_recorders, _saved_level, _saved_effective_level
    with _level_lock:
        if _active_recorders == 0:
            _saved_level = _sso_logger.level
            _saved_effective_level = _sso_logger.getEffectiveLevel()
            _sso_logger.setLevel(logging.DEBUG)
        _active_recorders += 1


def _release_debug_level() -> None:
    global _active_recorders
    with _level_lock:
        _active_recorders -= 1
        if _active_recorders == 0:
            _sso_logger.setLevel(_saved_level)


@contextmanager
def record_login_strategies() -> Iterator[LoginStrategyRecorder]:
    """Watch one login on this thread; always restores the SSO logger afterwards."""
    recorder = LoginStrategyRecorder()
    _acquire_debug_level()
    _sso_logger.addFilter(recorder)
    try:
        yield recorder
    finally:
        _sso_logger.removeFilter(recorder)
        _release_debug_level()


def classify_login_failure(error: BaseException) -> str:
    """Map a login exception to a coarse category; never inspects its message."""
    from garminconnect import (
        GarminConnectAuthenticationError,
        GarminConnectConnectionError,
        GarminConnectTooManyRequestsError,
    )

    if isinstance(error, GarminConnectTooManyRequestsError):
        return "rate_limited"
    if isinstance(error, GarminConnectAuthenticationError):
        return "auth_error"
    if isinstance(error, GarminConnectConnectionError):
        return "connection_error"
    return "error"


def log_login_summary(recorder: LoginStrategyRecorder, outcome: str) -> LoginStrategySummary:
    summary = recorder.summary(outcome)
    logger.info(summary.log_line())
    return summary
