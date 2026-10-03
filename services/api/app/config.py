from pydantic import HttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: SecretStr | None = None
    migration_database_url: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    # MQTT is optional: without MQTT_HOST the API still serves data and accepts HTTP telemetry.
    mqtt_host: str | None = None
    mqtt_port: int = 1883
    mqtt_username: str | None = None
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
