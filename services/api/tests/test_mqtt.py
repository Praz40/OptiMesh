import json
import logging
import ssl
import struct
from datetime import UTC, datetime, timedelta
from threading import Event
from unittest.mock import Mock
from uuid import uuid4

import paho.mqtt.client as mqtt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.main import create_app
from app.mqtt import MqttSubscriber
from app.telemetry_ingest import IngestOutcome, PermanentRejection


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
def subscriber(settings):
    return MqttSubscriber(settings, Mock())


def fake_client():
    client = Mock()
    client.subscribe.return_value = (mqtt.MQTT_ERR_SUCCESS, 42)
    client.ack.return_value = mqtt.MQTT_ERR_SUCCESS
    return client


def message(subscriber, payload=b"{}", qos=1):
    result = mqtt.MQTTMessage(mid=17)
    result.topic = subscriber._topic.encode()
    result.payload = payload
    result.qos = qos
    return result


def test_secure_client_and_secret_redaction(subscriber, settings):
    client = subscriber._client
    assert client._manual_ack is True
    assert client._clean_session is False
    assert client._protocol == mqtt.MQTTv311
    assert client._client_id == settings.mqtt_client_id.encode()
    assert client._ssl_context.check_hostname is True
    assert client._ssl_context.verify_mode == ssl.CERT_REQUIRED
    assert client._ssl_context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert settings.mqtt_password.get_secret_value() not in repr(settings)
    assert settings.mqtt_username.get_secret_value() not in repr(settings)


def test_invalid_ca_fails_closed(settings, tmp_path):
    settings.mqtt_ca_cert = tmp_path / "absent-ca.crt"
    with pytest.raises(OSError):
        MqttSubscriber(settings, Mock())


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
        {"mqtt_telemetry_topic": None},
        {"mqtt_telemetry_topic": "optimesh/v1/sites/+/devices/+/telemetry"},
        {"mqtt_host": "mqtts://user:secret@broker"},
        {"mqtt_port": 0},
    ],
)
def test_incomplete_configuration_is_rejected_without_exposing_input(settings, changes):
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **(settings.model_dump() | changes))
    assert "backend-password-private" not in str(error.value)
    assert "backend-user-private" not in str(error.value)
    assert "input_value" not in str(error.value)


def test_reconnect_resubscribes_and_waits_for_qos1_suback(subscriber):
    client = fake_client()
    for _ in range(2):
        subscriber._on_connect(
            client, None, mqtt.ConnectFlags(False), ReasonCode(PacketTypes.CONNACK), None
        )
        assert subscriber.status == "disconnected"
        subscriber._on_subscribe(
            client, None, 42, [ReasonCode(PacketTypes.SUBACK, identifier=1)], None
        )
        assert subscriber.status == "connected"
        subscriber._on_disconnect(
            client, None, mqtt.DisconnectFlags(False), ReasonCode(PacketTypes.DISCONNECT), None
        )
        assert subscriber.status == "disconnected"
    assert client.subscribe.call_count == 2
    client.subscribe.assert_called_with(subscriber._topic, qos=1)


@pytest.mark.parametrize("granted", [0, 128])
def test_rejected_or_downgraded_subscription_is_not_connected(subscriber, granted):
    client = fake_client()
    subscriber._subscription_mid = 42
    subscriber._on_subscribe(
        client, None, 42, [ReasonCode(PacketTypes.SUBACK, identifier=granted)], None
    )
    assert subscriber.status == "disconnected"
    client.disconnect.assert_called_once()


def test_connect_and_subscribe_send_failure(subscriber):
    client = fake_client()
    subscriber._on_connect(
        client,
        None,
        mqtt.ConnectFlags(False),
        ReasonCode(PacketTypes.CONNACK, identifier=135),
        None,
    )
    client.subscribe.assert_not_called()
    assert subscriber.status == "disconnected"
    client.subscribe.return_value = (mqtt.MQTT_ERR_NO_CONN, None)
    subscriber._on_connect(
        client, None, mqtt.ConnectFlags(False), ReasonCode(PacketTypes.CONNACK), None
    )
    client.disconnect.assert_called_once()


@pytest.mark.parametrize("outcome", [IngestOutcome.STORED, IngestOutcome.DUPLICATE])
def test_ack_is_sent_only_after_ingestion_returns_success(subscriber, outcome):
    client = fake_client()
    events = []

    def ingest(*args):
        events.append("committed")
        return outcome

    subscriber._ingestor = Mock(ingest=ingest)
    client.ack.side_effect = lambda *args: events.append("ack") or mqtt.MQTT_ERR_SUCCESS
    subscriber._on_message(client, None, message(subscriber))
    assert events == ["committed", "ack"]
    client.ack.assert_called_once_with(17, 1)


