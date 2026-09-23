from support_ops.config import SupportOpsConfig
from support_ops.health_check import run_health_check, run_readiness_check


class FakeResponse:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.requested_url = None

    def get(self, url, timeout):
        self.requested_url = url
        return self.response


def test_health_check_passes_for_expected_response():
    config = SupportOpsConfig(base_url="https://example.test", latency_threshold_ms=5000)
    session = FakeSession(FakeResponse(200, {"ok": True, "service": "it-ticketing-system"}))

    result = run_health_check(config=config, session=session)

    assert result["status"] == "PASS"
    assert result["endpoint"] == "/api/health"
    assert session.requested_url == "https://example.test/api/health"


def test_health_check_fails_for_bad_payload():
    config = SupportOpsConfig(base_url="https://example.test")
    session = FakeSession(FakeResponse(200, {"ok": False}))

    result = run_health_check(config=config, session=session)

    assert result["status"] == "FAIL"
    assert "Expected response body field `ok` to be true." in result["failures"]


def test_readiness_check_passes_and_records_the_request_id():
    config = SupportOpsConfig(base_url="https://example.test", latency_threshold_ms=5000)
    payload = {"ok": True, "database": "up", "service": "it-ticketing-system"}
    session = FakeSession(FakeResponse(200, payload, headers={"x-request-id": "req-123"}))

    result = run_readiness_check(config=config, session=session)

    assert result["status"] == "PASS"
    assert result["check"] == "readiness"
    assert result["request_id"] == "req-123"
    assert session.requested_url == "https://example.test/api/ready"


def test_readiness_check_fails_when_the_database_is_down():
    config = SupportOpsConfig(base_url="https://example.test", latency_threshold_ms=5000)
    payload = {"ok": False, "database": "down", "service": "it-ticketing-system"}
    session = FakeSession(FakeResponse(503, payload, headers={"x-request-id": "req-503"}))

    result = run_readiness_check(config=config, session=session)

    assert result["status"] == "FAIL"
    assert "Expected HTTP 200, received HTTP 503." in result["failures"]
    assert "Expected database to be up, received 'down'." in result["failures"]
    assert result["request_id"] == "req-503"


def test_readiness_check_reports_an_unreachable_service():
    import requests

    class DownSession:
        def get(self, url, timeout):
            raise requests.ConnectionError("connection refused")

    config = SupportOpsConfig(base_url="https://example.test")

    result = run_readiness_check(config=config, session=DownSession())

    assert result["status"] == "FAIL"
    assert result["status_code"] is None
    assert "connection refused" in result["failures"][0]
