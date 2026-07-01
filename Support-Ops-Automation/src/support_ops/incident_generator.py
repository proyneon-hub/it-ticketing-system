from __future__ import annotations

import argparse
from pathlib import Path

from support_ops.config import load_config
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
