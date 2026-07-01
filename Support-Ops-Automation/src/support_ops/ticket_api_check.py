from __future__ import annotations

import argparse
from time import perf_counter
from typing import Any

import requests

from support_ops.config import SupportOpsConfig, load_config
from support_ops.health_check import utc_now
from support_ops.synthetic_login import LOGIN_ENDPOINT

TICKETS_ENDPOINT = "/api/tickets"


def _json_payload(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _login(
    session: requests.Session,
    config: SupportOpsConfig,
    email: str,
    password: str,
) -> str | None:
    response = session.post(
        config.url_for(LOGIN_ENDPOINT),
        json={"email": email, "password": password},
        timeout=config.request_timeout_seconds,
    )
    payload = _json_payload(response)
    return payload.get("token") if response.status_code == 200 else None


def _timed_get(
    session: requests.Session,
    config: SupportOpsConfig,
    path: str,
    token: str | None = None,
) -> tuple[int | None, dict[str, Any], int | None, str | None]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    start = perf_counter()
    try:
        response = session.get(
            config.url_for(path),
            headers=headers,
            timeout=config.request_timeout_seconds,
        )
        latency_ms = round((perf_counter() - start) * 1000)
        return response.status_code, _json_payload(response), latency_ms, None
    except requests.RequestException as error:
        return None, {}, None, str(error)


def run_ticket_api_check(
    config: SupportOpsConfig | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    config = config or load_config()
    session = session or requests.Session()
    checks: list[dict[str, Any]] = []

    try:
        admin_token = _login(session, config, config.admin_email, config.admin_password)
    except requests.RequestException as error:
        admin_token = None
        checks.append(
            {
                "name": "admin login",
                "status": "FAIL",
                "status_code": None,
                "response_time_ms": None,
                "failures": [f"Admin login failed: {error}"],
            }
        )

    if not admin_token:
        checks.append(
            {
                "name": "admin ticket list",
                "status": "FAIL",
                "status_code": None,
                "response_time_ms": None,
                "failures": ["Could not obtain admin token."],
            }
        )
    else:
        status_code, payload, latency_ms, error = _timed_get(
            session,
            config,
            f"{TICKETS_ENDPOINT}?limit=5",
            admin_token,
        )
        failures: list[str] = []
        if error:
            failures.append(f"Request failed: {error}")
        if status_code != 200:
            failures.append(f"Expected HTTP 200, received HTTP {status_code or 'N/A'}.")
        if status_code == 200 and not isinstance(payload.get("tickets"), list):
            failures.append("Ticket list response did not include a tickets array.")
        checks.append(
            {
                "name": "admin ticket list",
                "status": "PASS" if not failures else "FAIL",
                "status_code": status_code,
                "response_time_ms": latency_ms,
                "failures": failures,
            }
        )

    status_code, _payload, latency_ms, error = _timed_get(session, config, TICKETS_ENDPOINT)
    protected_failures: list[str] = []
    if error:
        protected_failures.append(f"Request failed: {error}")
    if status_code != 401:
        protected_failures.append(
            f"Expected HTTP 401 without token, received HTTP {status_code or 'N/A'}."
        )
    checks.append(
        {
            "name": "protected endpoint rejects missing token",
            "status": "PASS" if not protected_failures else "FAIL",
            "status_code": status_code,
            "response_time_ms": latency_ms,
            "failures": protected_failures,
        }
    )

    try:
        user_token = _login(session, config, config.user_email, config.user_password)
    except requests.RequestException as error:
        user_token = None
        checks.append(
            {
                "name": "user role visibility",
                "status": "FAIL",
                "status_code": None,
                "response_time_ms": None,
                "failures": [f"User login failed: {error}"],
            }
        )

    if user_token:
        status_code, payload, latency_ms, error = _timed_get(
            session,
            config,
            f"{TICKETS_ENDPOINT}?limit=20",
            user_token,
        )
        failures = []
        if error:
            failures.append(f"Request failed: {error}")
        if status_code != 200:
            failures.append(f"Expected HTTP 200, received HTTP {status_code or 'N/A'}.")
        tickets = payload.get("tickets", [])
        if status_code == 200 and any(
            ticket.get("requesterEmail", "").lower() != config.user_email.lower()
            for ticket in tickets
        ):
            failures.append("User role response included another requester's ticket.")
        checks.append(
            {
                "name": "user role visibility",
                "status": "PASS" if not failures else "FAIL",
                "status_code": status_code,
                "response_time_ms": latency_ms,
                "failures": failures,
            }
        )
    elif not any(check["name"] == "user role visibility" for check in checks):
        checks.append(
            {
                "name": "user role visibility",
                "status": "FAIL",
                "status_code": None,
                "response_time_ms": None,
                "failures": ["Could not obtain user token."],
            }
        )

    return {
        "check": "ticket_api",
        "status": "PASS" if all(check["status"] == "PASS" for check in checks) else "FAIL",
        "endpoint": TICKETS_ENDPOINT,
        "checked_at": utc_now(),
        "checks": checks,
        "failures": [
            failure
            for check in checks
            for failure in check["failures"]
        ],
    }


def format_ticket_api_result(result: dict[str, Any]) -> str:
    lines = [
        f"Status: {result['status']}",
        f"Endpoint: {result['endpoint']}",
        f"Checked At: {result['checked_at']}",
        "Checks:",
    ]
    for check in result["checks"]:
        lines.append(
            f"- {check['name']}: {check['status']} "
            f"(HTTP {check['status_code'] or 'N/A'}, "
            f"{check['response_time_ms'] or 'N/A'}ms)"
        )
    if result["failures"]:
        lines.append("Failures:")
        lines.extend(f"- {failure}" for failure in result["failures"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run ticket API support checks.")
    parser.parse_args(argv)
    result = run_ticket_api_check()
    print(format_ticket_api_result(result))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
