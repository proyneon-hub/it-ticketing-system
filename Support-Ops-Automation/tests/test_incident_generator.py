from support_ops.incident_generator import build_incident_report, write_incident_report


def test_incident_report_includes_core_fields(tmp_path):
    content = build_incident_report(
        severity="high",
        summary="API health check failed",
        affected_service="IT Ticketing System",
        symptoms="The health endpoint is failing.",
        suspected_cause="Deployment configuration issue.",
        next_actions="Check hosting logs.",
        escalation_notes="Notify application owner.",
        detected_at="2026-07-01T13:00:00Z",
    )

    path = write_incident_report(tmp_path, content, detected_at="2026-07-01T13:00:00Z")

    assert path.name == "incident-2026-07-01-1300.md"
    assert "Severity: HIGH" in path.read_text(encoding="utf-8")
    assert "API health check failed" in content
