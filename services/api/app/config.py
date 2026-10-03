from pydantic import SecretStr
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
