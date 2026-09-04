#!/usr/bin/env python3
"""Smoke-test the local Docker Compose full-stack contract.

The checks intentionally cover both direct backend health endpoints and same-origin Nginx
routing so CI catches topology/proxy drift rather than merely proving that containers start.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from email.message import Message

FRONTEND = "http://127.0.0.1:8080"
GARMIN_BACKEND = "http://127.0.0.1:8081"
GOOGLE_HEALTH_BACKEND = "http://127.0.0.1:8082"


def _request(url: str, *, method: str = "GET") -> tuple[int, Message, bytes]:
    request = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def _expect_status(url: str, expected: int, *, method: str = "GET") -> tuple[Message, bytes]:
    status, headers, body = _request(url, method=method)
    if status != expected:
        raise AssertionError(f"{method} {url}: expected HTTP {expected}, got {status}")
    return headers, body


def _expect_header(headers: Message, name: str, expected_fragment: str) -> None:
    value = headers.get(name, "")
    if expected_fragment not in value:
        raise AssertionError(
            f"Expected {name!r} to contain {expected_fragment!r}, got {value!r}"
        )


def _expect_security_headers(headers: Message) -> None:
    _expect_header(headers, "X-Content-Type-Options", "nosniff")
    _expect_header(headers, "X-Frame-Options", "DENY")
    _expect_header(headers, "Content-Security-Policy", "default-src 'self'")


def main() -> int:
    _expect_status(f"{GARMIN_BACKEND}/health", 200)
    _expect_status(f"{GOOGLE_HEALTH_BACKEND}/health", 200)

    frontend_headers, index = _expect_status(f"{FRONTEND}/", 200)
    if b'<div id="root">' not in index:
        raise AssertionError("Frontend response did not contain the React root element")
    _expect_security_headers(frontend_headers)
    _expect_header(frontend_headers, "Cache-Control", "no-cache")

    # Verify the immutable asset location does not accidentally drop server-level security
    # headers (nginx add_header inheritance changes when a location adds Cache-Control).
    match = re.search(rb'(/assets/[^"\']+\.js)', index)
    if match is None:
        raise AssertionError("Could not find a built JavaScript asset in frontend index")
    asset_path = match.group(1).decode("utf-8")
    asset_headers, _ = _expect_status(f"{FRONTEND}{asset_path}", 200)
    _expect_security_headers(asset_headers)
    _expect_header(asset_headers, "Cache-Control", "immutable")

    sw_headers, _ = _expect_status(f"{FRONTEND}/sw.js", 200)
    _expect_security_headers(sw_headers)
    _expect_header(sw_headers, "Cache-Control", "no-store")

    # Authentication failures are deliberate here: the status codes prove that Nginx
    # reached the correct service without requiring real user tokens or external APIs.
    _expect_status(f"{FRONTEND}/api/garmin/status", 401, method="POST")
    _expect_status(f"{FRONTEND}/api/google-health/start-link", 400, method="POST")

    print("[OK] Docker Compose full-stack smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
