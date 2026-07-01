from support_ops.config import SupportOpsConfig
from support_ops.synthetic_login import run_synthetic_login


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeSession:
    def post(self, url, json, timeout):
        if json["password"].startswith("invalid"):
            return FakeResponse(401, {"message": "Invalid email or password."})
        if json["email"].startswith("admin"):
            return FakeResponse(200, {"token": "admin-token", "user": {"role": "admin"}})
        if json["email"].startswith("tech"):
            return FakeResponse(200, {"token": "tech-token", "user": {"role": "technician"}})
        return FakeResponse(200, {"token": "user-token", "user": {"role": "user"}})


def test_synthetic_login_checks_all_demo_roles_without_printing_passwords():
    result = run_synthetic_login(config=SupportOpsConfig(), session=FakeSession())

    assert result["status"] == "PASS"
    assert [check["role"] for check in result["checks"]] == [
        "admin",
        "technician",
        "user",
        "invalid-credentials",
    ]
    assert not result["failures"]
