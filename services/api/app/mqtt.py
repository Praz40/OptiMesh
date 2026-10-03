"""MQTT adapter: subscribes to device telemetry and acks, publishes commands."""

import asyncio
import json
import logging
from uuid import UUID

import aiomqtt
from pydantic import ValidationError

from app.config import Settings
from app.platform import InvalidRequest, NotFound, Platform
from app.schemas import CommandAck, CommandMessage, Telemetry
from app.topics import Channel, device_topic, parse_device_topic, subscription

logger = logging.getLogger(__name__)


class MqttBridge:
    def __init__(self, settings: Settings, platform: Platform) -> None:
        if settings.mqtt_host is None:
            raise ValueError("MQTT_HOST is required")
        self._host = settings.mqtt_host
        self._port = settings.mqtt_port
        self._username = settings.mqtt_username
        self._password = (
            settings.mqtt_password.get_secret_value() if settings.mqtt_password else None
        )
        self._prefix = settings.mqtt_topic_prefix
        self._platform = platform
        self._client: aiomqtt.Client | None = None

    @property
    def connected(self) -> bool:
        return self._client is not None

    async def run(self) -> None:
        """Connect and process messages forever, reconnecting with backoff."""
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    self._host,
                    self._port,
                    username=self._username,
                    password=self._password,
                    identifier=None,
                ) as client:
                    await client.subscribe(subscription(self._prefix, Channel.TELEMETRY), qos=1)
                    await client.subscribe(subscription(self._prefix, Channel.ACK), qos=1)
                    self._client = client
                    delay = 1.0
                    logger.info("MQTT connected to %s:%s", self._host, self._port)
                    async for message in client.messages:
                        await self.handle(str(message.topic), message.payload)
            except aiomqtt.MqttError as error:
                logger.warning("MQTT disconnected (%s); retrying in %.0fs", error, delay)
            finally:
                self._client = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    async def handle(self, topic: str, payload: object) -> None:
        """Validate and dispatch one message. Bad messages are logged, never fatal."""
        parts = parse_device_topic(self._prefix, topic)
        if parts is None or parts.channel == Channel.COMMAND:
            return
        try:
            if not isinstance(payload, bytes | bytearray | str):
                raise ValueError("Unsupported payload type")
            data = json.loads(payload)
            if parts.channel == Channel.TELEMETRY:
                telemetry = Telemetry.model_validate(data)
                if (telemetry.site_id, telemetry.device_id) != (parts.site_id, parts.device_id):
                    raise ValueError("Payload ids do not match the topic")
                await self._platform.ingest_telemetry(telemetry)
            else:
                ack = CommandAck.model_validate(data)
                await self._platform.handle_ack(parts.site_id, parts.device_id, ack)
        except (ValueError, ValidationError, NotFound, InvalidRequest) as error:
            # ValidationError is a ValueError; listed for clarity.
            logger.warning("Rejected MQTT message on %s: %s", topic, error)
        except Exception:
            logger.exception("Failed to process MQTT message on %s", topic)

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
