from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_liveness_without_database() -> None:
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "optimesh-api"}


def test_readiness_without_database_does_not_leak_configuration() -> None:
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"detail": "Database unavailable"}


def test_untrusted_origin_is_not_allowed() -> None:
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        response = client.get("/health", headers={"Origin": "https://untrusted.example"})
        assert "access-control-allow-origin" not in response.headers
