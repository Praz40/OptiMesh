import json
from datetime import UTC, datetime, timedelta
from io import BytesIO
from urllib.error import URLError
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ISSUER = "https://auth.example.test/auth/v1"


@pytest.fixture
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def auth_client(signing_key, monkeypatch):
    public_key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    public_key.update(kid="test-key", alg="RS256", use="sig")

    def fetch_keys(opener, request, **kwargs):
        assert request.full_url == ISSUER + "/.well-known/jwks.json"
        return BytesIO(json.dumps({"keys": [public_key]}).encode())

    monkeypatch.setattr("urllib.request.OpenerDirector.open", fetch_keys)
    with TestClient(
        create_app(
            Settings(_env_file=None, database_url=None, supabase_url="https://auth.example.test")
        )
    ) as client:
        yield client


def token(signing_key, **changes):
    claims = {
        "iss": ISSUER,
        "aud": "authenticated",
        "sub": str(uuid4()),
        "role": "authenticated",
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    claims.update(changes)
    return jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-key"})


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/sites"),
        ("POST", "/sites/" + str(uuid4()) + "/devices"),
        ("GET", "/sites/" + str(uuid4()) + "/measurements"),
    ],
)
def test_registry_requires_authentication(auth_client, method, path):
    response = auth_client.request(method, path)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_valid_signed_token_reaches_database_dependency(auth_client, signing_key):
    response = auth_client.post("/sites", headers={"Authorization": "Bearer " + token(signing_key)})
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://other.example.test/auth/v1"},
        {"aud": "other-service"},
        {"exp": datetime(2000, 1, 1, tzinfo=UTC)},
        {"sub": "not-a-user-uuid"},
        {"sub": None},
        {"role": "service_role"},
        {"nbf": datetime.now(UTC) + timedelta(hours=1)},
        {"exp": None},
    ],
)
def test_invalid_claims_cannot_access_registry(auth_client, signing_key, changes):
    response = auth_client.post(
        "/sites", headers={"Authorization": "Bearer " + token(signing_key, **changes)}
    )
    assert response.status_code == 401


@pytest.mark.parametrize("claim", ["iss", "aud", "exp", "sub"])
def test_required_claims_cannot_be_omitted(auth_client, signing_key, claim):
    claims = jwt.decode(
        token(signing_key), signing_key.public_key(), algorithms=["RS256"], audience="authenticated"
    )
    claims.pop(claim)
    encoded = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-key"})
    assert (
        auth_client.post("/sites", headers={"Authorization": "Bearer " + encoded}).status_code
        == 401
    )


def test_forged_signature_cannot_access_registry(auth_client):
    forged_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert (
        auth_client.post(
            "/sites", headers={"Authorization": "Bearer " + token(forged_key)}
        ).status_code
        == 401
    )


@pytest.mark.parametrize(
    "encoded",
    [
        "broken",
        "x" * 9000,
        jwt.encode(
            {"sub": str(uuid4())},
            "a sufficiently long attacker secret for HS256",
            algorithm="HS256",
        ),
    ],
    ids=["malformed", "oversized", "unsupported-algorithm"],
)
def test_malformed_or_unsupported_tokens_are_rejected(auth_client, encoded):
    assert (
        auth_client.post("/sites", headers={"Authorization": "Bearer " + encoded}).status_code
        == 401
    )


def test_jwks_outage_is_controlled(auth_client, signing_key, monkeypatch):
    def unavailable(*args, **kwargs):
        raise URLError("sensitive-host-details")

    monkeypatch.setattr("urllib.request.OpenerDirector.open", unavailable)
    response = auth_client.post("/sites", headers={"Authorization": "Bearer " + token(signing_key)})
    assert response.status_code == 503
    assert "sensitive-host-details" not in response.text


def test_missing_auth_configuration_fails_closed():
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        response = client.post("/sites", headers={"Authorization": "Bearer ignored"})
        assert response.status_code == 503
        assert response.json() == {"detail": "Authentication unavailable"}


@pytest.mark.parametrize(
    "payload",
    [
        b"not-json",
        b'{"keys":[]}',
        b'{"invalid":[]}',
        b'{"keys":[{"kty":"invalid","kid":"test-key"}]}',
    ],
)
def test_auth_provider_invalid_responses_are_unavailable(
    auth_client, signing_key, monkeypatch, payload
):
    monkeypatch.setattr(
        "urllib.request.OpenerDirector.open", lambda *args, **kwargs: BytesIO(payload)
    )
    response = auth_client.post("/sites", headers={"Authorization": "Bearer " + token(signing_key)})
    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication unavailable"}


def test_unknown_signing_key_is_invalid_authentication(auth_client, signing_key):
    claims = jwt.decode(
        token(signing_key), signing_key.public_key(), algorithms=["RS256"], audience="authenticated"
    )
    encoded = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "unknown"})
    assert (
        auth_client.post("/sites", headers={"Authorization": "Bearer " + encoded}).status_code
        == 401
    )


def test_es256_project_tokens_are_verified(auth_client, monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    public = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))
    public.update(kid="ec-key", alg="ES256", use="sig")
    monkeypatch.setattr(
        "urllib.request.OpenerDirector.open",
        lambda *args, **kwargs: BytesIO(json.dumps({"keys": [public]}).encode()),
    )
    encoded = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "authenticated",
            "role": "authenticated",
            "sub": str(uuid4()),
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        key,
        algorithm="ES256",
        headers={"kid": "ec-key"},
    )
    response = auth_client.post("/sites", headers={"Authorization": "Bearer " + encoded})
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
