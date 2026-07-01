from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from support_ops.config import SupportOpsConfig, load_config
from support_ops.health_check import run_health_check, utc_now
from support_ops.synthetic_login import run_synthetic_login
from support_ops.ticket_api_check import run_ticket_api_check


def _status_icon(status: str) -> str:
    return "PASS" if status == "PASS" else "FAIL"


def _collect_failures(results: list[dict[str, Any]]) -> list[str]:
    return [
        f"{result['check']}: {failure}"
        for result in results
        for failure in result.get("failures", [])
    ]


def _recommended_next_step(results: list[dict[str, Any]]) -> str:
    failed = [result for result in results if result["status"] != "PASS"]
    if not failed:
        return "No action required. Continue scheduled monitoring."
    names = ", ".join(result["check"] for result in failed)
    return f"Review failed checks ({names}), compare with recent deploys, and follow the runbook."


def build_status_report(
    config: SupportOpsConfig,
    results: list[dict[str, Any]],
    generated_at: str | None = None,
) -> str:
    generated_at = generated_at or utc_now()
    overall_status = "PASS" if all(result["status"] == "PASS" for result in results) else "FAIL"
    failures = _collect_failures(results)

    lines = [
        f"# Status Report - {config.app_name}",
        "",
        f"- Environment: {config.environment}",
        f"- Base URL: {config.base_url}",
        f"- Generated At: {generated_at}",
        f"- Overall Status: {_status_icon(overall_status)}",
        "",
        "## Checks",
        "",
        "| Check | Endpoint | Result | Latency | Checked At |",
        "| --- | --- | --- | --- | --- |",
    ]

    for result in results:
        latency = result.get("response_time_ms")
        if latency is None and result.get("checks"):
            latency_values = [
                check["response_time_ms"]
                for check in result["checks"]
                if check.get("response_time_ms") is not None
            ]
            latency = max(latency_values) if latency_values else None
        lines.append(
            "| {check} | `{endpoint}` | {status} | {latency} | {checked_at} |".format(
                check=result["check"],
                endpoint=result["endpoint"],
                status=_status_icon(result["status"]),
                latency=f"{latency}ms" if latency is not None else "N/A",
                checked_at=result["checked_at"],
            )
        )

    lines.extend(["", "## Failures", ""])
    if failures:
        lines.extend(f"- {failure}" for failure in failures)
    else:
        lines.append("- None")

    lines.extend(["", "## Recommended Next Step", "", _recommended_next_step(results), ""])
    return "\n".join(lines)


def write_status_report(
    output_dir: Path,
    content: str,
    generated_at: str | None = None,
) -> Path:
    generated_at = generated_at or utc_now()
    date_part = generated_at[:10]
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"status-report-{date_part}.md"
    path.write_text(content, encoding="utf-8")
    return path


def generate_status_report(
    config: SupportOpsConfig | None = None,
    output_dir: Path | str = "reports",
) -> tuple[Path, list[dict[str, Any]]]:
    config = config or load_config()
    generated_at = utc_now()
    results = [
        run_health_check(config),
        run_synthetic_login(config),
        run_ticket_api_check(config),
    ]
    content = build_status_report(config, results, generated_at)
    return write_status_report(Path(output_dir), content, generated_at), results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a Markdown support status report.")
    parser.add_argument("--output-dir", default="reports", help="Directory for generated reports.")
    args = parser.parse_args(argv)
    path, results = generate_status_report(output_dir=args.output_dir)
    print(f"Generated status report: {path}")
    return 0 if all(result["status"] == "PASS" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
