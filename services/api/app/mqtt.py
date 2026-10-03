"""MQTT adapter: subscribes to device telemetry and acks, publishes commands."""

import asyncio
import json
import logging
import ssl
from collections import OrderedDict
from hashlib import sha256
from uuid import UUID

import aiomqtt
import paho.mqtt.client as paho
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.platform import DatabaseUnavailable, InvalidRequest, NotFound, Platform
from app.schemas import CommandAck, CommandMessage, Telemetry
from app.topics import Channel, device_topic, parse_device_topic, subscription

logger = logging.getLogger(__name__)
MAX_PAYLOAD_BYTES = 4096
MAX_UNEXPECTED_RETRIES = 3
MAX_RETRY_ENTRIES = 256


def tls_context(settings: Settings) -> ssl.SSLContext | None:
    """Shared verified TLS for the API bridge and simulator, with no insecure fallback."""
    if not settings.mqtt_tls:
        return None
    ca = settings.mqtt_ca_file or settings.mqtt_ca_cert
    context = ssl.create_default_context(cafile=str(ca) if ca is not None else None)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


class ReliableClient(aiomqtt.Client):
    """Isolate aiomqtt's internal Paho access for commit-before-PUBACK delivery.

    aiomqtt has no public manual-ack API. Compatibility tests cover these two
    operations against the locked aiomqtt/Paho versions.
    """

    def enable_manual_ack(self) -> None:
        self._client.manual_ack_set(True)

    def acknowledge(self, message: aiomqtt.Message) -> None:
        if self._client.ack(message.mid, message.qos) != paho.MQTT_ERR_SUCCESS:
            raise aiomqtt.MqttError("MQTT acknowledgement failed")


class MqttBridge:
    def __init__(self, settings: Settings, platform: Platform) -> None:
        if settings.mqtt_host is None:
            raise ValueError("MQTT_HOST is required")
        self._host = settings.mqtt_host
        self._port = settings.mqtt_port
        self._username = (
            settings.mqtt_username.get_secret_value() if settings.mqtt_username else None
        )
        self._password = (
            settings.mqtt_password.get_secret_value() if settings.mqtt_password else None
        )
        self._identifier = settings.mqtt_client_id
        # Load/validate the CA once at startup, before the reconnect loop.
        self._tls_context = tls_context(settings)
        self._prefix = settings.mqtt_topic_prefix
        self._telemetry_topic = settings.mqtt_telemetry_topic
        self._ack_topic = (
            self._telemetry_topic.rsplit("/", 1)[0] + "/ack"
            if self._telemetry_topic
            else subscription(self._prefix, Channel.ACK)
        )
        self._platform = platform
        self._client: aiomqtt.Client | None = None
        self._unexpected_failures: OrderedDict[tuple[str, bytes], int] = OrderedDict()

    @property
    def connected(self) -> bool:
        return self._client is not None

    async def run(self) -> None:
        """Connect and process messages forever, reconnecting with backoff."""
        delay = 1.0
        while True:
            try:
                client = ReliableClient(
                    self._host,
                    self._port,
                    username=self._username,
                    password=self._password,
                    identifier=self._identifier,
                    protocol=aiomqtt.ProtocolVersion.V311,
                    clean_session=False if self._identifier else True,
                    tls_context=self._tls_context,
                    tls_insecure=False if self._tls_context else None,
                )
                client.enable_manual_ack()
                async with client:
                    for topic in (
                        self._telemetry_topic or subscription(self._prefix, Channel.TELEMETRY),
                        self._ack_topic,
                    ):
                        granted = await client.subscribe(topic, qos=1)
                        if len(granted) != 1 or granted[0] != 1:
                            raise aiomqtt.MqttError("Broker did not grant QoS 1 subscription")
                    self._client = client
                    delay = 1.0
                    logger.info("MQTT connected; telemetry and ack subscriptions accepted")
                    async for message in client.messages:
                        if message.qos in (0, 1):
                            await self.handle(str(message.topic), message.payload)
                            if message.qos == 1:
                                client.acknowledge(message)
                        else:
                            logger.warning("Rejected unsupported MQTT delivery QoS")
            except (aiomqtt.MqttError, OSError) as error:
                # Connection, TLS and authorization errors carry no payload or credentials.
                logger.warning(
                    "MQTT disconnected; retrying in %.0fs (%s: %s)",
                    delay,
                    type(error).__name__,
                    error,
                )
            finally:
                self._client = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    async def handle(self, topic: str, payload: object) -> None:
        """Validate and dispatch one message. Bad messages are logged, never fatal."""
        parts = parse_device_topic(self._prefix, topic)
        if parts is None or parts.channel == Channel.COMMAND:
            return
        if self._telemetry_topic is not None and topic not in (
            self._telemetry_topic,
            self._ack_topic,
        ):
            return
        retry_key = None
        try:
            if not isinstance(payload, bytes | bytearray | str):
                raise ValueError("Unsupported payload type")
            encoded = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
            retry_key = (topic, sha256(encoded).digest())
            size = len(encoded)
            if not 0 < size <= MAX_PAYLOAD_BYTES:
                raise ValueError("Invalid payload size")
            data = json.loads(payload)
            if parts.channel == Channel.TELEMETRY:
                telemetry = Telemetry.model_validate(data)
                if (telemetry.site_id, telemetry.device_id) != (parts.site_id, parts.device_id):
                    raise ValueError("Payload ids do not match the topic")
                stored = await self._platform.ingest_telemetry(telemetry)
                logger.info("MQTT telemetry %s", "stored" if stored else "duplicate")
            else:
                ack = CommandAck.model_validate(data)
                await self._platform.handle_ack(parts.site_id, parts.device_id, ack)
        except (
            ValueError,
            ValidationError,
            OverflowError,
            RecursionError,
            NotFound,
            InvalidRequest,
            DatabaseUnavailable,
        ) as error:
            # ValidationError is a ValueError; listed for clarity. Log only the class name:
            # pydantic messages contain input values.
            logger.warning("Rejected invalid MQTT message on %s (%s)", topic, type(error).__name__)
        except SQLAlchemyError:
            # Database outages must not exhaust a poison-message budget and lose readings.
            raise aiomqtt.MqttError("MQTT database processing failed") from None
        except Exception:
            # Bound unexpected deterministic bugs without storing payloads or relying on
            # packet IDs (which can change on replay). Cache size is bounded too.
            assert retry_key is not None
            attempts = self._unexpected_failures.get(retry_key, 0) + 1
            self._unexpected_failures[retry_key] = attempts
            self._unexpected_failures.move_to_end(retry_key)
            if len(self._unexpected_failures) > MAX_RETRY_ENTRIES:
                self._unexpected_failures.popitem(last=False)
            if attempts < MAX_UNEXPECTED_RETRIES:
                raise aiomqtt.MqttError("MQTT message processing failed") from None
            logger.warning("Rejected MQTT message after repeated unexpected processing errors")
        if retry_key is not None:
            self._unexpected_failures.pop(retry_key, None)

    async def publish_command(
        self, site_id: UUID, device_id: UUID, message: CommandMessage
    ) -> None:
        client = self._client
        if client is None:
            raise ConnectionError("MQTT is not connected")
        await client.publish(
            device_topic(self._prefix, site_id, device_id, Channel.COMMAND),
            message.model_dump_json(),
            qos=1,
        )
