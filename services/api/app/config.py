from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: SecretStr | None = None
    migration_database_url: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
