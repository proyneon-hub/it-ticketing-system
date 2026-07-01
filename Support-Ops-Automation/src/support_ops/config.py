from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urljoin

from dotenv import load_dotenv


@dataclass(frozen=True)
class Credential:
    role: str
    email: str
    password: str


@dataclass(frozen=True)
class SupportOpsConfig:
    app_name: str = "IT Ticketing System"
    environment: str = "local"
    base_url: str = "http://localhost:5173"
    admin_email: str = "admin@demo.local"
    admin_password: str = "AdminPass123!"
    tech_email: str = "tech@demo.local"
    tech_password: str = "TechPass123!"
    user_email: str = "user@demo.local"
    user_password: str = "UserPass123!"
    latency_threshold_ms: int = 1500
    request_timeout_seconds: float = 10.0

    def url_for(self, path: str) -> str:
        return urljoin(f"{self.base_url.rstrip('/')}/", path.lstrip("/"))

    @property
    def credentials(self) -> list[Credential]:
        return [
            Credential("admin", self.admin_email, self.admin_password),
            Credential("technician", self.tech_email, self.tech_password),
            Credential("user", self.user_email, self.user_password),
        ]


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    return int(value)


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if not value:
        return default
    return float(value)


def load_config() -> SupportOpsConfig:
    load_dotenv()
    return SupportOpsConfig(
        app_name=os.getenv("APP_NAME", "IT Ticketing System"),
        environment=os.getenv("ENVIRONMENT", "local"),
        base_url=os.getenv("BASE_URL", "http://localhost:5173"),
        admin_email=os.getenv("ADMIN_EMAIL", "admin@demo.local"),
        admin_password=os.getenv("ADMIN_PASSWORD", "AdminPass123!"),
        tech_email=os.getenv("TECH_EMAIL", "tech@demo.local"),
        tech_password=os.getenv("TECH_PASSWORD", "TechPass123!"),
        user_email=os.getenv("USER_EMAIL", "user@demo.local"),
        user_password=os.getenv("USER_PASSWORD", "UserPass123!"),
        latency_threshold_ms=_int_env("LATENCY_THRESHOLD_MS", 1500),
        request_timeout_seconds=_float_env("REQUEST_TIMEOUT_SECONDS", 10.0),
    )
