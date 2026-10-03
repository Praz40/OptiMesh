"""MQTT_TLS / MQTT_CA_FILE settings and the TLS context the MQTT bridge connects with."""

import asyncio
import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from pydantic import ValidationError

from app import mqtt
from app.config import Settings
from app.main import create_app
from app.mqtt import MqttBridge, tls_context
from app.platform import Platform

CA_NAME = "OptiMesh test CA"


@pytest.fixture(autouse=True)
def no_mqtt_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("MQTT_HOST", "MQTT_PORT", "MQTT_TLS", "MQTT_CA_FILE"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def ca_file(tmp_path: Path) -> Path:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CA_NAME)])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    path = tmp_path / "ca.pem"
    path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return path


def test_tls_is_off_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.mqtt_tls is False
    assert settings.mqtt_ca_file is None
    assert settings.mqtt_port == 1883
    assert tls_context(settings) is None


def test_tls_settings_are_read_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, ca_file: Path
) -> None:
    monkeypatch.setenv("MQTT_TLS", "true")
    monkeypatch.setenv("MQTT_CA_FILE", str(ca_file))
    monkeypatch.setenv("MQTT_PORT", "8883")
    settings = Settings(_env_file=None)
    assert settings.mqtt_tls is True
    assert settings.mqtt_ca_file == ca_file
    assert settings.mqtt_port == 8883


def test_missing_ca_file_is_rejected_at_startup(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="mqtt_ca_file"):
        Settings(_env_file=None, mqtt_tls=True, mqtt_ca_file=tmp_path / "missing.pem")


def test_ca_file_without_tls_is_rejected(ca_file: Path) -> None:
    with pytest.raises(ValidationError, match="MQTT_TLS is false"):
        Settings(_env_file=None, mqtt_ca_file=ca_file)


def test_tls_verifies_certificate_and_hostname_with_the_system_trust_store() -> None:
    context = tls_context(Settings(_env_file=None, mqtt_tls=True))
    assert context is not None
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_tls_trusts_the_configured_ca(ca_file: Path) -> None:
    context = tls_context(Settings(_env_file=None, mqtt_tls=True, mqtt_ca_file=ca_file))
    assert context is not None
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    subjects = [dict(field[0] for field in cert["subject"]) for cert in context.get_ca_certs()]
    assert {"commonName": CA_NAME} in subjects


def test_invalid_ca_file_fails_when_the_api_starts(tmp_path: Path) -> None:
    broken = tmp_path / "broken.pem"
    broken.write_text("not a certificate", encoding="utf-8")
    settings = Settings(_env_file=None, mqtt_host="broker", mqtt_tls=True, mqtt_ca_file=broken)
    with pytest.raises(ssl.SSLError):
        create_app(settings)


def test_bridge_passes_the_tls_context_to_the_mqtt_client(
    monkeypatch: pytest.MonkeyPatch, ca_file: Path
) -> None:
    calls: list[dict[str, Any]] = []

    class Stop(Exception):
        pass

    def fake_client(*args: Any, **kwargs: Any) -> None:
        calls.append({"args": args, **kwargs})
        raise Stop

    monkeypatch.setattr(mqtt.aiomqtt, "Client", fake_client)
    settings = Settings(
        _env_file=None,
        mqtt_host="broker.local",
        mqtt_port=8883,
        mqtt_tls=True,
        mqtt_ca_file=ca_file,
    )
    bridge = MqttBridge(settings, Platform(None, stale_after_s=15, command_ttl_s=15))
    with pytest.raises(Stop):
        asyncio.run(bridge.run())
    (call,) = calls
    assert call["args"] == ("broker.local", 8883)
    context = call["tls_context"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert "tls_insecure" not in call


def test_bridge_without_tls_connects_in_plain_text(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    class Stop(Exception):
        pass

    def fake_client(*args: Any, **kwargs: Any) -> None:
        calls.append(kwargs)
        raise Stop

    monkeypatch.setattr(mqtt.aiomqtt, "Client", fake_client)
    bridge = MqttBridge(
        Settings(_env_file=None, mqtt_host="127.0.0.1"),
        Platform(None, stale_after_s=15, command_ttl_s=15),
    )
    with pytest.raises(Stop):
        asyncio.run(bridge.run())
    assert calls[0]["tls_context"] is None
