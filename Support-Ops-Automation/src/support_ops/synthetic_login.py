from __future__ import annotations

import argparse
from time import perf_counter
from typing import Any

import requests

from support_ops.config import Credential, SupportOpsConfig, load_config
from support_ops.health_check import utc_now

LOGIN_ENDPOINT = "/api/auth/login"


def _post_login(
    session: requests.Session,
    config: SupportOpsConfig,
    email: str,
    password: str,
) -> tuple[int | None, dict[str, Any], int | None, str | None]:
    start = perf_counter()
    try:
        response = session.post(
            config.url_for(LOGIN_ENDPOINT),
            json={"email": email, "password": password},
            timeout=config.request_timeout_seconds,
        )
        latency_ms = round((perf_counter() - start) * 1000)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        return response.status_code, payload, latency_ms, None
    except requests.RequestException as error:
        return None, {}, None, str(error)


def _check_valid_login(
    session: requests.Session,
    config: SupportOpsConfig,
    credential: Credential,
) -> dict[str, Any]:
    status_code, payload, latency_ms, error = _post_login(
        session,
        config,
        credential.email,
        credential.password,
    )
    failures: list[str] = []

    if error:
        failures.append(f"Request failed: {error}")
    if status_code != 200:
        failures.append(f"Expected HTTP 200, received HTTP {status_code or 'N/A'}.")
    if not payload.get("token"):
        failures.append("Login response did not include a token.")
    if payload.get("user", {}).get("role") != credential.role:
        failures.append(f"Login response did not include role `{credential.role}`.")

    return {
        "role": credential.role,
        "email": credential.email,
        "status": "PASS" if not failures else "FAIL",
        "status_code": status_code,
        "response_time_ms": latency_ms,
        "failures": failures,
    }


def _check_invalid_login(
    session: requests.Session,
    config: SupportOpsConfig,
) -> dict[str, Any]:
    status_code, _payload, latency_ms, error = _post_login(
        session,
        config,
        config.admin_email,
        "invalid-password-for-support-check",
    )
    failures: list[str] = []

    if error:
        failures.append(f"Request failed: {error}")
    if status_code != 401:
        failures.append(f"Expected HTTP 401 for invalid credentials, received {status_code}.")

    return {
        "role": "invalid-credentials",
        "email": config.admin_email,
        "status": "PASS" if not failures else "FAIL",
        "status_code": status_code,
        "response_time_ms": latency_ms,
        "failures": failures,
    }


def run_synthetic_login(
    config: SupportOpsConfig | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    config = config or load_config()
    session = session or requests.Session()
    checks = [_check_valid_login(session, config, credential) for credential in config.credentials]
    checks.append(_check_invalid_login(session, config))

    return {
        "check": "synthetic_login",
        "status": "PASS" if all(check["status"] == "PASS" for check in checks) else "FAIL",
        "endpoint": LOGIN_ENDPOINT,
        "checked_at": utc_now(),
        "checks": checks,
        "failures": [
            failure
            for check in checks
            for failure in check["failures"]
        ],
    }


def format_synthetic_login_result(result: dict[str, Any]) -> str:
    lines = [
        f"Status: {result['status']}",
        f"Endpoint: {result['endpoint']}",
        f"Checked At: {result['checked_at']}",
        "Checks:",
    ]
    for check in result["checks"]:
        lines.append(
            f"- {check['role']}: {check['status']} "
            f"(HTTP {check['status_code'] or 'N/A'}, "
            f"{check['response_time_ms'] or 'N/A'}ms)"
        )
    if result["failures"]:
        lines.append("Failures:")
        lines.extend(f"- {failure}" for failure in result["failures"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run synthetic login checks.")
    parser.parse_args(argv)
    result = run_synthetic_login()
    print(format_synthetic_login_result(result))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
