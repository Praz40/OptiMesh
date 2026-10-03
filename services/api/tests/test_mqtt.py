import asyncio
import ssl
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import aiomqtt
import paho.mqtt.client as paho
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app
from app.mqtt import MqttBridge, ReliableClient
from app.platform import InvalidRequest, Platform
from app.schemas import CommandMessage, Telemetry


@pytest.fixture(scope="session")
def ca_path(tmp_path_factory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Local test CA")])
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
    path = tmp_path_factory.mktemp("mqtt") / "ca.crt"
    path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return path


@pytest.fixture
def settings(ca_path):
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test@localhost/test",
        mqtt_host="broker.example.test",
        mqtt_ca_cert=ca_path,
        mqtt_username="backend-user-private",
        mqtt_password="backend-password-private",
        mqtt_client_id="unit-test-subscriber",
        mqtt_telemetry_topic=f"optimesh/v1/sites/{uuid4()}/devices/{uuid4()}/telemetry",
    )


@pytest.fixture
def bridge(settings):
    platform = Mock()
    platform.ingest_telemetry = AsyncMock(return_value=True)
    platform.handle_ack = AsyncMock()
    return MqttBridge(settings, platform)


def reading(settings, at=None):
    parts = settings.mqtt_telemetry_topic.split("/")
    return Telemetry.model_validate(
        {
            "version": 1,
            "site_id": parts[3],
            "device_id": parts[5],
            "message_id": str(uuid4()),
            "observed_at": at or datetime.now(UTC),
            "metrics": {"power_w": 1200, "energy_wh": 42},
        }
    )


def test_verified_tls_and_secret_redaction(bridge, settings):
    context = bridge._tls_context
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert bridge._identifier == settings.mqtt_client_id
    assert settings.mqtt_password.get_secret_value() not in repr(settings)
    assert settings.mqtt_username.get_secret_value() not in repr(settings)


def test_invalid_ca_fails_closed(settings, tmp_path):
    settings.mqtt_ca_cert = tmp_path / "absent-ca.crt"
    with pytest.raises(OSError):
        MqttBridge(settings, Mock())


@pytest.mark.parametrize(
    "changes",
    [
        {"database_url": None},
        {"mqtt_ca_cert": None},
        {"mqtt_username": None},
        {"mqtt_username": ""},
        {"mqtt_password": None},
        {"mqtt_password": ""},
        {"mqtt_client_id": None},
        {"mqtt_client_id": ""},
        {"mqtt_telemetry_topic": "optimesh/v1/sites/+/devices/+/telemetry"},
        {"mqtt_host": "mqtts://user:secret@broker"},
        {"mqtt_port": 0},
        {"mqtt_tls": False},
        {"mqtt_topic_prefix": "optimesh/+"},
    ],
)
def test_invalid_configuration_hides_input(settings, changes):
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **(settings.model_dump() | changes))
    assert "backend-password-private" not in str(error.value)
    assert "backend-user-private" not in str(error.value)
    assert "input_value" not in str(error.value)


def test_plaintext_is_explicit_anonymous_loopback_only():
    local = Settings(_env_file=None, mqtt_host="localhost", mqtt_port=1883, mqtt_tls=False)
    assert MqttBridge(local, Mock())._tls_context is None
    for changes in ({"mqtt_host": "192.168.0.23"}, {"mqtt_password": "private"}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **(local.model_dump() | changes))


def test_wildcard_scope_supported_with_tls(settings):
    settings.mqtt_telemetry_topic = None
    mqtt = MqttBridge(settings, Mock())
    assert mqtt._ack_topic == "optimesh/v1/sites/+/devices/+/ack"


def test_reliable_client_compatibility(settings):
    async def scenario():
        client = ReliableClient(
            "localhost",
            identifier="test",
            clean_session=False,
            protocol=aiomqtt.ProtocolVersion.V311,
        )
        client.enable_manual_ack()
        assert client._client._manual_ack is True
        assert client._client._clean_session is False
        client._client.ack = Mock(return_value=paho.MQTT_ERR_SUCCESS)
        message = aiomqtt.Message(settings.mqtt_telemetry_topic, b"{}", 1, False, 17, None)
        client.acknowledge(message)
        client._client.ack.assert_called_once_with(17, 1)
        client._client.ack.return_value = paho.MQTT_ERR_NO_CONN
        with pytest.raises(aiomqtt.MqttError):
            client.acknowledge(message)

    asyncio.run(scenario())


