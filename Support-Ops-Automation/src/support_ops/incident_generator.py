from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from support_ops.config import SupportOpsConfig, load_config
from support_ops.health_check import utc_now

SEVERITIES = ("low", "medium", "high", "critical")


def build_incident_report(
    severity: str,
    summary: str,
    affected_service: str,
    symptoms: str,
    suspected_cause: str,
    next_actions: str,
    escalation_notes: str,
    detected_at: str | None = None,
) -> str:
    detected_at = detected_at or utc_now()
    return "\n".join(
        [
            f"# Incident Report - {summary}",
            "",
            f"- Severity: {severity.upper()}",
            f"- Detected Time: {detected_at}",
            f"- Affected Service: {affected_service}",
            "",
            "## Symptoms",
            "",
            symptoms,
            "",
            "## Checks Performed",
            "",
            "- API health check",
            "- Synthetic login validation",
            "- Authenticated ticket API check",
            "- Recent deployment and environment-variable review",
            "",
            "## Suspected Cause",
            "",
            suspected_cause,
            "",
            "## Next Actions",
            "",
            next_actions,
            "",
            "## Escalation Notes",
            "",
            escalation_notes,
            "",
        ]
    )


def write_incident_report(
    output_dir: Path,
    content: str,
    detected_at: str | None = None,
) -> Path:
    detected_at = detected_at or utc_now()
    stamp = f"{detected_at[:10]}-{detected_at[11:13]}{detected_at[14:16]}"
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"incident-{stamp}.md"
    path.write_text(content, encoding="utf-8")
    return path


def generate_incident_report(
    severity: str,
    summary: str,
    output_dir: Path | str = "reports",
    affected_service: str | None = None,
    symptoms: str | None = None,
    suspected_cause: str | None = None,
    next_actions: str | None = None,
    escalation_notes: str | None = None,
) -> Path:
    config = load_config()
    content = build_incident_report(
        severity=severity,
        summary=summary,
        affected_service=affected_service or config.app_name,
        symptoms=symptoms or "Support automation detected an unhealthy or degraded check.",
        suspected_cause=suspected_cause or "Cause is not confirmed. Review logs and recent changes.",
        next_actions=next_actions or "Follow the runbook, verify environment variables, and retest.",
        escalation_notes=escalation_notes
        or "Escalate to the application owner if the issue persists after initial triage.",
    )
    return write_incident_report(Path(output_dir), content)


# --- Incident issues raised by the scheduled health check --------------------------------
#
# The wording follows docs/INCIDENT_RESPONSE.md (severity levels, the communication template
# and the post-incident review), so an issue reads like a report a person would have written.

# Severity by what is broken, using the levels in docs/INCIDENT_RESPONSE.md: the app being down
# (health or readiness) is critical; a blocked login or ticket API is high; anything else that
# fails, such as a slow response, is medium.
_CRITICAL_CHECKS = {"health", "readiness"}
_HIGH_CHECKS = {"synthetic_login", "ticket_api"}

_CHECK_LABELS = {
    "health": "API health",
    "readiness": "API readiness (database)",
    "synthetic_login": "Sign-in",
    "ticket_api": "Ticket API",
}

_IMPACT = {
    "critical": "The service may be unavailable to users.",
    "high": "A major workflow, such as signing in or using the ticket API, is degraded.",
    "medium": "A non-critical feature is impaired or slow.",
}