def test_permanent_rejection_is_consumed_without_logging_payload_or_error(subscriber, caplog):
    client = fake_client()
    subscriber._ingestor = Mock()
    subscriber._ingestor.ingest.side_effect = PermanentRejection("SECRET input")
    with caplog.at_level(logging.INFO):
        subscriber._on_message(client, None, message(subscriber, b"SECRET payload"))
    client.ack.assert_called_once_with(17, 1)
    client.disconnect.assert_not_called()
    assert "permanently rejected" in caplog.text
    assert "SECRET" not in caplog.text


@pytest.mark.parametrize("payload", [b"not json", b"{}", b"[]", b"\xff"])
def test_real_validation_errors_are_consumed(subscriber, payload):
    client = fake_client()
    subscriber._on_message(client, None, message(subscriber, payload))
    client.ack.assert_called_once_with(17, 1)
    client.disconnect.assert_not_called()


def test_real_topic_payload_mismatch_is_consumed(subscriber):
    client = fake_client()
    data = {
        "version": 1,
        "site_id": str(uuid4()),
        "device_id": str(uuid4()),
        "message_id": str(uuid4()),
        "observed_at": "2026-10-03T12:00:00Z",
        "metrics": {"power_w": 10},
    }
    subscriber._on_message(client, None, message(subscriber, json.dumps(data).encode()))
    client.ack.assert_called_once_with(17, 1)


@pytest.mark.parametrize("invalid_topic", [b"unrelated/telemetry", b"\xff"])
def test_outside_subscription_or_invalid_encoding_is_consumed(subscriber, invalid_topic):
    client = fake_client()
    subscriber._ingestor = Mock()
    delivery = message(subscriber)
    delivery.topic = invalid_topic
    subscriber._on_message(client, None, delivery)
    client.ack.assert_called_once_with(17, 1)
    subscriber._ingestor.ingest.assert_not_called()


def test_transient_failure_is_unacknowledged_then_redelivery_can_succeed(subscriber, caplog):
    client = fake_client()
    subscriber._ingestor = Mock()
    subscriber._ingestor.ingest.side_effect = [
        OperationalError("SECRET query", {}, Exception("SECRET credentials")),
        IngestOutcome.STORED,
    ]
    subscriber._connected.set()
    with caplog.at_level(logging.INFO):
        subscriber._on_message(client, None, message(subscriber))
    client.ack.assert_not_called()
    client.disconnect.assert_called_once()
    assert subscriber.status == "disconnected"
    assert "SECRET" not in caplog.text
    subscriber._on_message(client, None, message(subscriber))
    client.ack.assert_called_once_with(17, 1)


def test_ack_send_failure_disconnects_for_duplicate_redelivery(subscriber):
    client = fake_client()
    client.ack.return_value = mqtt.MQTT_ERR_NO_CONN
    subscriber._ingestor = Mock()
    subscriber._ingestor.ingest.return_value = IngestOutcome.STORED
    subscriber._on_message(client, None, message(subscriber))
    client.disconnect.assert_called_once()


def test_qos0_is_rejected_without_persistence(subscriber):
    client = fake_client()
    subscriber._ingestor = Mock()
    subscriber._on_message(client, None, message(subscriber, qos=0))
    subscriber._ingestor.ingest.assert_not_called()
    client.ack.assert_not_called()


def test_stopping_worker_does_not_ack_new_delivery(subscriber):
    client = fake_client()
    subscriber._stop.set()
    subscriber._on_message(client, None, message(subscriber))
    client.ack.assert_not_called()


def test_worker_starts_and_stops_without_network_or_lingering_thread(subscriber):
    client = fake_client()
    running, disconnected = Event(), Event()

    def loop(**kwargs):
        running.set()
        assert disconnected.wait(2)

    client.loop_forever.side_effect = loop
    client.disconnect.side_effect = disconnected.set
    subscriber._client = client
    subscriber.start()
    assert running.wait(2)
    with pytest.raises(RuntimeError):
        subscriber.start()
    subscriber.stop()
    assert not subscriber._thread.is_alive()
    assert subscriber.status == "disconnected"
    client.connect_async.assert_called_once_with("broker.example.test", 8883, keepalive=60)


def test_supervisor_reconnects_same_client_after_processing_disconnect(subscriber):
    client = fake_client()
    waits = []
    stop = Mock()
    stop.is_set.return_value = False
    stop.wait.side_effect = lambda delay: waits.append(delay) or len(waits) == 2
    subscriber._client = client
    subscriber._stop = stop
    subscriber._run()
    assert client.connect_async.call_count == 2
    assert client.loop_forever.call_count == 2
    assert waits == [1.0, 2.0]


