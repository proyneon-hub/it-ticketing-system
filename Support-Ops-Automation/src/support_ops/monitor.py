from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from support_ops.config import SupportOpsConfig, load_config
from support_ops.health_check import utc_now
from support_ops.incident_generator import (
    build_incident_issue_body,
    build_incident_title,
    build_incident_update,
    build_recovery_comment,
    failed_checks,
    severity_for,
)
from support_ops.report_generator import generate_status_report

ISSUE_BODY_FILE = "incident-issue.md"
UPDATE_FILE = "incident-update.md"
RECOVERY_FILE = "incident-recovery.md"


def write_outputs(path: str | None, values: dict[str, str]) -> None:
    """Append `name=value` lines to a GitHub Actions output file (a no-op outside Actions)."""
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        for name, value in values.items():
            # A newline in a value would let it inject another output, so none is allowed.
            handle.write(f"{name}={value.replace(chr(10), ' ')}\n")


def monitor(
    output_dir: Path | str = "reports",
    github_output: str | None = None,
    run_url: str | None = None,
    config: SupportOpsConfig | None = None,
    results: list[dict[str, Any]] | None = None,
) -> int:
    """Run the checks, write the status report, and prepare the texts for the incident issue.

    The workflow (`support-ops-health-check.yml`) does the GitHub side, so this only writes
    files and outputs: `status` (pass or fail), and for a failure `severity` and `title`.
    Returns 0 when every check passed and 1 otherwise, like the report generator.
    """
    config = config or load_config()
    output = Path(output_dir)
    if results is None:
        _, results = generate_status_report(config, output)
    output.mkdir(parents=True, exist_ok=True)
    detected_at = utc_now()
    failures = failed_checks(results)

    if not failures:
        (output / RECOVERY_FILE).write_text(
            build_recovery_comment(config, results, detected_at, run_url), encoding="utf-8"
        )
        write_outputs(github_output, {"status": "pass"})
        return 0

    (output / ISSUE_BODY_FILE).write_text(
        build_incident_issue_body(config, results, detected_at, run_url), encoding="utf-8"
    )
    (output / UPDATE_FILE).write_text(
        build_incident_update(config, results, detected_at, run_url), encoding="utf-8"
    )
    write_outputs(
        github_output,
        {
            "status": "fail",
            "severity": severity_for(results),
            "title": build_incident_title(config, results),
        },
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the support checks and prepare an incident issue if any fail."
    )
    parser.add_argument("--output-dir", default="reports")
    parser.add_argument(
        "--github-output",
        default=os.getenv("GITHUB_OUTPUT"),
        help="File to append step outputs to (defaults to $GITHUB_OUTPUT).",
    )
    parser.add_argument("--run-url", default=None, help="Link to the workflow run, for the issue.")
    args = parser.parse_args(argv)
    return monitor(args.output_dir, args.github_output, args.run_url)


if __name__ == "__main__":
    raise SystemExit(main())