@pytest.mark.parametrize("payload", [b"not json", b"{}", b"[]", b"\xff", b"x" * 4097])
def test_rejected_payload_does_not_expose_content(bridge, settings, payload, caplog):
    asyncio.run(bridge.handle(settings.mqtt_telemetry_topic, payload))
    bridge._platform.ingest_telemetry.assert_not_called()
    assert "Rejected invalid MQTT message" in caplog.text
    assert "input_value" not in caplog.text


def test_topic_payload_and_exact_scope(bridge, settings):
    value = reading(settings)
    spoofed = value.model_copy(update={"device_id": uuid4()})
    asyncio.run(bridge.handle(settings.mqtt_telemetry_topic, spoofed.model_dump_json().encode()))
    asyncio.run(
        bridge.handle(
            settings.mqtt_telemetry_topic.replace(str(value.device_id), str(uuid4())),
            value.model_dump_json().encode(),
        )
    )
    bridge._platform.ingest_telemetry.assert_not_called()
    asyncio.run(bridge.handle(settings.mqtt_telemetry_topic, value.model_dump_json().encode()))
    bridge._platform.ingest_telemetry.assert_awaited_once_with(value)


def test_ack_and_command_support_preserved(bridge, settings):
    ack = (
        '{"version":1,"command_id":"'
        + str(uuid4())
        + '","status":"applied","observed_at":"2026-10-03T12:00:00Z"}'
    )
    asyncio.run(bridge.handle(bridge._ack_topic, ack.encode()))
    bridge._platform.handle_ack.assert_awaited_once()
    now = datetime.now(UTC)
    command = CommandMessage.model_validate(
        {
            "version": 1,
            "command_id": uuid4(),
            "issued_at": now,
            "expires_at": now + timedelta(seconds=15),
            "type": "switch",
            "params": {"on": True},
        }
    )
    value = reading(settings)
    with pytest.raises(ConnectionError):
        asyncio.run(bridge.publish_command(value.site_id, value.device_id, command))
    bridge._client = Mock(publish=AsyncMock())
    asyncio.run(bridge.publish_command(value.site_id, value.device_id, command))
    bridge._client.publish.assert_awaited_once_with(
        settings.mqtt_telemetry_topic.rsplit("/", 1)[0] + "/command",
        command.model_dump_json(),
        qos=1,
    )


def test_transient_failure_requests_reconnect(bridge, settings):
    bridge._platform.ingest_telemetry.side_effect = RuntimeError("private database URI")
    with pytest.raises(aiomqtt.MqttError, match="processing failed") as error:
        asyncio.run(
            bridge.handle(settings.mqtt_telemetry_topic, reading(settings).model_dump_json())
        )
    assert "private" not in str(error.value)


@pytest.mark.parametrize(
    "offset,accepted",
    [
        (-timedelta(hours=24, microseconds=1), False),
        (-timedelta(hours=24), True),
        (timedelta(0), True),
        (timedelta(minutes=5), True),
        (timedelta(minutes=5, microseconds=1), False),
    ],
)
def test_platform_freshness_before_database(settings, offset, accepted):
    now = datetime(2026, 10, 3, 12, tzinfo=UTC)
    platform = Platform(None, stale_after_s=15, command_ttl_s=15, clock=lambda: now)
    platform.find_device = Mock(return_value=object())
    platform._store_measurement = Mock(return_value=True)
    value = reading(settings, at=now + offset)
    if accepted:
        assert asyncio.run(platform.ingest_telemetry(value)) is True
        platform._store_measurement.assert_called_once_with(value)
    else:
        with pytest.raises(InvalidRequest):
            asyncio.run(platform.ingest_telemetry(value))
        platform.find_device.assert_not_called()
        platform._store_measurement.assert_not_called()