def test_status_disabled_and_no_subscriber_creation(monkeypatch):
    constructor = Mock()
    monkeypatch.setattr("app.main.MqttSubscriber", constructor)
    with TestClient(create_app(Settings(_env_file=None, database_url=None))) as client:
        assert client.get("/status").json() == {"mqtt": "disabled"}
        assert client.get("/health").status_code == 200
    constructor.assert_not_called()


def test_lifespan_status_and_shutdown_order(settings, monkeypatch):
    events = []
    engine = Mock()
    engine.dispose.side_effect = lambda: events.append("dispose")
    bridge = Mock(status="disconnected")
    bridge.start.side_effect = lambda: events.append("start")
    bridge.stop.side_effect = lambda: events.append("stop")
    monkeypatch.setattr("app.main.build_engine", lambda url: engine)
    monkeypatch.setattr("app.main.MqttSubscriber", lambda config, engine: bridge)
    with TestClient(create_app(settings)) as client:
        assert client.get("/status").json() == {"mqtt": "disconnected"}
        bridge.status = "connected"
        assert client.get("/status").json() == {"mqtt": "connected"}
        assert events == ["start"]
    assert events == ["start", "stop", "dispose"]


def test_installed_paho_receive_path_requires_explicit_qos1_ack(monkeypatch):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, manual_ack=True)
    puback = Mock(return_value=mqtt.MQTT_ERR_SUCCESS)
    monkeypatch.setattr(client, "_send_puback", puback)
    observed = []
    client.on_message = lambda client, userdata, message: observed.append(message.mid)
    wire_topic = b"test/telemetry"
    client._in_packet["command"] = mqtt.PUBLISH | 2
    client._in_packet["packet"] = (
        struct.pack("!H", len(wire_topic)) + wire_topic + struct.pack("!H", 17) + b"{}"
    )
    assert client._handle_publish() == mqtt.MQTT_ERR_SUCCESS
    assert observed == [17]
    puback.assert_not_called()
    assert client.ack(17, 1) == mqtt.MQTT_ERR_SUCCESS
    puback.assert_called_once_with(17)


def test_installed_paho_initial_connection_retry_can_be_stopped(subscriber, monkeypatch):
    attempted = Event()

    def unavailable():
        attempted.set()
        raise OSError("synthetic connection failure")

    monkeypatch.setattr(subscriber._client, "reconnect", unavailable)
    subscriber.start()
    try:
        assert attempted.wait(2)
    finally:
        subscriber.stop()
    assert not subscriber._thread.is_alive()
    assert subscriber.status == "disconnected"


def test_installed_paho_network_loop_exits_after_database_failure(subscriber, monkeypatch):
    subscriber._ingestor = Mock()
    subscriber._ingestor.ingest.side_effect = OperationalError("commit", {}, Exception())
    puback = Mock(return_value=mqtt.MQTT_ERR_SUCCESS)
    monkeypatch.setattr(subscriber._client, "_send_puback", puback)
    iterations = []

    def network_loop(timeout):
        iterations.append(True)
        subscriber._on_message(subscriber._client, None, message(subscriber))
        return mqtt.MQTT_ERR_NO_CONN

    monkeypatch.setattr(subscriber._client, "_loop", network_loop)
    result = subscriber._client.loop_forever()
    assert result == mqtt.MQTT_ERR_NO_CONN
    assert iterations == [True]
    puback.assert_not_called()


@pytest.mark.parametrize("offset", [timedelta(hours=-25), timedelta(minutes=6)])
def test_stale_or_future_telemetry_is_consumed_without_opening_database(
    subscriber, monkeypatch, offset
):
    now = datetime(2026, 10, 3, 12, tzinfo=UTC)
    monkeypatch.setattr("app.telemetry_ingest._utc_now", lambda: now)
    segments = subscriber._topic.split("/")
    data = {
        "version": 1,
        "site_id": segments[3],
        "device_id": segments[5],
        "message_id": str(uuid4()),
        "observed_at": (now + offset).isoformat(),
        "metrics": {"power_w": 1200, "energy_wh": 1.5},
    }
    factory = Mock()
    subscriber._ingestor._session_factory = factory
    client = fake_client()
    subscriber._on_message(client, None, message(subscriber, json.dumps(data).encode()))
    factory.assert_not_called()
    client.ack.assert_called_once_with(17, 1)
    client.disconnect.assert_not_called()
