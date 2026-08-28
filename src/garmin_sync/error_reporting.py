from __future__ import annotations

import json
import logging
import re
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

_MAX_MESSAGE_LENGTH = 1000
_MAX_STACK_FRAMES = 8

_EMAIL_PATTERN = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)(password|passwd|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|"
    r"custom[_-]?token|challenge[_-]?id|mfa[_-]?code|credential|email)"
    r"(\s*[:=]\s*)"
    r"(?:\"[^\"]*\"|'[^']*'|[^\s,;}&]+)"
)
_LONG_SECRET_PATTERN = re.compile(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{48,}(?![A-Za-z0-9_-])")
_USER_PATH_PATTERN = re.compile(r"(?i)(?P<prefix>\b(?:garmin/)?users/)[^/\s]+/")

_SENSITIVE_CONTEXT_KEYS = {
    "authorization",
    "password",
    "passwd",
    "email",
    "access_token",
    "refresh_token",
    "id_token",
    "custom_token",
    "challenge_id",
    "mfa_code",
    "credential",
    "credentials",
    "uid",
    "user_id",
}


@dataclass(frozen=True)
class ErrorReport:
    """Sanitized diagnostic record for logs and boundary-safe error metadata."""

    code: str
    category: str
    exception_type: str
    message: str
    retryable: bool
    operation: str
    context: dict[str, Any]
    stack: tuple[str, ...]

    def as_log_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "category": self.category,
            "exceptionType": self.exception_type,
            "message": self.message,
            "retryable": self.retryable,
            "operation": self.operation,
            "context": self.context,
            "stack": list(self.stack),
        }


def sanitize_text(value: object) -> str:
    """Remove credential-like values and user identifiers from diagnostic text."""
    text = str(value)
    text = _EMAIL_PATTERN.sub("<email-redacted>", text)
    text = _BEARER_PATTERN.sub("Bearer <redacted>", text)
    text = _SENSITIVE_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group(1)}{match.group(2)}<redacted>", text
    )
    text = _USER_PATH_PATTERN.sub(lambda match: f"{match.group('prefix')}<uid-redacted>/", text)
    text = _LONG_SECRET_PATTERN.sub("<secret-redacted>", text)
    return text[:_MAX_MESSAGE_LENGTH]


def _sanitize_context_value(key: str, value: Any) -> Any:
    normalized_key = key.lower().replace("-", "_")
    if normalized_key in _SENSITIVE_CONTEXT_KEYS:
        return "<redacted>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, Mapping):
        return sanitize_context(value)
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_context_value("", item) for item in value]
    return sanitize_text(value)


def sanitize_context(context: Mapping[str, Any] | None) -> dict[str, Any]:
    if not context:
        return {}
    return {str(key): _sanitize_context_value(str(key), value) for key, value in context.items()}


def classify_exception(error: BaseException) -> tuple[str, bool]:
    """Return a stable category and whether retrying later can reasonably help."""
    name = type(error).__name__.lower()

    if any(marker in name for marker in ("toomanyrequests", "ratelimit", "resourceexhausted")):
        return "rate_limited", True
    if any(marker in name for marker in ("authentication", "unauthenticated", "permissiondenied")):
        return "authentication", False
    if any(marker in name for marker in ("configuration", "defaultcredential", "credentialserror")):
        return "configuration", False
    if any(
        marker in name
        for marker in ("connection", "timeout", "deadline", "unavailable", "transport")
    ):
        return "upstream_unavailable", True
    if any(marker in name for marker in ("conflict", "alreadyexists")):
        return "conflict", False
    if isinstance(error, ValueError) or any(
        marker in name for marker in ("validation", "jsondecode")
    ):
        return "validation", False
    if "notfound" in name:
        return "not_found", False
    return "unexpected", False


def _operation_slug(operation: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", operation.strip().lower()).strip("_")
    return slug or "operation"


def _safe_stack(error: BaseException) -> tuple[str, ...]:
    tb = error.__traceback__
    if tb is None:
        return ()

    frames = traceback.extract_tb(tb)[-_MAX_STACK_FRAMES:]
    safe_frames: list[str] = []
    for frame in frames:
        normalized = frame.filename.replace("\\", "/")
        marker_path: str | None = None
        for marker in ("/src/", "/tests/", "/app/"):
            if marker in normalized:
                marker_path = normalized.split(marker, maxsplit=1)[1]
                marker_path = f"{marker.strip('/')}/{marker_path}"
                break
        safe_path = marker_path or Path(normalized).name
        safe_frames.append(f"{safe_path}:{frame.lineno}:{frame.name}")
    return tuple(safe_frames)


def build_error_report(
    operation: str,
    error: BaseException,
    *,
    context: Mapping[str, Any] | None = None,
) -> ErrorReport:
    category, retryable = classify_exception(error)
    exception_type = type(error).__name__
    raw_message = str(error).strip() or exception_type
    return ErrorReport(
        code=f"{_operation_slug(operation)}.{category}",
        category=category,
        exception_type=exception_type,
        message=sanitize_text(raw_message),
        retryable=retryable,
        operation=operation,
        context=sanitize_context(context),
        stack=_safe_stack(error),
    )


def log_exception(
    logger: logging.Logger,
    operation: str,
    error: BaseException,
    *,
    context: Mapping[str, Any] | None = None,
    level: int = logging.ERROR,
) -> ErrorReport:
    """Log a sanitized structured report without re-rendering the raw exception traceback."""
    report = build_error_report(operation, error, context=context)
    logger.log(
        level,
        "operation_failure %s",
        json.dumps(report.as_log_dict(), sort_keys=True, separators=(",", ":"), default=str),
    )
    return report
