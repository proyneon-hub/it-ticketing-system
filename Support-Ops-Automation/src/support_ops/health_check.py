from __future__ import annotations

import argparse
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

import requests

from support_ops.config import SupportOpsConfig, load_config

HEALTH_ENDPOINT = "/api/health"
READINESS_ENDPOINT = "/api/ready"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _response_json(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def run_health_check(
    config: SupportOpsConfig | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    config = config or load_config()
    session = session or requests.Session()
    checked_at = utc_now()
    start = perf_counter()
    failures: list[str] = []

    try:
        response = session.get(
            config.url_for(HEALTH_ENDPOINT),
            timeout=config.request_timeout_seconds,
        )
        latency_ms = round((perf_counter() - start) * 1000)
        body = _response_json(response)
    except requests.RequestException as error:
        return {
            "check": "health",
            "status": "FAIL",
            "endpoint": HEALTH_ENDPOINT,
            "status_code": None,
            "response_time_ms": None,
            "checked_at": checked_at,
            "failures": [f"Request failed: {error}"],
            "body": {},
        }

    if response.status_code != 200:
        failures.append(f"Expected HTTP 200, received HTTP {response.status_code}.")
    if body.get("ok") is not True:
        failures.append("Expected response body field `ok` to be true.")
    if not body.get("service"):
        failures.append("Expected response body to include a service name.")
    if latency_ms > config.latency_threshold_ms:
        failures.append(
            f"Response time {latency_ms}ms exceeded threshold "
            f"{config.latency_threshold_ms}ms."
        )

    return {
        "check": "health",
        "status": "PASS" if not failures else "FAIL",
        "endpoint": HEALTH_ENDPOINT,
        "status_code": response.status_code,
        "response_time_ms": latency_ms,
        "checked_at": checked_at,
        "failures": failures,
        "body": body,
    }


def run_readiness_check(
    config: SupportOpsConfig | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Check /api/ready, which proves the app can reach its database.

    Liveness (/api/health) only says the process is up. Readiness is the check
    that separates "the app is running" from "the app can actually serve users".
    The request id is recorded so an escalation can point straight at the logs.
    """
    config = config or load_config()
    session = session or requests.Session()
    checked_at = utc_now()
    start = perf_counter()
    failures: list[str] = []

    try:
        response = session.get(
            config.url_for(READINESS_ENDPOINT),
            timeout=config.request_timeout_seconds,
        )
        latency_ms = round((perf_counter() - start) * 1000)
        body = _response_json(response)
    except requests.RequestException as error:
        return {
            "check": "readiness",
            "status": "FAIL",
            "endpoint": READINESS_ENDPOINT,
            "status_code": None,
            "response_time_ms": None,
            "checked_at": checked_at,
            "request_id": None,
            "failures": [f"Request failed: {error}"],
            "body": {},
        }

    if response.status_code != 200:
        failures.append(f"Expected HTTP 200, received HTTP {response.status_code}.")
    if body.get("ok") is not True:
        failures.append("Expected response body field `ok` to be true.")
    if body.get("database") != "up":
        failures.append(f"Expected database to be up, received {body.get('database')!r}.")
    if latency_ms > config.latency_threshold_ms:
        failures.append(
            f"Response time {latency_ms}ms exceeded threshold "
            f"{config.latency_threshold_ms}ms."
        )

    headers = getattr(response, "headers", None) or {}
    return {
        "check": "readiness",
        "status": "PASS" if not failures else "FAIL",
        "endpoint": READINESS_ENDPOINT,
        "status_code": response.status_code,
        "response_time_ms": latency_ms,
        "checked_at": checked_at,
        "request_id": headers.get("x-request-id"),
        "failures": failures,
        "body": body,
    }


def format_health_result(result: dict[str, Any]) -> str:
    lines = [
        f"Status: {result['status']}",
        f"Endpoint: {result['endpoint']}",
        f"HTTP Status: {result['status_code'] or 'N/A'}",
        f"Response Time: {result['response_time_ms'] or 'N/A'}ms",
        f"Checked At: {result['checked_at']}",
    ]
    if result.get("request_id"):
        lines.append(f"Request ID: {result['request_id']}")
    if result["failures"]:
        lines.append("Failures:")
        lines.extend(f"- {failure}" for failure in result["failures"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the API liveness and readiness checks.")
    parser.parse_args(argv)
    results = [run_health_check(), run_readiness_check()]
    print("\n\n".join(format_health_result(result) for result in results))
    return 0 if all(result["status"] == "PASS" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
