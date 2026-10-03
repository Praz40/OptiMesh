"""A telemetry-only MQTT 3.1.1 subscriber with commit-before-PUBACK processing."""

import logging
import ssl
from threading import Event, Thread
from typing import Literal

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.properties import Properties
from paho.mqtt.reasoncodes import ReasonCode
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.telemetry_ingest import PermanentRejection, TelemetryIngestor

logger = logging.getLogger(__name__)
MqttStatus = Literal["disconnected", "connected"]


class MqttSubscriber:
    def __init__(self, settings: Settings, engine: Engine) -> None:
        assert settings.mqtt_host is not None
        assert settings.mqtt_ca_cert is not None
        assert settings.mqtt_username is not None
        assert settings.mqtt_password is not None
        assert settings.mqtt_client_id is not None
        assert settings.mqtt_telemetry_topic is not None
        self._host = settings.mqtt_host
        self._port = settings.mqtt_port
        self._topic = settings.mqtt_telemetry_topic
        self._ingestor = TelemetryIngestor(sessionmaker(engine))
        self._stop = Event()
        self._connected = Event()
        self._thread: Thread | None = None
        self._subscription_mid: int | None = None
        self._retry_delay = 1.0
        self._client = mqtt.Client(
            CallbackAPIVersion.VERSION2,
            client_id=settings.mqtt_client_id,
            clean_session=False,
            protocol=mqtt.MQTTv311,
            manual_ack=True,
        )
        context = ssl.create_default_context(cafile=str(settings.mqtt_ca_cert))
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self._client.tls_set_context(context)
        self._client.username_pw_set(
            settings.mqtt_username.get_secret_value(), settings.mqtt_password.get_secret_value()
        )
        self._client.connect_timeout = 3
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._on_connect
        self._client.on_subscribe = self._on_subscribe
        self._client.on_disconnect = self._on_disconnect
        self._client.on_connect_fail = self._on_connect_fail
        self._client.on_message = self._on_message

    @property
    def status(self) -> MqttStatus:
        return "connected" if self._connected.is_set() else "disconnected"

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            raise RuntimeError("MQTT subscriber already started")
        self._stop.clear()
        self._thread = Thread(target=self._run, name="mqtt-telemetry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._connected.clear()
        self._client.disconnect()
        if self._thread is not None:
            self._thread.join()

    def _run(self) -> None:
        self._retry_delay = 1.0
        while not self._stop.is_set():
            try:
                self._client.connect_async(self._host, self._port, keepalive=60)
                if self._stop.is_set():
                    self._client.disconnect()
                    break
                # Paho handles ordinary transport reconnects. An intentional disconnect
                # after a DB failure ends this loop; the supervisor reconnects the same
                # persistent session so Mosquitto can resend the unacknowledged delivery.
                self._client.loop_forever(retry_first_connection=True)
            except Exception:
                # Transport/driver exceptions may include credentials; log no exception text.
                logger.warning("MQTT worker failed; reconnecting")
                self._client.disconnect()
            finally:
                self._connected.clear()
            if self._stop.wait(self._retry_delay):
                break
            self._retry_delay = min(self._retry_delay * 2, 30.0)

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: object,
        flags: mqtt.ConnectFlags,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        self._connected.clear()
        self._subscription_mid = None
        if self._stop.is_set():
            client.disconnect()
        elif reason_code.is_failure:
            logger.warning("MQTT connection rejected")
        else:
            result, self._subscription_mid = client.subscribe(self._topic, qos=1)
            if result != mqtt.MQTT_ERR_SUCCESS:
                logger.warning("MQTT subscription could not be sent")
                client.disconnect()

    def _on_subscribe(
        self,
        client: mqtt.Client,
        userdata: object,
        mid: int,
        reason_codes: list[ReasonCode],
        properties: Properties | None,
    ) -> None:
        if mid != self._subscription_mid or self._stop.is_set():
            return
        if len(reason_codes) == 1 and reason_codes[0] == 1:
            self._retry_delay = 1.0
            self._connected.set()
            logger.info("MQTT telemetry subscription connected")
        else:
            logger.warning("MQTT QoS 1 subscription rejected")
            client.disconnect()

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: object,
        flags: mqtt.DisconnectFlags,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        self._connected.clear()

    def _on_connect_fail(self, client: mqtt.Client, userdata: object) -> None:
        self._connected.clear()
        logger.warning("MQTT connection unavailable; retrying")

    def _on_message(self, client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage) -> None:
        if self._stop.is_set():
            return
        try:
            # A persistent session can carry an older subscription. Accept only the
            # configured scope, independently of the broker's subscription/ACL checks.
            try:
                topic = message.topic
            except UnicodeError:
                raise PermanentRejection("Invalid topic encoding") from None
            if topic != self._topic:
                raise PermanentRejection("Delivery outside configured subscription")
            if message.qos != 1:
                raise PermanentRejection("Expected QoS 1 telemetry")
            outcome = self._ingestor.ingest(topic, message.payload)
            logger.info("MQTT telemetry %s", outcome.value)
        except PermanentRejection:
            logger.warning("MQTT telemetry permanently rejected")
        except Exception:
            logger.warning("MQTT telemetry processing failed; reconnecting without acknowledgement")
            self._connected.clear()
            client.disconnect()
            return
        # Poison messages are intentionally consumed. Valid messages reach this point
        # only after commit, including a committed ON CONFLICT duplicate check.
        if message.qos > 0 and client.ack(message.mid, message.qos) != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("MQTT acknowledgement failed; reconnecting")
            self._connected.clear()
            client.disconnect()
