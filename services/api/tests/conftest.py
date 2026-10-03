import json
import os
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import build_engine
from app.main import create_app


@pytest.fixture
def users():
    return uuid4(), uuid4()


@pytest.fixture
def signed_headers(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    public.update(kid="registry-test", alg="RS256", use="sig")

    def fetch_keys(opener, request, **kwargs):
        assert request.full_url == "https://auth.example.test/auth/v1/.well-known/jwks.json"
        return BytesIO(json.dumps({"keys": [public]}).encode())

    monkeypatch.setattr("urllib.request.OpenerDirector.open", fetch_keys)

    def headers(user_id):
        encoded = jwt.encode(
            {
                "iss": "https://auth.example.test/auth/v1",
                "aud": "authenticated",
                "role": "authenticated",
                "sub": str(user_id),
                "exp": datetime.now(UTC) + timedelta(minutes=5),
                "user_metadata": {"owner_id": str(uuid4())},
            },
            key,
            algorithm="RS256",
            headers={"kid": "registry-test"},
        )
        return {"Authorization": "Bearer " + encoded}

    return headers


@pytest.fixture
def registry_db():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    engine = build_engine(url)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            with Session(
                bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
            ) as db:
                try:
                    yield db
                finally:
                    transaction.rollback()
    finally:
        engine.dispose()


@pytest.fixture
def registry_client(registry_db, signed_headers):
    from app.dependencies import get_session

    application = create_app(
        Settings(_env_file=None, database_url=None, supabase_url="https://auth.example.test")
    )

    def test_session():
        yield registry_db

    application.dependency_overrides[get_session] = test_session
    with TestClient(application) as client:
        yield client


@pytest.fixture
def registry_data(registry_db, users):
    from app.models import Device, Site

    site = Site(owner_id=users[0], name="Office")
    other = Site(owner_id=users[1], name="Private")
    empty = Site(owner_id=users[0], name="Empty")
    registry_db.add_all([site, other, empty])
    registry_db.flush()
    device = Device(
        site_id=site.id,
        name="Battery",
        kind="battery",
        source="simulator",
        capabilities=["measure_power", "battery_soc"],
    )
    other_device = Device(site_id=other.id, name="Other load", kind="load", source="hardware")
    registry_db.add_all([device, other_device])
    registry_db.flush()
    return site, other, empty, device, other_device