def failed_checks(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [result for result in results if result.get("status") != "PASS"]


def _label(check: str) -> str:
    return _CHECK_LABELS.get(check, check)


def severity_for(results: list[dict[str, Any]]) -> str:
    names = {result["check"] for result in failed_checks(results)}
    if names & _CRITICAL_CHECKS:
        return "critical"
    if names & _HIGH_CHECKS:
        return "high"
    return "medium"


def build_incident_title(config: SupportOpsConfig, results: list[dict[str, Any]]) -> str:
    names = ", ".join(_label(result["check"]) for result in failed_checks(results))
    return f"[Incident] {config.app_name}: {names} failing ({severity_for(results).upper()})"


def _failure_lines(results: list[dict[str, Any]]) -> list[str]:
    lines = []
    for result in failed_checks(results):
        for failure in result.get("failures") or ["The check reported a failure."]:
            lines.append(f"- **{_label(result['check'])}**: {failure}")
    return lines


def _checks_table(results: list[dict[str, Any]]) -> list[str]:
    rows = ["| Check | Status | Endpoint |", "| --- | --- | --- |"]
    for result in results:
        rows.append(
            f"| {_label(result['check'])} | {result.get('status', 'FAIL')} | "
            f"`{result.get('endpoint', '')}` |"
        )
    return rows


def build_incident_issue_body(
    config: SupportOpsConfig,
    results: list[dict[str, Any]],
    detected_at: str,
    run_url: str | None = None,
) -> str:
    severity = severity_for(results)
    lines = [
        f"Detected by the scheduled health check at {detected_at}.",
        "",
        f"- Severity: {severity.upper()}",
        f"- Affected Service: {config.app_name} ({config.base_url})",
    ]
    if run_url:
        lines.append(f"- Workflow run: {run_url}")
    lines += [
        "",
        "## Communication",
        "",
        "```txt",
        "Status: Investigating",
        f"Service: {config.app_name}",
        f"Impact: {_IMPACT[severity]}",
        "Current Action: Running health, login, and ticket API checks.",
        "Next Update: Within 30 minutes or sooner if status changes.",
        "```",
        "",
        "## Failing checks",
        "",
        *_failure_lines(results),
        "",
        "## Latest results",
        "",
        *_checks_table(results),
        "",
        "## Next actions",
        "",
        "1. Follow the [support runbook](../blob/main/Support-Ops-Automation/docs/RUNBOOK.md) "
        "and the [incident guide](../blob/main/Support-Ops-Automation/docs/INCIDENT_RESPONSE.md).",
        "2. Compare with the most recent deployment and check the hosting logs.",
        "3. This issue is updated by each scheduled check and closed automatically when all "
        "checks pass again. Add the root cause here for the post-incident review.",
        "",
        "## Post-incident review",
        "",
        "- Root cause:",
        "- What worked well:",
        "- What needs improvement:",
        "- Follow-up actions:",
        "",
    ]
    return "\n".join(lines)


def build_incident_update(
    config: SupportOpsConfig,
    results: list[dict[str, Any]],
    detected_at: str,
    run_url: str | None = None,
) -> str:
    lines = [
        f"Still failing at {detected_at} ({severity_for(results).upper()}).",
        "",
        *_failure_lines(results),
    ]
    if run_url:
        lines += ["", f"Workflow run: {run_url}"]
    return "\n".join(lines) + "\n"


def build_recovery_comment(
    config: SupportOpsConfig,
    results: list[dict[str, Any]],
    checked_at: str,
    run_url: str | None = None,
) -> str:
    lines = [
        f"Recovered: all checks passed at {checked_at}.",
        "",
        *_checks_table(results),
    ]
    if run_url:
        lines += ["", f"Workflow run: {run_url}"]
    lines += ["", "Closing this incident. Please add the root cause above if it is known.", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a Markdown incident report.")
    parser.add_argument("--severity", required=True, choices=SEVERITIES)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--output-dir", default="reports")
    parser.add_argument("--affected-service")
    parser.add_argument("--symptoms")
    parser.add_argument("--suspected-cause")
    parser.add_argument("--next-actions")
    parser.add_argument("--escalation-notes")
    args = parser.parse_args(argv)
    path = generate_incident_report(
        severity=args.severity,
        summary=args.summary,
        output_dir=args.output_dir,
        affected_service=args.affected_service,
        symptoms=args.symptoms,
        suspected_cause=args.suspected_cause,
        next_actions=args.next_actions,
        escalation_notes=args.escalation_notes,
    )
    print(f"Generated incident report: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
