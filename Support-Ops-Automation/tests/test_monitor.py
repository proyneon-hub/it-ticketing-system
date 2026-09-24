from support_ops import monitor as monitor_module
from support_ops.config import SupportOpsConfig
from support_ops.incident_generator import (
    build_incident_issue_body,
    build_incident_title,
    build_incident_update,
    build_recovery_comment,
    failed_checks,
    severity_for,
)
from support_ops.monitor import monitor, write_outputs

CONFIG = SupportOpsConfig(app_name="IT Ticketing System", base_url="https://example.test")
NOW = "2026-07-01T13:00:00Z"


def result(check, ok=True, failure="Expected HTTP 200, received HTTP 503."):
    return {
        "check": check,
        "status": "PASS" if ok else "FAIL",
        "endpoint": f"/api/{check}",
        "response_time_ms": 100,
        "checked_at": NOW,
        "failures": [] if ok else [failure],
    }


def all_passing():
    return [result(name) for name in ("health", "readiness", "synthetic_login", "ticket_api")]


def with_failures(*names):
    return [result(r["check"], ok=r["check"] not in names) for r in all_passing()]


def test_severity_follows_what_is_broken():
    assert severity_for(with_failures("health")) == "critical"
    assert severity_for(with_failures("readiness")) == "critical"
    assert severity_for(with_failures("synthetic_login")) == "high"
    assert severity_for(with_failures("ticket_api", "synthetic_login")) == "high"
    # The worst failure wins.
    assert severity_for(with_failures("ticket_api", "health")) == "critical"
    # A check nobody classified is medium.
    assert severity_for([result("something_new", ok=False)]) == "medium"


def test_only_failing_checks_are_listed():
    failing = failed_checks(with_failures("readiness", "ticket_api"))
    assert [r["check"] for r in failing] == ["readiness", "ticket_api"]
    assert failed_checks(all_passing()) == []


def test_title_names_the_failing_checks_and_severity():
    title = build_incident_title(CONFIG, with_failures("health", "synthetic_login"))
    assert title == "[Incident] IT Ticketing System: API health, Sign-in failing (CRITICAL)"


def test_issue_body_follows_the_incident_guide():
    body = build_incident_issue_body(
        CONFIG, with_failures("synthetic_login"), NOW, "https://github.com/o/r/actions/runs/1"
    )

    assert "Severity: HIGH" in body
    assert "Detected by the scheduled health check at 2026-07-01T13:00:00Z" in body
    assert "Workflow run: https://github.com/o/r/actions/runs/1" in body
    # The communication template from docs/INCIDENT_RESPONSE.md, filled in.
    assert "Status: Investigating" in body
    assert "Service: IT Ticketing System" in body
    assert "Impact: A major workflow, such as signing in or using the ticket API, is degraded." in body
    assert "Next Update: Within 30 minutes" in body
    # What failed, and how.
    assert "- **Sign-in**: Expected HTTP 200, received HTTP 503." in body
    assert "| Sign-in | FAIL | `/api/synthetic_login` |" in body
    assert "| API health | PASS | `/api/health` |" in body
    # Where to go next, and the review to fill in when it is over.
    assert "RUNBOOK.md" in body and "INCIDENT_RESPONSE.md" in body
    assert "## Post-incident review" in body


def test_issue_body_without_a_run_link_has_no_dangling_line():
    body = build_incident_issue_body(CONFIG, with_failures("health"), NOW)
    assert "Workflow run" not in body


def test_update_and_recovery_comments():
    update = build_incident_update(CONFIG, with_failures("health"), NOW, "https://x/run")
    assert update.startswith("Still failing at 2026-07-01T13:00:00Z (CRITICAL).")
    assert "**API health**" in update and "https://x/run" in update

    recovery = build_recovery_comment(CONFIG, all_passing(), NOW, "https://x/run")
    assert recovery.startswith("Recovered: all checks passed at 2026-07-01T13:00:00Z.")
    assert "| Ticket API | PASS |" in recovery
    assert "Closing this incident" in recovery


def test_a_check_with_no_failure_text_still_says_something():
    broken = [{**result("health", ok=False), "failures": []}]
    assert "The check reported a failure." in build_incident_issue_body(CONFIG, broken, NOW)


def test_monitor_writes_the_issue_files_and_outputs_on_failure(tmp_path):
    output = tmp_path / "gh_output"

    code = monitor(
        tmp_path,
        str(output),
        "https://x/run",
        config=CONFIG,
        results=with_failures("readiness"),
    )

    assert code == 1
    assert "API readiness (database)" in (tmp_path / "incident-issue.md").read_text(encoding="utf-8")
    assert (tmp_path / "incident-update.md").exists()
    assert not (tmp_path / "incident-recovery.md").exists()
    lines = output.read_text(encoding="utf-8").splitlines()
    assert "status=fail" in lines
    assert "severity=critical" in lines
    assert "title=[Incident] IT Ticketing System: API readiness (database) failing (CRITICAL)" in lines


def test_monitor_writes_a_recovery_comment_when_everything_passes(tmp_path):
    output = tmp_path / "gh_output"

    code = monitor(tmp_path, str(output), config=CONFIG, results=all_passing())

    assert code == 0
    assert output.read_text(encoding="utf-8").splitlines() == ["status=pass"]
    assert (tmp_path / "incident-recovery.md").exists()
    assert not (tmp_path / "incident-issue.md").exists()


def test_monitor_runs_the_real_checks_when_none_are_given(tmp_path, monkeypatch):
    calls = []

    def fake_report(config, output_dir):
        calls.append((config, output_dir))
        return output_dir / "status-report.md", with_failures("ticket_api")

    monkeypatch.setattr(monitor_module, "generate_status_report", fake_report)

    assert monitor(tmp_path, None, config=CONFIG) == 1
    assert calls == [(CONFIG, tmp_path)]


def test_outputs_cannot_be_injected_through_a_newline(tmp_path):
    output = tmp_path / "gh_output"
    write_outputs(str(output), {"title": "bad\nstatus=pass"})
    assert output.read_text(encoding="utf-8").splitlines() == ["title=bad status=pass"]


def test_no_output_file_is_fine(tmp_path):
    write_outputs(None, {"status": "pass"})
    assert monitor(tmp_path, None, config=CONFIG, results=all_passing()) == 0
