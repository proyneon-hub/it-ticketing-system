from support_ops.config import SupportOpsConfig
from support_ops.report_generator import build_status_report, write_status_report


def test_status_report_summarizes_passing_checks(tmp_path):
    config = SupportOpsConfig(base_url="https://example.test", environment="test")
    results = [
        {
            "check": "health",
            "status": "PASS",
            "endpoint": "/api/health",
            "response_time_ms": 123,
            "checked_at": "2026-07-01T13:00:00Z",
            "failures": [],
        }
    ]

    content = build_status_report(config, results, generated_at="2026-07-01T13:00:00Z")
    path = write_status_report(tmp_path, content, generated_at="2026-07-01T13:00:00Z")

    assert path.name == "status-report-2026-07-01.md"
    assert "Overall Status: PASS" in content
    assert "| health | `/api/health` | PASS | 123ms |" in content


def test_status_report_recommends_followup_for_failures():
    config = SupportOpsConfig()
    results = [
        {
            "check": "health",
            "status": "FAIL",
            "endpoint": "/api/health",
            "response_time_ms": None,
            "checked_at": "2026-07-01T13:00:00Z",
            "failures": ["Expected HTTP 200, received HTTP 503."],
        }
    ]

    content = build_status_report(config, results, generated_at="2026-07-01T13:00:00Z")

    assert "Overall Status: FAIL" in content
    assert "Expected HTTP 200, received HTTP 503." in content
    assert "follow the runbook" in content
