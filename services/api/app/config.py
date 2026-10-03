from pathlib import Path

from pydantic import Field, FilePath, HttpUrl, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.topics import Channel, parse_device_topic


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    database_url: SecretStr | None = None
    migration_database_url: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    # MQTT is optional: without MQTT_HOST the API still serves data and accepts HTTP telemetry.
    mqtt_host: str | None = None
    mqtt_port: int = Field(default=8883, ge=1, le=65535)
    mqtt_tls: bool = True
    # MQTT_CA_FILE is shared with the simulator; MQTT_CA_CERT remains a legacy alias.
    mqtt_ca_file: FilePath | None = None
    mqtt_ca_cert: Path | None = None
    mqtt_client_id: str | None = Field(default=None, min_length=1, max_length=128)
    mqtt_telemetry_topic: str | None = None
    mqtt_username: SecretStr | None = None
    mqtt_password: SecretStr | None = None
    mqtt_topic_prefix: str = "optimesh/v1"
    # A device is offline when no telemetry arrived for this long.
    device_stale_after_s: float = 15.0
    # Devices must acknowledge a command within this time or it expires.
    command_ttl_s: float = 15.0

    # Supabase project whose signing keys verify bearer tokens on the /sites routes.
    supabase_url: HttpUrl | None = None

    @field_validator("supabase_url")
    @classmethod
    def validate_project_url(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and (
            value.scheme != "https"
            or value.username is not None
            or value.password is not None
            or value.path not in ("", "/")
            or value.query is not None
            or value.fragment is not None
        ):
            raise ValueError(
                "SUPABASE_URL must be an HTTPS project URL without a path or credentials"
            )
        return value

    @field_validator("mqtt_host")
    @classmethod
    def validate_mqtt_host(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or any(char.isspace() for char in value) or any(c in value for c in "/@")
        ):
            raise ValueError("MQTT_HOST must be a hostname or IP without credentials or a URI")
        return value

    @field_validator("mqtt_topic_prefix")
    @classmethod
    def validate_mqtt_prefix(cls, value: str) -> str:
        if not value or any(c in value for c in "+#\x00") or value.endswith("/"):
            raise ValueError("MQTT_TOPIC_PREFIX must be a nonempty literal prefix")
        return value

    @model_validator(mode="after")
    def require_mqtt_configuration(self) -> "Settings":
        if self.mqtt_ca_file is not None and self.mqtt_ca_cert is not None:
            if self.mqtt_ca_file.resolve() != self.mqtt_ca_cert.resolve():
                raise ValueError("MQTT_CA_FILE and MQTT_CA_CERT must refer to the same CA")
        ca = self.mqtt_ca_file or self.mqtt_ca_cert
        if ca is not None and not self.mqtt_tls:
            raise ValueError("MQTT CA is set but MQTT_TLS is false; set MQTT_TLS=true")
        if self.mqtt_telemetry_topic is not None:
            parts = parse_device_topic(self.mqtt_topic_prefix, self.mqtt_telemetry_topic)
            if parts is None or parts.channel != Channel.TELEMETRY:
                raise ValueError("MQTT_TELEMETRY_TOPIC must be an exact telemetry topic")
        if self.mqtt_host is None:
            return self
        if not self.mqtt_tls:
            # Preserve the anonymous local simulator broker, never downgrade a remote broker.
            if self.mqtt_host not in ("localhost", "127.0.0.1", "::1", "mqtt") or any(
                v is not None for v in (ca, self.mqtt_username, self.mqtt_password)
            ):
                raise ValueError(
                    "Plain MQTT is allowed only for an explicit anonymous local development broker"
                )
        elif any(
            not v
            for v in (
                self.database_url,
                ca,
                self.mqtt_username,
                self.mqtt_password,
                self.mqtt_client_id,
            )
        ):
            raise ValueError(
                "TLS MQTT requires database, CA, backend credentials and stable client ID"
            )
        return self
