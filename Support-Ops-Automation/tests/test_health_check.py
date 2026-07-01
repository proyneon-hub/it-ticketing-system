from support_ops.config import SupportOpsConfig
from support_ops.health_check import run_health_check


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

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
