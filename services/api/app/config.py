from pathlib import Path

from pydantic import Field, HttpUrl, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.telemetry_ingest import parse_telemetry_topic


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    database_url: SecretStr | None = None
    migration_database_url: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]

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

    # MQTT is opt-in. Host unset means no subscriber or broker connection.
    mqtt_host: str | None = None
    mqtt_port: int = Field(default=8883, ge=1, le=65535)
    mqtt_ca_cert: Path | None = None
    mqtt_username: SecretStr | None = None
    mqtt_password: SecretStr | None = None
    mqtt_client_id: str | None = Field(default=None, min_length=1, max_length=128)
    mqtt_telemetry_topic: str | None = None

    @field_validator("mqtt_host")
    @classmethod
    def validate_mqtt_host(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or any(char.isspace() for char in value) or any(c in value for c in "/@")
        ):
            raise ValueError("MQTT_HOST must be a hostname or IP without credentials or a URI")
        return value

    @field_validator("mqtt_telemetry_topic")
    @classmethod
    def validate_mqtt_topic(cls, value: str | None) -> str | None:
        if value is not None:
            parse_telemetry_topic(value)
        return value

    @model_validator(mode="after")
    def require_mqtt_configuration(self) -> "Settings":
        if self.mqtt_host is not None:
            if any(
                value is None
                for value in (
                    self.database_url,
                    self.mqtt_ca_cert,
                    self.mqtt_username,
                    self.mqtt_password,
                    self.mqtt_client_id,
                    self.mqtt_telemetry_topic,
                )
            ):
                raise ValueError(
                    "MQTT requires database, CA, backend credentials, client ID and topic"
                )
            if not self.mqtt_username or not self.mqtt_password:
                raise ValueError("MQTT backend credentials must not be empty")
        return self