@pytest.mark.parametrize(
    "at", [datetime(1, 1, 1, tzinfo=UTC), datetime(9999, 12, 31, 23, 59, 59, tzinfo=UTC)]
)
def test_extreme_timestamps_rejected(settings, at):
    platform = Platform(None, stale_after_s=15, command_ttl_s=15)
    with pytest.raises(InvalidRequest):
        asyncio.run(platform.ingest_telemetry(reading(settings, at)))


def test_duplicate_does_not_update_live_or_broadcast(settings):
    now = datetime.now(UTC)
    platform = Platform(None, stale_after_s=15, command_ttl_s=15, clock=lambda: now)
    platform.find_device = Mock(return_value=object())
    platform._store_measurement = Mock(return_value=False)
    platform.live.record = Mock()
    platform.broadcast_snapshot = AsyncMock()
    assert asyncio.run(platform.ingest_telemetry(reading(settings, now))) is False
    platform.live.record.assert_not_called()
    platform.broadcast_snapshot.assert_not_called()


@pytest.mark.parametrize("failure", ["transient", "permanent", "duplicate", "suback", "qos0"])
def test_run_ack_after_processing_and_reconnect(bridge, settings, monkeypatch, failure):
    events = []
    clients = []
    delays = []
    value = reading(settings)
    message = aiomqtt.Message(
        settings.mqtt_telemetry_topic,
        value.model_dump_json().encode(),
        0 if failure == "qos0" else 1,
        False,
        17,
        None,
    )

    class Client:
        def __init__(self, *args, **kwargs):
            clients.append(self)
            self.kwargs = kwargs

        def enable_manual_ack(self):
            events.append("manual")

        async def __aenter__(self):
            events.append("connect")
            return self

        async def __aexit__(self, *args):
            assert bridge.connected is (failure != "suback")

        async def subscribe(self, topic, qos):
            events.append(topic)
            assert not bridge.connected
            assert qos == 1
            return (0,) if failure == "suback" else (1,)

        @property
        def messages(self):
            async def messages():
                assert bridge.connected
                yield message
                raise aiomqtt.MqttError("disconnect")

            return messages()

        def acknowledge(self, delivery):
            events.append("ack")
            assert delivery is message

    async def ingest(telemetry):
        events.append("persist")
        if failure == "transient":
            raise RuntimeError("DB failure")
        if failure == "permanent":
            raise InvalidRequest("stale")
        return False

    bridge._platform.ingest_telemetry = AsyncMock(side_effect=ingest)

    async def sleep(delay):
        assert not bridge.connected
        delays.append(delay)
        if len(delays) == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr("app.mqtt.ReliableClient", Client)
    monkeypatch.setattr("app.mqtt.asyncio.sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(bridge.run())
    assert len(clients) == 2
    assert events.index("manual") < events.index("connect")
    assert clients[0].kwargs["identifier"] == settings.mqtt_client_id
    assert clients[0].kwargs["clean_session"] is False
    assert clients[0].kwargs["tls_insecure"] is False
    assert clients[0].kwargs["tls_context"] is bridge._tls_context
    assert settings.mqtt_telemetry_topic in events
    if failure == "suback":
        assert delays == [1, 2]
    else:
        assert bridge._ack_topic in events
    if failure in ("permanent", "duplicate"):
        assert events.index("persist") < events.index("ack")
    else:
        assert "ack" not in events


def test_status_alias_disabled():
    app = create_app(Settings(_env_file=None))
    with TestClient(app) as client:
        assert client.get("/status").json() == {"mqtt": "disabled"}
        assert client.get("/api/v1/status").json() == {"mqtt": "disabled"}


def test_anonymous_local_client_does_not_require_tls():
    async def scenario():
        client = ReliableClient("localhost", tls_context=None, tls_insecure=None)
        client.enable_manual_ack()
        client._set_tls_params()
        assert client._client._ssl_context is None

    asyncio.run(scenario())


def test_compose_broker_configuration():
    local = Settings(_env_file=None, mqtt_host="mqtt", mqtt_port=1883, mqtt_tls=False)
    assert MqttBridge(local, Mock())._tls_context is None
