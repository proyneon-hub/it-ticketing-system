from __future__ import annotations

import argparse
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

import requests

from support_ops.config import SupportOpsConfig, load_config

HEALTH_ENDPOINT = "/api/health"


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


def format_health_result(result: dict[str, Any]) -> str:
    lines = [
        f"Status: {result['status']}",
        f"Endpoint: {result['endpoint']}",
        f"HTTP Status: {result['status_code'] or 'N/A'}",
        f"Response Time: {result['response_time_ms'] or 'N/A'}ms",
        f"Checked At: {result['checked_at']}",
    ]
    if result["failures"]:
        lines.append("Failures:")
        lines.extend(f"- {failure}" for failure in result["failures"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the API health check.")
    parser.parse_args(argv)
    result = run_health_check()
    print(format_health_result(result))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
